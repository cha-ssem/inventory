import { describe, it, expect, vi } from 'vitest'
import { createSyncClient } from '../../src/sync/client.js'
import { createSyncEngine } from '../../src/sync/engine.js'
import { createReportChannel, REPORT_SYNC_KEYS } from '../../src/sync/reportChannel.js'
import { createStore } from '../../src/data/store.js'
import { createReportStore } from '../../src/data/reportStore.js'
import { createFakeBackend } from '../support/fakeBackend.js'

const CONFIG = { url: 'https://script.google.com/macros/s/AKfycbx/exec', token: 'tok0123456789abcdef' }
const snapshot = { stats: { completed: 0, ok: 0, issue: 0, fail: 0, newRequests: 0, open: 0, urgentOpen: 0, partsUsed: 0 }, completed: [], newRequests: [], open: [] }
const input = { period: 'DAILY', from: '2026-10-19', to: '2026-10-19', siteIds: ['ST-01'], siteNames: ['청솔댐 취수탑'] }

const memoryKv = ({ failSet = () => false } = {}) => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failSet(k)) throw new Error('QuotaExceededError')
      map.set(k, String(v))
    },
    removeItem: (k) => map.delete(k),
  }
}

const memoryStorage = ({ failSave = () => false } = {}) => {
  let saved = null
  return { load: () => saved, save: (s) => (failSave() ? false : ((saved = s), true)), clear: () => ((saved = null), true) }
}

const fakeServer = () => {
  const backend = createFakeBackend({ token: CONFIG.token })
  return { db: backend.db, fetchImpl: vi.fn(backend.fetchImpl) }
}

// 기기 한 대 = 입출고 저장소 + 보고서 저장소 + 채널 + 동기화 엔진 (main.js와 같은 연결)
const makeDevice = (server, { name = 'A', storageOptions, kvOptions } = {}) => {
  let n = 0
  let clock = 0
  const time = { now: 0 }
  const kv = memoryKv(kvOptions)
  const refs = {}
  const store = createStore({ storage: memoryStorage(), onLocalChange: (c) => refs.engine?.recordLocalChange(c) })
  const reports = createReportStore({
    storage: memoryStorage(storageOptions),
    // 고칠 때마다 시각이 흐르게 한다 (같은 상태끼리는 나중 것이 이긴다)
    now: () => new Date(Date.UTC(2026, 9, 19, 9, 0, clock++)).toISOString(),
    makeId: () => `${name}-${++n}`,
    onLocalChange: (r) => refs.channel?.recordLocalChange(r),
  })
  const channel = createReportChannel({
    store: reports,
    kv,
    isConnected: () => Boolean(refs.engine?.getConfig()),
    requestSync: () => refs.engine?.requestSync(),
    clock: () => time.now,
  })
  const engine = createSyncEngine({
    store,
    kv,
    createClient: (config) => createSyncClient({ ...config, fetchImpl: server.fetchImpl }),
    channels: [channel],
  })
  Object.assign(refs, { engine, channel })
  const finalized = (author = '') => {
    const { reportId } = reports.create(input, snapshot, author).value
    reports.update(reportId, { summary: `${name} 요약` })
    return reports.finalize(reportId).value
  }
  return { reports, channel, engine, kv, finalized, time }
}

const actions = (server) => server.fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).action)

