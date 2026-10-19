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

describe('점검 흐름 (createInspectionStore)', () => {
  const makeStore = (onLocalChange = vi.fn()) => {
    let n = 0
    const storage = memoryStorage()
    const store = createInspectionStore({ storage, now: () => NOW, makeId: () => `id-${++n}`, onLocalChange })
    store.loadSample()
    onLocalChange.mockClear()
    return { store, storage, onLocalChange }
  }
  const input = { siteId: 'ST-01', robotId: 'RV-01', priority: 'MID', title: '수문 점검' }

  it('점검 요청을 등록하면 이벤트를 저장하고 동기화에 그 이벤트만 알린다', () => {
    const { store, onLocalChange } = makeStore()
    const before = store.getState().events.length
    const result = store.addRequest(input, '김수중')
    expect(result.ok).toBe(true)
    expect(store.getState().events).toHaveLength(before + 1)
    expect(onLocalChange).toHaveBeenCalledWith({ events: [result.value] })
    expect(store.getRequest(result.value.requestId)).toMatchObject({ status: 'REQUESTED', title: '수문 점검', requestedBy: '김수중' })
  })

  it('잘못된 요청은 저장하지 않는다', () => {
    const { store, onLocalChange } = makeStore()
    const before = store.getState()
    expect(store.addRequest({ ...input, siteId: 'ST-99' }).ok).toBe(false)
    expect(store.getState()).toBe(before)
    expect(onLocalChange).not.toHaveBeenCalled()
  })

  it('transition: 배정 → 시작으로 상태를 바꾼다', () => {
    const { store } = makeStore()
    const { requestId } = store.addRequest(input).value
    expect(store.transition(requestId, 'ASSIGN', { assignee: '이로봇' }, '김수중').ok).toBe(true)
    expect(store.transition(requestId, 'START', {}).ok).toBe(true)
    expect(store.getRequest(requestId).status).toBe('IN_PROGRESS')
  })

  it('transition: 할 수 없는 작업이면 이유를 돌려준다', () => {
    const { store } = makeStore()
    const { requestId } = store.addRequest(input).value
    expect(store.transition(requestId, 'COMPLETE', { result: 'OK' })).toMatchObject({ ok: false })
    expect(store.transition('R-none', 'START', {})).toMatchObject({ ok: false, error: '점검 요청을 찾을 수 없습니다.' })
  })

  it('checkTransition: 저장하지 않고 입력만 확인한다 (부품 출고 전에 쓰임)', () => {
    const { store } = makeStore()
    const { requestId } = store.addRequest(input).value
    const before = store.getState()
    expect(store.checkTransition(requestId, 'ASSIGN', { assignee: '' }).ok).toBe(false)
    expect(store.checkTransition(requestId, 'ASSIGN', { assignee: '이로봇' })).toMatchObject({ ok: true })
    expect(store.getState()).toBe(before)
  })

  it('listRequests: 거르기 조건으로 목록을 준다', () => {
    const { store } = makeStore()
    const open = store.listRequests({ status: 'open' })
    expect(open.length).toBe(3)
    expect(store.listRequests({ siteId: 'ST-05' }).every((r) => r.siteId === 'ST-05')).toBe(true)
  })

  it('다른 탭이 방금 저장한 이벤트를 지우지 않고 그 위에 더한다', () => {
    const { store, storage } = makeStore()
    const other = createInspectionStore({ storage, now: () => NOW, makeId: () => 'other-1' })
    const fromOther = other.addRequest({ ...input, title: '다른 탭' }).value
    const mine = store.addRequest(input).value
    const ids = store.getState().events.map((e) => e.id)
    expect(ids).toContain(fromOther.id)
    expect(ids).toContain(mine.id)
  })
})
