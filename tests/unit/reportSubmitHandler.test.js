import { describe, it, expect } from 'vitest'
import { loadAppsScript } from '../support/fakeGoogle.js'

// 실제 Code.gs·Report.gs를 가짜 Google 서비스(시트·메일) 위에서 실행한다
const TOKEN = 'servertoken01234567'
const report = {
  reportId: 'rp-1', version: 1, title: '일간 점검 보고서 (2026-10-19)', period: 'DAILY', from: '2026-10-19', to: '2026-10-19',
  siteNames: ['청솔댐 취수탑'], author: '김수중', aiUsed: false, finalizedAt: '2026-10-19T01:00:00.000Z',
  body: { summary: '점검 1건 완료', findings: '특이 사항 없음', actions: '조치 사항 없음', nextPlan: '남은 점검 요청 없음' },
  stats: { completed: 1, ok: 1, issue: 0, fail: 0, newRequests: 1, open: 0, urgentOpen: 0, partsUsed: 0 },
  completed: [{ siteName: '청솔댐 취수탑', robotName: 'V1', title: '정기 점검', result: 'OK', findings: '이상 없음', actions: '', usedParts: [] }],
  open: [],
}

const setup = ({ properties = {}, mail, tryLock } = {}) => {
  const gas = loadAppsScript({ properties: { APP_TOKEN: TOKEN, ...properties }, mail, tryLock })
  return { gas, post: (body) => gas.post({ action: 'submitReport', token: TOKEN, ...body }) }
}
const rows = (gas) => gas.sheets.reports.cells.slice(1).filter((r) => r.length > 0)
const col = (gas, name) => gas.context.REPORT_COLUMNS.indexOf(name)

