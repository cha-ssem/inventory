import { describe, it, expect } from 'vitest'
import { computeStock, buildStockRows, searchStockRows, isLowStock } from '../../src/domain/stock.js'

const tx = (id, type, partNo, qty, refId) => ({ id, type, partNo, qty, refId, createdAt: '2026-10-01T09:00:00.000Z' })

describe('computeStock', () => {
  it('입고는 더하고 출고는 뺀다', () => {
    const stock = computeStock([tx('1', 'IN', 'A', 10), tx('2', 'OUT', 'A', 3), tx('3', 'IN', 'B', 5)])
    expect(stock.get('A')).toBe(7)
    expect(stock.get('B')).toBe(5)
  })

  it('취소된 기록은 계산에서 뺀다', () => {
    const stock = computeStock([tx('1', 'IN', 'A', 10), tx('2', 'OUT', 'A', 3), tx('3', 'CANCEL', 'A', 3, '2')])
    expect(stock.get('A')).toBe(10)
  })

  it('기록이 없으면 빈 결과를 돌려준다', () => {
    expect(computeStock([]).size).toBe(0)
  })
})

describe('isLowStock', () => {
  it('현재고가 안전재고보다 적을 때만 부족으로 본다', () => {
    expect(isLowStock(4, 5)).toBe(true)
    expect(isLowStock(5, 5)).toBe(false)
    expect(isLowStock(0, 0)).toBe(false)
  })
})

describe('buildStockRows', () => {
  const parts = [
    { partNo: 'B', name: '비', safetyStock: 5, active: true },
    { partNo: 'A', name: '에이', safetyStock: 5, active: true },
    { partNo: 'C', name: '씨', safetyStock: 50, active: true },
    { partNo: 'D', name: '디', safetyStock: 0, active: false },
  ]
  const stock = new Map([['A', 10], ['B', 10], ['C', 3]])

  it('부족 품목을 맨 위에 두고 나머지는 품번 순으로 정렬한다', () => {
    const rows = buildStockRows(parts, stock)
    expect(rows.map((r) => r.partNo)).toEqual(['C', 'A', 'B', 'D'])
    expect(rows[0]).toMatchObject({ stock: 3, low: true })
  })

  it('기록이 없는 부품의 현재고는 0이다', () => {
    const rows = buildStockRows(parts, stock)
    expect(rows.find((r) => r.partNo === 'D').stock).toBe(0)
  })

  it('원본 부품 배열을 바꾸지 않는다', () => {
    const before = JSON.stringify(parts)
    buildStockRows(parts, stock)
    expect(JSON.stringify(parts)).toBe(before)
  })
})

describe('searchStockRows', () => {
  const rows = [
    { partNo: 'SK-AD-001', name: '에어벤트 덕트', location: 'A-01', low: true, active: true },
    { partNo: 'SK-PD-001', name: '페달 하우징', location: 'B-02', low: false, active: true },
    { partNo: 'SK-OLD-01', name: '단종 부품', location: 'Z-99', low: false, active: false },
  ]

  it('품번, 품명, 위치로 검색한다 (대소문자 무시)', () => {
    expect(searchStockRows(rows, { query: 'sk-pd' }).map((r) => r.partNo)).toEqual(['SK-PD-001'])
    expect(searchStockRows(rows, { query: '덕트' }).map((r) => r.partNo)).toEqual(['SK-AD-001'])
    expect(searchStockRows(rows, { query: 'b-02' }).map((r) => r.partNo)).toEqual(['SK-PD-001'])
  })

  it('기본적으로 사용 중지 부품은 숨긴다', () => {
    expect(searchStockRows(rows, {}).length).toBe(2)
    expect(searchStockRows(rows, { includeInactive: true }).length).toBe(3)
  })

  it('부족 품목만 볼 수 있다', () => {
    expect(searchStockRows(rows, { lowOnly: true }).map((r) => r.partNo)).toEqual(['SK-AD-001'])
  })
})
