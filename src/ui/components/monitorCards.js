import { METRICS, ROBOT_MODELS } from '../../domain/inspection/constants.js'
import { ANOMALIES, anomaliesFor } from '../../domain/monitor/generator.js'
import { rulesFor } from '../../domain/monitor/rules.js'
import { html, qs, setHtml } from '../dom.js'
import { option } from '../inspectionFormat.js'

const SPARK_POINTS = 30
const SPARK_W = 120
const SPARK_H = 28

// 작은 선 그래프. 좌표는 숫자만 넣으므로 그대로 그려도 안전하다.
export const sparkline = (values, metric) => {
  const { min, max } = METRICS[metric]
  const shown = values.slice(-SPARK_POINTS)
  if (shown.length < 2) return html`<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true"></svg>`
  const step = SPARK_W / (SPARK_POINTS - 1)
  const offset = (SPARK_POINTS - shown.length) * step
  const points = shown
    .map((v, i) => `${(offset + i * step).toFixed(1)},${(SPARK_H - ((v - min) / (max - min || 1)) * SPARK_H).toFixed(1)}`)
    .join(' ')
  return html`<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" /></svg>`
}

const formatValue = (metric, value) => {
  if (value === undefined) return '-'
  if (metric === 'leak') return value >= 1 ? '감지됨' : '없음'
  return `${value}${METRICS[metric].unit ? ` ${METRICS[metric].unit}` : ''}`
}

export const robotCard = (robot, siteName) => {
  const metrics = rulesFor(robot.model).map((r) => r.metric)
  const allMetrics = [...new Set(['depth', ...metrics])]
  return html`<article class="robot-card panel" data-robot-id="${robot.robotId}">
    <header class="robot-head">
      <div>
        <h2>${robot.name}</h2>
        <p class="muted">${ROBOT_MODELS[robot.model]} · ${siteName}</p>
      </div>
      <span class="robot-state badge" data-state="ok">정상</span>
    </header>
    <dl class="metric-list">
      ${allMetrics.map(
        (metric) => html`<div class="metric-row" data-metric="${metric}">
          <dt>${METRICS[metric].label}</dt>
          <dd class="value">-</dd>
          <dd class="spark-slot"></dd>
        </div>`,
      )}
    </dl>
    <div class="anomaly-controls">
      <label class="sr-only" for="an-${robot.robotId}">넣을 이상</label>
      <select class="input" id="an-${robot.robotId}" data-anomaly-select>
        ${anomaliesFor(robot.model).map((kind) => option(kind, ANOMALIES[kind].label, ''))}
      </select>
      <button type="button" class="btn btn-sm btn-danger" data-inject="${robot.robotId}">이상 넣기</button>
      <button type="button" class="btn btn-sm" data-clear="${robot.robotId}">정상화</button>
    </div>
  </article>`
}

// 값·그래프·상태만 바꾼다 (카드를 다시 그리지 않아 선택 상자가 유지된다)
export const updateRobotCard = (card, { history, violations, anomaly }) => {
  const violated = new Set(violations.map((v) => v.rule.metric))
  card.querySelectorAll('.metric-row').forEach((row) => {
    const { metric } = row.dataset
    const values = history[metric] ?? []
    qs(row, '.value').textContent = formatValue(metric, values.at(-1))
    setHtml(qs(row, '.spark-slot'), sparkline(values, metric))
    row.classList.toggle('is-alert', violated.has(metric))
  })
  const state = qs(card, '.robot-state')
  const alert = violations.length > 0
  state.dataset.state = alert ? 'alert' : anomaly ? 'warn' : 'ok'
  state.textContent = alert ? `이상 ${violations.length}건` : anomaly ? `${ANOMALIES[anomaly].label} 중` : '정상'
}
