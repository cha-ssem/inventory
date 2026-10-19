import { REPORT_STATUSES, createDraft, finalizeReport, markSubmitted as markReportSubmitted, reviseReport, updateDraft } from '../domain/report/report.js'

// 점검 보고서는 점검 동기화와 저장 키를 나눈다. 확정·제출본은 보고서 동기화 채널(reportChannel.js)이 다른 기기와 주고받는다.
export const REPORT_STORAGE_KEY = 'samkwang-inventory:reports:v1'

const EMPTY = Object.freeze({ reports: [] })
const SAVE_FAILED = '브라우저에 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도하세요. (방금 고친 내용은 화면에만 남아 있습니다)'
const NOT_FOUND = { ok: false, error: '보고서를 찾을 수 없습니다.' }

const isValidReport = (r) =>
  Boolean(r) && typeof r.reportId === 'string' && typeof r.status === 'string' && Object.hasOwn(REPORT_STATUSES, r.status) && Boolean(r.body) && Boolean(r.snapshot)

export const isValidReportState = (data) => Boolean(data) && Array.isArray(data.reports) && data.reports.every(isValidReport)

// 불러올 때 형식이 틀린 보고서만 빼고 나머지는 살린다 (하나 때문에 목록 전체가 사라지지 않도록)
export const normalizeReportState = (data) =>
  data && Array.isArray(data.reports) ? { ...data, reports: data.reports.filter(isValidReport) } : data

const defaultMakeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// onLocalChange(report): 이 기기에서 보고서를 저장할 때마다 알린다 (동기화 채널이 확정·제출본만 골라 보낸다)
export const createReportStore = ({ storage, now = () => new Date().toISOString(), makeId = defaultMakeId, onLocalChange }) => {
  let state = storage.load() ?? EMPTY
  const listeners = new Set()

  // 다른 탭이 저장한 내용을 덮어쓰지 않도록, 바꾸기 직전에 저장소의 최신 상태를 읽는다
  const syncFromStorage = () => {
    const latest = storage.load()
    if (latest) state = latest
  }

  const notify = () => listeners.forEach((listener) => listener(state))

  // 저장에 실패하면 메모리도 바꾸지 않는다. 바꿔 두면 다음 작업이 저장소의 옛 상태를 다시 읽어
  // 고친 내용이 조용히 사라진 채 확정될 수 있다 (보고서는 확정 후 고칠 수 없어서 더 위험하다).
  const commit = (reports, result) => {
    const next = { reports }
    if (!storage.save(next)) return { ok: false, error: SAVE_FAILED }
    state = next
    notify()
    return result
  }

  const upsert = (report) => {
    const result = commit([...state.reports.filter((r) => r.reportId !== report.reportId), report], { ok: true, value: report })
    if (result.ok) onLocalChange?.(report)
    return result
  }

  // 다른 기기에서 받은 보고서를 합친다 (mergeFn(reports) → 새 목록, 바뀐 것이 없으면 같은 목록)
  const applyRemote = (mergeFn) => {
    syncFromStorage()
    const next = mergeFn(state.reports)
    if (next === state.reports) return { ok: true, changed: false }
    return commit(next, { ok: true, changed: true })
  }

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
    // 이미 이 보고서의 수정본이 있으면 새로 만들지 않는다 (같은 버전 번호가 둘 생겨 제출이 두 번 되지 않도록)
    const existing = state.reports.find((r) => r.supersedes === reportId)
    if (existing) return { ok: true, existing: true, value: existing }
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

  return { get, list, create, update, finalize, markSubmitted, revise, remove, reload, subscribe, applyRemote }
}
