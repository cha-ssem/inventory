// AI 보고서 초안(6단계)에 보낼 내용: 문장을 쓰는 데 필요한 글만 고른다.
// 내부 ID, 작성자·완료자 이름, 기존 문장은 보내지 않는다 (서버 ReportLogic.gs가 한 번 더 걸러 자른다).
export const AI_DRAFT_TIMEOUT_MS = 90_000

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
