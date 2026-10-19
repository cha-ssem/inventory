import { MODEL_METRICS } from '../inspection/constants.js'

// 센서 기준: 최근 windowN개 값이 모두 기준을 넘으면 위반이다 (순간 튀는 값으로 요청이 생기지 않도록).
// kind: MAX(기준보다 큼) · MIN(기준보다 작음) · BOOL(1이면 위반). cooldownMin: 재발생을 다시 기록하기까지 기다리는 분.
export const SENSOR_RULES = Object.freeze([
  { id: 'leak', metric: 'leak', kind: 'BOOL', threshold: 1, windowN: 1, priority: 'HIGH', title: '누수 감지', cooldownMin: 10 },
  { id: 'motor-overcurrent', metric: 'motorCurrent', kind: 'MAX', threshold: 20, windowN: 3, priority: 'HIGH', title: '추진기 과전류', cooldownMin: 10 },
  { id: 'battery-low', metric: 'battery', kind: 'MIN', threshold: 20, windowN: 2, priority: 'MID', title: '배터리 부족', cooldownMin: 30 },
  { id: 'water-hot', metric: 'waterTemp', kind: 'MAX', threshold: 35, windowN: 3, priority: 'LOW', title: '수온 높음', cooldownMin: 30 },
  { id: 'turbidity-high', metric: 'turbidity', kind: 'MAX', threshold: 120, windowN: 3, priority: 'MID', title: '탁도 높음 (영상 판독 어려움)', cooldownMin: 30 },
  { id: 'sonar-weak', metric: 'sonarSignal', kind: 'MIN', threshold: 40, windowN: 3, priority: 'MID', title: '소나 신호 약함', cooldownMin: 30 },
  { id: 'suction-clog', metric: 'suctionPressure', kind: 'MAX', threshold: 85, windowN: 3, priority: 'MID', title: '흡입구 막힘 의심', cooldownMin: 20 },
  { id: 'arm-overload', metric: 'armTorque', kind: 'MAX', threshold: 100, windowN: 2, priority: 'HIGH', title: '로봇팔 과부하', cooldownMin: 10 },
])

const VIOLATES = {
  MAX: (value, threshold) => value > threshold,
  MIN: (value, threshold) => value < threshold,
  BOOL: (value, threshold) => value >= threshold,
}

export const evaluateRule = (rule, values) => {
  if (values.length < rule.windowN) return false
  return values.slice(-rule.windowN).every((v) => Number.isFinite(v) && VIOLATES[rule.kind](v, rule.threshold))
}

export const rulesFor = (model) => {
  const metrics = new Set(MODEL_METRICS[model] ?? [])
  return SENSOR_RULES.filter((rule) => metrics.has(rule.metric))
}

// history: { 지표: [값, …] } (오래된 것부터). 위반한 기준과 그 지표의 마지막 값을 돌려준다.
export const findViolations = (model, history) =>
  rulesFor(model)
    .filter((rule) => Array.isArray(history[rule.metric]) && evaluateRule(rule, history[rule.metric]))
    .map((rule) => ({ rule, reading: { metric: rule.metric, value: history[rule.metric].at(-1) } }))
