import { describe, it, expect } from 'vitest'
import { ANOMALIES, advance, anomaliesFor, clearAnomaly, createSimulation, injectAnomaly, latest } from '../../src/domain/monitor/generator.js'
import { METRICS, MODEL_METRICS } from '../../src/domain/inspection/constants.js'
import { findViolations } from '../../src/domain/monitor/rules.js'

const robots = [
  { robotId: 'RV-01', model: 'V1', siteId: 'ST-01' },
  { robotId: 'RV-04', model: 'V3', siteId: 'ST-05' },
  { robotId: 'RV-06', model: 'V4', siteId: null },
]

const run = (sim, ticks) => Array.from({ length: ticks }).reduce((s) => advance(s), sim)

describe('createSimulation / advance', () => {
  it('현장에 나가 있는 로봇만 모델별 지표를 만든다', () => {
    const sim = advance(createSimulation(robots, 1))
    expect(Object.keys(sim.history)).toEqual(['RV-01', 'RV-04'])
    expect(Object.keys(sim.history['RV-01'])).toEqual(MODEL_METRICS.V1)
    expect(Object.keys(sim.history['RV-04'])).toEqual(MODEL_METRICS.V3)
  })

  it('값은 지표 범위 안에 있고, 정상일 때는 어떤 기준도 위반하지 않는다', () => {
    const sim = run(createSimulation(robots, 7), 60)
    Object.entries(sim.history).forEach(([robotId, metrics]) => {
      Object.entries(metrics).forEach(([metric, values]) => {
        values.forEach((v) => {
          expect(v).toBeGreaterThanOrEqual(METRICS[metric].min)
          expect(v).toBeLessThanOrEqual(METRICS[metric].max)
        })
      })
      const model = robots.find((r) => r.robotId === robotId).model
      expect(findViolations(model, metrics)).toEqual([])
    })
  })

  it('같은 seed면 같은 값을 만든다', () => {
    expect(run(createSimulation(robots, 3), 10)).toEqual(run(createSimulation(robots, 3), 10))
  })

  it('지표별로 최근 값만 남긴다 (메모리 보호)', () => {
    const sim = run(createSimulation(robots, 3), 200)
    expect(sim.history['RV-01'].depth.length).toBeLessThanOrEqual(60)
    expect(sim.tick).toBe(200)
  })

  it('원래 상태를 바꾸지 않고 새 상태를 돌려준다', () => {
    const sim = createSimulation(robots, 3)
    const next = advance(sim)
    expect(sim.tick).toBe(0)
    expect(next).not.toBe(sim)
  })
})

describe('이상 넣기', () => {
  it.each(Object.keys(ANOMALIES).filter((k) => ANOMALIES[k].models === undefined))('%s를 넣으면 몇 번 안에 해당 기준을 위반한다', (kind) => {
    let sim = injectAnomaly(run(createSimulation(robots, 5), 5), 'RV-01', kind)
    sim = run(sim, 8)
    const found = findViolations('V1', sim.history['RV-01'])
    expect(found.map((f) => f.rule.metric)).toContain(ANOMALIES[kind].metric)
  })

  it('모델 전용 이상은 그 모델에서만 고를 수 있다', () => {
    expect(anomaliesFor('V1')).toContain('turbiditySurge')
    expect(anomaliesFor('V3')).not.toContain('turbiditySurge')
    expect(anomaliesFor('V3')).toContain('suctionClog')
  })

  it('모델 전용 이상도 위반을 만든다', () => {
    let sim = injectAnomaly(run(createSimulation(robots, 5), 3), 'RV-04', 'suctionClog')
    sim = run(sim, 8)
    expect(findViolations('V3', sim.history['RV-04']).map((f) => f.rule.metric)).toContain('suctionPressure')
  })

  it('정상화하면 다시 기준 안으로 돌아온다', () => {
    let sim = run(injectAnomaly(createSimulation(robots, 5), 'RV-01', 'currentSpike'), 6)
    sim = run(clearAnomaly(sim, 'RV-01'), 6)
    expect(findViolations('V1', sim.history['RV-01'])).toEqual([])
  })

  it('없는 로봇이나 그 모델에 없는 이상은 무시한다', () => {
    const sim = createSimulation(robots, 5)
    expect(injectAnomaly(sim, 'RV-99', 'leak')).toBe(sim)
    expect(injectAnomaly(sim, 'RV-04', 'turbiditySurge')).toBe(sim)
  })

  it('latest: 로봇의 지표별 마지막 값을 준다', () => {
    const sim = run(createSimulation(robots, 5), 2)
    const values = latest(sim, 'RV-01')
    expect(Object.keys(values)).toEqual(MODEL_METRICS.V1)
    expect(values.depth).toBe(sim.history['RV-01'].depth.at(-1))
  })
})