describe('submitReport 요청', () => {
  it('reports 시트에 한 줄 기록하고, PDF를 붙여 배포한 본인에게 메일을 보낸다', () => {
    const { gas, post } = setup()
    const result = post({ report })
    expect(result).toMatchObject({ ok: true, duplicate: false, mailStatus: 'SENT', recipients: 1 })
    expect(rows(gas)).toHaveLength(1)
    expect(rows(gas)[0][col(gas, 'reportKey')]).toBe('rp-1|1')
    expect(rows(gas)[0][col(gas, 'mailStatus')]).toBe('SENT')
    const [mail] = gas.mails
    expect(mail.to).toBe('owner@example.com')
    expect(mail.subject).toBe('[점검 보고서] 일간 점검 보고서 (2026-10-19) v1')
    expect(mail.htmlBody).toContain('청솔댐 취수탑')
    expect(mail.attachments[0]).toMatchObject({ type: 'application/pdf', name: '일간 점검 보고서 (2026-10-19) v1.pdf' })
  })

  it('받는 사람은 스크립트 속성에서만 정한다 (앱이 보낸 주소는 무시)', () => {
    const { gas, post } = setup({ properties: { REPORT_RECIPIENTS: 'team@example.com, lead@example.com' } })
    post({ report: { ...report, to: '2026-10-19', mailTo: 'attacker@evil.com' } })
    expect(gas.mails[0].to).toBe('team@example.com,lead@example.com')
  })

  it('같은 보고서를 다시 제출하면 줄도 메일도 늘지 않는다', () => {
    const { gas, post } = setup()
    const first = post({ report })
    const again = post({ report })
    expect(again).toMatchObject({ ok: true, duplicate: true, mailStatus: 'SENT', submittedAt: first.submittedAt })
    expect(rows(gas)).toHaveLength(1)
    expect(gas.mails).toHaveLength(1)
  })

  it('수정본(다음 버전)은 새 줄로 기록한다', () => {
    const { gas, post } = setup()
    post({ report })
    post({ report: { ...report, version: 2 } })
    expect(rows(gas).map((r) => r[col(gas, 'reportKey')])).toEqual(['rp-1|1', 'rp-1|2'])
  })

  it('메일이 실패해도 시트 기록은 남기고 경고를 돌려주며, 다시 제출하면 메일만 다시 보낸다', () => {
    const mail = { throws: '서비스 오류' }
    const { gas, post } = setup({ mail })
    const failed = post({ report })
    expect(failed).toMatchObject({ ok: true, mailStatus: 'FAILED', warning: expect.stringMatching(/메일을 보내지 못했습니다/) })
    expect(rows(gas)[0][col(gas, 'mailStatus')]).toBe('FAILED')

    delete mail.throws
    const retry = post({ report })
    expect(retry).toMatchObject({ ok: true, duplicate: true, mailStatus: 'SENT' })
    expect(rows(gas)).toHaveLength(1)
    expect(rows(gas)[0][col(gas, 'mailStatus')]).toBe('SENT')
    expect(gas.mails).toHaveLength(1)
  })

  it('하루 메일 한도를 다 썼으면 보내지 않고 알린다', () => {
    const { gas, post } = setup({ mail: { quota: 0 } })
    expect(post({ report })).toMatchObject({ ok: true, mailStatus: 'QUOTA', warning: expect.stringMatching(/메일 수를 다 썼습니다/) })
    expect(gas.mails).toHaveLength(0)
  })

  it('확정하지 않은 보고서는 받지 않는다', () => {
    const { gas, post } = setup()
    expect(post({ report: { ...report, finalizedAt: null } })).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(gas.sheets.reports).toBeUndefined()
  })

  it('메일을 보내는 동안에는 전체 잠금을 잡지 않는다 (Report.gs가 시트 기록 때만 잠금), setup()은 reports 시트를 만든다', () => {
    const { gas } = setup()
    expect(gas.context.WRITE_ACTIONS.submitReport).toBeUndefined()
    gas.context.setup()
    expect(Object.keys(gas.sheets)).toContain('reports')
  })

  it('하루 제출 한도: 새 보고서만 세고, 같은 보고서 재제출은 세지 않는다', () => {
    const { post } = setup({ properties: { REPORT_SUBMIT_DAILY_LIMIT: '1' } })
    expect(post({ report }).ok).toBe(true)
    expect(post({ report }).ok).toBe(true)
    expect(post({ report: { ...report, reportId: 'rp-2' } })).toMatchObject({ ok: false, code: 'SUBMIT_QUOTA' })
  })

  it('이미 제출한 같은 버전과 내용이 다르면 거부한다 (시트·메일 내용이 갈라지지 않도록)', () => {
    const mail = { throws: '실패' }
    const { gas, post } = setup({ mail })
    post({ report })
    delete mail.throws
    expect(post({ report: { ...report, body: { ...report.body, summary: '바뀐 요약' } } })).toMatchObject({ ok: false, code: 'CONFLICT' })
    expect(gas.mails).toHaveLength(0)
  })

  it('다른 요청이 보내는 중(SENDING, 5분 안)이면 메일을 또 보내지 않는다', () => {
    const { gas, post } = setup()
    post({ report })
    const row = 2
    const statusCol = gas.context.REPORT_COLUMNS.indexOf('mailStatus')
    gas.sheets.reports.cells[row - 1][statusCol] = 'SENDING'
    gas.sheets.reports.cells[row - 1][gas.context.REPORT_COLUMNS.indexOf('mailAt')] = new Date().toISOString()
    expect(post({ report })).toMatchObject({ ok: true, duplicate: true, mailStatus: 'SENDING' })
    expect(gas.mails).toHaveLength(1)
  })

  it('메일을 보낸 뒤 결과 기록이 잠금을 한 번 못 잡으면 더 오래 기다리며 다시 시도해 SENT로 기록한다', () => {
    const answers = [true, false, true] // 1단계 잡음 → 2단계 첫 시도 실패 → 두 번째 성공
    const { gas, post } = setup({ tryLock: () => answers.shift() ?? true })
    const result = post({ report })
    expect(result).toMatchObject({ ok: true, mailStatus: 'SENT' })
    expect(result.warning).toBeUndefined()
    expect(rows(gas)[0][col(gas, 'mailStatus')]).toBe('SENT')
    expect(gas.lockWaits.slice(1).every((ms) => ms > gas.context.LOCK_WAIT_MS)).toBe(true)
  })

  it('결과 기록을 끝내 못 하면 경고를 돌려주고 서버 로그에 남긴다 (SENDING으로 남으면 5분 뒤 메일이 또 갈 수 있어서)', () => {
    let calls = 0
    const { gas, post } = setup({ tryLock: () => (calls += 1) === 1 })
    const result = post({ report })
    expect(result).toMatchObject({ ok: true, mailStatus: 'SENT', warning: expect.stringMatching(/mailStatus를 SENT로/) })
    expect(rows(gas)[0][col(gas, 'mailStatus')]).toBe('SENDING')
    expect(gas.logs.some((line) => line.includes('메일 결과를 시트에 기록하지 못함'))).toBe(true)
    expect(gas.mails).toHaveLength(1)
  })

  it('시트가 제목·문장 글자를 바꿔 저장해도 같은 내용 재제출은 CONFLICT가 아니다 (해시로 비교)', () => {
    const mail = { throws: '실패' }
    const { gas, post } = setup({ mail })
    post({ report })
    gas.sheets.reports.cells[1][col(gas, 'summary')] = '시트가 바꾼 글자'
    delete mail.throws
    expect(post({ report })).toMatchObject({ ok: true, duplicate: true, mailStatus: 'SENT' })
  })

  it('예전에 만든 reports 탭의 빈 머리글을 채운다 (이미 있는 머리글은 그대로)', () => {
    const { gas, post } = setup()
    post({ report })
    const header = gas.sheets.reports.cells[0]
    header[col(gas, 'mailAt')] = ''
    header[col(gas, 'contentHash')] = ''
    header[0] = '보고서 키'
    gas.context.setup()
    expect(header[col(gas, 'mailAt')]).toBe('mailAt')
    expect(header[col(gas, 'contentHash')]).toBe('contentHash')
    expect(header[0]).toBe('보고서 키')
  })

  it('줄 기록이 실패하면 하루 제출 한도를 쓰지 않는다', () => {
    const { gas, post } = setup()
    post({ report })
    const original = gas.context.writeRows
    gas.context.writeRows = () => {
      throw new Error('시트 쓰기 실패')
    }
    const before = gas.props.REPORT_SUBMIT_USAGE
    expect(post({ report: { ...report, reportId: 'rp-2' } }).ok).toBe(false)
    expect(gas.props.REPORT_SUBMIT_USAGE).toBe(before)
    gas.context.writeRows = original
  })
})
