import { REPORT_STATUSES, createDraft, finalizeReport, markSubmitted as markReportSubmitted, reviseReport, updateDraft } from '../domain/report/report.js'

// 점검 보고서는 점검 동기화와 저장 키를 나눈다 (동기화가 보고서를 건드리지 않도록). 시트에는 7단계 제출 때 올린다.
export const REPORT_STORAGE_KEY = 'samkwang-inventory:reports:v1'

const EMPTY = Object.freeze({ reports: [] })
const SAVE_WARNING = '브라우저에 저장하지 못했습니다. 화면을 닫으면 방금 내용이 사라질 수 있습니다.'
const NOT_FOUND = { ok: false, error: '보고서를 찾을 수 없습니다.' }

const isValidReport = (r) =>
  Boolean(r) && typeof r.reportId === 'string' && Boolean(REPORT_STATUSES[r.status]) && Boolean(r.body) && Boolean(r.snapshot)

export const isValidReportState = (data) => Boolean(data) && Array.isArray(data.reports) && data.reports.every(isValidReport)

const defaultMakeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const createReportStore = ({ storage, now = () => new Date().toISOString(), makeId = defaultMakeId }) => {
  let state = storage.load() ?? EMPTY
  const listeners = new Set()

  // 다른 탭이 저장한 내용을 덮어쓰지 않도록, 바꾸기 직전에 저장소의 최신 상태를 읽는다
  const syncFromStorage = () => {
    const latest = storage.load()
    if (latest) state = latest
  }

  const notify = () => listeners.forEach((listener) => listener(state))

  const commit = (reports, result) => {
    state = { reports }
    const saved = storage.save(state)
    notify()
    return saved ? result : { ...result, warning: SAVE_WARNING }
  }

  const upsert = (report) => commit([...state.reports.filter((r) => r.reportId !== report.reportId), report], { ok: true, value: report })

  // 보고서 하나를 바꾸는 공통 흐름: 최신 상태 읽기 → 찾기 → 바꾸기(change가 { ok, value }) → 저장
  const modify = (reportId, change) => {
    syncFromStorage()
    const report = state.reports.find((r) => r.reportId === reportId)
    if (!report) return NOT_FOUND
    const result = change(report)
    return result.ok ? upsert(result.value) : result
  }

  const get = (reportId) => state.reports.find((r) => r.reportId === reportId)
  // 최근에 고친 순서, 같으면 높은 버전 먼저
  const list = () => [...state.reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version)

  const create = (input, snapshot, author = '') => {
    syncFromStorage()
    const result = createDraft(input, snapshot, { now: now(), makeId, author })
    return result.ok ? upsert(result.value) : result
  }

  // extra: 문장 말고 함께 바꿀 값 (예: AI 초안 사용 여부)
  const update = (reportId, changes, extra) => modify(reportId, (r) => updateDraft(r, changes, now(), extra))
  const finalize = (reportId) => modify(reportId, (r) => finalizeReport(r, now()))
  const markSubmitted = (reportId, submission) => modify(reportId, (r) => markReportSubmitted(r, submission, now()))

  const revise = (reportId, author = '') => {
    syncFromStorage()
    const report = get(reportId)
    if (!report) return NOT_FOUND
    const result = reviseReport(report, { now: now(), makeId, author })
    return result.ok ? upsert(result.value) : result
  }

  const remove = (reportId) => {
    syncFromStorage()
    const report = get(reportId)
    if (!report) return NOT_FOUND
    if (report.status !== 'DRAFT') return { ok: false, error: '확정한 보고서는 지울 수 없습니다.' }
    return commit(state.reports.filter((r) => r.reportId !== reportId), { ok: true })
  }

  const reload = () => {
    syncFromStorage()
    notify()
  }

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { get, list, create, update, finalize, markSubmitted, revise, remove, reload, subscribe }
}
