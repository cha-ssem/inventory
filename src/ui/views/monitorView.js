import { raiseAlerts } from '../../data/inspectionActions.js'
import { formatDateTime } from '../../domain/dates.js'
import { advance, clearAnomaly, createSimulation, injectAnomaly } from '../../domain/monitor/generator.js'
import { findViolations } from '../../domain/monitor/rules.js'
import { html, qs, setHtml } from '../dom.js'
import { toast } from '../feedback.js'
import { robotCard, updateRobotCard } from '../components/monitorCards.js'
import { mountLogUpload } from '../components/logUpload.js'
import { priorityBadge, sectionBanner } from '../inspectionFormat.js'

const TICK_MS = 1000
const FEED_LIMIT = 8

const feedView = (feed) =>
  feed.length === 0
    ? html`<p class="muted">아직 감지된 이상이 없습니다. 로봇 카드에서 [이상 넣기]를 눌러 보세요.</p>`
    : html`<ul class="alert-feed">
        ${feed.map(
          (f) => html`<li>
            <span class="when">${formatDateTime(f.at)}</span> ${priorityBadge(f.priority)}
            <a href="#/inspection?id=${encodeURIComponent(f.requestId)}">${f.title}</a>
            ${f.kind === 'RECUR' ? html`<span class="muted">· 재발생</span>` : html`<span class="muted">· 점검 요청 생성</span>`}
          </li>`,
        )}
      </ul>`

const noRobotsView = html`<div class="empty">
  현장에 나가 있는 로봇이 없습니다. <a href="#/settings">설정 → 영풍산업 현장점검 샘플</a>에서 샘플을 불러오세요.
</div>`

export const renderMonitor = (container, { inspection, store }) => {
  const { robots, sites } = inspection.getState()
  let sim = createSimulation(robots)
  let running = true
  let autoRequest = true
  let feed = []
  const siteName = (siteId) => sites.find((s) => s.siteId === siteId)?.name ?? '본사 정비 중'
  const deployed = robots.filter((r) => sim.robots.some((s) => s.robotId === r.robotId))

  setHtml(
    container,
    html`${sectionBanner()}<div class="page-head">
        <h1>센서 모니터링</h1>
        <div class="actions">
          <label class="check"><input type="checkbox" data-auto checked /> 기준을 넘으면 점검 요청 자동 생성</label>
          <button type="button" class="btn" data-toggle>일시정지</button>
        </div>
      </div>
      <p class="muted">시연용 가상 센서입니다. 1초마다 새 값이 들어오고, 기준을 연속으로 넘으면 현장점검 탭에 점검 요청이 생깁니다.</p>
      <section class="panel">
        <div class="panel-head"><h2>최근 감지</h2></div>
        <div class="feed-slot" data-testid="alert-feed"></div>
      </section>
      <div class="robot-grid">${deployed.length === 0 ? noRobotsView : deployed.map((r) => robotCard(r, siteName(r.siteId)))}</div>
      <section class="panel log-slot"></section>`,
  )

  const drawFeed = () => setHtml(qs(container, '.feed-slot'), feedView(feed))

  const recordAlerts = (violations, source) => {
    const now = new Date().toISOString()
    const { created, recurred } = raiseAlerts(inspection, violations, { now, source })
    const items = created.map((e) => ({ kind: 'REQUEST', at: e.at, requestId: e.requestId, title: e.payload.title, priority: e.payload.priority }))
    if (created.length > 0) toast(`점검 요청 ${created.length}건을 만들었습니다: ${created.map((e) => e.payload.title).join(', ')}`, 'warning')
    if (recurred > 0) items.push({ kind: 'RECUR', at: now, requestId: '', title: `열린 요청 ${recurred}건에 재발생 기록`, priority: 'MID' })
    if (items.length > 0) {
      feed = [...items, ...feed].slice(0, FEED_LIMIT)
      drawFeed()
    }
    return { created, recurred }
  }

  const tick = () => {
    if (!running || document.hidden) return
    sim = advance(sim)
    const violations = deployed.flatMap((robot) => {
      const found = findViolations(robot.model, sim.history[robot.robotId])
      const card = qs(container, `[data-robot-id="${robot.robotId}"]`)
      if (card) updateRobotCard(card, { history: sim.history[robot.robotId], violations: found, anomaly: sim.anomalies[robot.robotId] })
      return found.map((v) => ({ ...v, robot }))
    })
    if (autoRequest) recordAlerts(violations, 'SENSOR')
  }

  container.addEventListener('click', (event) => {
    const inject = event.target.closest('[data-inject]')?.dataset.inject
    const clear = event.target.closest('[data-clear]')?.dataset.clear
    if (inject) {
      const kind = qs(event.target.closest('.robot-card'), '[data-anomaly-select]').value
      sim = injectAnomaly(sim, inject, kind)
    }
    if (clear) sim = clearAnomaly(sim, clear)
    if (event.target.closest('[data-toggle]')) {
      running = !running
      event.target.textContent = running ? '일시정지' : '다시 시작'
    }
  })
  container.addEventListener('change', (event) => {
    if (event.target.matches('[data-auto]')) autoRequest = event.target.checked
  })

  drawFeed()
  tick()
  const timer = setInterval(tick, TICK_MS)
  const unmountLog = mountLogUpload(qs(container, '.log-slot'), { inspection, store, onViolations: (v) => recordAlerts(v, 'LOG') })
  return () => {
    clearInterval(timer)
    unmountLog()
  }
}
