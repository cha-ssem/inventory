import { REPORT_LIMITS, REPORT_SECTIONS } from '../../domain/report/report.js'
import { formValues, html, qs, setHtml } from '../dom.js'
import { toast } from '../feedback.js'
import { reportSheet, reportStatusBadge } from '../components/reportSheet.js'
import { sectionBanner } from '../inspectionFormat.js'
import { createReportActions } from './reportEditorActions.js'

const SECTION_ROWS = { summary: 3, findings: 5, actions: 4, nextPlan: 4 }

const ACTIONS = {
  DRAFT: [
    ['save', '저장', 'btn'],
    ['ai', 'AI 초안 쓰기', 'btn'],
    ['recollect', '데이터 다시 모으기', 'btn'],
    ['delete', '삭제', 'btn btn-danger'],
    ['finalize', '확정', 'btn btn-primary'],
  ],
  FINALIZED: [
    ['revise', '수정본 만들기', 'btn'],
    ['print', 'PDF 저장 (인쇄)', 'btn'],
    ['submit', '제출 (시트 기록·메일)', 'btn btn-primary'],
  ],
  SUBMITTED: [
    ['revise', '수정본 만들기', 'btn'],
    ['print', 'PDF 저장 (인쇄)', 'btn btn-primary'],
  ],
}

// 메일을 아직 보내지 못한 제출 완료 보고서에는 [메일 다시 보내기]를 보인다
const actionsFor = (report) =>
  report.status === 'SUBMITTED' && report.submission?.mailStatus !== 'SENT'
    ? [...ACTIONS.SUBMITTED, ['submit', '메일 다시 보내기', 'btn btn-primary']]
    : ACTIONS[report.status] ?? []

const editorForm = (report) => html`<form class="panel report-form no-print" novalidate>
  <div class="panel-head"><h2>문장 고치기</h2><span class="muted">고친 내용은 오른쪽(아래) 미리 보기에 바로 보입니다</span></div>
  <fieldset class="report-fields">
  ${Object.entries(REPORT_SECTIONS).map(
    ([key, label]) => html`<div class="field">
      <label for="rp-${key}">${label}</label>
      <textarea class="input" id="rp-${key}" name="${key}" rows="${SECTION_ROWS[key]}" maxlength="${REPORT_LIMITS.maxSection}">${report.body[key]}</textarea>
    </div>`,
  )}
  </fieldset>
</form>`

const layout = (report) => html`<div class="no-print">${sectionBanner()}</div>
  <div class="page-head no-print">
    <h1>${report.title}</h1>
    <div class="actions">
      ${reportStatusBadge(report.status)}
      ${actionsFor(report).map(([action, label, kind]) => html`<button type="button" class="${kind}" data-report-action="${action}">${label}</button>`)}
    </div>
  </div>
  <p class="no-print"><a href="#/reports">← 보고서 목록</a></p>
  <div class="report-layout ${report.status === 'DRAFT' ? 'is-draft' : ''}">
    ${report.status === 'DRAFT' ? editorForm(report) : ''}
    <div class="report-preview">${reportSheet(report)}</div>
  </div>`

export const renderReportEditor = (container, { reports, inspection, sync, query, navigate }) => {
  const reportId = query.get('id') || ''
  let dirty = false
  let busy = false
  let stale = false // 기다리는 동안 다른 탭이 저장해서 다시 그려야 하는지

  const form = () => qs(container, '.report-form')
  const formBody = () => (form() ? formValues(form()) : null)

  const draw = () => {
    const report = reports.get(reportId)
    if (!report) {
      setHtml(container, html`${sectionBanner()}<div class="page-head"><h1>점검 보고서</h1></div><section class="panel"><div class="empty">보고서를 찾을 수 없습니다. <a href="#/reports">목록으로</a></div></section>`)
      return
    }
    setHtml(container, layout(report))
    dirty = false
    stale = false
    applyBusy()
  }

  const preview = () => {
    const report = reports.get(reportId)
    if (!report) return draw() // 다른 탭에서 지운 경우
    setHtml(qs(container, '.report-preview'), reportSheet(report, { ...report.body, ...formBody() }))
    dirty = true
  }

  const applyBusy = () => {
    container.querySelectorAll('[data-report-action], .report-form fieldset').forEach((el) => {
      el.disabled = busy
    })
    container.classList.toggle('is-busy', busy)
  }

  const setBusy = (value) => {
    busy = value
    applyBusy()
    if (!busy && stale && !dirty) draw()
  }

  // AI 초안을 저장하지 못했을 때 문장을 입력 칸에 넣어 둔다 (다시 [저장]할 수 있도록)
  const fillForm = (body) => {
    const target = form()
    if (!target) return
    Object.entries(body).forEach(([key, value]) => {
      const field = target.elements.namedItem(key)
      if (field) field.value = value
    })
    preview()
  }

  const actions = createReportActions({
    reports, inspection, sync, reportId, navigate,
    view: { getDirty: () => dirty, setDirty: (value) => (dirty = value), formBody, setBusy, fillForm },
  })

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-report-action]')
    if (!button) return
    try {
      await actions[button.dataset.reportAction]()
    } catch (error) {
      console.error('보고서 작업 실패:', error)
      toast('작업 중 문제가 생겼습니다. 다시 시도하세요.', 'error')
    }
  })
  container.addEventListener('input', (event) => {
    if (event.target.closest('.report-form')) preview()
  })
  draw()
  // 문장을 고치는 중에는 다른 탭의 저장으로 화면을 다시 그리지 않는다 (입력이 지워지지 않도록).
  // 서버를 기다리는 중이면 끝난 뒤에 다시 그린다 (다시 그리면서 잠금이 풀리지 않도록).
  return reports.subscribe(() => {
    if (dirty) return
    if (busy) stale = true
    else draw()
  })
}
