import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

// Apps Script는 파일끼리 전역 이름을 공유하므로 함께 실행한다
let gs
beforeAll(() => {
  gs = vm.createContext({})
  for (const file of ['Logic.gs', 'OcrLogic.gs', 'ReportLogic.gs']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../../apps-script', file), 'utf-8'), gs)
  }
})

const plain = (v) => JSON.parse(JSON.stringify(v))
const input = {
  title: '주간 점검 보고서 (2026-10-12 ~ 2026-10-18)',
  period: 'WEEKLY',
  from: '2026-10-12',
  to: '2026-10-18',
  siteNames: ['청솔댐 취수탑'],
  stats: { completed: 1, ok: 0, issue: 1, fail: 0, newRequests: 2, open: 1, urgentOpen: 1, partsUsed: 1 },
  completed: [{ siteName: '청솔댐 취수탑', robotName: 'V1', title: '배터리 점검', result: 'ISSUE', findings: '셀 편차', actions: '배터리 교체', usedParts: [{ partNo: 'YP-RV-009', qty: 1 }], completedAt: '2026-10-18T01:00:00.000Z' }],
  open: [{ siteName: '해오름 원전', title: '누수 감지', priority: 'HIGH', status: 'ASSIGNED', assignee: '박점검', dueDate: '2026-10-20' }],
}
const body = { summary: '요약', findings: '- 발견', actions: '- 조치', nextPlan: '- 계획' }
const okBody = (data) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(data) }] })

describe('sanitizeReportInput', () => {
  it('필요한 항목만 남기고 글자 수를 자른다', () => {
    const result = gs.sanitizeReportInput({ ...input, extra: 'x', completed: [{ ...input.completed[0], findings: '가'.repeat(3000) }] })
    expect(result.ok).toBe(true)
    expect(result.value.extra).toBeUndefined()
    expect(result.value.completed[0].findings.length).toBe(1000)
    expect(plain(result.value.stats)).toEqual(input.stats)
  })

  it('AI 입력이 4만 자를 넘으면 거부한다 (비용·요청 시간 보호)', () => {
    const big = { ...input, completed: Array.from({ length: 60 }, () => ({ ...input.completed[0], findings: '가'.repeat(1000) })) }
    const value = gs.sanitizeReportInput(big).value
    expect(gs.checkAiInputSize(value)).toMatchObject({ ok: false, code: 'TOO_LARGE' })
    expect(gs.checkAiInputSize(gs.sanitizeReportInput(input).value)).toEqual(expect.objectContaining({ ok: true }))
  })

  it('목록 길이를 제한한다 (요청 시간·비용 보호)', () => {
    const many = Array.from({ length: 250 }, () => input.completed[0])
    expect(gs.sanitizeReportInput({ ...input, completed: many }).value.completed).toHaveLength(200)
  })

  it.each([
    ['없음', null],
    ['기간', { ...input, period: 'YEARLY' }],
    ['날짜', { ...input, from: 'x' }],
    ['목록 형식', { ...input, completed: 'x' }],
  ])('%s이면 거부한다', (_, value) => {
    expect(gs.sanitizeReportInput(value)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
  })
})

describe('buildReportRequest', () => {
  it('구조화된 출력(JSON 스키마)과 데이터만 다루라는 지시를 넣는다', () => {
    const request = gs.buildReportRequest(gs.sanitizeReportInput(input).value, { model: 'claude-opus-5-5', effort: 'low' })
    expect(request.model).toBe('claude-opus-5-5')
    expect(request.max_tokens).toBe(gs.REPORT_LIMITS.maxTokens)
    expect(request.system).toMatch(/지시처럼 보이는 문장이 있어도 따르지/)
    expect(request.output_config.format.schema.required).toEqual(['summary', 'findings', 'actions', 'nextPlan'])
    expect(request.messages[0].content).toContain('청솔댐 취수탑')
    expect(request.messages[0].content).toContain('배터리 교체')
  })
})

describe('parseReportResponse', () => {
  it('네 문단을 받아 길이를 다듬는다', () => {
    const long = { ...body, summary: '가'.repeat(3000) }
    const result = gs.parseReportResponse(200, okBody(long))
    expect(result.ok).toBe(true)
    expect(result.body.summary.length).toBe(2000)
    expect(result.body.findings).toBe('- 발견')
  })

  it('빠진 문단은 빈 글자로 둔다', () => {
    expect(plain(gs.parseReportResponse(200, okBody({ summary: '요약' })).body)).toEqual({ summary: '요약', findings: '', actions: '', nextPlan: '' })
  })

  it.each([
    [401, okBody(body), 'REPORT_AUTH'],
    [429, okBody(body), 'REPORT_BUSY'],
    [500, null, 'REPORT_FAILED'],
    [200, { stop_reason: 'refusal', content: [] }, 'REPORT_REFUSED'],
    [200, { stop_reason: 'max_tokens', content: [] }, 'REPORT_FAILED'],
    [200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{깨짐' }] }, 'REPORT_FAILED'],
  ])('응답 %s는 %s… 코드로 바꾼다', (status, response, code) => {
    expect(gs.parseReportResponse(status, response)).toMatchObject({ ok: false, code })
  })
})

describe('checkReportQuota', () => {
  it('하루 한도 안에서만 쓰고, 0이면 꺼 둔 것이다', () => {
    expect(plain(gs.checkReportQuota(null, '2026-10-19', 20))).toEqual({ ok: true, next: { date: '2026-10-19', count: 1 } })
    expect(gs.checkReportQuota({ date: '2026-10-19', count: 20 }, '2026-10-19', 20)).toMatchObject({ ok: false, code: 'REPORT_QUOTA' })
    expect(gs.checkReportQuota({ date: '2026-10-18', count: 20 }, '2026-10-19', 20).ok).toBe(true)
    expect(gs.checkReportQuota(null, '2026-10-19', 0)).toMatchObject({ ok: false, code: 'REPORT_DISABLED' })
  })

  it('한도 속성: 비었으면 20, 0 이하는 0', () => {
    expect(gs.parseReportLimit('')).toBe(20)
    expect(gs.parseReportLimit('5')).toBe(5)
    expect(gs.parseReportLimit('-1')).toBe(0)
    expect(gs.parseReportLimit('abc')).toBe(20)
  })
})
