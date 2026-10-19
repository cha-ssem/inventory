import { describe, it, expect, vi } from 'vitest'
import { createInspectionStore, EMPTY_INSPECTION } from '../../src/data/inspectionStore.js'

const NOW = '2026-10-19T09:00:00.000Z'

const memoryStorage = (initial = null, { failSave = false } = {}) => {
  let saved = initial
  return {
    load: () => saved,
    save: (s) => {
      if (failSave) return false
      saved = s
      return true
    },
    clear: () => ((saved = null), true),
    peek: () => saved,
  }
}

describe('createInspectionStore', () => {
  it('저장된 것이 없으면 빈 상태로 시작한다', () => {
    const store = createInspectionStore({ storage: memoryStorage(), now: () => NOW })
    expect(store.getState()).toEqual(EMPTY_INSPECTION)
  })

  it('샘플을 불러오면 저장하고, 구독자와 동기화에 "통째로 바뀜"을 알린다', () => {
    const storage = memoryStorage()
    const onLocalChange = vi.fn()
    const store = createInspectionStore({ storage, now: () => NOW, onLocalChange })
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.loadSample()).toEqual({ ok: true })
    expect(store.getState().sites).toHaveLength(8)
    expect(storage.peek()).toBe(store.getState())
    expect(listener).toHaveBeenCalledTimes(1)
    expect(onLocalChange).toHaveBeenCalledWith({ replaced: true })
  })

  it('전체 초기화는 빈 상태로 되돌린다', () => {
    const store = createInspectionStore({ storage: memoryStorage(), now: () => NOW })
    store.loadSample()
    store.resetAll()
    expect(store.getState()).toEqual(EMPTY_INSPECTION)
  })

  it('저장에 실패하면 경고를 돌려준다', () => {
    const store = createInspectionStore({ storage: memoryStorage(null, { failSave: true }), now: () => NOW })
    expect(store.loadSample().warning).toMatch(/저장하지 못했습니다/)
  })

  it('reload: 다른 탭이 저장한 최신 상태를 읽고 다시 그린다', () => {
    const storage = memoryStorage()
    const store = createInspectionStore({ storage, now: () => NOW })
    const listener = vi.fn()
    store.subscribe(listener)
    const other = { sites: [], robots: [], events: [] }
    storage.save(other)
    store.reload()
    expect(store.getState()).toBe(other)
    expect(listener).toHaveBeenCalledWith(other)
  })

  it('applyRemote: 받은 데이터를 합치되 동기화 보낼 목록에는 넣지 않는다', () => {
    const onLocalChange = vi.fn()
    const store = createInspectionStore({ storage: memoryStorage(), now: () => NOW, onLocalChange })
    const next = { sites: [], robots: [], events: [] }
    expect(store.applyRemote(() => next)).toEqual({ ok: true, changed: true })
    expect(store.getState()).toBe(next)
    expect(onLocalChange).not.toHaveBeenCalled()
  })

  it('applyRemote: 바뀐 게 없으면 저장하지 않는다', () => {
    const store = createInspectionStore({ storage: memoryStorage(), now: () => NOW })
    expect(store.applyRemote((s) => s)).toEqual({ ok: true, changed: false })
  })

  it('applyRemote: 다른 탭의 최신 저장분을 기준으로 합친다', () => {
    const storage = memoryStorage()
    const store = createInspectionStore({ storage, now: () => NOW })
    const latest = { sites: [], robots: [], events: [] }
    storage.save(latest)
    const mergeFn = vi.fn((s) => s)
    store.applyRemote(mergeFn)
    expect(mergeFn).toHaveBeenCalledWith(latest)
  })
})
