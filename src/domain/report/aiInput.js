// AI 보고서 초안(6단계)에 보낼 내용: 문장을 쓰는 데 필요한 글만 고른다.
// 내부 ID, 작성자·완료자 이름, 기존 문장은 보내지 않는다 (서버 ReportLogic.gs가 한 번 더 걸러 자른다).
export const AI_DRAFT_TIMEOUT_MS = 90_000
export const SUBMIT_TIMEOUT_MS = 60_000 // 시트 기록 + PDF 변환 + 메일
// 서버 ReportLogic.gs의 REPORT_LIMITS.maxInputChars와 같게 (비용·요청 시간 보호)
export const AI_INPUT_MAX_CHARS = 40_000

export const isAiInputTooLarge = (input) => JSON.stringify(input).length > AI_INPUT_MAX_CHARS

export const buildAiInput = ({ title, period, from, to, siteNames, snapshot }) => ({
  title,
  period,
  from,
  to,
  siteNames,
  stats: snapshot.stats,
  completed: snapshot.completed.map(({ siteName, robotName, title: t, result, findings, actions, usedParts, completedAt }) => ({
    siteName, robotName, title: t, result, findings, actions, usedParts, completedAt,
  })),
  open: snapshot.open.map(({ siteName, title: t, priority, status, assignee, dueDate }) => ({ siteName, title: t, priority, status, assignee, dueDate })),
})

// 7단계 제출에 보낼 내용: AI 입력 내용 + 보고서 ID·버전·작성자·문장·확정 일시 (시트 기록과 메일·PDF에 쓰임)
export const buildSubmission = (report) => ({
  ...buildAiInput(report),
  reportId: report.reportId,
  version: report.version,
  author: report.author,
  aiUsed: report.aiUsed,
  finalizedAt: report.finalizedAt,
  body: report.body,
})
