import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../../src/data/store.js'
import { createSyncClient } from '../../src/sync/client.js'
import { createSyncEngine } from '../../src/sync/engine.js'

const NOW = '2026-10-05T01:00:00.000Z'
const URL = 'https://script.google.com/macros/s/AKfycbTEST/exec'
const TOKEN = 'tok0123456789abcdef'

const memoryStorage = () => {
  let saved = null
  return {
    load: () => saved,
    save: (s) => {
      saved = s
      return true
    },
    clear: () => {
      saved = null
      return true
    },
  }
}

const memoryKv = () => {
  const map = new Map()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }
}

const makeStore = (onLocalChange = () => {}) => {
  let n = 0
  const store = createStore({ storage: memoryStorage(), now: () => NOW, makeId: () => `id-${++n}`, onLocalChange })
  store.addPart({ partNo: 'SK-SB-001', name: '클립', unit: 'BOX', safetyStock: 5 })
  store.addPart({ partNo: 'SK-SB-002', name: '패킹', unit: 'BOX', safetyStock: 5 })
  return store
}

describe('store.recordInboundBatch', () => {
  const input = (partNo, qty) => ({ partNo, qty, partner: '동방부품', worker: '김자재', memo: 'DB-1002-338' })

  it('여러 입고를 한 번에 저장하고, 보낼 목록에는 한 번만 알린다', () => {
    const changes = []
    const store = makeStore((c) => changes.push(c))
    changes.length = 0
    const result = store.recordInboundBatch([input('SK-SB-001', 30), input('sk-sb-002', 20)])
    expect(result.ok).toBe(true)
    expect(result.value.map((t) => [t.partNo, t.qty, t.memo])).toEqual([
      ['SK-SB-001', 30, 'DB-1002-338'],
      ['SK-SB-002', 20, 'DB-1002-338'],
    ])
    expect(store.getStockMap().get('SK-SB-002')).toBe(20)
    expect(changes).toHaveLength(1)
    expect(changes[0].transactions).toHaveLength(2)
  })

  it('하나라도 잘못되면 아무것도 저장하지 않고 몇 번째가 왜 틀렸는지 알려 준다', () => {
    const store = makeStore()
    const result = store.recordInboundBatch([input('SK-SB-001', 3), input('SK-NO-999', 1), input('SK-SB-002', 0)])
    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.index)).toEqual([1, 2])
    expect(store.getState().transactions).toHaveLength(0)
  })

  it('사용 중지된 부품은 거부하고, 빈 목록은 저장하지 않는다', () => {
    const store = makeStore()
    store.setPartActive('SK-SB-001', false)
    expect(store.recordInboundBatch([input('SK-SB-001', 1)]).ok).toBe(false)
    expect(store.recordInboundBatch([]).ok).toBe(false)
  })
})

describe('createSyncClient 시간 제한', () => {
  it('요청마다 시간 제한을 바꿀 수 있고, 시간이 지나면 중단한다', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }))
      const client = createSyncClient({ url: URL, token: TOKEN, fetchImpl, timeoutMs: 1000 })
      const pending = client.request('ocr', { file: {} }, { timeoutMs: 5000 })
      await vi.advanceTimersByTimeAsync(1500)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(4000)
      const result = await pending
      expect(result).toMatchObject({ ok: false, code: 'NETWORK', timedOut: true })
      expect(result.error).toContain('늦어')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('engine.callServer', () => {
  const makeEngine = (fetchImpl) => {
    const kv = memoryKv()
    const engine = createSyncEngine({
      store: makeStore(),
      kv,
      createClient: (config) => createSyncClient({ ...config, fetchImpl }),
      now: () => NOW,
    })
    return { engine, kv }
  }

  it('구글 시트에 연결되지 않았으면 NOT_CONNECTED를 돌려준다', async () => {
    const fetchImpl = vi.fn()
    const { engine } = makeEngine(fetchImpl)
    expect(await engine.callServer('ocr', {})).toMatchObject({ ok: false, code: 'NOT_CONNECTED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('연결된 주소와 토큰으로 요청을 보낸다', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, statement: { items: [] } }) }))
    const { engine, kv } = makeEngine(fetchImpl)
    kv.setItem('samkwang-inventory:sync-config', JSON.stringify({ url: URL, token: TOKEN }))
    const result = await engine.callServer('ocr', { file: { mediaType: 'image/png', data: 'AAAA' } })
    expect(result.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(URL)
    expect(JSON.parse(init.body)).toMatchObject({ action: 'ocr', token: TOKEN, file: { mediaType: 'image/png' } })
  })
})
