import { describe, it, expect, vi } from 'vitest'
import { completeInspection, pendingReverts, raiseAlerts, revertSkippedCompletion } from '../../src/data/inspectionActions.js'
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

  it('위반을 센서 점검 요청으로 기록하고, 대기 시간이 지나 다시 생기면 재발생으로 남긴다', () => {
    let clock = NOW
    let saved = null
    const storage = { load: () => saved, save: (st) => ((saved = st), true), clear: () => true }
    const inspection = createInspectionStore({ storage, now: () => clock, makeId: (() => { let n = 0; return () => `c-${++n}` })() })
    inspection.loadSample()
    const first = raiseAlerts(inspection, [violation])
    expect(first.created).toHaveLength(1)
    const request = inspection.getRequest(first.created[0].requestId)
    expect(request).toMatchObject({ source: 'SENSOR', priority: 'HIGH', ruleId: 'leak', status: 'REQUESTED', requestedBy: '센서 감시' })

    expect(raiseAlerts(inspection, [violation])).toMatchObject({ created: [], recurred: 0 })
    clock = '2026-10-19T09:30:00.000Z'
    expect(raiseAlerts(inspection, [violation]).recurred).toBe(1)
  })

  it('위반이 없으면 아무것도 하지 않는다', () => {
    const { inspection } = setup()
    const before = inspection.getState()
    expect(raiseAlerts(inspection, [])).toEqual({ created: [], recurred: 0, warnings: [], failed: [] })
    expect(inspection.getState()).toBe(before)
  })
})

describe('완료 충돌·원자성', () => {
  it('출고 기록 ID는 완료 이벤트 ID에서 만든다 (어느 완료 때문에 나간 부품인지 추적)', () => {
    const { store, inspection, requestId } = setup()
    completeInspection({ store, inspection }, requestId, { result: 'OK', usedParts: [{ partNo: 'YP-SP-003', qty: 1 }] })
    const completeEvent = inspection.getRequest(requestId).history.at(-1)
    expect(store.getState().transactions.at(-1).id).toBe(`${completeEvent.id}-OUT-1`)
  })

  it('완료 저장이 실패하면 방금 한 출고를 취소 기록으로 되돌린다', () => {
    const { store, inspection, requestId } = setup()
    const before = store.getStockMap().get('YP-SP-003')
    vi.spyOn(inspection, 'commitEvent').mockReturnValue({ ok: false, error: '저장 실패' })
    const result = completeInspection({ store, inspection }, requestId, { result: 'OK', usedParts: [{ partNo: 'YP-SP-003', qty: 1 }] })
    expect(result.ok).toBe(false)
    expect(store.getStockMap().get('YP-SP-003')).toBe(before)
    expect(store.getState().transactions.at(-1)).toMatchObject({ type: 'CANCEL' })
  })

  it('다른 기기가 먼저 완료해서 반영되지 않은 완료의 출고를 되돌린다 (한 번만)', () => {
    const { store, inspection, requestId } = setup()
    const before = store.getStockMap().get('YP-SP-003')
    completeInspection({ store, inspection }, requestId, { result: 'OK', usedParts: [{ partNo: 'YP-SP-003', qty: 1 }] })
    const mine = inspection.getRequest(requestId).history.at(-1)
    // 다른 기기의 완료가 시각상 먼저였다고 가정: 내 완료가 skipped가 되도록 앞선 완료 이벤트를 받는다
    const earlier = { ...mine, id: 'other-complete', at: new Date(Date.parse(mine.at) - 1).toISOString(), payload: { ...mine.payload, usedParts: [] } }
    inspection.applyRemote((state) => ({ ...state, events: [...state.events, earlier] }))
    const request = inspection.getRequest(requestId)
    expect(request.skipped.map((e) => e.id)).toEqual([mine.id])
    expect(pendingReverts(store, request)).toEqual([{ eventId: mine.id, txIds: [`${mine.id}-OUT-1`] }])

    expect(revertSkippedCompletion({ store, inspection }, requestId, mine.id)).toMatchObject({ ok: true, reverted: 1 })
    expect(store.getStockMap().get('YP-SP-003')).toBe(before)
    expect(pendingReverts(store, inspection.getRequest(requestId))).toEqual([])
    expect(revertSkippedCompletion({ store, inspection }, requestId, mine.id)).toMatchObject({ ok: true, reverted: 0 })
  })
})

