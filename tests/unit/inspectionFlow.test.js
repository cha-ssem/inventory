import { describe, it, expect } from 'vitest'
import {
  availableActions,
  createRequestEvent,
  createTransitionEvent,
  foldRequests,
  listRequests,
} from '../../src/domain/inspection/flow.js'

const AT = '2026-10-19T01:00:00.000Z'
const site = { siteId: 'ST-01', name: '청솔댐 취수탑', sector: 'DAM', active: true, updatedAt: AT }
const stopped = { siteId: 'ST-02', name: '중지 현장', sector: 'DAM', active: false, updatedAt: AT }
const robot = { robotId: 'RV-01', model: 'V1', name: 'V1 1호기', siteId: 'ST-01', active: true, updatedAt: AT }
const masters = { sites: [site, stopped], robots: [robot] }

let n = 0
const ctx = (at = AT) => ({ now: at, makeId: () => `id-${++n}`, actor: '김수중' })

const requestInput = { siteId: 'ST-01', robotId: 'RV-01', priority: 'HIGH', title: ' 정기 점검 ', detail: '' }

const newRequest = (input = requestInput, at = AT) => {
  const result = createRequestEvent(input, masters, ctx(at))
  expect(result.ok).toBe(true)
  return result.value
}

const step = (events, type, input = {}, at = AT) => {
  const request = foldRequests(events).get(events[0].requestId)
  const result = createTransitionEvent(request, type, input, ctx(at))
  if (!result.ok) throw new Error(result.error)
  return [...events, result.value]
}

describe('createRequestEvent', () => {
  it('점검 요청 이벤트를 만든다 (요청 ID 새로 발급, 글자 앞뒤 공백 제거)', () => {
    const event = newRequest()
    expect(event).toMatchObject({ type: 'REQUEST', at: AT, actor: '김수중', payload: { siteId: 'ST-01', robotId: 'RV-01', source: 'MANUAL', priority: 'HIGH', title: '정기 점검' } })
    expect(event.requestId).toMatch(/^R-/)
    expect(event.id).not.toBe(event.requestId)
  })

  it.each([
    ['없는 현장', { siteId: 'ST-99' }, /현장/],
    ['사용 중지된 현장', { siteId: 'ST-02' }, /사용 중지/],
    ['없는 로봇', { robotId: 'RV-99' }, /로봇/],
    ['제목 없음', { title: '  ' }, /제목/],
    ['긴 제목', { title: '가'.repeat(101) }, /100자/],
    ['긴 설명', { detail: '가'.repeat(501) }, /500자/],
    ['우선순위', { priority: 'NOW' }, /우선순위/],
    ['출처', { source: 'EMAIL' }, /출처/],
  ])('%s면 거부한다', (_, change, message) => {
    const result = createRequestEvent({ ...requestInput, ...change }, masters, ctx())
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(message)
  })

  it('센서가 만든 요청은 측정값을 함께 남긴다', () => {
    const result = createRequestEvent({ ...requestInput, source: 'SENSOR', ruleId: 'leak', reading: { metric: 'leak', value: 1 } }, masters, ctx())
    expect(result.value.payload).toMatchObject({ source: 'SENSOR', ruleId: 'leak', reading: { metric: 'leak', value: 1 } })
  })
})

