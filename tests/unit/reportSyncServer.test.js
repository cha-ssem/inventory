import { describe, it, expect } from 'vitest'
import { loadAppsScript } from '../support/fakeGoogle.js'

// 실제 ReportSync.gs·ReportSyncLogic.gs를 가짜 시트 위에서 실행한다
const TOKEN = 'servertoken01234567'
const stats = { completed: 0, ok: 0, issue: 0, fail: 0, newRequests: 0, open: 0, urgentOpen: 0, partsUsed: 0 }
const report = (changes = {}) => ({
  reportId: 'a1b2c3d4-0000-4000-8000-000000000001', title: '일간 점검 보고서 (2026-10-19)', period: 'DAILY', from: '2026-10-19', to: '2026-10-19',
  siteIds: ['ST-01'], siteNames: ['청솔댐 취수탑'], status: 'FINALIZED', version: 1, supersedes: null, author: '', aiUsed: false,
  body: { summary: '요약', findings: '=SUM(A1)', actions: '', nextPlan: '' },
  snapshot: { stats, completed: [], newRequests: [], open: [] },
  createdAt: '2026-10-19T01:00:00.000Z', updatedAt: '2026-10-19T02:00:00.000Z', finalizedAt: '2026-10-19T02:00:00.000Z',
  ...changes,
})

const setup = (properties = {}) => {
  const gas = loadAppsScript({ properties: { APP_TOKEN: TOKEN, ...properties } })
  return {
    gas,
    push: (reports) => gas.post({ action: 'reportPush', token: TOKEN, reports }),
    pull: (sinceRev) => gas.post({ action: 'reportPull', token: TOKEN, sinceRev }),
  }
}
const dataRows = (gas) => gas.sheets.report_store.cells.slice(1).filter((r) => r.length > 0)

