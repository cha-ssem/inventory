import { describe, it, expect } from 'vitest'
import { buildHistoryRows, filterHistory } from '../../src/domain/history.js'
import { dashboardStats, recentTransactions } from '../../src/domain/stats.js'

const parts = [
  { partNo: 'SK-AD-001', name: '에어벤트 덕트', safetyStock: 10, active: true },
  { partNo: 'SK-PD-001', name: '페달 하우징', safetyStock: 100, active: true },
  { partNo: 'SK-OLD-01', name: '단종', safetyStock: 0, active: false },
]

// 한국 시간 기준: 10/02 09:00, 10/03 09:00, 10/04 09:00, 10/04 10:00
const txs = [
  { id: '1', type: 'IN', partNo: 'SK-AD-001', qty: 20, createdAt: '2026-10-02T00:00:00.000Z' },
  { id: '2', type: 'IN', partNo: 'SK-PD-001', qty: 30, createdAt: '2026-10-03T00:00:00.000Z' },
  { id: '3', type: 'OUT', partNo: 'SK-AD-001', qty: 5, createdAt: '2026-10-04T00:00:00.000Z' },
  { id: '4', type: 'IN', partNo: 'SK-AD-001', qty: 1, createdAt: '2026-10-04T00:30:00.000Z' },
  { id: '5', type: 'CANCEL', partNo: 'SK-AD-001', qty: 1, refId: '4', createdAt: '2026-10-04T01:00:00.000Z' },
]

describe('buildHistoryRows', () => {
  it('최신순으로 정렬하고 품명과 취소 여부를 붙인다', () => {
    const rows = buildHistoryRows(txs, parts)
    expect(rows.map((r) => r.id)).toEqual(['5', '4', '3', '2', '1'])
    expect(rows.find((r) => r.id === '4')).toMatchObject({ partName: '에어벤트 덕트', cancelled: true })
    expect(rows.find((r) => r.id === '3').cancelled).toBe(false)
  })

  it('마스터에 없는 품번은 품명을 비워 둔다', () => {
    const rows = buildHistoryRows([{ id: 'x', type: 'IN', partNo: 'NOPE', qty: 1, createdAt: txs[0].createdAt }], parts)
    expect(rows[0].partName).toBe('')
  })
})

describe('filterHistory', () => {
  const rows = buildHistoryRows(txs, parts)

  it('기간(현지 날짜, 양 끝 포함)으로 거른다', () => {
    expect(filterHistory(rows, { from: '2026-10-03', to: '2026-10-03' }).map((r) => r.id)).toEqual(['2'])
    expect(filterHistory(rows, { from: '2026-10-04' }).map((r) => r.id)).toEqual(['5', '4', '3'])
    expect(filterHistory(rows, { to: '2026-10-02' }).map((r) => r.id)).toEqual(['1'])
  })

  it('구분으로 거른다', () => {
    expect(filterHistory(rows, { type: 'OUT' }).map((r) => r.id)).toEqual(['3'])
  })

  it('품번이나 품명으로 검색한다', () => {
    expect(filterHistory(rows, { query: '페달' }).map((r) => r.id)).toEqual(['2'])
    expect(filterHistory(rows, { query: 'sk-ad' })).toHaveLength(4)
  })

  it('조건이 없으면 전부 돌려준다', () => {
    expect(filterHistory(rows, {})).toHaveLength(5)
  })
})

describe('dashboardStats', () => {
  it('사용 중 품목 수, 부족 품목 수, 오늘 입고·출고 건수를 계산한다', () => {
    const stats = dashboardStats({ parts, transactions: txs, now: '2026-10-04T05:00:00.000Z' })
    // 오늘 입고 1건(id 4)은 취소되었으므로 빼고, 출고 1건(id 3)만 센다
    expect(stats).toEqual({ totalParts: 2, lowStockCount: 1, todayIn: 0, todayOut: 1 })
  })
})

describe('recentTransactions', () => {
  it('최신 기록부터 지정한 개수만큼 돌려준다', () => {
    expect(recentTransactions(txs, parts, 2).map((r) => r.id)).toEqual(['5', '4'])
  })
})
