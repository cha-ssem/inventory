import { describe, it, expect } from 'vitest'
import { generateSampleData } from '../../src/data/sampleData.js'
import { computeStock, buildStockRows } from '../../src/domain/stock.js'
import { validatePart } from '../../src/domain/validation.js'

const NOW = '2026-10-04T05:00:00.000Z'

describe('generateSampleData', () => {
  const data = generateSampleData({ now: NOW, seed: 42 })

  it('부품 25개 정도와 입출고 기록 100건 정도를 만든다', () => {
    expect(data.parts.length).toBe(25)
    expect(data.transactions.length).toBeGreaterThanOrEqual(80)
    expect(data.transactions.length).toBeLessThanOrEqual(130)
  })

  it('모든 부품이 검증 규칙을 통과하고 품번이 겹치지 않는다', () => {
    const seen = []
    data.parts.forEach((p) => {
      expect(validatePart(p, seen).ok).toBe(true)
      seen.push(p)
    })
  })

  it('모든 기록의 품번이 부품 마스터에 있다', () => {
    const partNos = new Set(data.parts.map((p) => p.partNo))
    data.transactions.forEach((t) => expect(partNos.has(t.partNo)).toBe(true))
  })

  it('시간 순으로 처리해도 재고가 한 번도 음수가 되지 않는다', () => {
    const sorted = [...data.transactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const running = new Map()
    sorted.forEach((t) => {
      const next = (running.get(t.partNo) || 0) + (t.type === 'IN' ? t.qty : -t.qty)
      expect(next).toBeGreaterThanOrEqual(0)
      running.set(t.partNo, next)
    })
  })

  it('기록은 최근 2주 안에 있고 현재 시각을 넘지 않는다', () => {
    const min = new Date(NOW).getTime() - 15 * 86400000
    data.transactions.forEach((t) => {
      const ts = new Date(t.createdAt).getTime()
      expect(ts).toBeGreaterThan(min)
      expect(ts).toBeLessThanOrEqual(new Date(NOW).getTime())
    })
  })

  it('안전재고 미달 품목이 3~4개 있다', () => {
    const rows = buildStockRows(data.parts, computeStock(data.transactions))
    const low = rows.filter((r) => r.low).length
    expect(low).toBeGreaterThanOrEqual(3)
    expect(low).toBeLessThanOrEqual(4)
  })

  it('같은 seed면 같은 데이터를 만든다', () => {
    expect(generateSampleData({ now: NOW, seed: 42 })).toEqual(data)
  })
})