describe('reportPush·reportPull 요청', () => {
  it('올린 보고서를 그대로 돌려준다 (수식처럼 보이는 글도 그대로)', () => {
    const { gas, push, pull } = setup()
    expect(push([report()])).toMatchObject({ ok: true, acceptedIds: [report().reportId], duplicateIds: [], rejected: [], rev: 1 })
    expect(dataRows(gas)).toHaveLength(1)
    const pulled = pull(0)
    expect(pulled).toMatchObject({ ok: true, full: true, rev: 1, invalidCount: 0 })
    expect(pulled.reports).toEqual([report()])
  })

  it('받은 위치 이후의 줄만 준다', () => {
    const { push, pull } = setup()
    push([report()])
    expect(pull(1)).toMatchObject({ ok: true, reports: [], rev: 1 })
    push([report({ reportId: 'rp-2' })])
    const pulled = pull(1)
    expect(pulled.reports.map((r) => r.reportId)).toEqual(['rp-2'])
    expect(pulled.rev).toBe(2)
  })

  it('제출 상태가 나아가면 같은 줄을 고치고, 같거나 옛 상태는 중복으로 처리한다', () => {
    const { gas, push, pull } = setup()
    push([report()])
    const submitted = report({ status: 'SUBMITTED', submission: { submittedAt: '2026-10-19T03:00:00.000Z', mailStatus: 'SENT', recipients: 1 }, updatedAt: '2026-10-19T03:00:00.000Z' })
    expect(push([submitted]).acceptedIds).toHaveLength(1)
    expect(push([report()])).toMatchObject({ acceptedIds: [], duplicateIds: [report().reportId] })
    expect(push([submitted])).toMatchObject({ acceptedIds: [], duplicateIds: [report().reportId] })
    expect(dataRows(gas)).toHaveLength(1)
    expect(pull(1).reports[0].status).toBe('SUBMITTED')
  })

  it('초안·형식이 틀린 보고서는 거절한다', () => {
    const { push } = setup()
    const result = push([report({ status: 'DRAFT' }), report({ reportId: '=HYPERLINK()' }), report({ updatedAt: '어제' }), null])
    expect(result.acceptedIds).toEqual([])
    expect(result.rejected).toHaveLength(4)
    expect(result.rev).toBe(0)
  })

  it('큰 보고서는 여러 칸에 나눠 담는다 (셀 5만 자 제한)', () => {
    const { gas, push, pull } = setup()
    const completed = Array.from({ length: 300 }, (_, i) => ({ siteName: `현장${i}`, findings: '가'.repeat(400), usedParts: [] }))
    const big = report({ snapshot: { stats, completed, newRequests: [], open: [] } })
    expect(JSON.stringify(big).length).toBeGreaterThan(100000)
    push([big])
    const row = dataRows(gas)[0]
    expect(row.every((cell) => String(cell).length <= 50000)).toBe(true)
    expect(pull(0).reports[0]).toEqual(big)
  })

  it('너무 큰 보고서는 거절한다', () => {
    const { push } = setup()
    const huge = report({ body: { summary: '가'.repeat(400000), findings: '', actions: '', nextPlan: '' } })
    expect(push([huge]).rejected[0].reason).toMatch(/너무 커서/)
  })

  it('시트에서 손으로 깨뜨린 줄은 받지 않고 개수만 알린다', () => {
    const { gas, push, pull } = setup()
    push([report()])
    gas.sheets.report_store.cells[1][6] = '~{깨짐'
    expect(pull(0)).toMatchObject({ ok: true, reports: [], invalidCount: 1, rev: 1 })
  })

  it('앱이 받은 위치가 시트보다 앞서면 처음부터 다시 준다', () => {
    const { push, pull } = setup()
    push([report()])
    expect(pull(99)).toMatchObject({ full: true, rev: 1 })
    expect(pull(99).reports).toHaveLength(1)
  })

  it('쓰기 잠금 안에서 처리한다', () => {
    const { gas, push } = setup()
    push([report()])
    expect(gas.lockWaits.length).toBeGreaterThan(0)
  })

  it('쓰다가 실패해 시트에 rev가 속성보다 앞선 줄이 남아도, 같은 rev를 다시 쓰지 않는다', () => {
    const { gas, push, pull } = setup()
    push([report()])
    // 다음 push가 줄(rev 2)만 쓰고 속성을 못 올린 채 실패한 상태
    const row = [...gas.sheets.report_store.cells[1]]
    row[0] = 'rp-left'
    row[5] = 2
    gas.sheets.report_store.cells.push(row)
    expect(pull(1)).toMatchObject({ reports: [], rev: 1 }) // 속성에 올라가지 않은 줄은 아직 주지 않는다
    expect(push([report({ reportId: 'rp-new' })]).rev).toBe(3)
    const pulled = pull(1)
    // 남은 줄(rev 2)과 새 줄(rev 3)을 모두 준다. 남은 줄은 ID를 바꿔 만든 가짜라 형식 오류로 센다.
    expect(pulled).toMatchObject({ rev: 3, invalidCount: 1 })
    expect(pulled.reports.map((r) => r.reportId)).toEqual(['rp-new'])
  })

  it('한 번에 10줄씩 rev 순서로 주고, 남았으면 more로 알린다', () => {
    const { push, pull } = setup()
    push(Array.from({ length: 12 }, (_, i) => report({ reportId: `rp-${i}` })))
    const first = pull(0)
    expect(first).toMatchObject({ more: true, rev: 10 })
    expect(first.reports).toHaveLength(10)
    const second = pull(first.rev)
    expect(second).toMatchObject({ more: false, rev: 12 })
    expect(second.reports.map((r) => r.reportId)).toEqual(['rp-10', 'rp-11'])
  })

  it('같은 제출 상태면 메일 상태가 나아간 쪽을 남긴다 (시계가 어긋나도)', () => {
    const { push, pull } = setup()
    const sub = (mailStatus, updatedAt) => report({ status: 'SUBMITTED', submission: { submittedAt: '2026-10-19T03:00:00.000Z', mailStatus, recipients: 1 }, updatedAt })
    push([sub('SENT', '2026-10-19T03:00:00.000Z')])
    expect(push([sub('FAILED', '2026-10-19T09:00:00.000Z')]).duplicateIds).toHaveLength(1)
    expect(pull(0).reports[0].submission.mailStatus).toBe('SENT')
  })

  it('프로토타입 이름을 상태로 보내면 거절한다', () => {
    const { push } = setup()
    expect(push([report({ status: 'constructor' }), report({ status: 'toString' })]).rejected).toHaveLength(2)
  })
})
