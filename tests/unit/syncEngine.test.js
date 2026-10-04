import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSyncClient } from '../../src/sync/client.js'
import { createSyncEngine } from '../../src/sync/engine.js'
import { createStore } from '../../src/data/store.js'
import { createFakeBackend } from '../support/fakeBackend.js'

const NOW = '2026-10-05T01:00:00.000Z'
const URL = 'https://script.google.com/macros/s/AKfycbx/exec'

const memoryKv = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

const memoryStorage = () => {
  let saved = null
  return { load: () => saved, save: (s) => ((saved = s), true), clear: () => ((saved = null), true) }
}

// 실제 Logic.gs 규칙을 쓰는 가짜 Apps Script (tests/support/fakeBackend.js)
const fakeServer = () => {
  const backend = createFakeBackend({ token: 'tok0123456789abcdef' })
  return { db: backend.db, fetchImpl: vi.fn(backend.fetchImpl) }
}

const makeDevice = (server, kv = memoryKv(), storage = memoryStorage()) => {
  let n = 0
  const engineRef = {}
  const store = createStore({
    storage,
    now: () => NOW,
    makeId: () => `${Math.random().toString(36).slice(2)}-${++n}`,
    onLocalChange: (change) => engineRef.engine?.recordLocalChange(change),
  })
  const engine = createSyncEngine({
    store,
    kv,
    createClient: (config) => createSyncClient({ ...config, fetchImpl: server.fetchImpl }),
    now: () => NOW,
  })
  engineRef.engine = engine
  return { store, engine, kv }
}

const CONFIG = { url: URL, token: 'tok0123456789abcdef' }
const partInput = { partNo: 'SK-AD-001', name: '덕트', unit: 'EA', safetyStock: 5 }

describe('createSyncClient', () => {
  it('POST(text/plain)로 토큰과 함께 보낸다 (브라우저 사전 요청을 피하기 위함)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    const client = createSyncClient({ url: URL, token: 'tok0123456789abcdef', fetchImpl })
    await client.request('ping')
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toMatch(/text\/plain/)
    expect(JSON.parse(init.body)).toEqual({ action: 'ping', token: 'tok0123456789abcdef' })
  })

  it('네트워크 오류는 NETWORK 코드로 바꾼다', async () => {
    const client = createSyncClient({ url: URL, token: 't', fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    expect(await client.request('ping')).toMatchObject({ ok: false, code: 'NETWORK' })
  })

  it('JSON이 아닌 응답은 BAD_RESPONSE 코드로 바꾼다', async () => {
    const client = createSyncClient({ url: URL, token: 't', fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('x') } }) })
    expect(await client.request('ping')).toMatchObject({ ok: false, code: 'BAD_RESPONSE' })
  })

  it('HTTP 오류는 HTTP 코드로 바꾼다', async () => {
    const client = createSyncClient({ url: URL, token: 't', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
    expect(await client.request('ping')).toMatchObject({ ok: false, code: 'HTTP' })
  })
})

