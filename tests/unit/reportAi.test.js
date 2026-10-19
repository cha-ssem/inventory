import { describe, it, expect } from 'vitest'
import { buildAiInput, buildSubmission, isAiInputTooLarge, AI_DRAFT_TIMEOUT_MS, AI_INPUT_MAX_CHARS } from '../../src/domain/report/aiInput.js'

const report = {
  reportId: 'rp-1', title: '일간 점검 보고서 (2026-10-19)', period: 'DAILY', from: '2026-10-19', to: '2026-10-19',
  siteIds: ['ST-01'], siteNames: ['청솔댐 취수탑'], author: '김수중', body: { summary: '기존' },
  snapshot: {
    stats: { completed: 1, ok: 1, issue: 0, fail: 0, newRequests: 1, open: 1, urgentOpen: 0, partsUsed: 0 },
    completed: [{ requestId: 'R-1', siteId: 'ST-01', siteName: '청솔댐 취수탑', robotId: 'RV-01', robotName: 'V1', title: '정기 점검', priority: 'MID', source: 'MANUAL', completedAt: '2026-10-19T01:00:00.000Z', completedBy: '이로봇', result: 'OK', findings: '이상 없음', actions: '', usedParts: [] }],
    newRequests: [{ requestId: 'R-2', siteName: '청솔댐 취수탑', title: '새 요청' }],
    open: [{ requestId: 'R-2', siteId: 'ST-01', siteName: '청솔댐 취수탑', robotName: 'V1', title: '새 요청', priority: 'LOW', status: 'REQUESTED', assignee: '', dueDate: '', requestedAt: '2026-10-19T02:00:00.000Z' }],
  },
}

describe('buildAiInput', () => {
  it('보고서 문장을 쓰는 데 필요한 글만 고른다 (ID·작성자·기존 문장은 보내지 않음)', () => {
    const input = buildAiInput(report)
    expect(input).toEqual({
      title: report.title, period: 'DAILY', from: '2026-10-19', to: '2026-10-19', siteNames: ['청솔댐 취수탑'], stats: report.snapshot.stats,
      completed: [{ siteName: '청솔댐 취수탑', robotName: 'V1', title: '정기 점검', result: 'OK', findings: '이상 없음', actions: '', usedParts: [], completedAt: '2026-10-19T01:00:00.000Z' }],
      open: [{ siteName: '청솔댐 취수탑', title: '새 요청', priority: 'LOW', status: 'REQUESTED', assignee: '', dueDate: '' }],
    })
    expect(JSON.stringify(input)).not.toContain('김수중')
    expect(JSON.stringify(input)).not.toContain('이로봇')
  })

  it('AI 요청은 오래 걸릴 수 있어 시간 제한을 넉넉히 둔다', () => {
    expect(AI_DRAFT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })
})

describe('buildSubmission', () => {
  it('AI 입력 내용에 보고서 ID·버전·작성자·문장·확정 일시를 더한다', () => {
    const finalized = { ...report, version: 2, aiUsed: true, status: 'FINALIZED', finalizedAt: '2026-10-19T03:00:00.000Z', body: { summary: '요약', findings: 'f', actions: 'a', nextPlan: 'n' } }
    expect(buildSubmission(finalized)).toEqual({
      ...buildAiInput(finalized), reportId: 'rp-1', version: 2, author: '김수중', aiUsed: true, finalizedAt: '2026-10-19T03:00:00.000Z', body: finalized.body,
    })
  })
})

describe('isAiInputTooLarge', () => {
  it('서버와 같은 4만 자 상한으로 미리 막는다', () => {
    expect(isAiInputTooLarge(buildAiInput(report))).toBe(false)
    const big = { ...report, snapshot: { ...report.snapshot, completed: Array.from({ length: 60 }, () => ({ ...report.snapshot.completed[0], findings: '가'.repeat(1000) })) } }
    expect(isAiInputTooLarge(buildAiInput(big))).toBe(true)
    expect(AI_INPUT_MAX_CHARS).toBe(40_000)
  })
})
