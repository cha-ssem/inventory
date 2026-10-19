import { addDays, toDateKey } from '../dates.js'
import { STATUS_AFTER_EVENT } from '../inspection/constants.js'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const OPEN = new Set(['REQUESTED', 'ASSIGNED', 'IN_PROGRESS'])

// 일간: 그날 하루, 주간: 그날이 들어 있는 월요일~일요일 (날짜는 'YYYY-MM-DD')
export const periodRange = (period, dateKey) => {
  if (!DATE_KEY.test(dateKey ?? '')) return null
  if (period === 'DAILY') return { from: dateKey, to: dateKey }
  if (period !== 'WEEKLY') return null
  const [y, m, d] = dateKey.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).getDay() // 0=일요일
  const from = addDays(dateKey, -((weekday + 6) % 7))
  return { from, to: addDays(from, 6) }
}

const inRange = (value, { from, to }) => {
  const key = toDateKey(value)
  return key !== '' && key >= from && key <= to
}

// 기간 끝 시점의 상태와 담당 (그 뒤에 일어난 일은 보지 않는다)
const stateAt = (request, to) =>
  request.history
    .filter((e) => toDateKey(e.at) <= to)
    .reduce(
      (acc, e) => ({
        status: STATUS_AFTER_EVENT[e.type] ?? acc.status,
        assignee: e.type === 'ASSIGN' ? e.payload.assignee : acc.assignee,
        dueDate: e.type === 'ASSIGN' ? e.payload.dueDate || '' : acc.dueDate,
      }),
      { status: null, assignee: '', dueDate: '' },
    )

const nameOf = (list, key, id) => list.find((item) => item[key] === id)?.name ?? id

const baseItem = (r, masters) => ({
  requestId: r.requestId,
  siteId: r.siteId,
  siteName: nameOf(masters.sites, 'siteId', r.siteId),
  robotId: r.robotId,
  robotName: nameOf(masters.robots, 'robotId', r.robotId),
  title: r.title,
  priority: r.priority,
  source: r.source,
})

const completedItem = (r, masters) => {
  const event = r.history.find((e) => e.type === 'COMPLETE')
  return {
    ...baseItem(r, masters),
    completedAt: r.completedAt,
    completedBy: event?.actor ?? '',
    result: r.completion.result,
    findings: r.completion.findings,
    actions: r.completion.actions,
    usedParts: r.completion.usedParts ?? [],
  }
}

const byTime = (key) => (a, b) => a[key].localeCompare(b[key])

// 보고서에 넣을 내용을 모은다 (보고서에 그대로 저장하는 스냅숏이라 화면용 이름까지 담는다).
// requests: foldRequests 결과의 요청 목록, range: { from, to, siteIds }
export const collectReport = (requests, masters, { from, to, siteIds }) => {
  const sites = new Set(siteIds)
  const mine = requests.filter((r) => sites.has(r.siteId))
  const completed = mine
    .filter((r) => r.status === 'COMPLETED' && inRange(r.completedAt, { from, to }))
    .map((r) => completedItem(r, masters))
    .sort(byTime('completedAt'))
  const newRequests = mine
    .filter((r) => inRange(r.requestedAt, { from, to }))
    .map((r) => ({ ...baseItem(r, masters), requestedAt: r.requestedAt }))
    .sort(byTime('requestedAt'))
  const open = mine
    .map((r) => ({ r, at: stateAt(r, to) }))
    .filter(({ at }) => OPEN.has(at.status))
    .map(({ r, at }) => ({ ...baseItem(r, masters), requestedAt: r.requestedAt, ...at }))
    .sort(byTime('requestedAt'))
  const count = (result) => completed.filter((c) => c.result === result).length
  return {
    stats: {
      completed: completed.length,
      ok: count('OK'),
      issue: count('ISSUE'),
      fail: count('FAIL'),
      newRequests: newRequests.length,
      open: open.length,
      urgentOpen: open.filter((o) => o.priority === 'HIGH').length,
      partsUsed: completed.reduce((sum, c) => sum + c.usedParts.reduce((s, u) => s + u.qty, 0), 0),
    },
    completed,
    newRequests,
    open,
  }
}
