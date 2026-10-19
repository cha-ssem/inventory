import { parseCsv, toCsv } from '../csv.js'
import { MODEL_METRICS } from '../inspection/constants.js'
import { advance, clearAnomaly, createSimulation, injectAnomaly, latest } from './generator.js'
import { evaluateRule, rulesFor } from './rules.js'

// 로봇이 남긴 센서 로그(CSV: 시각, 로봇, 지표, 값)를 읽고 기준을 넘은 구간을 찾는다
export const LOG_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxRows: 20000, maxErrors: 5 })

const HEADERS = {
  at: ['timestamp', 'time', '시각', '일시'],
  robotId: ['robotid', 'robot', '로봇'],
  metric: ['metric', '지표'],
  value: ['value', '값'],
}

const findColumns = (header) => {
  const lower = header.map((h) => h.trim().toLowerCase())
  const columns = Object.fromEntries(Object.entries(HEADERS).map(([field, names]) => [field, lower.findIndex((h) => names.includes(h))]))
  return Object.values(columns).every((i) => i >= 0) ? columns : null
}

const readRow = (cells, columns, models) => {
  const time = Date.parse(cells[columns.at]?.trim() ?? '')
  const robotId = (cells[columns.robotId] ?? '').trim().toUpperCase()
  const metric = (cells[columns.metric] ?? '').trim()
  const raw = (cells[columns.value] ?? '').trim()
  const value = raw === '' ? Number.NaN : Number(raw)
  if (Number.isNaN(time)) return { error: '시각을 읽을 수 없습니다' }
  if (!models.has(robotId)) return { error: `등록되지 않은 로봇 ${robotId || '(빈 값)'}` }
  if (!MODEL_METRICS[models.get(robotId)].includes(metric)) return { error: `이 로봇에 없는 지표 ${metric || '(빈 값)'}` }
  if (!Number.isFinite(value)) return { error: `숫자가 아닌 값 ${raw}` }
  return { row: { at: new Date(time).toISOString(), robotId, metric, value } }
}

export const parseSensorLog = (text, robots) => {
  let table
  try {
    table = parseCsv(text)
  } catch (error) {
    return { ok: false, error: error.message }
  }
  const [header = [], ...body] = table
  const columns = findColumns(header)
  if (!columns) return { ok: false, error: '머리글이 맞지 않습니다. 첫 줄은 timestamp,robotId,metric,value (또는 시각,로봇,지표,값)이어야 합니다.' }
  if (body.length > LOG_LIMITS.maxRows) return { ok: false, error: `로그는 한 번에 ${LOG_LIMITS.maxRows.toLocaleString()}행까지 올릴 수 있습니다.` }
  const models = new Map(robots.map((r) => [r.robotId, r.model]))
  const parsed = body.map((cells, i) => ({ line: i + 2, ...readRow(cells, columns, models) }))
  const rows = parsed.filter((p) => p.row).map((p) => p.row).sort((a, b) => a.at.localeCompare(b.at))
  const failed = parsed.filter((p) => p.error)
  if (rows.length === 0) return { ok: false, error: failed.length > 0 ? `읽을 수 있는 행이 없습니다 (${failed[0].line}행: ${failed[0].error}).` : '로그에 내용이 없습니다.' }
  return { ok: true, rows, skipped: failed.length, errors: failed.slice(0, LOG_LIMITS.maxErrors).map((f) => `${f.line}행: ${f.error}`) }
}

const worstOf = (rule, values) => (rule.kind === 'MIN' ? Math.min(...values) : Math.max(...values))

// 한 지표의 시간순 값에서 위반이 이어진 구간을 묶는다
const segmentsOf = (rule, points) => {
  const segments = []
  let current = null
  points.forEach((point, i) => {
    const violated = evaluateRule(rule, points.slice(Math.max(0, i - rule.windowN + 1), i + 1).map((p) => p.value))
    if (violated) {
      current = current ?? { from: point.at, points: [] }
      current.points.push(point)
    } else if (current) {
      segments.push(current)
      current = null
    }
  })
  if (current) segments.push(current)
  return segments.map((s) => ({ from: s.from, to: s.points.at(-1).at, count: s.points.length, worst: worstOf(rule, s.points.map((p) => p.value)) }))
}

// 위반 구간: [{ robotId, rule, from, to, count, worst }]
export const analyzeLog = (rows, robots) =>
  robots.flatMap((robot) =>
    rulesFor(robot.model).flatMap((rule) => {
      const points = rows.filter((r) => r.robotId === robot.robotId && r.metric === rule.metric)
      return segmentsOf(rule, points).map((segment) => ({ robotId: robot.robotId, rule, ...segment }))
    }),
  )

const SAMPLE_MINUTES = 120
const MINUTE_MS = 60_000
const SAMPLE_SEED = 20261019

// 시연용 로그: 현장 로봇들의 최근 2시간(1분 간격). 소나 로봇은 중간에 신호가 끊기고, 첫 로봇은 끝 무렵 배터리가 급감한다.
export const buildSampleLog = (robots, now) => {
  let sim = createSimulation(robots, SAMPLE_SEED)
  const sonar = sim.robots.find((r) => r.model === 'V2')
  const first = sim.robots.find((r) => r.model !== 'V2')
  const endMs = Date.parse(now)
  const rows = []
  for (let minute = 0; minute < SAMPLE_MINUTES; minute += 1) {
    if (sonar && minute === 60) sim = injectAnomaly(sim, sonar.robotId, 'sonarLoss')
    if (sonar && minute === 75) sim = clearAnomaly(sim, sonar.robotId)
    if (first && minute === 100) sim = injectAnomaly(sim, first.robotId, 'batteryDrain')
    sim = advance(sim)
    const at = new Date(endMs - (SAMPLE_MINUTES - 1 - minute) * MINUTE_MS).toISOString()
    sim.robots.forEach(({ robotId }) => {
      Object.entries(latest(sim, robotId)).forEach(([metric, value]) => rows.push([at, robotId, metric, value]))
    })
  }
  return toCsv([['timestamp', 'robotId', 'metric', 'value'], ...rows])
}