describe('raiseAlerts 리뷰 반영', () => {
  const leakRule = { id: 'leak', metric: 'leak', kind: 'BOOL', threshold: 1, windowN: 1, priority: 'HIGH', title: '누수 감지', cooldownMin: 10 }
  const violationFor = (robot) => ({ robot, rule: leakRule, reading: { metric: 'leak', value: 1 } })

  it('저장소 시계로 대기 시간을 판단해서, 여러 번 불러도 대기 시간 안에는 재발생을 남기지 않는다', () => {
    const { inspection } = setup()
    const robot = inspection.getState().robots.find((r) => r.robotId === 'RV-02')
    raiseAlerts(inspection, [violationFor(robot)])
    for (let i = 0; i < 5; i += 1) expect(raiseAlerts(inspection, [violationFor(robot)]).recurred).toBe(0)
  })

  it('같은 저장소를 쓰는 다른 탭이 방금 만든 요청을 보고 중복을 만들지 않는다', () => {
    let saved = null
    const shared = { load: () => saved, save: (s) => ((saved = s), true), clear: () => true }
    let n = 0
    const tabA = createInspectionStore({ storage: shared, now: () => NOW, makeId: () => `a-${++n}` })
    tabA.loadSample()
    const tabB = createInspectionStore({ storage: shared, now: () => NOW, makeId: () => `b-${++n}` })
    const robot = tabA.getState().robots.find((r) => r.robotId === 'RV-02')
    raiseAlerts(tabA, [violationFor(robot)])
    expect(raiseAlerts(tabB, [violationFor(robot)]).created).toHaveLength(0)
    expect(tabB.listRequests({ status: 'open' }).filter((r) => r.ruleId === 'leak' && r.robotId === 'RV-02')).toHaveLength(1)
  })

  it('저장 경고를 돌려준다 (화면이 자동 생성을 끄도록)', () => {
    let fail = false
    let saved = null
    const storage = { load: () => saved, save: (s) => (fail ? false : ((saved = s), true)), clear: () => true }
    const inspection = createInspectionStore({ storage, now: () => NOW, makeId: (() => { let n = 0; return () => `x-${++n}` })() })
    inspection.loadSample()
    fail = true
    const robot = inspection.getState().robots.find((r) => r.robotId === 'RV-02')
    expect(raiseAlerts(inspection, [violationFor(robot)]).warnings[0]).toMatch(/저장하지 못했습니다/)
  })

  it('지금 로봇 정보로 판단한다: 본사로 돌아왔거나 사용 중지된 현장이면 만들지 않고 이유를 돌려준다', () => {
    const { inspection } = setup()
    const robot = inspection.getState().robots.find((r) => r.robotId === 'RV-02')
    inspection.applyRemote((s) => ({ ...s, robots: s.robots.map((r) => (r.robotId === 'RV-02' ? { ...r, siteId: null } : r)) }))
    const result = raiseAlerts(inspection, [violationFor(robot)])
    expect(result.created).toHaveLength(0)
    expect(result.failed).toEqual([{ key: 'RV-02|leak', error: expect.stringMatching(/현장/) }])
  })
})

describe('확인 리뷰 반영: 되돌리기는 실제로 완료된 요청에서만', () => {
  it('완료되지 않은 요청에는 되돌릴 출고를 보여 주지 않는다', () => {
    const { store } = setup()
    const request = { requestId: 'R', status: 'REQUESTED', skipped: [{ id: 'E', type: 'COMPLETE' }] }
    store.addPart({ partNo: 'ZZ-01', name: 'z', unit: 'EA', safetyStock: 0 })
    store.recordInbound({ partNo: 'ZZ-01', qty: 5 })
    store.recordOutboundBatch([{ partNo: 'ZZ-01', qty: 1 }], { idPrefix: 'E' })
    expect(pendingReverts(store, request)).toEqual([])
    expect(pendingReverts(store, { ...request, status: 'COMPLETED' })).toHaveLength(1)
  })
})

describe('addRequest 중복 자동 요청 거부', () => {
  it('저장 직전 다른 탭이 같은 로봇·기준의 자동 요청을 만들었으면 거부한다', () => {
    let saved = null
    const shared = { load: () => saved, save: (s) => ((saved = s), true), clear: () => true }
    let n = 0
    const tabA = createInspectionStore({ storage: shared, now: () => NOW, makeId: () => `a-${++n}` })
    tabA.loadSample()
    const tabB = createInspectionStore({ storage: shared, now: () => NOW, makeId: () => `b-${++n}` })
    const input = { siteId: 'ST-07', robotId: 'RV-02', source: 'SENSOR', ruleId: 'leak', priority: 'HIGH', title: '누수', reading: { metric: 'leak', value: 1 } }
    expect(tabA.addRequest(input).ok).toBe(true)
    expect(tabB.addRequest(input)).toMatchObject({ ok: false, code: 'DUPLICATE_ALERT' })
    expect(tabB.addRequest({ ...input, source: 'MANUAL', ruleId: undefined }).ok).toBe(true)
  })
})
