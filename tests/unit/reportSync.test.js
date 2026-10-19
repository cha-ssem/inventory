import { describe, it, expect } from 'vitest'
import { isNewerReport, isSharedReport, isValidRemoteReport, mergeReports } from '../../src/domain/report/sync.js'

const stats = { completed: 1, ok: 1, issue: 0, fail: 0, newRequests: 0, open: 0, urgentOpen: 0, partsUsed: 0 }
const finalized = {
  reportId: 'rp-1', title: '일간 점검 보고서 (2026-10-19)', period: 'DAILY', from: '2026-10-19', to: '2026-10-19',
  siteIds: ['ST-01'], siteNames: ['청솔댐 취수탑'], status: 'FINALIZED', version: 1, supersedes: null, author: '김수중', aiUsed: false,
  body: { summary: '요약', findings: '', actions: '', nextPlan: '' },
  snapshot: { stats, completed: [{ siteName: '청솔댐 취수탑', usedParts: [] }], newRequests: [], open: [] },
  createdAt: '2026-10-19T01:00:00.000Z', updatedAt: '2026-10-19T02:00:00.000Z', finalizedAt: '2026-10-19T02:00:00.000Z',
}
const submitted = { ...finalized, status: 'SUBMITTED', submission: { submittedAt: '2026-10-19T03:00:00.000Z', mailStatus: 'SENT', recipients: 1 }, updatedAt: '2026-10-19T03:00:00.000Z' }
const draft = { ...finalized, status: 'DRAFT', finalizedAt: undefined }

describe('isSharedReport', () => {
  it('확정·제출본만 다른 기기와 주고받는다', () => {
    expect(isSharedReport(finalized)).toBe(true)
    expect(isSharedReport(submitted)).toBe(true)
    expect(isSharedReport(draft)).toBe(false)
    expect(isSharedReport(undefined)).toBe(false)
    expect(isSharedReport({ status: 'constructor' })).toBe(false)
  })
})

describe('isValidRemoteReport', () => {
  it('화면이 그리는 모양을 갖춘 보고서만 받는다', () => {
    expect(isValidRemoteReport(finalized)).toBe(true)
    expect(isValidRemoteReport(submitted)).toBe(true)
  })

  it.each([
    ['초안', draft],
    ['ID 없음', { ...finalized, reportId: '' }],
    ['기간', { ...finalized, period: 'MONTHLY' }],
    ['현장 이름', { ...finalized, siteNames: [1] }],
    ['버전', { ...finalized, version: 1.5 }],
    ['문단', { ...finalized, body: { summary: '요약' } }],
    ['숫자', { ...finalized, snapshot: { ...finalized.snapshot, stats: { ...stats, ok: 'x' } } }],
    ['완료 목록', { ...finalized, snapshot: { ...finalized.snapshot, completed: 'x' } }],
    ['사용 부품', { ...finalized, snapshot: { ...finalized.snapshot, completed: [{ usedParts: 'x' }] } }],
    ['제출 정보 없음', { ...submitted, submission: undefined }],
    ['배열', [finalized]],
    ['프로토타입 상태', { ...finalized, status: 'constructor' }],
    ['프로토타입 기간', { ...finalized, period: 'toString' }],
  ])('%s이(가) 틀리면 받지 않는다', (_, report) => {
    expect(isValidRemoteReport(report)).toBe(false)
  })
})

describe('isNewerReport', () => {
  it('제출이 확정보다 앞선다 (기기 시계가 어긋나도)', () => {
    expect(isNewerReport({ ...submitted, updatedAt: '2000-01-01T00:00:00.000Z' }, finalized)).toBe(true)
    expect(isNewerReport(finalized, submitted)).toBe(false)
  })

  it('같은 제출 상태면 메일 상태가 나아간 쪽 (시계가 어긋나도 "보냄"이 "실패"에 덮이지 않음)', () => {
    const failed = { ...submitted, submission: { ...submitted.submission, mailStatus: 'FAILED' }, updatedAt: '2026-10-19T09:00:00.000Z' }
    expect(isNewerReport(submitted, failed)).toBe(true)
    expect(isNewerReport(failed, submitted)).toBe(false)
  })

  it('같은 상태면 나중에 바뀐 쪽 (메일 다시 보내기)', () => {
    const resent = { ...submitted, updatedAt: '2026-10-19T04:00:00.000Z' }
    expect(isNewerReport(resent, submitted)).toBe(true)
    expect(isNewerReport(submitted, resent)).toBe(false)
    expect(isNewerReport(submitted, submitted)).toBe(false)
  })
})

describe('mergeReports', () => {
  it('없는 보고서는 더하고, 더 나아간 보고서로 바꾼다', () => {
    const other = { ...finalized, reportId: 'rp-2' }
    const merged = mergeReports([finalized], [submitted, other])
    expect(merged.map((r) => [r.reportId, r.status])).toEqual([
      ['rp-1', 'SUBMITTED'],
      ['rp-2', 'FINALIZED'],
    ])
  })

  it('바뀐 것이 없으면 같은 목록을 돌려준다', () => {
    const local = [submitted]
    expect(mergeReports(local, [finalized, submitted])).toBe(local)
    expect(mergeReports(local, [])).toBe(local)
  })

  it('이 기기의 초안은 건드리지 않는다', () => {
    const local = [draft]
    expect(mergeReports(local, [finalized])).toBe(local)
  })
})
