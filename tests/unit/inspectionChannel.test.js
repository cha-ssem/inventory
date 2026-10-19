import { describe, it, expect, vi } from 'vitest'
import { createSyncClient } from '../../src/sync/client.js'
import { createSyncEngine } from '../../src/sync/engine.js'
import { createInspectionChannel, INSPECTION_SYNC_KEYS } from '../../src/sync/inspectionChannel.js'
import { createStore } from '../../src/data/store.js'
import { createInspectionStore } from '../../src/data/inspectionStore.js'
import { createFakeBackend } from '../support/fakeBackend.js'

const NOW = '2026-10-19T09:00:00.000Z'
const CONFIG = { url: 'https://script.google.com/macros/s/AKfycbx/exec', token: 'tok0123456789abcdef' }
const request = { siteId: 'ST-01', robotId: 'RV-01', priority: 'HIGH', title: '수문 점검' }

const memoryKv = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  }
}

const memoryStorage = ({ failSave = () => false } = {}) => {
  let saved = null
  return {
    load: () => saved,
    save: (s) => {
      if (failSave()) return false
      saved = s
      return true
    },
    clear: () => ((saved = null), true),
  }
}

const fakeServer = () => {
  const backend = createFakeBackend({ token: CONFIG.token })
  return { db: backend.db, fetchImpl: vi.fn(backend.fetchImpl) }
}

// 기기 한 대 = 입출고 저장소 + 점검 저장소 + 채널 + 동기화 엔진 (main.js와 같은 연결)
const makeDevice = (server, { name = 'A', storageOptions } = {}) => {
  let n = 0
  const kv = memoryKv()
  const refs = {}
  const store = createStore({ storage: memoryStorage(), now: () => NOW, onLocalChange: (c) => refs.engine?.recordLocalChange(c) })
  const inspection = createInspectionStore({
    storage: memoryStorage(storageOptions),
    now: () => NOW,
    makeId: () => `${name}-${++n}`,
    onLocalChange: (c) => refs.channel?.recordLocalChange(c),
  })
  const channel = createInspectionChannel({
    store: inspection,
    kv,
    isConnected: () => Boolean(refs.engine?.getConfig()),
    requestSync: () => refs.engine?.requestSync(),
  })
  const engine = createSyncEngine({
    store,
    kv,
    createClient: (config) => createSyncClient({ ...config, fetchImpl: server.fetchImpl }),
    now: () => NOW,
    channels: [channel],
  })
  Object.assign(refs, { engine, channel })
  return { store, inspection, channel, engine, kv }
}

const actions = (server) => server.fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).action)

