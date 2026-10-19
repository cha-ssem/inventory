import { describe, it, expect, vi } from 'vitest'
import { createReportStore, isValidReportState } from '../../src/data/reportStore.js'

const NOW = '2026-10-19T09:00:00.000Z'
const snapshot = { stats: { completed: 0, ok: 0, issue: 0, fail: 0, newRequests: 0, open: 0, urgentOpen: 0, partsUsed: 0 }, completed: [], newRequests: [], open: [] }
const input = { period: 'DAILY', from: '2026-10-19', to: '2026-10-19', siteIds: ['ST-01'], siteNames: ['청솔댐 취수탑'] }

const memoryStorage = ({ failSave = false } = {}) => {
  let saved = null
  return { load: () => saved, save: (s) => (failSave ? false : ((saved = s), true)), clear: () => ((saved = null), true), peek: () => saved }
}

const makeStore = (options) => {
  let n = 0
  const storage = memoryStorage(options)
  return { store: createReportStore({ storage, now: () => NOW, makeId: () => `rp-${++n}` }), storage }
}

describe('createReportStore', () => {
  it('초안을 만들어 저장하고 구독자에게 알린다', () => {
    const { store, storage } = makeStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const result = store.create(input, snapshot, '김수중')
    expect(result).toMatchObject({ ok: true, value: { reportId: 'rp-1', status: 'DRAFT' } })
    expect(storage.peek().reports).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get('rp-1').author).toBe('김수중')
  })

  it('고치기·확정·수정본 만들기', () => {
    const { store } = makeStore()
    store.create(input, snapshot)
    expect(store.update('rp-1', { summary: '요약' }).ok).toBe(true)
    expect(store.finalize('rp-1').value.status).toBe('FINALIZED')
    expect(store.update('rp-1', { summary: 'x' }).ok).toBe(false)
    const revised = store.revise('rp-1', '이로봇')
    expect(revised.value).toMatchObject({ reportId: 'rp-2', version: 2, supersedes: 'rp-1' })
    expect(store.list().map((r) => r.reportId)).toEqual(['rp-2', 'rp-1'])
  })

  it('없는 보고서면 이유를 돌려준다', () => {
    const { store } = makeStore()
    expect(store.update('none', {})).toMatchObject({ ok: false, error: '보고서를 찾을 수 없습니다.' })
    expect(store.finalize('none').ok).toBe(false)
    expect(store.revise('none').ok).toBe(false)
  })

  it('초안만 지울 수 있다', () => {
    const { store } = makeStore()
    store.create(input, snapshot)
    store.create(input, snapshot)
    store.finalize('rp-2')
    expect(store.remove('rp-2').ok).toBe(false)
    expect(store.remove('rp-1').ok).toBe(true)
    expect(store.list().map((r) => r.reportId)).toEqual(['rp-2'])
  })

  it('목록은 최근에 고친 순서', () => {
    let t = 0
    const storage = memoryStorage()
    const store = createReportStore({ storage, now: () => `2026-10-19T0${t++}:00:00.000Z`, makeId: (() => { let n = 0; return () => `rp-${++n}` })() })
    store.create(input, snapshot)
    store.create(input, snapshot)
    store.update('rp-1', { summary: '나중에 고침' })
    expect(store.list().map((r) => r.reportId)).toEqual(['rp-1', 'rp-2'])
  })

  it('저장에 실패하면 경고를 돌려준다', () => {
    const { store } = makeStore({ failSave: true })
    expect(store.create(input, snapshot).warning).toMatch(/저장하지 못했습니다/)
  })

  it('다른 탭이 저장한 보고서를 덮어쓰지 않는다', () => {
    const storage = memoryStorage()
    const a = createReportStore({ storage, now: () => NOW, makeId: () => 'a-1' })
    const b = createReportStore({ storage, now: () => NOW, makeId: () => 'b-1' })
    a.create(input, snapshot)
    b.create(input, snapshot)
    expect(b.list().map((r) => r.reportId).sort()).toEqual(['a-1', 'b-1'])
  })
})

describe('isValidReportState', () => {
  it('보고서 목록 형식을 확인한다', () => {
    expect(isValidReportState({ reports: [] })).toBe(true)
    expect(isValidReportState({ reports: [{ reportId: 'r', status: 'DRAFT', body: {}, snapshot: {} }] })).toBe(true)
    expect(isValidReportState({ reports: [{ reportId: 'r', status: 'X', body: {}, snapshot: {} }] })).toBe(false)
    expect(isValidReportState({})).toBe(false)
    expect(isValidReportState(null)).toBe(false)
  })
})
