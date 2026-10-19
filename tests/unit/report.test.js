import { describe, it, expect } from 'vitest'
import { createDraft, defaultBody, finalizeReport, markSubmitted, reviseReport, updateDraft, REPORT_LIMITS } from '../../src/domain/report/report.js'

const NOW = '2026-10-19T09:00:00.000Z'
const LATER = '2026-10-19T10:00:00.000Z'
const snapshot = {
  stats: { completed: 2, ok: 1, issue: 1, fail: 0, newRequests: 3, open: 1, urgentOpen: 1, partsUsed: 2 },
  completed: [
    { requestId: 'R-1', siteName: '청솔댐 취수탑', robotName: 'V1', title: '정기 점검', result: 'OK', findings: '이상 없음', actions: '', usedParts: [] },
    { requestId: 'R-2', siteName: '가람대교 교각 P7', robotName: 'V1', title: '균열', result: 'ISSUE', findings: '균열 0.3mm', actions: '정밀진단 요청', usedParts: [{ partNo: 'YP-SP-001', qty: 2 }] },
  ],
  newRequests: [],
  open: [{ requestId: 'R-3', siteName: '해오름 원전', title: '누수 감지', priority: 'HIGH', status: 'ASSIGNED', assignee: '박점검', dueDate: '2026-10-20' }],
}
const input = { period: 'WEEKLY', from: '2026-10-12', to: '2026-10-18', siteIds: ['ST-01', 'ST-07'], siteNames: ['청솔댐 취수탑', '가람대교 교각 P7'] }
let n = 0
const ctx = { now: NOW, makeId: () => `id-${++n}`, author: '김수중' }

describe('defaultBody (AI 없이 만드는 기본 문장)', () => {
  it('요약에 숫자를, 주요 발견·조치에 조치가 필요했던 점검을, 다음 계획에 열린 요청을 넣는다', () => {
    const body = defaultBody(snapshot)
    expect(body.summary).toMatch(/점검 2건 완료.*이상 없음 1건.*조치 필요 1건/)
    expect(body.findings).toContain('가람대교 교각 P7')
    expect(body.findings).toContain('균열 0.3mm')
    expect(body.findings).not.toContain('청솔댐')
    expect(body.actions).toContain('정밀진단 요청')
    expect(body.nextPlan).toMatch(/\[긴급\] 해오름 원전 · 누수 감지 \(박점검, 2026-10-20\)/)
  })

  it('완료·열린 요청이 없으면 그렇다고 쓴다', () => {
    const body = defaultBody({ ...snapshot, stats: { ...snapshot.stats, completed: 0, ok: 0, issue: 0 }, completed: [], open: [] })
    expect(body.findings).toBe('특이 사항 없음')
    expect(body.nextPlan).toBe('남은 점검 요청 없음')
  })
})

describe('createDraft', () => {
  it('기간·현장·스냅숏과 기본 문장으로 초안(버전 1)을 만든다', () => {
    const result = createDraft(input, snapshot, ctx)
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({
      period: 'WEEKLY', from: '2026-10-12', to: '2026-10-18', siteIds: ['ST-01', 'ST-07'], status: 'DRAFT', version: 1,
      supersedes: null, author: '김수중', createdAt: NOW, updatedAt: NOW, aiUsed: false,
      title: '주간 점검 보고서 (2026-10-12 ~ 2026-10-18)',
    })
    expect(result.value.snapshot).toEqual(snapshot)
    expect(result.value.body.summary).toMatch(/점검 2건 완료/)
  })

  it('일간 제목은 날짜 하나', () => {
    expect(createDraft({ ...input, period: 'DAILY', from: '2026-10-15', to: '2026-10-15' }, snapshot, ctx).value.title).toBe('일간 점검 보고서 (2026-10-15)')
  })

  it.each([
    ['기간', { period: 'YEARLY' }],
    ['현장 없음', { siteIds: [] }],
    ['날짜', { from: 'x' }],
  ])('%s가 틀리면 거부한다', (_, change) => {
    expect(createDraft({ ...input, ...change }, snapshot, ctx).ok).toBe(false)
  })
})

