import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

let gs
beforeAll(() => {
  gs = vm.createContext({})
  for (const file of ['Logic.gs', 'OcrLogic.gs', 'ReportLogic.gs', 'ReportSubmitLogic.gs']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../../apps-script', file), 'utf-8'), gs)
  }
})

const plain = (v) => JSON.parse(JSON.stringify(v))
const submission = {
  reportId: 'rp-1', version: 2, title: '주간 점검 보고서 (2026-10-12 ~ 2026-10-18)', period: 'WEEKLY', from: '2026-10-12', to: '2026-10-18',
  siteNames: ['청솔댐 취수탑'], author: '김수중', aiUsed: true, finalizedAt: '2026-10-19T01:00:00.000Z',
  body: { summary: '요약', findings: '- 발견', actions: '- 조치', nextPlan: '- 계획' },
  stats: { completed: 1, ok: 0, issue: 1, fail: 0, newRequests: 2, open: 1, urgentOpen: 1, partsUsed: 1 },
  completed: [{ siteName: '청솔댐 취수탑', robotName: 'V1', title: '배터리 점검', result: 'ISSUE', findings: '셀 편차', actions: '교체', usedParts: [{ partNo: 'YP-RV-009', qty: 1 }], completedAt: '2026-10-18T01:00:00.000Z' }],
  open: [{ siteName: '해오름 원전', title: '누수 감지', priority: 'HIGH', status: 'ASSIGNED', assignee: '박점검', dueDate: '2026-10-20' }],
}

describe('sanitizeSubmission', () => {
  it('확정한 보고서를 받아 필요한 항목만 남긴다', () => {
    const result = gs.sanitizeSubmission({ ...submission, extra: 'x' })
    expect(result.ok).toBe(true)
    expect(result.value.extra).toBeUndefined()
    expect(result.value.key).toBe('rp-1|2')
    expect(plain(result.value.body)).toEqual(submission.body)
    expect(result.value.completed).toHaveLength(1)
  })

  it.each([
    ['ID', { reportId: '' }],
    ['ID 형식', { reportId: '=HYPERLINK()' }],
    ['버전', { version: 0 }],
    ['확정 일시', { finalizedAt: '' }],
    ['요약 없음', { body: { ...submission.body, summary: '' } }],
    ['기간', { period: 'X' }],
  ])('%s가 틀리면 거부한다', (_, change) => {
    expect(gs.sanitizeSubmission({ ...submission, ...change })).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
  })
})

describe('parseRecipients', () => {
  it('쉼표·줄바꿈으로 나눈 올바른 메일 주소만, 5개까지 받는다', () => {
    expect(plain(gs.parseRecipients(' a@x.com, bad, b@y.co.kr\nc@z.com ', 'me@x.com'))).toEqual(['a@x.com', 'b@y.co.kr', 'c@z.com'])
    const many = Array.from({ length: 8 }, (_, i) => `u${i}@x.com`).join(',')
    expect(gs.parseRecipients(many, 'me@x.com')).toHaveLength(5)
  })

  it('비었으면 배포한 본인 주소로 보낸다', () => {
    expect(plain(gs.parseRecipients('', 'me@x.com'))).toEqual(['me@x.com'])
    expect(plain(gs.parseRecipients(null, ''))).toEqual([])
  })
})

describe('reportToRow / planSubmission', () => {
  it('시트 한 줄로 바꾸고, 수식처럼 보이는 글은 작은따옴표로 막는다', () => {
    const value = gs.sanitizeSubmission({ ...submission, author: '=CMD()' }).value
    const row = gs.reportToRow(value, '2026-10-19T02:00:00.000Z', ['me@x.com'], 'PENDING')
    expect(row).toHaveLength(gs.REPORT_COLUMNS.length)
    expect(row[gs.REPORT_COLUMNS.indexOf('reportKey')]).toBe('rp-1|2')
    expect(row[gs.REPORT_COLUMNS.indexOf('author')]).toBe("'=CMD()")
    expect(row[gs.REPORT_COLUMNS.indexOf('mailStatus')]).toBe('PENDING')
  })

  it('처음 제출이면 새 줄과 메일, 이미 있고 메일을 보냈으면 아무것도 하지 않는다, 메일이 실패했었으면 메일만 다시', () => {
    expect(plain(gs.planSubmission([], 'rp-1|2'))).toEqual({ append: true, rowIndex: null, sendMail: true })
    const rows = [{ reportKey: 'rp-1|1', mailStatus: 'SENT' }, { reportKey: 'rp-1|2', mailStatus: 'SENT' }]
    expect(plain(gs.planSubmission(rows, 'rp-1|2'))).toEqual({ append: false, rowIndex: 1, sendMail: false })
    const failed = [{ reportKey: 'rp-1|2', mailStatus: 'FAILED' }]
    expect(plain(gs.planSubmission(failed, 'rp-1|2'))).toEqual({ append: false, rowIndex: 0, sendMail: true })
  })
})

describe('buildReportHtml', () => {
  it('보고서 내용을 HTML로 만들고, 글 속의 태그는 그대로 보이게 막는다 (메일·PDF에 스크립트가 끼지 않도록)', () => {
    const value = gs.sanitizeSubmission({ ...submission, body: { ...submission.body, findings: '<script>alert(1)</script> & "x"' } }).value
    const out = gs.buildReportHtml(value, '2026-10-19T02:00:00.000Z')
    expect(out).toContain('주간 점검 보고서')
    expect(out).toContain('청솔댐 취수탑')
    expect(out).toContain('배터리 점검')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;')
    expect(out).not.toContain('<script>')
    expect(out).toContain('AI 초안 사용')
  })

  it('메일 제목에 보고서 제목과 버전을 넣는다', () => {
    const value = gs.sanitizeSubmission(submission).value
    expect(gs.reportMailSubject(value)).toBe('[점검 보고서] 주간 점검 보고서 (2026-10-12 ~ 2026-10-18) v2')
  })
})
