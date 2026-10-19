import { describe, it, expect } from 'vitest'
import { collectReport, periodRange } from '../../src/domain/report/collect.js'
import { generateInspectionSample } from '../../src/data/inspectionSample.js'
import { foldRequests } from '../../src/domain/inspection/flow.js'

// 2026-10-19(월) 18:00 KST
const NOW = '2026-10-19T09:00:00.000Z'
const sample = generateInspectionSample({ now: NOW })
const requests = [...foldRequests(sample.events).values()]
const masters = { sites: sample.sites, robots: sample.robots }
const allSites = sample.sites.map((s) => s.siteId)

describe('periodRange', () => {
  it('일간은 그날 하루', () => {
    expect(periodRange('DAILY', '2026-10-15')).toEqual({ from: '2026-10-15', to: '2026-10-15' })
  })

  it('주간은 그날이 들어 있는 월요일~일요일', () => {
    expect(periodRange('WEEKLY', '2026-10-15')).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(periodRange('WEEKLY', '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(periodRange('WEEKLY', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' })
  })

  it('알 수 없는 기간이나 날짜는 null', () => {
    expect(periodRange('MONTHLY', '2026-10-15')).toBe(null)
    expect(periodRange('DAILY', '10/15')).toBe(null)
  })
})

describe('collectReport', () => {
  it('기간 안에 완료한 점검을 결과·내용·사용 부품과 함께 모은다 (현장·로봇 이름 포함)', () => {
    const report = collectReport(requests, masters, { from: '2026-10-12', to: '2026-10-18', siteIds: allSites })
    const titles = report.completed.map((c) => c.title)
    expect(titles).toEqual(['선체 하부 이물질 제거', '교각 P7 균열 영상 기록', '로그 분석: 배터리 소모가 빠름'])
    const battery = report.completed.find((c) => c.requestId === 'YP-R-006')
    expect(battery).toMatchObject({ siteName: '청솔댐 취수탑', robotName: 'V1 영상 1호기', result: 'ISSUE', usedParts: [{ partNo: 'YP-RV-009', qty: 1 }] })
  })

  it('완료 순서는 완료 시각 순서다', () => {
    const report = collectReport(requests, masters, { from: '2026-10-01', to: '2026-10-19', siteIds: allSites })
    const times = report.completed.map((c) => c.completedAt)
    expect([...times].sort()).toEqual(times)
  })

  it('고른 현장만 담는다', () => {
    const report = collectReport(requests, masters, { from: '2026-10-01', to: '2026-10-19', siteIds: ['ST-01'] })
    expect(report.completed.every((c) => c.siteId === 'ST-01')).toBe(true)
    expect(report.completed).toHaveLength(2)
  })

  it('기간 안에 들어온 새 요청과, 기간 끝에 아직 열려 있던 요청을 따로 모은다', () => {
    const report = collectReport(requests, masters, { from: '2026-10-19', to: '2026-10-19', siteIds: allSites })
    expect(report.newRequests.map((r) => r.requestId)).toEqual(expect.arrayContaining(['YP-R-009']))
    expect(report.open.map((r) => r.requestId).sort()).toEqual(['YP-R-008', 'YP-R-009', 'YP-R-010'])
    expect(report.open.find((r) => r.requestId === 'YP-R-010')).toMatchObject({ status: 'IN_PROGRESS', assignee: '최현장' })
  })

  it('지난 기간의 보고서에는 그 뒤에 완료된 요청도 "그때는 열려 있던" 것으로 넣는다', () => {
    const report = collectReport(requests, masters, { from: '2026-10-07', to: '2026-10-07', siteIds: allSites })
    // YP-R-001은 10-07에 요청·배정되고 10-08에 완료됐다 → 10-07 보고서에서는 "배정" 상태의 열린 요청
    expect(report.open).toHaveLength(1)
    expect(report.open[0]).toMatchObject({ requestId: 'YP-R-001', status: 'ASSIGNED', assignee: '김수중' })
    expect(report.completed).toEqual([])
  })

  it('요약 숫자: 완료(결과별)·새 요청·열린 요청·긴급 열린 요청·사용 부품 수량', () => {
    const report = collectReport(requests, masters, { from: '2026-10-01', to: '2026-10-19', siteIds: allSites })
    expect(report.stats).toEqual({
      completed: 7, ok: 3, issue: 4, fail: 0, newRequests: 11, open: 3, urgentOpen: 1, partsUsed: 4,
    })
  })

  it('취소된 요청은 완료·열린 요청 어디에도 넣지 않는다', () => {
    const report = collectReport(requests, masters, { from: '2026-10-01', to: '2026-10-19', siteIds: allSites })
    const ids = [...report.completed, ...report.open].map((r) => r.requestId)
    expect(ids).not.toContain('YP-R-011')
  })
})