describe('createSyncEngine', () => {
  let server
  beforeEach(() => {
    server = fakeServer()
  })

  it('연결하지 않으면 아무것도 보내지 않는다', async () => {
    const { store, engine } = makeDevice(server)
    store.addPart(partInput)
    await engine.syncNow()
    expect(server.fetchImpl).not.toHaveBeenCalled()
    expect(engine.getStatus()).toMatchObject({ connected: false, pending: 0 })
  })

  it('연결 확인: 토큰이 틀리면 연결하지 않는다', async () => {
    const { engine } = makeDevice(server)
    const result = await engine.testConnection({ url: URL, token: 'wrongwrongwrongwrong' })
    expect(result.ok).toBe(false)
    expect(engine.getStatus().connected).toBe(false)
  })

  it('두 기기가 같은 시트를 통해 기록을 주고받는다', async () => {
    const a = makeDevice(server)
    const b = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    await b.engine.connect(CONFIG, 'download')

    a.store.addPart(partInput)
    a.store.recordInbound({ partNo: 'SK-AD-001', qty: 10, worker: '박입고' })
    expect(a.engine.getStatus().pending).toBe(2)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, state: 'ok' })

    await b.engine.syncNow()
    expect(b.store.getStockMap().get('SK-AD-001')).toBe(10)

    b.store.recordOutbound({ partNo: 'SK-AD-001', qty: 3 })
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(a.store.getStockMap().get('SK-AD-001')).toBe(7)
    expect(server.db.transactions).toHaveLength(2)
  })

  it('오프라인이면 보낼 목록에 남겨 두었다가 연결되면 보낸다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    const realFetch = server.fetchImpl.getMockImplementation()
    server.fetchImpl.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    a.store.addPart(partInput)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'offline', pending: 1 })

    server.fetchImpl.mockImplementation(realFetch)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', pending: 0 })
    expect(server.db.parts).toHaveLength(1)
  })

  it('보낼 목록과 연결 정보는 새로고침해도 남는다', async () => {
    const kv = memoryKv()
    const a = makeDevice(server, kv)
    await a.engine.connect(CONFIG, 'upload')
    server.fetchImpl.mockImplementation(async () => {
      throw new TypeError('offline')
    })
    a.store.addPart(partInput)
    const reloaded = makeDevice(server, kv)
    expect(reloaded.engine.getStatus()).toMatchObject({ connected: true, pending: 1 })
  })

  it('샘플 불러오기·초기화는 시트 전체를 바꾸고 다른 기기는 전체를 다시 받는다', async () => {
    const a = makeDevice(server)
    const b = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    await b.engine.connect(CONFIG, 'download')
    b.store.addPart({ ...partInput, partNo: 'OLD-1' })
    await b.engine.syncNow()

    await a.engine.syncNow()
    a.store.loadSample()
    await a.engine.syncNow()
    expect(server.db.parts).toHaveLength(25)

    await b.engine.syncNow()
    expect(b.store.getState().parts).toHaveLength(25)
    expect(b.store.getState().parts.some((p) => p.partNo === 'OLD-1')).toBe(false)
  })

  it('처음 연결할 때 upload는 이 기기 데이터로, download는 시트 데이터로 맞춘다', async () => {
    const a = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    expect(server.db.parts.map((p) => p.partNo)).toEqual(['SK-AD-001'])

    const b = makeDevice(server)
    b.store.addPart({ ...partInput, partNo: 'LOCAL-ONLY' })
    await b.engine.connect(CONFIG, 'download')
    expect(b.store.getState().parts.map((p) => p.partNo)).toEqual(['SK-AD-001'])
  })

  it('merge는 양쪽 데이터를 합친다', async () => {
    const a = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    const b = makeDevice(server)
    b.store.addPart({ ...partInput, partNo: 'SK-PD-001' })
    await b.engine.connect(CONFIG, 'merge')
    expect(b.store.getState().parts.map((p) => p.partNo).sort()).toEqual(['SK-AD-001', 'SK-PD-001'])
    expect(server.db.parts).toHaveLength(2)
  })

  it('토큰이 틀리면 오류 상태로 알리고 보낼 목록은 지키며, 연결 해제하면 동기화를 멈춘다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    server.fetchImpl.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: false, code: 'UNAUTHORIZED', error: '연결 토큰이 맞지 않습니다.' }) }))
    a.store.addPart(partInput)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'error', pending: 1 })
    expect(a.engine.getStatus().message).toMatch(/토큰/)

    a.engine.disconnect()
    expect(a.engine.getStatus()).toMatchObject({ connected: false })
  })

  it('상태가 바뀌면 구독자에게 알린다', async () => {
    const a = makeDevice(server)
    const listener = vi.fn()
    a.engine.subscribe(listener)
    await a.engine.connect(CONFIG, 'upload')
    expect(listener).toHaveBeenCalled()
  })

  it('서버가 거부한 기록은 보낼 목록에서 빼고 상태에 이유를 남긴다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    server.fetchImpl.mockImplementation(async (url, init) => {
      const req = JSON.parse(init.body)
      const body = req.action === 'push'
        ? { ok: true, dataVersion: server.db.version, acceptedIds: [], duplicateIds: [], rejected: [], rejectedParts: req.parts.map((p) => ({ partNo: p.partNo, reason: '품명과 단위는 꼭 있어야 합니다.' })), txTotal: 0 }
        : { ok: true, dataVersion: server.db.version, full: false, parts: [], transactions: [], txTotal: 0 }
      return { ok: true, json: async () => body }
    })
    a.store.addPart(partInput)
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', pending: 0 })
    expect(a.engine.getStatus().rejected[0].reason).toMatch(/품명/)
  })

  it('동기화 중에 또 부르면 끝난 뒤 한 번 더 돌린다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    a.store.addPart(partInput)
    const first = a.engine.syncNow()
    a.store.recordInbound({ partNo: 'SK-AD-001', qty: 2 })
    const second = a.engine.syncNow()
    await Promise.all([first, second])
    expect(server.db.transactions).toHaveLength(1)
    expect(a.engine.getStatus().pending).toBe(0)
  })

  it('잘못된 연결 정보는 서버에 묻지 않고 거부한다', async () => {
    const a = makeDevice(server)
    const result = await a.engine.connect({ url: 'https://example.com', token: 'x' }, 'upload')
    expect(result.ok).toBe(false)
    expect(server.fetchImpl).not.toHaveBeenCalled()
  })

})