describe('foldRequests', () => {
  it('요청 → 배정 → 시작 → 완료를 차례로 접어 현재 상태를 계산한다', () => {
    let events = [newRequest()]
    expect(foldRequests(events).get(events[0].requestId).status).toBe('REQUESTED')
    events = step(events, 'ASSIGN', { assignee: '이로봇', dueDate: '2026-10-20' }, '2026-10-19T02:00:00.000Z')
    expect(foldRequests(events).get(events[0].requestId)).toMatchObject({ status: 'ASSIGNED', assignee: '이로봇', dueDate: '2026-10-20' })
    events = step(events, 'START', {}, '2026-10-19T03:00:00.000Z')
    events = step(events, 'COMPLETE', { result: 'ISSUE', findings: '균열', actions: '보수 요청', usedParts: [{ partNo: 'yp-sp-001', qty: '2' }] }, '2026-10-19T04:00:00.000Z')
    const request = foldRequests(events).get(events[0].requestId)
    expect(request).toMatchObject({
      status: 'COMPLETED',
      startedAt: '2026-10-19T03:00:00.000Z',
      completedAt: '2026-10-19T04:00:00.000Z',
      completion: { result: 'ISSUE', findings: '균열', actions: '보수 요청', usedParts: [{ partNo: 'YP-SP-001', qty: 2 }] },
    })
    expect(request.history.map((e) => e.type)).toEqual(['REQUEST', 'ASSIGN', 'START', 'COMPLETE'])
  })

  it('허용되지 않는 순서의 이벤트(다른 기기에서 겹친 완료 등)는 건너뛴다', () => {
    let events = [newRequest()]
    events = step(events, 'ASSIGN', { assignee: '이로봇' })
    events = step(events, 'START')
    events = step(events, 'COMPLETE', { result: 'OK' }, '2026-10-19T05:00:00.000Z')
    const duplicate = { ...events.at(-1), id: 'other-device', at: '2026-10-19T06:00:00.000Z', payload: { result: 'FAIL', findings: '', actions: '', usedParts: [] } }
    const request = foldRequests([...events, duplicate]).get(events[0].requestId)
    expect(request.completion.result).toBe('OK')
    expect(request.history).toHaveLength(4)
  })

  it('이벤트가 저장 순서와 달라도 시각 순서로 접는다', () => {
    let events = [newRequest()]
    events = step(events, 'ASSIGN', { assignee: '이로봇' }, '2026-10-19T02:00:00.000Z')
    events = step(events, 'START', {}, '2026-10-19T03:00:00.000Z')
    const shuffled = [events[2], events[0], events[1]]
    expect(foldRequests(shuffled).get(events[0].requestId).status).toBe('IN_PROGRESS')
  })

  it('요청 이벤트가 없는 이벤트는 무시한다', () => {
    const orphan = { id: 'x', requestId: 'R-none', type: 'START', at: AT, actor: '', payload: {} }
    expect(foldRequests([orphan]).size).toBe(0)
  })

  it('재발생(RECUR)은 횟수와 마지막 측정값을 남긴다', () => {
    let events = [newRequest({ ...requestInput, source: 'SENSOR', reading: { metric: 'leak', value: 1 } })]
    events = step(events, 'RECUR', { reading: { metric: 'leak', value: 1 } }, '2026-10-19T02:00:00.000Z')
    events = step(events, 'RECUR', { reading: { metric: 'leak', value: 1 } }, '2026-10-19T03:00:00.000Z')
    expect(foldRequests(events).get(events[0].requestId)).toMatchObject({ recurCount: 2, lastRecurAt: '2026-10-19T03:00:00.000Z' })
  })

  it('취소하면 사유를 남긴다', () => {
    const events = step([newRequest()], 'CANCEL', { reason: '일정 변경' })
    expect(foldRequests(events).get(events[0].requestId)).toMatchObject({ status: 'CANCELLED', cancelReason: '일정 변경' })
  })
})

