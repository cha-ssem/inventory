import { formatDateTime, toDateKey } from '../../domain/dates.js'
import { REPORT_PERIODS } from '../../domain/report/report.js'
import { collectReport, periodRange } from '../../domain/report/collect.js'
import { html, qs, qsa, setHtml } from '../dom.js'
import { actorField, formButtons, openFormModal } from '../components/inspectionForms.js'
import { reportStatusBadge } from '../components/reportSheet.js'
import { option, sectionBanner } from '../inspectionFormat.js'

const reportTable = (reports) =>
  reports.length === 0
    ? html`<div class="empty">아직 만든 보고서가 없습니다. [새 보고서]를 눌러 보세요.</div>`
    : html`<div class="table-wrap">
        <table>
          <thead><tr><th>보고서</th><th>현장</th><th>상태</th><th class="num">버전</th><th>고친 일시</th></tr></thead>
          <tbody>
            ${reports.map(
              (r) => html`<tr data-report-id="${r.reportId}">
                <td><a href="#/report?id=${encodeURIComponent(r.reportId)}">${r.title}</a></td>
                <td>${r.siteNames.length > 2 ? `${r.siteNames.slice(0, 2).join(', ')} 외 ${r.siteNames.length - 2}곳` : r.siteNames.join(', ')}</td>
                <td>${reportStatusBadge(r.status)}</td>
                <td class="num">${r.version}</td>
                <td class="nowrap">${formatDateTime(r.updatedAt)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`

const siteChecks = (sites) => html`<fieldset class="site-checks">
  <legend>현장 * <button type="button" class="btn btn-sm" data-check-all>모두 고르기</button></legend>
  ${sites.map((s) => html`<label class="check"><input type="checkbox" name="siteId" value="${s.siteId}" checked /> ${s.name}</label>`)}
</fieldset>`

// 새 보고서: 기간과 현장을 고르면 그 범위의 점검 기록을 모아 초안을 만든다
const openNewReportForm = ({ reports, inspection, navigate }) => {
  const { sites } = inspection.getState()
  openFormModal({
    title: '새 보고서',
    content: html`<div class="field">
        <label for="nr-period">기간 *</label>
        <select class="input" id="nr-period" name="period">${Object.entries(REPORT_PERIODS).map(([k, v]) => option(k, v, 'DAILY'))}</select>
      </div>
      <div class="field">
        <label for="nr-date">날짜 * <span class="muted">(주간이면 이 날짜가 든 월~일)</span></label>
        <input class="input" id="nr-date" type="date" name="date" value="${toDateKey(new Date())}" />
      </div>
      ${siteChecks(sites)} ${actorField('nr-actor')} ${formButtons('초안 만들기')}`,
    onMount: (form) => {
      qs(form, '[data-check-all]').addEventListener('click', () => qsa(form, '[name="siteId"]').forEach((box) => (box.checked = true)))
    },
    save: ({ period, date, actor }, form) => {
      const range = periodRange(period, date)
      if (!range) return { ok: false, error: '날짜를 고르세요.' }
      const siteIds = qsa(form, '[name="siteId"]:checked').map((box) => box.value)
      const siteNames = siteIds.map((id) => sites.find((s) => s.siteId === id)?.name ?? id)
      const snapshot = collectReport(inspection.listRequests(), inspection.getState(), { ...range, siteIds })
      return reports.create({ period, ...range, siteIds, siteNames }, snapshot, actor)
    },
    successMessage: '보고서 초안을 만들었습니다.',
    onDone: (result) => navigate(`/report?id=${encodeURIComponent(result.value.reportId)}`),
  })
}

export const renderReports = (container, { reports, inspection, navigate }) => {
  setHtml(
    container,
    html`${sectionBanner()}<div class="page-head">
        <h1>점검 보고서</h1>
        <div class="actions"><button type="button" class="btn btn-primary" data-action="new">새 보고서</button></div>
      </div>
      <p class="muted">일간·주간 점검 기록을 모아 보고서를 만들고, 확정한 뒤 PDF로 저장합니다.</p>
      <section class="panel"><div class="table-area"></div></section>`,
  )
  const newButton = qs(container, '[data-action="new"]')

  const draw = () => {
    const hasSites = inspection.getState().sites.length > 0
    newButton.disabled = !hasSites
    newButton.title = hasSites ? '' : '먼저 설정에서 현장점검 샘플을 불러오세요.'
    setHtml(qs(container, '.table-area'), reportTable(reports.list()))
  }

  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="new"]')) openNewReportForm({ reports, inspection, navigate })
    const row = event.target.closest('tr[data-report-id]')
    if (row && !event.target.closest('a')) navigate(`/report?id=${encodeURIComponent(row.dataset.reportId)}`)
  })
  draw()
  const unsubscribeReports = reports.subscribe(draw)
  const unsubscribeInspection = inspection.subscribe(draw)
  return () => {
    unsubscribeReports()
    unsubscribeInspection()
  }
}

