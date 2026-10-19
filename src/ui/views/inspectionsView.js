import { isSameLocalDay, formatDateTime } from '../../domain/dates.js'
import { isOpenStatus } from '../../domain/inspection/flow.js'
import { STATUSES } from '../../domain/inspection/constants.js'
import { formValues, formatNumber, html, qs, setHtml } from '../dom.js'
import { openRequestForm } from '../components/inspectionForms.js'
import { option, priorityBadge, sourceLabel, statusBadge } from '../inspectionFormat.js'

const statCard = (label, value, kind, testId) => html`<div class="stat-card ${kind}" data-testid="${testId}">
  <div class="label">${label}</div>
  <div class="value">${formatNumber(value)}</div>
</div>`

const stats = (requests) => {
  const open = requests.filter((r) => isOpenStatus(r.status))
  const now = new Date()
  return html`<div class="stat-grid">
    ${statCard('열린 요청', open.length, '', 'insp-open')}
    ${statCard('긴급', open.filter((r) => r.priority === 'HIGH').length, open.some((r) => r.priority === 'HIGH') ? 'is-danger' : '', 'insp-high')}
    ${statCard('점검 중', open.filter((r) => r.status === 'IN_PROGRESS').length, '', 'insp-progress')}
    ${statCard('오늘 완료', requests.filter((r) => r.completedAt && isSameLocalDay(r.completedAt, now)).length, 'is-in', 'insp-today')}
  </div>`
}

const nameOf = (list, key, id) => list.find((item) => item[key] === id)?.name ?? id

const requestTable = (requests, { sites, robots }) => {
  if (requests.length === 0) return html`<div class="empty">조건에 맞는 점검 요청이 없습니다.</div>`
  return html`<div class="table-wrap">
    <table class="inspection-table">
      <thead>
        <tr><th>우선</th><th>점검 제목</th><th>현장</th><th>로봇</th><th>상태</th><th>담당</th><th>요청 일시</th><th>출처</th></tr>
      </thead>
      <tbody>
        ${requests.map(
          (r) => html`<tr data-request-id="${r.requestId}" class="clickable">
            <td>${priorityBadge(r.priority)}</td>
            <td><a href="#/inspection?id=${encodeURIComponent(r.requestId)}">${r.title}</a>${r.recurCount > 0 ? html` <span class="muted">(재발생 ${r.recurCount}회)</span>` : ''}</td>
            <td>${nameOf(sites, 'siteId', r.siteId)}</td>
            <td>${nameOf(robots, 'robotId', r.robotId)}</td>
            <td>${statusBadge(r.status)}</td>
            <td>${r.assignee || '-'}</td>
            <td class="nowrap">${formatDateTime(r.requestedAt)}</td>
            <td>${sourceLabel(r.source)}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`
}

const NO_DATA = html`<div class="empty">
  등록된 현장이 없습니다. <a href="#/settings">설정 → 영풍산업 현장점검 샘플</a>에서 샘플을 불러오세요.
</div>`

const siteOptions = (sites, selected) => html`${option('', '전체 현장', selected)}${sites.map((s) => option(s.siteId, s.name, selected))}`

export const renderInspections = (container, { inspection, query, navigate }) => {
  const initialStatus = query.get('status') || 'open'
  setHtml(
    container,
    html`<div class="page-head">
        <h1>현장점검</h1>
        <div class="actions"><button type="button" class="btn btn-primary" data-action="new">점검 요청 등록</button></div>
      </div>
      <div class="stats-slot"></div>
      <section class="panel">
        <form class="filters" onsubmit="return false">
          <div class="field">
            <label for="if-status">상태</label>
            <select id="if-status" class="input" name="status">
              ${option('open', '열린 요청', initialStatus)}${option('all', '전체', initialStatus)}
              ${Object.entries(STATUSES).map(([k, v]) => option(k, v, initialStatus))}
            </select>
          </div>
          <div class="field">
            <label for="if-site">현장</label>
            <select id="if-site" class="input" name="siteId"></select>
          </div>
        </form>
        <p class="muted summary"></p>
        <div class="table-area"></div>
      </section>`,
  )
  const form = qs(container, '.filters')
  const newButton = qs(container, '[data-action="new"]')

  const draw = () => {
    const state = inspection.getState()
    const hasData = state.sites.length > 0
    form.hidden = !hasData
    newButton.hidden = !hasData
    const selectedSite = form.elements.siteId.value
    setHtml(form.elements.siteId, siteOptions(state.sites, selectedSite))
    if (!hasData) {
      setHtml(qs(container, '.stats-slot'), '')
      qs(container, '.summary').textContent = ''
      return setHtml(qs(container, '.table-area'), NO_DATA)
    }
    const shown = inspection.listRequests(formValues(form))
    setHtml(qs(container, '.stats-slot'), stats(inspection.listRequests()))
    qs(container, '.summary').textContent = `${shown.length}건`
    setHtml(qs(container, '.table-area'), requestTable(shown, state))
  }

  form.addEventListener('input', draw)
  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="new"]')) return openRequestForm({ inspection })
    const row = event.target.closest('tr[data-request-id]')
    if (row && !event.target.closest('a')) navigate(`/inspection?id=${encodeURIComponent(row.dataset.requestId)}`)
  })
  draw()
  return inspection.subscribe(draw)
}