describe('createTransitionEvent', () => {
  const requested = () => [newRequest()]

  it.each([
    ['요청 상태에서 시작', 'START', {}],
    ['요청 상태에서 완료', 'COMPLETE', { result: 'OK' }],
  ])('%s은 할 수 없다', (_, type, input) => {
    const events = requested()
    const request = foldRequests(events).get(events[0].requestId)
    const result = createTransitionEvent(request, type, input, ctx())
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toMatch(/할 수 없습니다/)
  })

  it('점검 중에는 취소할 수 없다 (완료로 결과를 남긴다)', () => {
    let events = step(requested(), 'ASSIGN', { assignee: '이로봇' })
    events = step(events, 'START')
    const request = foldRequests(events).get(events[0].requestId)
    expect(createTransitionEvent(request, 'CANCEL', { reason: 'x' }, ctx()).ok).toBe(false)
  })

  it('없는 요청이면 거부한다', () => {
    expect(createTransitionEvent(undefined, 'START', {}, ctx())).toMatchObject({ ok: false, error: '점검 요청을 찾을 수 없습니다.' })
  })

  it.each([
    ['배정: 담당자 없음', 'ASSIGN', { assignee: ' ' }, /담당자/],
    ['배정: 날짜 형식', 'ASSIGN', { assignee: '이로봇', dueDate: '10/20' }, /날짜/],
    ['취소: 사유 없음', 'CANCEL', { reason: '' }, /사유/],
  ])('%s', (_, type, input, message) => {
    const events = requested()
    const request = foldRequests(events).get(events[0].requestId)
    expect(createTransitionEvent(request, type, input, ctx()).error).toMatch(message)
  })

  describe('완료 입력', () => {
    const inProgress = () => {
      let events = step(requested(), 'ASSIGN', { assignee: '이로봇' })
      events = step(events, 'START')
      return foldRequests(events).get(events[0].requestId)
    }

    it.each([
      ['결과 없음', { result: '' }, /결과/],
      ['긴 점검 내용', { result: 'OK', findings: '가'.repeat(1001) }, /1000자/],
      ['부품 수량', { result: 'OK', usedParts: [{ partNo: 'YP-SP-001', qty: 0 }] }, /수량/],
      ['부품 품번', { result: 'OK', usedParts: [{ partNo: '', qty: 1 }] }, /품번/],
      ['부품 너무 많음', { result: 'OK', usedParts: Array.from({ length: 21 }, (_, i) => ({ partNo: `P-${i}`, qty: 1 })) }, /20종/],
      ['같은 부품 두 줄', { result: 'OK', usedParts: [{ partNo: 'P-1', qty: 1 }, { partNo: 'p-1', qty: 2 }] }, /한 번만/],
    ])('%s면 거부한다', (_, input, message) => {
      expect(createTransitionEvent(inProgress(), 'COMPLETE', input, ctx()).error).toMatch(message)
    })

    it('쓴 부품이 없으면 빈 목록으로 남긴다', () => {
      expect(createTransitionEvent(inProgress(), 'COMPLETE', { result: 'OK' }, ctx()).value.payload.usedParts).toEqual([])
    })
  })
})

describe('availableActions', () => {
  it.each([
    ['REQUESTED', ['ASSIGN', 'CANCEL']],
    ['ASSIGNED', ['ASSIGN', 'START', 'CANCEL']],
    ['IN_PROGRESS', ['COMPLETE']],
    ['COMPLETED', []],
    ['CANCELLED', []],
  ])('%s 상태에서 할 수 있는 일', (status, actions) => {
    expect(availableActions(status)).toEqual(actions)
  })
})

describe('listRequests', () => {
  it('열린 요청을 먼저, 그 안에서 긴급 → 최근 순으로 보여 준다', () => {
    const low = newRequest({ ...requestInput, priority: 'LOW', title: '낮음' }, '2026-10-19T05:00:00.000Z')
    const high = newRequest({ ...requestInput, priority: 'HIGH', title: '긴급' }, '2026-10-19T01:00:00.000Z')
    const done = step([newRequest({ ...requestInput, priority: 'HIGH', title: '취소됨' }, '2026-10-19T06:00:00.000Z')], 'CANCEL', { reason: 'x' }, '2026-10-19T07:00:00.000Z')
    const list = listRequests([low, high, ...done])
    expect(list.map((r) => r.title)).toEqual(['긴급', '낮음', '취소됨'])
  })

  it('상태·현장으로 거른다', () => {
    const a = newRequest({ ...requestInput, title: 'A' })
    const b = step([newRequest({ ...requestInput, title: 'B' })], 'CANCEL', { reason: 'x' })
    expect(listRequests([a, ...b], { status: 'open' }).map((r) => r.title)).toEqual(['A'])
    expect(listRequests([a, ...b], { status: 'CANCELLED' }).map((r) => r.title)).toEqual(['B'])
    expect(listRequests([a, ...b], { siteId: 'ST-09' })).toEqual([])
  })
})

