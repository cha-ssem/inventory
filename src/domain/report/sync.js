import { REPORT_PERIODS, REPORT_SECTIONS } from './report.js'

// 기기끼리 주고받는 보고서는 확정·제출본만이다. 확정본은 내용이 고정이라 두 기기가 다르게 고칠 일이 없고,
// 바뀌는 것은 제출 상태(제출·메일 다시 보내기)뿐이라 "더 나아간 쪽"을 남기면 된다.
const STATUS_RANK = Object.freeze({ FINALIZED: 1, SUBMITTED: 2 })
// 같은 제출 상태면 메일 상태가 나아간 쪽을 먼저 본다 (기기 시계가 어긋나도 "보냄"이 "실패"에 덮여 메일이 또 가지 않게)
const MAIL_RANK = Object.freeze({ FAILED: 1, QUOTA: 1, SENDING: 2, SENT: 3 })
const STAT_KEYS = ['completed', 'ok', 'issue', 'fail', 'newRequests', 'open', 'urgentOpen', 'partsUsed']

// 'constructor' 같은 이름이 통과하지 않도록 표 자신의 키만 본다
const rankOf = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : 0)

export const isSharedReport = (report) => rankOf(STATUS_RANK, report?.status) > 0

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isStringList = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string')
const isObjectList = (value) => Array.isArray(value) && value.every(isObject)

const isValidSnapshot = (snapshot) =>
  isObject(snapshot) &&
  isObject(snapshot.stats) &&
  STAT_KEYS.every((k) => Number.isFinite(snapshot.stats[k])) &&
  isObjectList(snapshot.completed) &&
  snapshot.completed.every((c) => isObjectList(c.usedParts ?? [])) &&
  isObjectList(snapshot.open) &&
  isObjectList(snapshot.newRequests ?? [])

const isValidBody = (body) => isObject(body) && Object.keys(REPORT_SECTIONS).every((k) => typeof body[k] === 'string')

// 다른 기기(시트)에서 받은 보고서는 화면이 그대로 그리므로, 화면이 쓰는 모양을 모두 확인한다
export const isValidRemoteReport = (r) =>
  isObject(r) &&
  isSharedReport(r) &&
  typeof r.reportId === 'string' &&
  r.reportId !== '' &&
  typeof r.title === 'string' &&
  typeof r.period === 'string' &&
  Object.hasOwn(REPORT_PERIODS, r.period) &&
  typeof r.from === 'string' &&
  typeof r.to === 'string' &&
  isStringList(r.siteIds) &&
  isStringList(r.siteNames) &&
  Number.isInteger(r.version) &&
  r.version >= 1 &&
  typeof r.updatedAt === 'string' &&
  typeof r.finalizedAt === 'string' &&
  isValidBody(r.body) &&
  isValidSnapshot(r.snapshot) &&
  (r.status !== 'SUBMITTED' || isObject(r.submission))

// 제출 상태 → 메일 상태가 더 나아간 쪽, 둘 다 같으면 더 나중에 바뀐 쪽 (메일 다시 보내기 결과)
export const isNewerReport = (incoming, current) => {
  const status = rankOf(STATUS_RANK, incoming.status) - rankOf(STATUS_RANK, current.status)
  if (status !== 0) return status > 0
  const mail = rankOf(MAIL_RANK, incoming.submission?.mailStatus) - rankOf(MAIL_RANK, current.submission?.mailStatus)
  if (mail !== 0) return mail > 0
  return incoming.updatedAt > current.updatedAt
}

// 받은 보고서를 이 기기 목록에 합친다. 이 기기의 초안은 건드리지 않는다. 바뀐 것이 없으면 같은 목록을 돌려준다.
export const mergeReports = (local, remote) => {
  const byId = new Map(local.map((r) => [r.reportId, r]))
  let changed = false
  remote.forEach((incoming) => {
    const current = byId.get(incoming.reportId)
    if (current && (!isSharedReport(current) || !isNewerReport(incoming, current))) return
    byId.set(incoming.reportId, incoming)
    changed = true
  })
  return changed ? [...byId.values()] : local
}