describe('updateDraft · finalizeReport · reviseReport', () => {
  const draft = () => createDraft(input, snapshot, ctx).value

  it('초안의 문장을 고치면 수정 시각이 바뀐다 (원래 보고서는 그대로)', () => {
    const original = draft()
    const result = updateDraft(original, { summary: ' 새 요약 ', findings: 'a', actions: 'b', nextPlan: 'c' }, LATER)
    expect(result.value.body).toEqual({ summary: '새 요약', findings: 'a', actions: 'b', nextPlan: 'c' })
    expect(result.value.updatedAt).toBe(LATER)
    expect(original.body.summary).not.toBe('새 요약')
  })

  it('문장이 너무 길면 거부한다', () => {
    expect(updateDraft(draft(), { summary: '가'.repeat(REPORT_LIMITS.maxSection + 1) }, LATER)).toMatchObject({ ok: false, error: expect.stringMatching(/자 이하/) })
  })

  it('확정하면 더 고칠 수 없다', () => {
    const final = finalizeReport(draft(), LATER).value
    expect(final).toMatchObject({ status: 'FINALIZED', finalizedAt: LATER })
    expect(updateDraft(final, { summary: 'x' }, LATER)).toMatchObject({ ok: false, error: expect.stringMatching(/확정/) })
    expect(finalizeReport(final, LATER).ok).toBe(false)
  })

  it('요약이 비어 있으면 확정하지 않는다', () => {
    const empty = updateDraft(draft(), { summary: '' }, LATER).value
    expect(finalizeReport(empty, LATER)).toMatchObject({ ok: false, error: expect.stringMatching(/요약/) })
  })

  it('확정본을 고치려면 같은 내용으로 다음 버전 초안을 새로 만든다', () => {
    const final = finalizeReport(draft(), LATER).value
    const revised = reviseReport(final, { now: LATER, makeId: () => 'new-id', author: '이로봇' })
    expect(revised.value).toMatchObject({ reportId: 'new-id', version: 2, supersedes: final.reportId, status: 'DRAFT', body: final.body, snapshot: final.snapshot, author: '이로봇' })
    expect(revised.value.finalizedAt).toBeUndefined()
    expect(reviseReport(draft(), ctx).ok).toBe(false)
  })
})

describe('markSubmitted', () => {
  const finalized = () => finalizeReport(createDraft(input, snapshot, ctx).value, LATER).value

  it('확정본을 제출 완료로 바꾸고 제출 결과(시각·메일 상태)를 남긴다', () => {
    const result = markSubmitted(finalized(), { submittedAt: LATER, mailStatus: 'SENT', recipients: 1 }, LATER)
    expect(result.value).toMatchObject({ status: 'SUBMITTED', submission: { submittedAt: LATER, mailStatus: 'SENT', recipients: 1 } })
  })

  it('제출 완료 보고서는 메일 상태만 다시 고칠 수 있다 (메일 다시 보내기)', () => {
    const failed = markSubmitted(finalized(), { submittedAt: LATER, mailStatus: 'FAILED', recipients: 1 }, LATER).value
    expect(markSubmitted(failed, { submittedAt: LATER, mailStatus: 'SENT', recipients: 1 }, LATER).value.submission.mailStatus).toBe('SENT')
  })

  it('초안은 제출할 수 없다', () => {
    expect(markSubmitted(createDraft(input, snapshot, ctx).value, { submittedAt: LATER, mailStatus: 'SENT' }, LATER)).toMatchObject({ ok: false, error: expect.stringMatching(/확정/) })
  })

  it('수정본을 만들면 제출 정보는 따라가지 않는다', () => {
    const submitted = markSubmitted(finalized(), { submittedAt: LATER, mailStatus: 'SENT', recipients: 1 }, LATER).value
    const revised = reviseReport(submitted, { now: LATER, makeId: () => 'v2', author: '' }).value
    expect(revised.submission).toBeUndefined()
    expect(revised.status).toBe('DRAFT')
  })
})
