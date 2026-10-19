import { METRICS, MODEL_METRICS } from '../inspection/constants.js'
import { createRandom } from '../random.js'

// 시연용 가상 센서. 상태를 바꾸지 않고 advance가 새 상태를 돌려준다. 같은 seed면 늘 같은 값이 나온다.
const HISTORY_LIMIT = 60
const BATTERY_START = 90
const BATTERY_NORMAL_DRAIN = 0.05
const BATTERY_FLOOR = 25 // 정상일 때는 이 아래로 내려가지 않는다 (배터리 부족 기준 20%)
const BATTERY_FAST_DRAIN = 12

// 정상값: [기준, 흔들림 폭]
const NORMAL = {
  depth: [10, 0.6],
  waterTemp: [16, 0.4],
  motorCurrent: [8, 2],
  turbidity: [30, 10],
  sonarSignal: [80, 5],
  suctionPressure: [50, 5],
  armTorque: [40, 10],
}

// metric을 [기준, 흔들림 폭]으로 바꾸는 이상. models가 있으면 그 모델만 고를 수 있다.
export const ANOMALIES = Object.freeze({
  leak: { label: '누수 발생', metric: 'leak' },
  currentSpike: { label: '추진기 과전류', metric: 'motorCurrent', value: [24, 2] },
  batteryDrain: { label: '배터리 급감', metric: 'battery' },
  tempRise: { label: '수온 상승', metric: 'waterTemp', value: [38, 1] },
  turbiditySurge: { label: '흙탕물 유입', metric: 'turbidity', value: [160, 10], models: ['V1'] },
  sonarLoss: { label: '소나 신호 끊김', metric: 'sonarSignal', value: [25, 5], models: ['V2'] },
  suctionClog: { label: '흡입구 막힘', metric: 'suctionPressure', value: [92, 3], models: ['V3'] },
  armOverload: { label: '로봇팔 과부하', metric: 'armTorque', value: [110, 5], models: ['V4'] },
})

export const anomaliesFor = (model) =>
  Object.keys(ANOMALIES).filter((kind) => !ANOMALIES[kind].models || ANOMALIES[kind].models.includes(model))

const round1 = (v) => Math.round(v * 10) / 10
const clamp = (metric, v) => Math.min(METRICS[metric].max, Math.max(METRICS[metric].min, v))

// 현장에 나가 있는 로봇만 센서를 돌린다 (본사 정비 중인 로봇은 제외)
export const createSimulation = (robots, seed = Date.now()) => {
  const deployed = robots.filter((r) => r.siteId && MODEL_METRICS[r.model])
  return {
    seed,
    tick: 0,
    robots: deployed.map((r) => ({ robotId: r.robotId, model: r.model })),
    anomalies: {},
    battery: Object.fromEntries(deployed.map((r) => [r.robotId, BATTERY_START])),
    history: Object.fromEntries(deployed.map((r) => [r.robotId, Object.fromEntries(MODEL_METRICS[r.model].map((m) => [m, []]))])),
  }
}

const nextBattery = (level, anomaly) => {
  if (anomaly === 'batteryDrain') return Math.max(0, level - BATTERY_FAST_DRAIN)
  return Math.max(BATTERY_FLOOR, level - BATTERY_NORMAL_DRAIN)
}

const readMetric = (metric, { random, anomaly, battery, offset }) => {
  if (metric === 'leak') return anomaly === 'leak' ? 1 : 0
  if (metric === 'battery') return round1(battery)
  const override = anomaly && ANOMALIES[anomaly].metric === metric ? ANOMALIES[anomaly].value : null
  const [base, spread] = override ?? NORMAL[metric]
  const shift = metric === 'depth' ? offset : 0
  return round1(clamp(metric, base + shift + (random() * 2 - 1) * spread))
}

export const advance = (sim) => {
  const random = createRandom(sim.seed + sim.tick * 7919)
  const battery = {}
  const history = {}
  sim.robots.forEach(({ robotId, model }, index) => {
    const anomaly = sim.anomalies[robotId]
    battery[robotId] = nextBattery(sim.battery[robotId], anomaly)
    const context = { random, anomaly, battery: battery[robotId], offset: index * 3 }
    history[robotId] = Object.fromEntries(
      MODEL_METRICS[model].map((metric) => [metric, [...sim.history[robotId][metric], readMetric(metric, context)].slice(-HISTORY_LIMIT)]),
    )
  })
  return { ...sim, tick: sim.tick + 1, battery, history }
}

export const injectAnomaly = (sim, robotId, kind) => {
  const robot = sim.robots.find((r) => r.robotId === robotId)
  if (!robot || !anomaliesFor(robot.model).includes(kind)) return sim
  return { ...sim, anomalies: { ...sim.anomalies, [robotId]: kind } }
}

// 정상화: 배터리 급감이었으면 배터리를 교체한 것으로 본다
export const clearAnomaly = (sim, robotId) => {
  const { [robotId]: removed, ...rest } = sim.anomalies
  const battery = removed === 'batteryDrain' ? { ...sim.battery, [robotId]: BATTERY_START } : sim.battery
  return { ...sim, anomalies: rest, battery }
}

export const latest = (sim, robotId) =>
  Object.fromEntries(Object.entries(sim.history[robotId] ?? {}).map(([metric, values]) => [metric, values.at(-1)]))
