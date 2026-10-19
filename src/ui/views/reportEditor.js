import { REPORT_LIMITS, REPORT_SECTIONS, defaultBody } from '../../domain/report/report.js'
import { collectReport } from '../../domain/report/collect.js'
import { formValues, html, qs, setHtml } from '../dom.js'
import { confirmDialog, notifyResult } from '../feedback.js'
import { reportSheet, reportStatusBadge } from '../components/reportSheet.js'
import { rememberedInspector, sectionBanner } from '../inspectionFormat.js'

const SECTION_ROWS = { summary: 3, findings: 5, actions: 4, nextPlan: 4 }

const ACTIONS = {
  DRAFT: [
    ['save', '저장', 'btn'],
    ['recollect', '데이터 다시 모으기', 'btn'],
    ['delete', '삭제', 'btn btn-danger'],
    ['finalize', '확정', 'btn btn-primary'],
  ],
  FINALIZED: [
    ['revise', '수정본 만들기', 'btn'],
    ['print', 'PDF 저장 (인쇄)', 'btn btn-primary'],
  ],
  SUBMITTED: [
    ['revise', '수정본 만들기', 'btn'],
    ['print', 'PDF 저장 (인쇄)', 'btn btn-primary'],
  ],
}

const editorForm = (report) => html`<form class="panel report-form no-print" novalidate>
  <div class="panel-head"><h2>문장 고치기</h2><span class="muted">고친 내용은 오른쪽(아래) 미리 보기에 바로 보입니다</span></div>
  ${Object.entries(REPORT_SECTIONS).map(
    ([key, label]) => html`<div class="field">
      <label for="rp-${key}">${label}</label>
      <textarea class="input" id="rp-${key}" name="${key}" rows="${SECTION_ROWS[key]}" maxlength="${REPORT_LIMITS.maxSection}">${report.body[key]}</textarea>
    </div>`,
  )}
</form>`

const layout = (report) => html`<div class="no-print">${sectionBanner()}</div>
  <div class="page-head no-print">
    <h1>${report.title}</h1>
    <div class="actions">
      ${reportStatusBadge(report.status)}
      ${(ACTIONS[report.status] ?? []).map(([action, label, kind]) => html`<button type="button" class="${kind}" data-report-action="${action}">${label}</button>`)}
    </div>
  </div>
  <p class="no-print"><a href="#/reports">← 보고서 목록</a></p>
  <div class="report-layout ${report.status === 'DRAFT' ? 'is-draft' : ''}">
    ${report.status === 'DRAFT' ? editorForm(report) : ''}
    <div class="report-preview">${reportSheet(report)}</div>
  </div>`

export const renderReportEditor = (container, { reports, inspection, query, navigate }) => {
  const reportId = query.get('id') || ''
  let dirty = false

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
  }

  const preview = () => {
    const report = reports.get(reportId)
    setHtml(qs(container, '.report-preview'), reportSheet(report, { ...report.body, ...formBody() }))
    dirty = true
  }

  // 저장하면 화면을 새 내용으로 다시 그려도 된다
  const save = () => {
    dirty = false
    return reports.update(reportId, formBody())
  }

  // 점검 기록이 바뀌었으면 다시 모은다. 문장은 새 데이터로 만든 기본 문장으로 바뀐다.
  const recollect = async () => {
    const ok = await confirmDialog({ title: '데이터 다시 모으기', message: '지금 점검 기록으로 다시 모읍니다. 고친 문장은 새 데이터의 기본 문장으로 바뀝니다.', confirmLabel: '다시 모으기' })
    if (!ok) return
    const report = reports.get(reportId)
    const snapshot = collectReport(inspection.listRequests(), inspection.getState(), report)
    dirty = false
    notifyResult(reports.update(reportId, defaultBody(snapshot), { snapshot }), '점검 기록을 다시 모았습니다.')
  }

  const actions = {
    save: () => notifyResult(save(), '보고서를 저장했습니다.'),
    recollect,
    delete: async () => {
      if (!(await confirmDialog({ title: '보고서 삭제', message: '이 초안을 지울까요?', confirmLabel: '지우기', danger: true }))) return
      const result = reports.remove(reportId)
      notifyResult(result, '보고서를 지웠습니다.')
      if (result.ok) navigate('/reports')
    },
    finalize: async () => {
      if (!(await confirmDialog({ title: '보고서 확정', message: '확정하면 더 고칠 수 없습니다. 고칠 일이 생기면 수정본(다음 버전)을 만듭니다.', confirmLabel: '확정' }))) return
      const saved = save()
      if (!saved.ok) return notifyResult(saved)
      notifyResult(reports.finalize(reportId), '보고서를 확정했습니다. PDF로 저장할 수 있습니다.')
    },
    revise: () => {
      const result = reports.revise(reportId, rememberedInspector())
      notifyResult(result, '수정본 초안을 만들었습니다.')
      if (result.ok) navigate(`/report?id=${encodeURIComponent(result.value.reportId)}`)
    },
    print: () => window.print(),
  }

  container.addEventListener('click', (event) => {
    const action = event.target.closest('[data-report-action]')?.dataset.reportAction
    if (action) actions[action]()
  })
  container.addEventListener('input', (event) => {
    if (event.target.closest('.report-form')) preview()
  })
  draw()
  // 문장을 고치는 중에는 다른 탭의 저장으로 화면을 다시 그리지 않는다 (입력이 지워지지 않도록)
  return reports.subscribe(() => !dirty && draw())
}
