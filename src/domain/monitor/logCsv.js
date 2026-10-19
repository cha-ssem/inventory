import { parseCsv, toCsv, unescapeCell } from '../csv.js'
import { MODEL_METRICS } from '../inspection/constants.js'
import { blockedReason } from './deployment.js'
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

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/
const NUMBER = /^-?\d+(\.\d+)?$/
const YEAR_RANGE = [2000, 2100]
const MAX_RAW_IN_MESSAGE = 40

// ISO(시차 포함)는 그대로, "YYYY-MM-DD HH:mm[:ss]"는 이 기기 시간(한국 시간)으로 읽는다. 날짜만·엑셀 일련번호는 받지 않는다.
// 2026-02-31, 25:61처럼 없는 날짜·시각은 Date가 다음 달·날로 넘기므로, 숫자 범위를 먼저 확인한다
const isRealDateTime = ([y, mo, d, h, mi, sec]) => {
  const day = new Date(Date.UTC(y, mo - 1, d))
  return day.getUTCMonth() === mo - 1 && day.getUTCDate() === d && h <= 23 && mi <= 59 && sec <= 59
}

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/

const parseTime = (text) => {
  const parts = DATE_PARTS.exec(text)
  if (!parts || !isRealDateTime(parts.slice(1).map((v) => Number(v ?? 0)))) return Number.NaN
  let time = Number.NaN
  if (ISO_TIME.test(text)) time = Date.parse(text)
  const local = LOCAL_TIME.exec(text)
  if (local) {
    const [, y, mo, d, h, mi, sec = '0'] = local.map((v) => (v === undefined ? v : Number(v)))
    time = new Date(y, mo - 1, d, h, mi, sec).getTime()
  }
  const year = Number.isNaN(time) ? 0 : new Date(time).getFullYear()
  return year >= YEAR_RANGE[0] && year <= YEAR_RANGE[1] ? time : Number.NaN
}

const clipRaw = (raw) => (raw.length > MAX_RAW_IN_MESSAGE ? `${raw.slice(0, MAX_RAW_IN_MESSAGE)}…` : raw)

const readRow = (cells, columns, models) => {
  const cell = (key) => unescapeCell((cells[columns[key]] ?? '').trim())
  const time = parseTime(cell('at'))
  const robotId = cell('robotId').toUpperCase()
  const metric = cell('metric')
  const raw = cell('value')
  if (Number.isNaN(time)) return { error: '시각을 읽을 수 없습니다 (예: 2026-10-19 10:00 또는 2026-10-19T01:00:00Z)' }
  if (!models.has(robotId)) return { error: `등록되지 않은 로봇 ${clipRaw(robotId) || '(빈 값)'}` }
  if (!MODEL_METRICS[models.get(robotId)].includes(metric)) return { error: `이 로봇에 없는 지표 ${clipRaw(metric) || '(빈 값)'}` }
  if (!NUMBER.test(raw)) return { error: `숫자가 아닌 값 ${clipRaw(raw)}` }
  return { row: { time, at: new Date(time).toISOString(), robotId, metric, value: Number(raw) } }
}

// 같은 로봇·지표·시각의 행은 마지막 값 하나만 남긴다 (로그를 두 번 붙여 넣어 거짓 위반이 생기지 않도록)
const dedupe = (rows) => {
  const byKey = new Map()
  rows.forEach((row) => byKey.set(`${row.robotId}|${row.metric}|${row.time}`, row))
  return [...byKey.values()]
}

export const parseSensorLog = (text, robots) => {
  if (text.length > LOG_LIMITS.maxBytes) return { ok: false, error: '로그 파일은 2MB 이하만 올릴 수 있습니다.' }
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
  const valid = parsed.filter((p) => p.row).map((p) => p.row)
  const failed = parsed.filter((p) => p.error)
  if (valid.length === 0) return { ok: false, error: failed.length > 0 ? `읽을 수 있는 행이 없습니다 (${failed[0].line}행: ${failed[0].error}).` : '로그에 내용이 없습니다.' }
  const rows = dedupe(valid).sort((a, b) => a.time - b.time).map(({ time, ...row }) => row)
  return {
    ok: true,
    rows,
    skipped: failed.length,
    duplicates: valid.length - rows.length,
    errors: failed.slice(0, LOG_LIMITS.maxErrors).map((f) => `${f.line}행: ${f.error}`),
  }
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

// 위반 구간: [{ robotId, rule, from, to, count, worst, deployed, blocked }].
// deployed=false면 점검 요청을 만들 수 없고, blocked에 그 이유(본사 정비 중·사용 중지)가 있다.
export const analyzeLog = (rows, robots, sites) => {
  const byKey = new Map()
  rows.forEach((r) => {
    const key = `${r.robotId}|${r.metric}`
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  })
  return robots.flatMap((robot) =>
    rulesFor(robot.model).flatMap((rule) =>
      segmentsOf(rule, byKey.get(`${robot.robotId}|${rule.metric}`) ?? []).map((segment) => ({
        robotId: robot.robotId, rule, ...segment, deployed: !blockedReason(robot, sites), blocked: blockedReason(robot, sites),
      })),
    ),
  )
}

const SAMPLE_MINUTES = 120
const MINUTE_MS = 60_000
const SAMPLE_SEED = 20261019

// 시연용 로그: 현장 로봇들의 최근 2시간(1분 간격). 소나 로봇은 중간에 신호가 끊기고, 첫 로봇은 끝 무렵 배터리가 급감한다.
export const buildSampleLog = (robots, now) => {
  let sim = createSimulation(robots, SAMPLE_SEED)
  // 로봇이 많아도 올릴 수 있는 행 수(maxRows)를 넘지 않게 기간을 줄인다
  const rowsPerMinute = sim.robots.reduce((sum, r) => sum + MODEL_METRICS[r.model].length, 0) || 1
  const minutes = Math.min(SAMPLE_MINUTES, Math.floor(LOG_LIMITS.maxRows / rowsPerMinute))
  const sonar = sim.robots.find((r) => r.model === 'V2')
  const first = sim.robots.find((r) => r.model !== 'V2')
  const endMs = Date.parse(now)
  const rows = []
  for (let minute = 0; minute < minutes; minute += 1) {
    if (sonar && minute === Math.floor(minutes / 2)) sim = injectAnomaly(sim, sonar.robotId, 'sonarLoss')
    if (sonar && minute === Math.floor(minutes * 0.625)) sim = clearAnomaly(sim, sonar.robotId)
    if (first && minute === Math.floor(minutes * 0.83)) sim = injectAnomaly(sim, first.robotId, 'batteryDrain')
    sim = advance(sim)
    const at = new Date(endMs - (minutes - 1 - minute) * MINUTE_MS).toISOString()
    sim.robots.forEach(({ robotId }) => {
      Object.entries(latest(sim, robotId)).forEach(([metric, value]) => rows.push([at, robotId, metric, value]))
    })
  }
  return toCsv([['timestamp', 'robotId', 'metric', 'value'], ...rows])
}