describe('점검 동기화 채널', () => {
  it('연결하면 이 기기의 점검 데이터를 시트에 올린다 (입출고와 같은 연결·같은 동기화)', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    expect(await a.engine.connect(CONFIG, 'merge')).toEqual({ ok: true })
    expect(server.db.sites).toHaveLength(8)
    expect(server.db.robots).toHaveLength(6)
    expect(server.db.events).toHaveLength(a.inspection.getState().events.length)
    expect(actions(server)).toEqual(['ping', 'pull', 'inspPush', 'inspPull'])
    expect(a.channel.pending()).toBe(0)
  })

  it('다른 기기가 "시트 데이터 받기"로 연결하면 점검 데이터도 받는다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')

    const b = makeDevice(server, { name: 'B' })
    b.inspection.addRequest({ ...request, siteId: 'ST-99' }) // 현장이 없어 실패 → B는 빈 상태
    expect(await b.engine.connect(CONFIG, 'download')).toEqual({ ok: true })
    expect(b.inspection.getState().sites).toHaveLength(8)
    expect(b.inspection.listRequests({ status: 'open' })).toHaveLength(3)
  })

  it('한 기기에서 등록·배정한 점검이 다른 기기에 반영된다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const b = makeDevice(server, { name: 'B' })
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    await b.engine.connect(CONFIG, 'download')

    const { requestId } = a.inspection.addRequest(request, '김수중').value
    a.inspection.transition(requestId, 'ASSIGN', { assignee: '이로봇' })
    expect(a.engine.getStatus().pending).toBe(2)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', pending: 0 })

    await b.engine.syncNow()
    expect(b.inspection.getRequest(requestId)).toMatchObject({ status: 'ASSIGNED', assignee: '이로봇' })
    // 받은 위치 이후만 받는다
    expect(server.fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body)).filter((r) => r.action === 'inspPull').at(-1).offset).toBeGreaterThan(0)
  })

  it('양쪽이 따로 바꿔도 이벤트를 합쳐서 둘 다 남긴다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    const b = makeDevice(server, { name: 'B' })
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    await b.engine.connect(CONFIG, 'download')
    const fromA = a.inspection.addRequest({ ...request, title: 'A 요청' }).value
    const fromB = b.inspection.addRequest({ ...request, title: 'B 요청' }).value
    await a.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(a.inspection.getRequest(fromB.requestId)?.title).toBe('B 요청')
    expect(b.inspection.getRequest(fromA.requestId)?.title).toBe('A 요청')
  })

  it('오프라인에서 바꾼 것은 쌓아 두었다가 연결되면 보낸다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    server.db.online = false
    a.inspection.addRequest(request)
    expect((await a.engine.syncNow()).state).toBe('offline')
    expect(a.channel.pending()).toBe(1)
    server.db.online = true
    expect((await a.engine.syncNow()).state).toBe('ok')
    expect(a.channel.pending()).toBe(0)
  })

  it('"시트 데이터 받기"로 연결해도 이 기기에만 있던 점검 기록은 지우지 않고 합친다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    const b = makeDevice(server, { name: 'B' })
    b.inspection.loadSample()
    const onlyB = b.inspection.addRequest({ ...request, title: 'B에만 있던 요청' }).value
    await b.engine.connect(CONFIG, 'download')
    expect(b.inspection.getRequest(onlyB.requestId)).toBeDefined()
    expect(server.db.events.some((e) => e.id === onlyB.id)).toBe(true)
  })

  it('연결하지 않았으면 보낼 목록을 만들지 않는다', () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    a.inspection.addRequest(request)
    expect(a.channel.pending()).toBe(0)
  })

  it('연결된 채로 샘플을 다시 불러오면 전체를 다시 보낸다 (시트에 이미 있는 것은 중복으로 처리)', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    a.inspection.loadSample()
    expect(a.channel.pending()).toBeGreaterThan(0)
    await a.engine.syncNow()
    expect(server.db.events).toHaveLength(a.inspection.getState().events.length)
  })

  it('현장 정보를 고치면 수정일시가 최신인 쪽을 남긴다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    const newer = { ...server.db.sites[0], name: '시트에서 바뀐 이름', updatedAt: '2026-10-19T10:00:00.000Z' }
    server.db.sites = [newer, ...server.db.sites.slice(1)]
    await a.engine.syncNow()
    expect(a.inspection.getState().sites.find((s) => s.siteId === newer.siteId).name).toBe('시트에서 바뀐 이름')
  })

  it('시트가 거부한 기록은 보낼 목록에서 빼고 개수를 알린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    a.channel.recordLocalChange({ events: [{ id: 'bad id!', requestId: 'R-1', type: 'START', at: NOW, actor: '', payload: {} }] })
    const status = await a.engine.syncNow()
    expect(status.state).toBe('ok')
    expect(status.message).toMatch(/점검 기록 1건/)
    expect(a.channel.pending()).toBe(0)
  })

  it('Apps Script가 예전 버전이면 입출고 동기화는 그대로 하고, 점검 기록은 남겨 두고 안내한다', async () => {
    const server = fakeServer()
    server.db.inspectionSupported = false
    const a = makeDevice(server)
    a.inspection.loadSample()
    expect(await a.engine.connect(CONFIG, 'merge')).toEqual({ ok: true })
    const status = a.engine.getStatus()
    expect(status.state).toBe('ok')
    expect(status.message).toMatch(/다시 배포/)
    expect(a.channel.pending()).toBeGreaterThan(0)
  })

  it('받은 점검 데이터를 저장하지 못하면 받은 위치를 옮기지 않는다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    let failing = true
    const b = makeDevice(server, { name: 'B', storageOptions: { failSave: () => failing } })
    const result = await b.engine.connect(CONFIG, 'download')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/저장하지 못했습니다/)
    failing = false
    expect(await b.engine.connect(CONFIG, 'download')).toEqual({ ok: true })
    expect(b.inspection.getState().sites).toHaveLength(8)
  })

  it('연결을 끊으면 점검 채널의 보낼 목록·진행 상태도 지운다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    server.db.online = false
    a.inspection.addRequest(request)
    a.engine.disconnect()
    expect(a.kv.keys().filter((k) => Object.values(INSPECTION_SYNC_KEYS).includes(k))).toEqual([])
    expect(a.channel.pending()).toBe(0)
  })

  it('동기화 중에 연결을 끊으면 받은 결과를 버린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    a.inspection.loadSample()
    await a.engine.connect(CONFIG, 'merge')
    server.db.events = [...server.db.events, { id: 'X-1', requestId: 'X-R', type: 'REQUEST', at: NOW, actor: '', payload: { ...request, source: 'MANUAL' } }]
    server.db.hooks.inspPull = async () => a.engine.disconnect()
    await a.engine.syncNow()
    expect(a.inspection.getRequest('X-R')).toBeUndefined()
  })

  it('형식이 틀린 응답이면 오류로 알린다', async () => {
    const server = fakeServer()
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'merge')
    server.fetchImpl.mockImplementation(async (url, init) => {
      const { action } = JSON.parse(init.body)
      if (action === 'inspPull') return { ok: true, json: async () => ({ ok: true, sites: 'x' }) }
      return createFakeBackend({ token: CONFIG.token }).fetchImpl(url, init)
    })
    const status = await a.engine.syncNow()
    expect(status.state).toBe('error')
    expect(status.message).toMatch(/형식/)
  })
})
