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
const RETRY_AFTER_MS = 10 * 60_000 // 만들지 못한 자동 요청은 이 시간 동안 다시 시도하지 않는다

const feedItem = (f) => html`<li>
  <span class="when">${formatDateTime(f.at)}</span> ${priorityBadge(f.priority)}
  ${f.requestId ? html`<a href="#/inspection?id=${encodeURIComponent(f.requestId)}">${f.title}</a>` : f.title}
  <span class="muted">· ${f.kind === 'RECUR' ? '재발생' : '점검 요청 생성'}</span>
</li>`

const feedView = (feed) =>
  feed.length === 0
    ? html`<p class="muted">아직 감지된 이상이 없습니다. 로봇 카드에서 [이상 넣기]를 눌러 보세요.</p>`
    : html`<ul class="alert-feed">${feed.map(feedItem)}</ul>`

const noRobotsView = html`<div class="empty">
  현장에 나가 있는 로봇이 없습니다. <a href="#/settings">설정 → 수중 점검 로봇 현장점검 샘플</a>에서 샘플을 불러오세요.
</div>`

const layout = (deployed, siteName) => html`${sectionBanner()}<div class="page-head">
    <h1>센서 모니터링</h1>
    <div class="actions">
      <label class="check"><input type="checkbox" data-auto checked /> 기준을 넘으면 점검 요청 자동 생성</label>
      <button type="button" class="btn" data-toggle>일시정지</button>
    </div>
  </div>
  <p class="muted">시연용 가상 센서입니다. 이 화면을 보고 있는 동안 1초마다 새 값이 들어오고, 기준을 연속으로 넘으면 현장점검 탭에 점검 요청이 생깁니다. (다른 탭을 보면 멈춥니다)</p>
  <section class="panel">
    <div class="panel-head"><h2>최근 감지</h2></div>
    <div class="feed-slot" data-testid="alert-feed"></div>
  </section>
  <div class="robot-grid">${deployed.length === 0 ? noRobotsView : deployed.map((r) => robotCard(r, siteName(r.siteId)))}</div>
  <section class="panel log-slot"></section>`

// 사용 중인 현장에 나가 있는 사용 중인 로봇만 감시한다
const deployedRobots = ({ robots, sites }) => {
  const activeSites = new Set(sites.filter((s) => s.active !== false).map((s) => s.siteId))
  return robots.filter((r) => r.active !== false && activeSites.has(r.siteId))
}

// 위반을 점검 요청으로 기록하고 결과를 "최근 감지"에 보여 준다.
// 저장 경고가 나면 자동 생성을 끄고, 만들지 못한 것은 한 번만 알리고 한동안 다시 시도하지 않는다.
const createAlertRecorder = ({ inspection, onFeed, onStorageWarning }) => {
  const suppressed = new Map() // 'robotId|ruleId' → 다시 시도할 시각
  const isSuppressed = (v) => (suppressed.get(`${v.robot.robotId}|${v.rule.id}`) ?? 0) > Date.now()

  return (violations, source) => {
    const result = raiseAlerts(inspection, violations.filter((v) => !isSuppressed(v)), { source })
    result.failed.forEach(({ key, error }) => {
      suppressed.set(key, Date.now() + RETRY_AFTER_MS)
      toast(`점검 요청을 만들지 못했습니다 (${key.split('|')[0]}): ${error}`, 'error')
    })
    if (result.warnings.length > 0) onStorageWarning(result.warnings[0])
    const items = result.created.map((e) => ({ kind: 'REQUEST', at: e.at, requestId: e.requestId, title: e.payload.title, priority: e.payload.priority }))
    if (result.created.length > 0) toast(`점검 요청 ${result.created.length}건을 만들었습니다: ${result.created.map((e) => e.payload.title).join(', ')}`, 'warning')
    if (result.recurred > 0) items.push({ kind: 'RECUR', at: new Date().toISOString(), requestId: '', title: `열린 요청 ${result.recurred}건에 재발생 기록`, priority: 'MID' })
    if (items.length > 0) onFeed(items)
    return result
  }
}

// 화면 한 벌을 새 요소(view)에 그린다. 다시 그릴 때는 새 요소를 써서 이전 이벤트가 남지 않게 한다.
const mountMonitor = (view, { inspection }) => {
  const state = inspection.getState()
  const deployed = deployedRobots(state)
  const siteName = (siteId) => state.sites.find((s) => s.siteId === siteId)?.name ?? '본사 정비 중'
  let sim = createSimulation(deployed)
  let running = true
  let autoRequest = true
  let feed = []

  setHtml(view, layout(deployed, siteName))
  const drawFeed = () => setHtml(qs(view, '.feed-slot'), feedView(feed))
  const autoBox = qs(view, '[data-auto]')
  const record = createAlertRecorder({
    inspection,
    onFeed: (items) => {
      feed = [...items, ...feed].slice(0, FEED_LIMIT)
      drawFeed()
    },
    onStorageWarning: (warning) => {
      autoRequest = false
      autoBox.checked = false
      toast(`${warning} 자동 생성을 껐습니다.`, 'error')
    },
  })

  const tick = () => {
    if (!running || document.hidden) return
    sim = advance(sim)
    const violations = deployed.flatMap((robot) => {
      const found = findViolations(robot.model, sim.history[robot.robotId])
      const card = qs(view, `[data-robot-id="${robot.robotId}"]`)
      if (card) updateRobotCard(card, { history: sim.history[robot.robotId], violations: found, anomaly: sim.anomalies[robot.robotId] })
      return found.map((v) => ({ ...v, robot }))
    })
    if (autoRequest) record(violations, 'SENSOR')
  }

  view.addEventListener('click', (event) => {
    const inject = event.target.closest('[data-inject]')?.dataset.inject
    const clear = event.target.closest('[data-clear]')?.dataset.clear
    if (inject) sim = injectAnomaly(sim, inject, qs(event.target.closest('.robot-card'), '[data-anomaly-select]').value)
    if (clear) sim = clearAnomaly(sim, clear)
    const toggle = event.target.closest('[data-toggle]')
    if (toggle) {
      running = !running
      toggle.textContent = running ? '일시정지' : '다시 시작'
    }
  })
  autoBox.addEventListener('change', () => (autoRequest = autoBox.checked))

  drawFeed()
  tick()
  const timer = setInterval(tick, TICK_MS)
  const unmountLog = mountLogUpload(qs(view, '.log-slot'), { inspection, onViolations: (v) => record(v, 'LOG') })
  return () => {
    clearInterval(timer)
    unmountLog()
  }
}

// 로봇·현장 목록이 바뀌면(동기화, 다른 탭) 화면을 새로 그린다. 그래야 옮겨진 로봇의 예전 현장으로 요청이 생기지 않는다.
// 다른 탭이 저장하면 같은 내용이어도 새 객체로 읽히므로, 감시에 쓰는 값으로 비교한다
const deploymentKey = ({ robots, sites }) =>
  JSON.stringify([robots.map((r) => [r.robotId, r.model, r.siteId, r.active, r.name]), sites.map((s) => [s.siteId, s.active, s.name])])

export const renderMonitor = (container, deps) => {
  const { inspection } = deps
  let shown = deploymentKey(inspection.getState())
  let unmount = () => {}
  const mount = () => {
    unmount()
    const view = document.createElement('div')
    container.replaceChildren(view)
    unmount = mountMonitor(view, deps)
  }
  mount()
  const unsubscribe = inspection.subscribe((next) => {
    const key = deploymentKey(next)
    if (key === shown) return
    shown = key
    mount()
  })
  return () => {
    unsubscribe()
    unmount()
  }
}
