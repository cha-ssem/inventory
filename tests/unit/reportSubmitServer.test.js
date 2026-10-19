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
    ['확정 일시 형식(ISO 아님)', { finalizedAt: 'Hello world 2020' }],
    ['주간인데 월~일이 아님', { from: '2026-10-13', to: '2026-10-19' }],
    ['시작이 끝보다 늦음', { from: '2026-10-18', to: '2026-10-12' }],
    ['일간인데 날짜가 둘', { period: 'DAILY', from: '2026-10-12', to: '2026-10-13' }],
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
    const row = gs.reportToRow(value, '2026-10-19T02:00:00.000Z', ['me@x.com'], 'SENDING')
    expect(row).toHaveLength(gs.REPORT_COLUMNS.length)
    expect(row[gs.REPORT_COLUMNS.indexOf('reportKey')]).toBe('rp-1|2')
    expect(row[gs.REPORT_COLUMNS.indexOf('author')]).toBe("'=CMD()")
    expect(row[gs.REPORT_COLUMNS.indexOf('mailStatus')]).toBe('SENDING')
  })

  const NOW_MS = Date.parse('2026-10-19T02:00:00.000Z')
  const minutesAgo = (m) => new Date(NOW_MS - m * 60000).toISOString()

  it('처음 제출이면 새 줄과 메일, 이미 있고 메일을 보냈으면 아무것도 하지 않는다, 메일이 실패했었으면 메일만 다시', () => {
    expect(plain(gs.planSubmission([], 'rp-1|2', NOW_MS))).toEqual({ append: true, rowIndex: null, sendMail: true })
    const rows = [{ reportKey: 'rp-1|1', mailStatus: 'SENT' }, { reportKey: 'rp-1|2', mailStatus: 'SENT' }]
    expect(plain(gs.planSubmission(rows, 'rp-1|2', NOW_MS))).toEqual({ append: false, rowIndex: 1, sendMail: false })
    const failed = [{ reportKey: 'rp-1|2', mailStatus: 'FAILED' }]
    expect(plain(gs.planSubmission(failed, 'rp-1|2', NOW_MS))).toEqual({ append: false, rowIndex: 0, sendMail: true })
  })

  it('다른 요청이 보내는 중(5분 안)이면 다시 보내지 않고, 5분이 지나면 멈춘 것으로 보고 다시 보낸다', () => {
    expect(gs.planSubmission([{ reportKey: 'k', mailStatus: 'SENDING', mailAt: minutesAgo(1) }], 'k', NOW_MS).sendMail).toBe(false)
    expect(gs.planSubmission([{ reportKey: 'k', mailStatus: 'SENDING', mailAt: minutesAgo(6) }], 'k', NOW_MS).sendMail).toBe(true)
  })

  it('이미 제출한 줄과 제목·문장이 같은지 확인한다 (확정 후 내용이 바뀐 재제출 거부)', () => {
    const value = gs.sanitizeSubmission(submission).value
    const stored = Object.fromEntries(gs.REPORT_COLUMNS.map((c, i) => [c, gs.reportToRow(value, 'x', [], 'SENT')[i]]))
    expect(gs.sameSubmission(stored, value)).toBe(true)
    expect(gs.sameSubmission({ ...stored, summary: '다른 요약' }, value)).toBe(false)
    const tricky = gs.sanitizeSubmission({ ...submission, body: { ...submission.body, summary: '=1+1 요약' } }).value
    const trickyStored = Object.fromEntries(gs.REPORT_COLUMNS.map((c, i) => [c, gs.reportToRow(tricky, 'x', [], 'SENT')[i]]))
    expect(gs.sameSubmission(trickyStored, tricky)).toBe(true)
  })

  it('해시가 있는 줄은 해시로 비교한다 (시트가 글자를 바꿔 저장해도 같은 내용이면 같다), 해시 열이 없는 예전 줄은 글자로', () => {
    const value = gs.withContentHash(gs.sanitizeSubmission(submission).value, 'h1')
    const stored = Object.fromEntries(gs.REPORT_COLUMNS.map((c, i) => [c, gs.reportToRow(value, 'x', [], 'SENT')[i]]))
    expect(stored.contentHash).toBe('h1')
    expect(gs.sameSubmission({ ...stored, summary: '시트가 바꾼 글자' }, value)).toBe(true)
    expect(gs.sameSubmission(stored, { ...value, contentHash: 'h2' })).toBe(false)
    expect(gs.sameSubmission({ ...stored, contentHash: '' }, value)).toBe(true)
    expect(value).not.toBe(gs.sanitizeSubmission(submission).value)
  })

  it('하루 제출 한도: 새 줄을 추가할 때만 센다, 0이면 끔', () => {
    expect(plain(gs.checkSubmitQuota(null, '2026-10-19', 10))).toEqual({ ok: true, next: { date: '2026-10-19', count: 1 } })
    expect(gs.checkSubmitQuota({ date: '2026-10-19', count: 10 }, '2026-10-19', 10)).toMatchObject({ ok: false, code: 'SUBMIT_QUOTA' })
    expect(gs.checkSubmitQuota(null, '2026-10-19', 0)).toMatchObject({ ok: false, code: 'SUBMIT_DISABLED' })
    expect(gs.parseSubmitLimit('')).toBe(10)
    expect(gs.parseSubmitLimit('3')).toBe(3)
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

  it('메일 제목에 보고서 제목과 버전을 넣고, 줄바꿈 같은 제어 문자는 공백으로 바꾼다', () => {
    const value = gs.sanitizeSubmission(submission).value
    expect(gs.reportMailSubject(value)).toBe('[점검 보고서] 주간 점검 보고서 (2026-10-12 ~ 2026-10-18) v2')
    const tricky = gs.sanitizeSubmission({ ...submission, title: '보고서\nBcc: x@evil.com' }).value
    expect(gs.reportMailSubject(tricky)).not.toMatch(/[\u0000-\u001f]/)
  })
})
