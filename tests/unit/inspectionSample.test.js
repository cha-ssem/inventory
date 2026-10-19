import { describe, it, expect } from 'vitest'
import { generateInspectionSample, generateRobotStock } from '../../src/data/inspectionSample.js'
import { ROBOT_PARTS } from '../../src/data/youngpoongCatalog.js'
import { isValidInspectionState } from '../../src/domain/inspection/validation.js'
import { isValidPart, isValidTransaction } from '../../src/domain/backup.js'
import { MODEL_METRICS, SECTORS } from '../../src/domain/inspection/constants.js'
import { foldRequests } from '../../src/domain/inspection/flow.js'

const NOW = '2026-10-19T09:00:00.000Z'

describe('generateInspectionSample', () => {
  const sample = generateInspectionSample({ now: NOW })

  it('형식이 올바른 상태를 만든다', () => {
    expect(isValidInspectionState(sample)).toBe(true)
  })

  it('여러 분야의 현장 8곳과 로봇 6대를 담는다', () => {
    expect(sample.sites).toHaveLength(8)
    expect(sample.robots).toHaveLength(6)
    const sectors = new Set(sample.sites.map((s) => s.sector))
    expect(sectors.size).toBe(Object.keys(SECTORS).length)
    expect(new Set(sample.robots.map((r) => r.model))).toEqual(new Set(Object.keys(MODEL_METRICS)))
  })

  it('로봇은 있는 현장에만 배치한다', () => {
    const siteIds = new Set(sample.sites.map((s) => s.siteId))
    sample.robots.forEach((r) => expect(r.siteId === null || siteIds.has(r.siteId)).toBe(true))
  })

  it('이벤트의 현장·로봇은 모두 존재한다', () => {
    const siteIds = new Set(sample.sites.map((s) => s.siteId))
    const robotIds = new Set(sample.robots.map((r) => r.robotId))
    sample.events.filter((e) => e.type === 'REQUEST').forEach((e) => {
      expect(siteIds.has(e.payload.siteId)).toBe(true)
      expect(robotIds.has(e.payload.robotId)).toBe(true)
    })
  })

  it('보고서 시연을 위해 지난 2주 안에 완료된 점검과, 아직 열린 요청을 함께 담는다', () => {
    const completed = sample.events.filter((e) => e.type === 'COMPLETE')
    expect(completed.length).toBeGreaterThanOrEqual(5)
    const closed = new Set(sample.events.filter((e) => e.type === 'COMPLETE' || e.type === 'CANCEL').map((e) => e.requestId))
    const open = sample.events.filter((e) => e.type === 'REQUEST' && !closed.has(e.requestId))
    expect(open.length).toBeGreaterThanOrEqual(3)
  })

  it('이벤트는 시간 순서이고 지금보다 늦지 않다', () => {
    const times = sample.events.map((e) => e.at)
    expect([...times].sort()).toEqual(times)
    expect(times.every((t) => t <= NOW)).toBe(true)
  })

  it('모든 이벤트가 흐름 규칙에 맞아서 버려지는 것이 없다', () => {
    const requests = foldRequests(sample.events)
    const kept = [...requests.values()].reduce((sum, r) => sum + r.history.length, 0)
    expect(kept).toBe(sample.events.length)
    const statuses = [...requests.values()].map((r) => r.status)
    expect(statuses.filter((s) => s === 'COMPLETED')).toHaveLength(7)
    expect(new Set(statuses)).toEqual(new Set(['COMPLETED', 'REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'CANCELLED']))
  })

  it('같은 시각이면 늘 같은 데이터를 만든다 (기기끼리 ID가 겹쳐도 같은 내용)', () => {
    expect(generateInspectionSample({ now: NOW })).toEqual(sample)
  })

  it('점검에 쓴 부품은 로봇 부품 목록에 있다', () => {
    const partNos = new Set(ROBOT_PARTS.map((p) => p.partNo))
    sample.events
      .filter((e) => e.type === 'COMPLETE')
      .flatMap((e) => e.payload.usedParts)
      .forEach((u) => expect(partNos.has(u.partNo)).toBe(true))
  })
})

describe('generateRobotStock', () => {
  it('로봇 부품과 첫 입고 기록을 만든다', () => {
    const { parts, transactions } = generateRobotStock({ now: NOW })
    expect(parts).toHaveLength(ROBOT_PARTS.length)
    parts.forEach((p) => expect(isValidPart(p)).toBe(true))
    transactions.forEach((t) => expect(isValidTransaction(t)).toBe(true))
    expect(transactions.filter((t) => t.type === 'IN')).toHaveLength(ROBOT_PARTS.length)
  })

  it('샘플 점검에서 쓴 부품은 출고 기록으로 남기고(메모에 요청 번호), 재고가 모자라지 않다', () => {
    const { transactions } = generateRobotStock({ now: NOW })
    const used = generateInspectionSample({ now: NOW }).events.filter((e) => e.type === 'COMPLETE').flatMap((e) =>
      e.payload.usedParts.map((u) => ({ ...u, requestId: e.requestId })),
    )
    const outs = transactions.filter((t) => t.type === 'OUT')
    expect(outs).toHaveLength(used.length)
    used.forEach((u) => expect(outs.some((t) => t.partNo === u.partNo && t.qty === u.qty && t.memo.includes(u.requestId))).toBe(true))
    const stock = new Map()
    transactions.forEach((t) => {
      stock.set(t.partNo, (stock.get(t.partNo) || 0) + (t.type === 'IN' ? t.qty : -t.qty))
      expect(stock.get(t.partNo)).toBeGreaterThanOrEqual(0)
    })
  })

  it('기록은 시간 순서다 (입고가 출고보다 먼저)', () => {
    const times = generateRobotStock({ now: NOW }).transactions.map((t) => t.createdAt)
    expect([...times].sort()).toEqual(times)
  })

  it('품번은 YP- 로 시작해서 삼광 부품(SK-)과 겹치지 않는다', () => {
    ROBOT_PARTS.forEach((p) => expect(p.partNo).toMatch(/^YP-[A-Z]+-\d{3}$/))
  })
})
