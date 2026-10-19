import { cleanText } from '../validation.js'
import { PRIORITIES } from '../inspection/constants.js'

// 점검 보고서: 초안(DRAFT) → 확정(FINALIZED, 내용 고정) → 제출(7단계). 확정본을 고치려면 다음 버전 초안을 새로 만든다.
export const REPORT_PERIODS = Object.freeze({ DAILY: '일간', WEEKLY: '주간' })
export const REPORT_STATUSES = Object.freeze({ DRAFT: '초안', FINALIZED: '확정', SUBMITTED: '제출 완료' })
export const REPORT_SECTIONS = Object.freeze({ summary: '요약', findings: '주요 발견 사항', actions: '조치 사항', nextPlan: '다음 계획' })
export const REPORT_LIMITS = Object.freeze({ maxSection: 2000 })

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const fail = (error) => ({ ok: false, error })
const lines = (items, empty) => (items.length === 0 ? empty : items.map((line) => `- ${line}`).join('\n'))

// AI 없이 스냅숏으로 만드는 기본 문장 (6단계 AI 초안이 없거나 쓰지 않을 때)
export const defaultBody = ({ stats, completed, open }) => ({
  summary:
    `점검 ${stats.completed}건 완료(이상 없음 ${stats.ok}건, 조치 필요 ${stats.issue}건, 점검 불가 ${stats.fail}건). ` +
    `새 요청 ${stats.newRequests}건, 남은 요청 ${stats.open}건(긴급 ${stats.urgentOpen}건). 사용 부품 ${stats.partsUsed}개.`,
  findings: lines(
    completed.filter((c) => c.result !== 'OK').map((c) => `${c.siteName} · ${c.title}: ${c.findings || '내용 없음'}`),
    '특이 사항 없음',
  ),
  actions: lines(
    completed.filter((c) => c.actions).map((c) => `${c.siteName} · ${c.title}: ${c.actions}`),
    '조치 사항 없음',
  ),
  nextPlan: lines(
    open.map((o) => `[${PRIORITIES[o.priority] ?? o.priority}] ${o.siteName} · ${o.title} (${o.assignee || '담당 미정'}, ${o.dueDate || '예정일 미정'})`),
    '남은 점검 요청 없음',
  ),
})

const titleOf = ({ period, from, to }) =>
  `${REPORT_PERIODS[period]} 점검 보고서 (${from === to ? from : `${from} ~ ${to}`})`

export const createDraft = (input, snapshot, { now, makeId, author = '' }) => {
  if (!REPORT_PERIODS[input.period]) return fail('보고서 기간(일간·주간)을 고르세요.')
  if (!DATE_KEY.test(input.from ?? '') || !DATE_KEY.test(input.to ?? '')) return fail('날짜를 고르세요.')
  if (!Array.isArray(input.siteIds) || input.siteIds.length === 0) return fail('현장을 하나 이상 고르세요.')
  return {
    ok: true,
    value: {
      reportId: makeId(),
      title: titleOf(input),
      period: input.period,
      from: input.from,
      to: input.to,
      siteIds: [...input.siteIds],
      siteNames: [...(input.siteNames ?? [])],
      snapshot,
      body: defaultBody(snapshot),
      status: 'DRAFT',
      version: 1,
      supersedes: null,
      author: cleanText(author),
      aiUsed: false,
      createdAt: now,
      updatedAt: now,
    },
  }
}

const checkSections = (changes) => {
  const body = {}
  for (const key of Object.keys(REPORT_SECTIONS)) {
    if (changes[key] === undefined) continue
    const text = cleanText(changes[key])
    if (text.length > REPORT_LIMITS.maxSection) return { error: `${REPORT_SECTIONS[key]}은(는) ${REPORT_LIMITS.maxSection}자 이하로 입력하세요.` }
    body[key] = text
  }
  return { body }
}

export const updateDraft = (report, changes, now, extra = {}) => {
  if (report.status !== 'DRAFT') return fail('확정한 보고서는 고칠 수 없습니다. 수정본을 만드세요.')
  const checked = checkSections(changes)
  if (checked.error) return fail(checked.error)
  return { ok: true, value: { ...report, ...extra, body: { ...report.body, ...checked.body }, updatedAt: now } }
}

export const finalizeReport = (report, now) => {
  if (report.status !== 'DRAFT') return fail('이미 확정한 보고서입니다.')
  if (!report.body.summary) return fail('요약을 입력한 뒤 확정하세요.')
  return { ok: true, value: { ...report, status: 'FINALIZED', finalizedAt: now, updatedAt: now } }
}

export const reviseReport = (report, { now, makeId, author = '' }) => {
  if (report.status === 'DRAFT') return fail('초안은 그대로 고치면 됩니다.')
  const { finalizedAt, submission, ...rest } = report
  return {
    ok: true,
    value: { ...rest, reportId: makeId(), version: report.version + 1, supersedes: report.reportId, status: 'DRAFT', author: cleanText(author), createdAt: now, updatedAt: now },
  }
}

// 7단계 제출 결과를 남긴다. 제출 완료 보고서는 메일 상태만 다시 고칠 수 있다 (메일 다시 보내기).
export const markSubmitted = (report, { submittedAt, mailStatus, recipients = 0 }, now) => {
  if (report.status !== 'FINALIZED' && report.status !== 'SUBMITTED') return fail('확정한 보고서만 제출할 수 있습니다.')
  return { ok: true, value: { ...report, status: 'SUBMITTED', submission: { submittedAt, mailStatus, recipients }, updatedAt: now } }
}
