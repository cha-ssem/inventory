import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSyncClient } from '../../src/sync/client.js'
import { createSyncEngine } from '../../src/sync/engine.js'
import { createStore } from '../../src/data/store.js'
import { createFakeBackend } from '../support/fakeBackend.js'

// 동기화 엔진에 붙는 채널(입출고 외의 데이터 묶음)이 같은 연결·같은 동기화 주기를 쓰는지 확인한다
const NOW = '2026-10-19T01:00:00.000Z'
const URL = 'https://script.google.com/macros/s/AKfycbx/exec'
const CONFIG = { url: URL, token: 'tok0123456789abcdef' }

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

const fakeChannel = (overrides = {}) => ({
  name: 'test',
  label: '현장점검',
  keys: ['test:outbox'],
  sync: vi.fn(async () => ({ ok: true })),
  pending: vi.fn(() => 0),
  onConnect: vi.fn(),
  reset: vi.fn(),
  ...overrides,
})

const makeDevice = (channels) => {
  const backend = createFakeBackend({ token: CONFIG.token })
  const fetchImpl = vi.fn(backend.fetchImpl)
  const store = createStore({ storage: memoryStorage(), now: () => NOW })
  const engine = createSyncEngine({
    store,
    kv: memoryKv(),
    createClient: (config) => createSyncClient({ ...config, fetchImpl }),
    now: () => NOW,
    channels,
  })
  return { store, engine, fetchImpl, db: backend.db }
}

describe('동기화 채널', () => {
  let channel

  beforeEach(() => {
    channel = fakeChannel()
  })

  it('입출고 동기화가 끝난 뒤 같은 연결(client)로 채널을 동기화한다', async () => {
    const { engine, fetchImpl } = makeDevice([channel])
    const result = await engine.connect(CONFIG, 'merge')
    expect(result).toEqual({ ok: true })
    expect(channel.sync).toHaveBeenCalledTimes(1)
    const [client, isCurrent] = channel.sync.mock.calls[0]
    expect(typeof client.request).toBe('function')
    expect(isCurrent()).toBe(true)
    // 입출고 push·pull 요청이 채널보다 먼저 나간다
    const actions = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).action)
    expect(actions).toEqual(['ping', 'pull'])
  })

  it('연결 방식(mode)을 채널에도 알린다', async () => {
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'download')
    expect(channel.onConnect).toHaveBeenCalledWith('download')
    expect(channel.onConnect.mock.invocationCallOrder[0]).toBeLessThan(channel.sync.mock.invocationCallOrder[0])
  })

  it('채널의 안내 문구를 상태에 보여 준다', async () => {
    channel.sync.mockResolvedValue({ ok: true, notice: '점검 기록 1건을 받지 않았습니다.' })
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    expect(engine.getStatus()).toMatchObject({ state: 'ok', message: '점검 기록 1건을 받지 않았습니다.' })
  })

  it('채널이 실패하면 동기화 상태를 오류로 바꾸고 어느 채널인지 알린다', async () => {
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    channel.sync.mockResolvedValue({ ok: false, code: 'SERVER_ERROR', error: '점검 기록을 저장하지 못했습니다.' })
    const status = await engine.syncNow()
    expect(status).toMatchObject({ state: 'error', channelFailed: true, message: '현장점검 동기화: 점검 기록을 저장하지 못했습니다.' })
  })

  it('입출고 안내와 채널 안내를 함께 보여 준다', async () => {
    const { engine, db } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    db.transactions = [{ id: 'bad', type: 'IN', partNo: 'X', qty: 'abc', createdAt: 'x' }]
    channel.sync.mockResolvedValue({ ok: true, notice: '점검 안내' })
    await engine.resolveConflict('download')
    expect(engine.getStatus().message).toMatch(/형식이 잘못된 행 1개.*점검 안내/)
  })

  it('채널이 네트워크 오류면 오프라인으로 표시한다', async () => {
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    channel.sync.mockResolvedValue({ ok: false, code: 'NETWORK', error: 'x' })
    expect((await engine.syncNow()).state).toBe('offline')
  })

  it('채널에서 예외가 나도 "동기화 중"에 멈추지 않는다', async () => {
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    channel.sync.mockRejectedValue(new Error('채널 오류'))
    const status = await engine.syncNow()
    expect(status).toMatchObject({ state: 'error', message: '현장점검 동기화: 채널 오류' })
  })

  it('입출고 동기화가 실패하면 채널은 건너뛴다', async () => {
    const { engine, db } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    channel.sync.mockClear()
    db.online = false
    await engine.syncNow()
    expect(channel.sync).not.toHaveBeenCalled()
  })

  it('채널이 ABORTED를 돌려주면(연결 해제됨) 상태를 바꾸지 않는다', async () => {
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    channel.sync.mockImplementation(async () => {
      engine.disconnect()
      return { ok: false, code: 'ABORTED' }
    })
    const status = await engine.syncNow()
    expect(status.state).toBe('idle')
  })

  it('보낼 건수에 채널의 대기 건수를 더한다', async () => {
    channel.pending.mockReturnValue(3)
    const { engine, store } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    expect(engine.getStatus().pending).toBe(3)
    // 연결하지 않았으면 채널은 묻지 않는다
    engine.disconnect()
    expect(engine.getStatus().pending).toBe(0)
    expect(store).toBeTruthy()
  })

  it('연결을 끊으면 채널의 보낼 목록·진행 상태도 지운다', async () => {
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    engine.disconnect()
    expect(channel.reset).toHaveBeenCalled()
  })

  it('연결 중 채널만 실패하면 입출고 연결은 유지하고 경고로 알린다 (입출고 데이터는 이미 맞춰짐)', async () => {
    channel.sync.mockResolvedValue({ ok: false, code: 'SERVER_ERROR', error: '점검 시트 오류' })
    const { engine } = makeDevice([channel])
    const result = await engine.connect(CONFIG, 'merge')
    expect(result).toEqual({ ok: true, warning: '현장점검 동기화: 점검 시트 오류' })
    expect(engine.getStatus().connected).toBe(true)
    expect(channel.reset).not.toHaveBeenCalled()
  })

  it('다음 동기화에서 채널이 회복되면 오류 표시를 지운다', async () => {
    channel.sync.mockResolvedValueOnce({ ok: false, code: 'BUSY', error: '바쁨' })
    const { engine } = makeDevice([channel])
    await engine.connect(CONFIG, 'merge')
    expect((await engine.syncNow())).toMatchObject({ state: 'ok', channelFailed: false })
  })

  it('채널 키 목록을 알려 준다 (다른 탭 변경 감지용)', () => {
    const { engine } = makeDevice([channel])
    expect(engine.channelKeys()).toEqual(['test:outbox'])
  })

  it('requestSync: 연결돼 있을 때만 상태 구독자에게 알린다', async () => {
    const { engine } = makeDevice([channel])
    const listener = vi.fn()
    engine.subscribe(listener)
    engine.requestSync()
    expect(listener).not.toHaveBeenCalled()
    await engine.connect(CONFIG, 'merge')
    listener.mockClear()
    engine.requestSync()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('채널이 없으면 지금과 똑같이 동작한다', async () => {
    const { engine } = makeDevice(undefined)
    expect(await engine.connect(CONFIG, 'merge')).toEqual({ ok: true })
    expect(engine.channelKeys()).toEqual([])
  })
})