describe('보고서 동기화 채널', () => {
  it('한 기기에서 확정한 보고서가 다른 기기에 보인다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const b = makeDevice(server, { name: 'B' })
    await a.engine.connect(CONFIG, 'merge')
    await b.engine.connect(CONFIG, 'download')

    const report = a.finalized('김수중')
    expect(a.engine.getStatus().pending).toBe(1)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', pending: 0 })

    await b.engine.syncNow()
    expect(b.reports.get(report.reportId)).toEqual(report)
    expect(actions(server)).toContain('reportPush')
  })

  it('초안은 보내지 않는다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    const { reportId } = a.reports.create(input, snapshot).value
    a.reports.update(reportId, { summary: '쓰는 중' })
    expect(a.channel.pending()).toBe(0)
    await a.engine.syncNow()
    expect(server.db.reportStore).toHaveLength(0)
  })

  it('연결하기 전에 확정한 보고서도 연결할 때 올라간다 (받기로 연결해도)', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const report = a.finalized()
    a.reports.create(input, snapshot) // 초안은 그대로 이 기기에만
    expect(await a.engine.connect(CONFIG, 'download')).toEqual({ ok: true })
    expect(server.db.reportStore).toHaveLength(1)

    const b = makeDevice(server, { name: 'B' })
    await b.engine.connect(CONFIG, 'download')
    expect(b.reports.list().map((r) => r.reportId)).toEqual([report.reportId])
  })

  it('제출하면 다른 기기에서도 제출 완료로 바뀐다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const b = makeDevice(server, { name: 'B' })
    await a.engine.connect(CONFIG, 'merge')
    await b.engine.connect(CONFIG, 'merge')
    const report = a.finalized()
    await a.engine.syncNow()
    await b.engine.syncNow()

    b.reports.markSubmitted(report.reportId, { submittedAt: '2026-10-19T10:00:00.000Z', mailStatus: 'SENT', recipients: 1 })
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(a.reports.get(report.reportId)).toMatchObject({ status: 'SUBMITTED', submission: { mailStatus: 'SENT' } })
  })

  it('다른 기기에서 이미 수정본을 만들었으면 그 수정본을 연다 (같은 버전이 둘 생기지 않게)', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const b = makeDevice(server, { name: 'B' })
    await a.engine.connect(CONFIG, 'merge')
    await b.engine.connect(CONFIG, 'merge')
    const report = a.finalized()
    const revised = a.reports.revise(report.reportId).value
    a.reports.update(revised.reportId, { summary: 'v2' })
    a.reports.finalize(revised.reportId)
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect(b.reports.revise(report.reportId)).toMatchObject({ ok: true, existing: true, value: { reportId: revised.reportId } })
  })

  it('받은 위치 이후만 받는다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    a.finalized()
    await a.engine.syncNow()
    await a.engine.syncNow()
    const pulls = server.fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body)).filter((r) => r.action === 'reportPull')
    expect(pulls.at(-1).sinceRev).toBe(1)
  })

  it('오프라인에서 확정한 보고서는 쌓아 두었다가 연결되면 보낸다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    server.db.online = false
    a.finalized()
    expect((await a.engine.syncNow()).state).toBe('offline')
    expect(a.channel.pending()).toBe(1)
    server.db.online = true
    await a.engine.syncNow()
    expect(a.channel.pending()).toBe(0)
    expect(server.db.reportStore).toHaveLength(1)
  })

  it('보내는 사이 제출 상태가 바뀌면 다시 보낸다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    const report = a.finalized()
    server.db.hooks.reportPush = async () => {
      server.db.hooks.reportPush = null
      a.reports.markSubmitted(report.reportId, { submittedAt: '2026-10-19T10:00:00.000Z', mailStatus: 'SENT', recipients: 1 })
    }
    await a.engine.syncNow()
    expect(a.channel.pending()).toBe(0)
    expect(server.db.reportStore[0][2]).toBe('SUBMITTED')
  })

  it('예전 Apps Script 배포면 입출고 동기화는 그대로 두고 다시 배포하라고 알린다', async () => {
    const server = fakeServer()
    server.db.reportSyncSupported = false
    const a = makeDevice(server)
    a.finalized()
    expect(await a.engine.connect(CONFIG, 'merge')).toEqual({ ok: true })
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', message: expect.stringContaining('다시 배포') })
    expect(a.channel.pending()).toBe(1)
  })

  it('받은 보고서를 저장하지 못하면 받은 위치를 옮기지 않는다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    a.finalized()
    await a.engine.syncNow()

    let failing = true
    const b = makeDevice(server, { name: 'B', storageOptions: { failSave: () => failing } })
    await b.engine.connect(CONFIG, 'merge')
    expect(b.engine.getStatus()).toMatchObject({ state: 'error', channelFailed: true })
    expect(JSON.parse(b.kv.getItem(REPORT_SYNC_KEYS.meta)).rev).toBe(0)
    failing = false
    // 바로 다시 받지 않는다 (같은 쪽을 30초마다 받아 서버 한도를 쓰지 않도록)
    const pulls = () => server.db.requests.filter((a) => a === 'reportPull').length
    const before = pulls()
    await b.engine.syncNow()
    expect(pulls()).toBe(before)
    expect(b.engine.getStatus().message).toMatch(/저장하지 못했습니다/)
    b.time.now += 60_000
    await b.engine.syncNow()
    expect(b.reports.list()).toHaveLength(1)
    expect(b.engine.getStatus().state).toBe('ok')
  })

  it('시트에서 형식이 깨진 보고서는 받지 않고 알린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    a.finalized()
    await a.engine.syncNow()
    const row = server.db.reportStore[0]
    server.db.reportStore = [[...row.slice(0, 5), row[5] + 1, '~{"reportId":"A-1","status":"FINALIZED","version":1,"updatedAt":"2026-10-19T09:00:00.000Z"}']]
    server.db.reportRev += 1

    const b = makeDevice(server, { name: 'B' })
    await b.engine.connect(CONFIG, 'merge')
    expect(b.reports.list()).toHaveLength(0)
    expect(b.engine.getStatus().message).toMatch(/형식이 잘못된 보고서 1건/)
  })

  it('연결을 끊으면 보낼 목록과 받은 위치를 지운다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    a.engine.disconnect()
    expect(a.kv.getItem(REPORT_SYNC_KEYS.outbox)).toBeNull()
    expect(a.kv.getItem(REPORT_SYNC_KEYS.meta)).toBeNull()
    a.finalized()
    expect(a.channel.pending()).toBe(0)
  })

  it('시트가 한 쪽씩 주면 이어 받아 한 번의 동기화로 모두 받는다', async () => {
    const server = fakeServer()
    server.db.reportPage = 2
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    a.finalized()
    a.finalized()
    a.finalized()
    a.finalized()
    a.finalized()
    await a.engine.syncNow()

    const b = makeDevice(server, { name: 'B' })
    await b.engine.connect(CONFIG, 'merge')
    expect(b.reports.list()).toHaveLength(5)
    expect(JSON.parse(b.kv.getItem(REPORT_SYNC_KEYS.meta)).rev).toBe(server.db.reportRev)
  })

  it('보낼 목록을 저장하지 못했으면 다음 동기화 때 확정·제출본을 모두 다시 넣어 보낸다', async () => {
    const server = fakeServer()
    let failing = false
    const a = makeDevice(server, { kvOptions: { failSet: (k) => failing && k === REPORT_SYNC_KEYS.outbox } })
    await a.engine.connect(CONFIG, 'merge')
    failing = true
    a.finalized()
    failing = false
    expect(a.channel.pending()).toBe(0)
    await a.engine.syncNow()
    expect(server.db.reportStore).toHaveLength(1)
  })

  it('다른 기기가 받지 못할 모양의 보고서는 보내지 않고 알린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    const report = a.finalized()
    // 예전 버전에서 만든 보고서처럼 숫자 하나가 빠진 경우
    a.reports.applyRemote((list) => list.map((r) => ({ ...r, snapshot: { ...r.snapshot, stats: { ...r.snapshot.stats, urgentOpen: undefined } } })))
    a.channel.recordLocalChange(a.reports.get(report.reportId))
    await a.engine.syncNow()
    expect(server.db.reportStore).toHaveLength(0)
    expect(a.channel.pending()).toBe(0)
    expect(a.engine.getStatus().message).toMatch(/주고받지 못한 보고서 1건/)
  })

  it('보고서 동기화가 생기기 전부터 연결돼 있던 기기도 예전 확정·제출본을 올린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    const old = a.finalized()
    a.reports.create(input, snapshot) // 초안은 올리지 않음
    // 업데이트 전 앱처럼 보고서 동기화 정보가 하나도 없는 상태
    a.kv.removeItem(REPORT_SYNC_KEYS.outbox)
    a.kv.removeItem(REPORT_SYNC_KEYS.meta)
    server.db.reportStore = []
    server.db.reportRev = 0

    await a.engine.syncNow()
    expect(server.db.reportStore.map((row) => row[0])).toEqual([old.reportId])

    const b = makeDevice(server, { name: 'B' })
    await b.engine.connect(CONFIG, 'merge')
    expect(b.reports.list().map((r) => r.reportId)).toEqual([old.reportId])

    // 두 번째 동기화부터는 다시 넣지 않는다
    const pushes = () => server.db.requests.filter((x) => x === 'reportPush').length
    const before = pushes()
    await a.engine.syncNow()
    expect(pushes()).toBe(before)
  })

  it('예전 버전에서 받은 위치만 남아 있는 기기도 예전 확정·제출본을 한 번 올린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    const old = a.finalized()
    // 처음 넣기 표시(seeded)가 없던 버전이 받은 위치만 저장해 둔 상태
    a.kv.removeItem(REPORT_SYNC_KEYS.outbox)
    a.kv.setItem(REPORT_SYNC_KEYS.meta, JSON.stringify({ rev: 0 }))
    server.db.reportStore = []
    server.db.reportRev = 0

    await a.engine.syncNow()
    expect(server.db.reportStore.map((row) => row[0])).toEqual([old.reportId])
    expect(JSON.parse(a.kv.getItem(REPORT_SYNC_KEYS.meta)).seeded).toBe(true)
  })

  it('받은 목록: 마지막으로 받은 건수를 묶음별로 남기고, 아무것도 안 받은 동기화는 그대로 둔다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const b = makeDevice(server, { name: 'B' })
    await a.engine.connect(CONFIG, 'merge')
    a.finalized()
    a.finalized()
    await a.engine.syncNow()
    expect(a.engine.getStatus().lastReceived).toBeNull() // 자기가 올린 것은 받은 것으로 세지 않는다

    await b.engine.connect(CONFIG, 'merge')
    expect(b.engine.getStatus().lastReceived).toMatchObject({ items: [{ label: '보고서', count: 2 }] })
    const first = b.engine.getStatus().lastReceived
    await b.engine.syncNow()
    expect(b.engine.getStatus().lastReceived).toBe(first)
  })
})

