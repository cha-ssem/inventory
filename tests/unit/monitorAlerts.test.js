import { describe, it, expect } from 'vitest'
import { planAlerts } from '../../src/domain/monitor/alerts.js'

const NOW = '2026-10-19T09:00:00.000Z'
const MIN = 60_000
const at = (minutesAgo) => new Date(Date.parse(NOW) - minutesAgo * MIN).toISOString()
const robot = { robotId: 'RV-01', model: 'V1', siteId: 'ST-01', name: 'V1 영상 1호기' }
const leakRule = { id: 'leak', metric: 'leak', kind: 'BOOL', threshold: 1, windowN: 1, priority: 'HIGH', title: '누수 감지', cooldownMin: 10 }
const violation = { robot, rule: leakRule, reading: { metric: 'leak', value: 1 } }
const openRequest = (overrides = {}) => ({
  requestId: 'R-1', robotId: 'RV-01', ruleId: 'leak', status: 'REQUESTED', source: 'SENSOR', requestedAt: at(30), lastRecurAt: null, ...overrides,
})

describe('planAlerts', () => {
  it('열린 요청이 없으면 센서 점검 요청을 만든다', () => {
    const [action] = planAlerts([violation], [], NOW)
    expect(action).toEqual({
      kind: 'REQUEST',
      input: {
        siteId: 'ST-01', robotId: 'RV-01', source: 'SENSOR', priority: 'HIGH', ruleId: 'leak',
        title: '누수 감지 (V1 영상 1호기)', detail: '센서 기준을 넘었습니다: 누수 감지', reading: { metric: 'leak', value: 1 },
      },
    })
  })

  it('같은 로봇·같은 기준의 열린 요청이 있으면 재발생으로 기록한다', () => {
    expect(planAlerts([violation], [openRequest()], NOW)).toEqual([{ kind: 'RECUR', requestId: 'R-1', reading: { metric: 'leak', value: 1 } }])
  })

  it('재발생은 기준의 대기 시간(cooldown) 안이면 다시 기록하지 않는다', () => {
    expect(planAlerts([violation], [openRequest({ requestedAt: at(5) })], NOW)).toEqual([])
    expect(planAlerts([violation], [openRequest({ lastRecurAt: at(3) })], NOW)).toEqual([])
    expect(planAlerts([violation], [openRequest({ lastRecurAt: at(11) })], NOW)).toHaveLength(1)
  })

  it('끝난 요청은 중복으로 보지 않는다 (완료 후 다시 생기면 새 요청)', () => {
    const [action] = planAlerts([violation], [openRequest({ status: 'COMPLETED' })], NOW)
    expect(action.kind).toBe('REQUEST')
  })

  it('다른 기준·다른 로봇의 요청은 상관없다', () => {
    expect(planAlerts([violation], [openRequest({ ruleId: 'battery' })], NOW)[0].kind).toBe('REQUEST')
    expect(planAlerts([violation], [openRequest({ robotId: 'RV-02' })], NOW)[0].kind).toBe('REQUEST')
  })

  it('현장에 배치되지 않은 로봇은 요청을 만들지 않는다', () => {
    expect(planAlerts([{ ...violation, robot: { ...robot, siteId: null } }], [], NOW)).toEqual([])
  })

  it('한 번에 같은 로봇·기준이 두 번 오면 하나만 만든다', () => {
    expect(planAlerts([violation, violation], [], NOW)).toHaveLength(1)
  })

  it('열린 요청 시각이 미래(다른 기기 시계가 빠름)면 대기 시간이 지난 것으로 본다', () => {
    expect(planAlerts([violation], [openRequest({ requestedAt: at(-60) })], NOW)).toHaveLength(1)
  })

  it('재발생이 50번 쌓인 요청에는 더 기록하지 않는다 (저장 공간 보호)', () => {
    expect(planAlerts([violation], [openRequest({ recurCount: 50, lastRecurAt: at(30) })], NOW)).toEqual([])
  })

  it('로그 분석에서 온 위반은 출처를 LOG로 남긴다', () => {
    const [action] = planAlerts([violation], [], NOW, { source: 'LOG' })
    expect(action.input).toMatchObject({ source: 'LOG', title: '로그 분석: 누수 감지 (V1 영상 1호기)' })
  })
})
