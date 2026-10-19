import { describe, it, expect, vi } from 'vitest'
import { createReportStore, isValidReportState, normalizeReportState } from '../../src/data/reportStore.js'

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

  it('저장에 실패하면 실패로 돌려주고 목록에 넣지 않는다', () => {
    const { store } = makeStore({ failSave: true })
    expect(store.create(input, snapshot)).toMatchObject({ ok: false, error: expect.stringMatching(/저장하지 못했습니다/) })
    expect(store.list()).toEqual([])
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

describe('markSubmitted (reportStore)', () => {
  it('제출 결과를 저장한다', () => {
    const { store } = makeStore()
    store.create(input, snapshot)
    store.update('rp-1', { summary: '요약' })
    store.finalize('rp-1')
    expect(store.markSubmitted('rp-1', { submittedAt: NOW, mailStatus: 'SENT', recipients: 1 }).value.status).toBe('SUBMITTED')
    expect(store.markSubmitted('none', {}).ok).toBe(false)
  })
})

describe('리뷰 반영: 저장 실패·손상·수정본 중복', () => {
  it('저장에 실패하면 메모리도 바꾸지 않고 실패로 알린다 (옛 문장으로 확정되지 않도록)', () => {
    let failing = false
    let saved = null
    const storage = { load: () => saved, save: (s) => (failing ? false : ((saved = s), true)), clear: () => true }
    let n = 0
    const store = createReportStore({ storage, now: () => NOW, makeId: () => `rp-${++n}` })
    store.create(input, snapshot)
    failing = true
    const result = store.update('rp-1', { summary: '고친 요약' })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/저장하지 못했습니다/) })
    expect(store.get('rp-1').body.summary).not.toBe('고친 요약')
    failing = false
    expect(store.update('rp-1', { summary: '고친 요약' }).ok).toBe(true)
    expect(store.finalize('rp-1').value.body.summary).toBe('고친 요약')
  })

  it('수정본이 이미 있으면 새로 만들지 않고 그 수정본을 알려 준다', () => {
    const { store } = makeStore()
    store.create(input, snapshot)
    store.finalize('rp-1')
    const first = store.revise('rp-1')
    const again = store.revise('rp-1')
    expect(again).toMatchObject({ ok: true, existing: true, value: { reportId: first.value.reportId } })
    expect(store.list()).toHaveLength(2)
  })
})

describe('normalizeReportState', () => {
  it('형식이 틀린 보고서만 빼고 나머지는 살린다', () => {
    const good = { reportId: 'a', status: 'DRAFT', body: {}, snapshot: {} }
    expect(normalizeReportState({ reports: [good, { reportId: 'b', status: '?' }, null] })).toEqual({ reports: [good] })
    expect(normalizeReportState({ reports: 'x' })).toEqual({ reports: 'x' })
  })

  it('저장할 때마다 onLocalChange로 알리고, 저장에 실패하면 알리지 않는다', () => {
    const changes = []
    const ok = createReportStore({ storage: memoryStorage(), now: () => NOW, makeId: () => 'rp-1', onLocalChange: (r) => changes.push(r.status) })
    ok.create(input, snapshot)
    ok.update('rp-1', { summary: '요약' })
    ok.finalize('rp-1')
    expect(changes).toEqual(['DRAFT', 'DRAFT', 'FINALIZED'])

    const failed = vi.fn()
    createReportStore({ storage: memoryStorage({ failSave: true }), now: () => NOW, makeId: () => 'rp-1', onLocalChange: failed }).create(input, snapshot)
    expect(failed).not.toHaveBeenCalled()
  })

  it('applyRemote: 받은 보고서를 합쳐 저장하고, 바뀐 것이 없으면 저장하지 않는다', () => {
    const { store, storage } = makeStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const remote = { ...store.create(input, snapshot).value, reportId: 'other' }
    listener.mockClear()
    expect(store.applyRemote((reports) => [...reports, remote])).toEqual({ ok: true, changed: true })
    expect(storage.peek().reports).toHaveLength(2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.applyRemote((reports) => reports)).toEqual({ ok: true, changed: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('applyRemote: 저장에 실패하면 실패를 돌려주고 목록을 바꾸지 않는다', () => {
    const { store } = makeStore({ failSave: true })
    expect(store.applyRemote(() => [{ reportId: 'x' }]).ok).toBe(false)
    expect(store.list()).toEqual([])
  })
})