describe('기기 간 시계 차이·충돌', () => {
  it('이 기기 시계가 늦어도 새 이벤트는 그 요청의 마지막 이벤트보다 뒤 시각으로 찍는다', () => {
    let events = [newRequest(requestInput, '2026-10-19T05:00:00.000Z')]
    events = step(events, 'ASSIGN', { assignee: '이로봇' }, '2026-10-19T05:10:00.000Z')
    events = step(events, 'START', {}, '2026-10-19T05:20:00.000Z')
    // 10분 늦은 기기에서 완료
    events = step(events, 'COMPLETE', { result: 'OK' }, '2026-10-19T05:10:00.000Z')
    const request = foldRequests(events).get(events[0].requestId)
    expect(request.status).toBe('COMPLETED')
    expect(events.at(-1).at).toBe('2026-10-19T05:20:00.001Z')
  })

  it('반영되지 않은 이벤트(다른 기기의 늦은 완료 등)는 skipped로 남긴다', () => {
    let events = [newRequest()]
    events = step(events, 'ASSIGN', { assignee: '이로봇' })
    events = step(events, 'START')
    events = step(events, 'COMPLETE', { result: 'OK' }, '2026-10-19T05:00:00.000Z')
    const late = { ...events.at(-1), id: 'other', at: '2026-10-19T06:00:00.000Z', payload: { result: 'ISSUE', findings: '', actions: '', usedParts: [{ partNo: 'P', qty: 1 }] } }
    const request = foldRequests([...events, late]).get(events[0].requestId)
    expect(request.skipped.map((e) => e.id)).toEqual(['other'])
  })

  it('내용(JSON)이 서버 한도보다 크면 만들지 않는다', () => {
    let events = step([newRequest()], 'ASSIGN', { assignee: '이로봇' })
    events = step(events, 'START')
    const request = foldRequests(events).get(events[0].requestId)
    const quotes = '"'.repeat(1000)
    const result = createTransitionEvent(request, 'COMPLETE', { result: 'OK', findings: quotes, actions: quotes }, ctx())
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/너무 깁니다/) })
  })
})

describe('여러 기기의 자동 요청 합치기', () => {
  const sensor = (overrides = {}) => ({ ...requestInput, source: 'SENSOR', ruleId: 'leak', reading: { metric: 'leak', value: 1 }, ...overrides })

  it('같은 로봇·기준의 자동 요청이 이미 열려 있으면, 나중 요청은 재발생으로 합쳐 하나만 보인다', () => {
    const a = newRequest(sensor(), '2026-10-19T01:00:00.000Z')
    const b = newRequest(sensor(), '2026-10-19T01:00:05.000Z')
    const requests = foldRequests([b, a])
    expect(requests.size).toBe(1)
    expect(requests.get(a.requestId)).toMatchObject({ recurCount: 1, lastRecurAt: '2026-10-19T01:00:05.000Z', status: 'REQUESTED' })
  })

  it('합쳐진 요청에 다른 기기가 남긴 작업은 반영하지 않고 skipped로 남긴다', () => {
    const a = newRequest(sensor(), '2026-10-19T01:00:00.000Z')
    const b = newRequest(sensor(), '2026-10-19T01:00:05.000Z')
    const assignB = { id: 'x', requestId: b.requestId, type: 'ASSIGN', at: '2026-10-19T01:01:00.000Z', actor: '', payload: { assignee: '이로봇', dueDate: '' } }
    const merged = foldRequests([a, b, assignB]).get(a.requestId)
    expect(merged.status).toBe('REQUESTED')
    expect(merged.skipped.map((e) => e.id)).toEqual(['x'])
  })

  it('앞 요청이 끝났으면 새 요청으로 본다', () => {
    let events = [newRequest(sensor(), '2026-10-19T01:00:00.000Z')]
    events = step(events, 'CANCEL', { reason: '오작동' }, '2026-10-19T01:30:00.000Z')
    const later = newRequest(sensor(), '2026-10-19T02:00:00.000Z')
    expect(foldRequests([...events, later]).size).toBe(2)
  })

  it('직접 등록한 요청과 다른 기준·다른 로봇은 합치지 않는다', () => {
    const list = [
      newRequest(sensor()),
      newRequest(sensor({ ruleId: 'battery-low', reading: { metric: 'battery', value: 10 } })),
      newRequest(requestInput),
      newRequest(requestInput),
    ]
    expect(foldRequests(list).size).toBe(4)
  })
})
