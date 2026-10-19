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

const setup = ({ properties = {}, mail } = {}) => {
  const gas = loadAppsScript({ properties: { APP_TOKEN: TOKEN, ...properties }, mail })
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

  it('쓰기 요청이라 잠금을 잡고 처리한다, setup()은 reports 시트를 만든다', () => {
    const { gas } = setup()
    expect(gas.context.WRITE_ACTIONS.submitReport).toBe(true)
    gas.context.setup()
    expect(Object.keys(gas.sheets)).toContain('reports')
  })
})
