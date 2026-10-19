import { AI_DRAFT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS, buildAiInput, buildSubmission, isAiInputTooLarge } from '../../domain/report/aiInput.js'
import { collectReport } from '../../domain/report/collect.js'
import { defaultBody } from '../../domain/report/report.js'
import { confirmDialog, notifyResult, toast } from '../feedback.js'
import { rememberedInspector } from '../inspectionFormat.js'

const NOT_CONNECTED = '구글 시트(Apps Script)에 연결해야 쓸 수 있습니다. 설정 → 구글 시트 연결에서 연결하세요.'
const SUBMIT_CONFIRM = '이 보고서를 구글 시트 reports 탭에 기록하고, PDF를 붙여 정해 둔 주소(설정하지 않았으면 Apps Script 배포 계정)로 메일을 보냅니다.'
const AI_CONFIRM = '점검 기록(현장·점검 내용·조치·남은 요청)을 AI에 보내 네 문단을 새로 씁니다. 지금 문장은 AI 초안으로 바뀌고, 확정 전에 고칠 수 있습니다.\n하루 사용 횟수가 정해져 있습니다.'
const AI_TOO_LARGE = '보고서 내용이 많아 AI 초안을 만들 수 없습니다. 기간(주간 → 일간)이나 현장 수를 줄여 새 보고서를 만드세요.'
const SUBMIT_TIMEOUT = '서버 응답이 늦어 결과를 받지 못했습니다. 서버에서는 처리됐을 수 있으니 잠시 뒤 다시 누르세요. 다시 눌러도 시트 줄과 메일은 늘지 않습니다.'

// 보고서 화면의 단추 동작. view: { getDirty, setDirty, formBody, setBusy } (화면 상태를 다루는 함수)
export const createReportActions = ({ reports, inspection, sync, reportId, navigate, view }) => {
  // 저장에 성공해야 화면을 새 내용으로 다시 그려도 된다 (실패하면 고친 내용을 화면에 그대로 둔다)
  const save = () => {
    const wasDirty = view.getDirty()
    view.setDirty(false)
    const result = reports.update(reportId, view.formBody())
    if (!result.ok) view.setDirty(wasDirty)
    return result
  }

  // 서버 요청 동안 입력과 단추를 모두 잠근다 (기다리는 사이 확정·입력이 결과에 덮이지 않도록)
  const withBusy = async (fn) => {
    view.setBusy(true)
    try {
      return await fn()
    } finally {
      view.setBusy(false)
    }
  }

  const recollect = async () => {
    const ok = await confirmDialog({ title: '데이터 다시 모으기', message: '지금 점검 기록으로 다시 모읍니다. 고친 문장은 새 데이터의 기본 문장으로 바뀝니다.', confirmLabel: '다시 모으기' })
    if (!ok) return
    const snapshot = collectReport(inspection.listRequests(), inspection.getState(), reports.get(reportId))
    view.setDirty(false)
    notifyResult(reports.update(reportId, defaultBody(snapshot), { snapshot }), '점검 기록을 다시 모았습니다.')
  }

  // 6단계: Apps Script를 거쳐 Claude가 네 문단을 쓴다 (API 키는 서버에만 있음)
  const aiDraft = async () => {
    if (!sync?.getStatus().connected) return toast(`AI 초안은 ${NOT_CONNECTED}`, 'error')
    const input = buildAiInput(reports.get(reportId))
    if (isAiInputTooLarge(input)) return toast(AI_TOO_LARGE, 'error')
    if (!(await confirmDialog({ title: 'AI 초안 쓰기', message: AI_CONFIRM, confirmLabel: 'AI 초안 쓰기' }))) return
    const result = await withBusy(() => sync.callServer('reportDraft', { report: input }, { timeoutMs: AI_DRAFT_TIMEOUT_MS }))
    if (!result.ok) return toast(result.error || 'AI 초안을 만들지 못했습니다.', 'error')
    if (view.getDirty() && !(await confirmDialog({ title: 'AI 초안 넣기', message: '기다리는 동안 고친 문장이 있습니다. AI 초안으로 바꿀까요?', confirmLabel: '바꾸기' }))) return
    view.setDirty(false)
    notifyResult(reports.update(reportId, result.body, { aiUsed: true }), 'AI 초안을 넣었습니다. 내용을 확인하고 고친 뒤 확정하세요.')
  }

  // 7단계: 시트 기록과 메일. 같은 보고서를 다시 보내도 서버가 줄·메일을 늘리지 않는다 (메일 실패였으면 메일만 다시).
  const submit = async () => {
    if (!sync?.getStatus().connected) return toast(`제출은 ${NOT_CONNECTED}`, 'error')
    const report = reports.get(reportId)
    if (report.status !== 'SUBMITTED' && !(await confirmDialog({ title: '보고서 제출', message: SUBMIT_CONFIRM, confirmLabel: '제출' }))) return
    const result = await withBusy(() => sync.callServer('submitReport', { report: buildSubmission(report) }, { timeoutMs: SUBMIT_TIMEOUT_MS }))
    if (!result.ok) return toast(result.timedOut ? SUBMIT_TIMEOUT : result.error || '제출하지 못했습니다.', 'error')
    const saved = reports.markSubmitted(reportId, { submittedAt: result.submittedAt, mailStatus: result.mailStatus, recipients: result.recipients })
    const message = result.mailStatus === 'SENT' ? '제출했습니다. 시트에 기록하고 메일을 보냈습니다.' : '시트에 기록했습니다.'
    notifyResult(saved.ok && result.warning ? { ...saved, warning: result.warning } : saved, message)
  }

  const remove = async () => {
    if (!(await confirmDialog({ title: '보고서 삭제', message: '이 초안을 지울까요?', confirmLabel: '지우기', danger: true }))) return
    const result = reports.remove(reportId)
    notifyResult(result, '보고서를 지웠습니다.')
    if (result.ok) navigate('/reports')
  }

  const finalize = async () => {
    if (!(await confirmDialog({ title: '보고서 확정', message: '확정하면 더 고칠 수 없습니다. 고칠 일이 생기면 수정본(다음 버전)을 만듭니다.', confirmLabel: '확정' }))) return
    const saved = save()
    if (!saved.ok) return notifyResult(saved)
    notifyResult(reports.finalize(reportId), '보고서를 확정했습니다. PDF로 저장할 수 있습니다.')
  }

  const revise = () => {
    const result = reports.revise(reportId, rememberedInspector())
    notifyResult(result, result.existing ? '이미 만든 수정본이 있어서 그 보고서를 엽니다.' : '수정본 초안을 만들었습니다.')
    if (result.ok) navigate(`/report?id=${encodeURIComponent(result.value.reportId)}`)
  }

  return {
    save: () => notifyResult(save(), '보고서를 저장했습니다.'),
    ai: aiDraft,
    recollect,
    delete: remove,
    finalize,
    submit,
    revise,
    print: () => window.print(),
  }
}
