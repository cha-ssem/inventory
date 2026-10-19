import { describe, it, expect, vi } from 'vitest'
import { completeInspection, raiseAlerts } from '../../src/data/inspectionActions.js'
import { createInspectionStore } from '../../src/data/inspectionStore.js'
import { createStore } from '../../src/data/store.js'
import { generateRobotStock } from '../../src/data/inspectionSample.js'

const NOW = '2026-10-19T09:00:00.000Z'

const memoryStorage = () => {
  let saved = null
  return { load: () => saved, save: (s) => ((saved = s), true), clear: () => ((saved = null), true) }
}

const setup = () => {
  let n = 0
  const makeId = () => `id-${++n}`
  const store = createStore({ storage: memoryStorage(), now: () => NOW, makeId })
  const inspection = createInspectionStore({ storage: memoryStorage(), now: () => NOW, makeId })
  inspection.loadSample()
  store.addCatalog(generateRobotStock({ now: NOW }))
  // 샘플의 YP-R-010은 점검 중이다
  return { store, inspection, requestId: 'YP-R-010' }
}

describe('completeInspection', () => {
  it('쓴 부품을 출고(메모에 요청 번호)하고 점검을 완료한다', () => {
    const { store, inspection, requestId } = setup()
    const before = store.getStockMap().get('YP-SP-003')
    const result = completeInspection({ store, inspection }, requestId, {
      result: 'ISSUE', findings: '호스 마모', actions: '교체', usedParts: [{ partNo: 'YP-SP-003', qty: 1 }],
    }, '최현장')
    expect(result.ok).toBe(true)
    expect(store.getStockMap().get('YP-SP-003')).toBe(before - 1)
    const out = store.getState().transactions.at(-1)
    expect(out).toMatchObject({ type: 'OUT', partNo: 'YP-SP-003', qty: 1, partner: '현장점검', worker: '최현장', memo: `점검 ${requestId}` })
    expect(inspection.getRequest(requestId)).toMatchObject({ status: 'COMPLETED', completion: { usedParts: [{ partNo: 'YP-SP-003', qty: 1 }] } })
  })

  it('쓴 부품이 없으면 출고 없이 완료한다', () => {
    const { store, inspection, requestId } = setup()
    const count = store.getState().transactions.length
    expect(completeInspection({ store, inspection }, requestId, { result: 'OK' }).ok).toBe(true)
    expect(store.getState().transactions).toHaveLength(count)
  })

  it('재고가 모자라면 출고도 완료도 하지 않는다', () => {
    const { store, inspection, requestId } = setup()
    const count = store.getState().transactions.length
    const result = completeInspection({ store, inspection }, requestId, { result: 'OK', usedParts: [{ partNo: 'YP-SP-003', qty: 999 }] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/재고/)
    expect(store.getState().transactions).toHaveLength(count)
    expect(inspection.getRequest(requestId).status).toBe('IN_PROGRESS')
  })

  it('입력이 틀리면 출고 전에 멈춘다', () => {
    const { store, inspection, requestId } = setup()
    const spy = vi.spyOn(store, 'recordOutboundBatch')
    const result = completeInspection({ store, inspection }, requestId, { result: '', usedParts: [{ partNo: 'YP-SP-003', qty: 1 }] })
    expect(result.ok).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('저장 경고와 안전재고 미달 품목을 함께 알려 준다', () => {
    const { store, inspection, requestId } = setup()
    const stock = store.getStockMap().get('YP-SP-004')
    const result = completeInspection({ store, inspection }, requestId, { result: 'OK', usedParts: [{ partNo: 'YP-SP-004', qty: stock }] })
    expect(result).toMatchObject({ ok: true, low: ['YP-SP-004'] })
  })
})

describe('raiseAlerts', () => {
  const leakRule = { id: 'leak', metric: 'leak', kind: 'BOOL', threshold: 1, windowN: 1, priority: 'HIGH', title: '누수 감지', cooldownMin: 10 }
  const robot = { robotId: 'RV-02', model: 'V1', siteId: 'ST-07', name: 'V1 영상 2호기' }
  const violation = { robot, rule: leakRule, reading: { metric: 'leak', value: 1 } }

  it('위반을 센서 점검 요청으로 기록하고, 다시 생기면 재발생으로 남긴다', () => {
    const { inspection } = setup()
    const first = raiseAlerts(inspection, [violation], { now: NOW })
    expect(first.created).toHaveLength(1)
    const request = inspection.getRequest(first.created[0].requestId)
    expect(request).toMatchObject({ source: 'SENSOR', priority: 'HIGH', ruleId: 'leak', status: 'REQUESTED', requestedBy: '센서 감시' })

    const soon = raiseAlerts(inspection, [violation], { now: NOW })
    expect(soon).toEqual({ created: [], recurred: 0 })
    const later = raiseAlerts(inspection, [violation], { now: '2026-10-19T09:30:00.000Z' })
    expect(later.recurred).toBe(1)
  })

  it('위반이 없으면 아무것도 하지 않는다', () => {
    const { inspection } = setup()
    const before = inspection.getState()
    expect(raiseAlerts(inspection, [], { now: NOW })).toEqual({ created: [], recurred: 0 })
    expect(inspection.getState()).toBe(before)
  })
})
