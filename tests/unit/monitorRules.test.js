import { describe, it, expect } from 'vitest'
import { SENSOR_RULES, evaluateRule, findViolations, rulesFor } from '../../src/domain/monitor/rules.js'

const rule = (overrides) => ({ id: 't', metric: 'motorCurrent', kind: 'MAX', threshold: 20, windowN: 3, priority: 'HIGH', title: '과전류', ...overrides })

describe('evaluateRule', () => {
  it('MAX: 최근 N개가 모두 기준을 넘어야 위반이다 (순간 튀는 값은 무시)', () => {
    expect(evaluateRule(rule(), [10, 25, 26, 27])).toBe(true)
    expect(evaluateRule(rule(), [25, 26, 10, 27])).toBe(false)
    expect(evaluateRule(rule(), [25, 26])).toBe(false)
  })

  it('기준값과 같으면 위반이 아니다', () => {
    expect(evaluateRule(rule({ windowN: 1 }), [20])).toBe(false)
  })

  it('MIN: 최근 N개가 모두 기준보다 낮아야 위반이다', () => {
    const low = rule({ metric: 'battery', kind: 'MIN', threshold: 20, windowN: 2 })
    expect(evaluateRule(low, [30, 19, 18])).toBe(true)
    expect(evaluateRule(low, [19, 21])).toBe(false)
  })

  it('BOOL: 1이 나오면 위반이다', () => {
    const leak = rule({ metric: 'leak', kind: 'BOOL', threshold: 1, windowN: 1 })
    expect(evaluateRule(leak, [0, 0, 1])).toBe(true)
    expect(evaluateRule(leak, [1, 0])).toBe(false)
  })

  it('숫자가 아닌 값이 끼면 위반으로 보지 않는다', () => {
    expect(evaluateRule(rule({ windowN: 2 }), [25, Number.NaN])).toBe(false)
  })
})

describe('rulesFor', () => {
  it('공통 기준과 그 모델에만 있는 지표의 기준을 준다', () => {
    const v1 = rulesFor('V1').map((r) => r.metric)
    expect(v1).toEqual(expect.arrayContaining(['leak', 'motorCurrent', 'battery', 'turbidity']))
    expect(v1).not.toContain('armTorque')
    expect(rulesFor('V4').map((r) => r.metric)).toContain('armTorque')
  })

  it('모든 기준은 ID가 겹치지 않고 우선순위가 있다', () => {
    expect(new Set(SENSOR_RULES.map((r) => r.id)).size).toBe(SENSOR_RULES.length)
    SENSOR_RULES.forEach((r) => expect(['HIGH', 'MID', 'LOW']).toContain(r.priority))
  })
})

describe('findViolations', () => {
  it('로봇의 지표별 기록을 보고 위반한 기준과 마지막 값을 돌려준다', () => {
    const history = { leak: [0, 1], motorCurrent: [10, 11, 12], battery: [80, 80] }
    const found = findViolations('V1', history)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: { metric: 'leak' }, reading: { metric: 'leak', value: 1 } })
  })

  it('기록이 없는 지표는 건너뛴다', () => {
    expect(findViolations('V2', {})).toEqual([])
  })
})