describe('리뷰 반영: 동기화 무결성', () => {
  let server
  beforeEach(() => {
    server = fakeServer()
  })

  it('H1: 시트 전체 바꾸기가 진행되는 동안 입력한 기록도 시트에 올라간다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    a.store.loadSample()
    server.db.hooks.replaceAll = async () => {
      a.store.recordInbound({ partNo: 'SK-AD-001', qty: 4, worker: '도중입력' })
    }
    await a.engine.syncNow()
    server.db.hooks.replaceAll = null
    await a.engine.syncNow()
    expect(server.db.transactions.some((t) => t.worker === '도중입력')).toBe(true)
    expect(a.engine.getStatus().pending).toBe(0)
  })

  it('H3: 다른 기기가 그사이 올린 기록이 있으면 시트 전체 바꾸기를 멈추고 충돌을 알린다', async () => {
    const a = makeDevice(server)
    const b = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    await b.engine.connect(CONFIG, 'download')
    b.store.recordInbound({ partNo: 'SK-AD-001', qty: 50 })
    await b.engine.syncNow()

    a.store.resetAll()
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ state: 'error', conflict: true })
    expect(server.db.transactions).toHaveLength(1)
  })

  it('H3: 충돌 후 "시트 데이터 받기"를 고르면 내 바꾸기를 취소하고 시트를 받는다', async () => {
    const a = makeDevice(server)
    const b = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    await b.engine.connect(CONFIG, 'download')
    b.store.recordInbound({ partNo: 'SK-AD-001', qty: 50 })
    await b.engine.syncNow()
    a.store.resetAll()
    await a.engine.syncNow()

    await a.engine.resolveConflict('download')
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', conflict: false })
    expect(a.store.getStockMap().get('SK-AD-001')).toBe(50)
  })

  it('H3: 충돌 후 "덮어쓰기"를 고르면 시트를 이 기기 데이터로 바꾼다', async () => {
    const a = makeDevice(server)
    const b = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    await b.engine.connect(CONFIG, 'download')
    b.store.recordInbound({ partNo: 'SK-AD-001', qty: 50 })
    await b.engine.syncNow()
    a.store.resetAll()
    await a.engine.syncNow()

    await a.engine.resolveConflict('overwrite')
    expect(a.engine.getStatus()).toMatchObject({ state: 'ok', conflict: false })
    expect(server.db.transactions).toHaveLength(0)
  })

  it('M2: 서버 응답 형식이 이상해도 "동기화 중"에 멈추지 않는다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    server.fetchImpl.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    a.store.addPart(partInput)
    await a.engine.syncNow()
    expect(a.engine.getStatus().state).toBe('error')
  })

  it('M3: 시트에 잘못 들어간 행은 받지 않고 알린다', async () => {
    const a = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    server.db.transactions = [...server.db.transactions, { id: 'manual', type: 'IN', partNo: 'SK-AD-001', qty: Number('abc'), createdAt: NOW }]
    await a.engine.syncNow()
    expect(a.store.getState().transactions.some((t) => t.id === 'manual')).toBe(false)
    expect(a.engine.getStatus().message).toMatch(/형식/)
  })

  it('M4: 브라우저 저장에 실패하면 받은 위치를 앞으로 옮기지 않는다', async () => {
    const a = makeDevice(server)
    const b = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    let failSave = false
    const flaky = memoryStorage()
    const flakyStorage = { ...flaky, save: (st) => (failSave ? false : flaky.save(st)) }
    const c = makeDevice(server, memoryKv(), flakyStorage)
    await c.engine.connect(CONFIG, 'download')

    b.store.addPart({ ...partInput, partNo: 'SK-PD-001' })
    await b.engine.connect(CONFIG, 'merge')
    a.store.recordInbound({ partNo: 'SK-AD-001', qty: 2 })
    await a.engine.syncNow()

    failSave = true
    await c.engine.syncNow()
    expect(c.engine.getStatus().state).toBe('error')
    failSave = false
    await c.engine.syncNow()
    expect(c.store.getStockMap().get('SK-AD-001')).toBe(2)
  })

  it('M5: "시트 데이터 받기"로 연결하다 실패하면 이 기기 데이터를 지우지 않는다', async () => {
    const a = makeDevice(server)
    a.store.addPart(partInput)
    server.db.hooks.pull = async () => {
      throw new TypeError('Failed to fetch')
    }
    const result = await a.engine.connect(CONFIG, 'download')
    expect(result.ok).toBe(false)
    expect(a.store.getState().parts).toHaveLength(1)
  })

  it('M7: 시트 행이 직접 지워지거나 정렬되면 전체를 다시 받는다', async () => {
    const a = makeDevice(server)
    a.store.addPart(partInput)
    await a.engine.connect(CONFIG, 'upload')
    a.store.recordInbound({ partNo: 'SK-AD-001', qty: 1 })
    a.store.recordInbound({ partNo: 'SK-AD-001', qty: 2 })
    await a.engine.syncNow()
    server.db.transactions = [...server.db.transactions].reverse()
    server.db.transactions = [...server.db.transactions, { id: 'late', type: 'IN', partNo: 'SK-AD-001', qty: 10, partner: '', worker: '', memo: '', refId: null, createdAt: NOW }]
    await a.engine.syncNow()
    expect(a.store.getStockMap().get('SK-AD-001')).toBe(13)
  })

  it('L: 서버가 아무것도 처리하지 않으면 보내기를 끝없이 반복하지 않는다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    server.fetchImpl.mockImplementation(async (url, init) => {
      const req = JSON.parse(init.body)
      const body = req.action === 'push'
        ? { ok: true, dataVersion: 'v2', revision: 1, acceptedIds: [], duplicateIds: [], rejected: [], rejectedParts: [], txTotal: 0 }
        : { ok: true, dataVersion: 'v2', revision: 1, full: false, parts: [], transactions: [], txTotal: 0 }
      return { ok: true, json: async () => body }
    })
    a.engine.recordLocalChange({ transactions: [{ id: 'stuck', type: 'IN', partNo: 'SK-AD-001', qty: 1, createdAt: NOW }] })
    await a.engine.syncNow()
    expect(a.engine.getStatus().state).toBe('error')
    expect(a.engine.getStatus().pending).toBe(1)
  })

  it('L: 동기화 도중 연결을 해제하면 연결 정보가 다시 생기지 않는다', async () => {
    const a = makeDevice(server)
    await a.engine.connect(CONFIG, 'upload')
    a.store.addPart(partInput)
    server.db.hooks.push = async () => {
      a.engine.disconnect()
    }
    await a.engine.syncNow()
    expect(a.engine.getStatus()).toMatchObject({ connected: false, pending: 0 })
    expect(a.kv.getItem('samkwang-inventory:sync-meta')).toBeNull()
  })
})

