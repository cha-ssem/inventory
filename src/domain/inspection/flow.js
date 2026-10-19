import { cleanText, normalizePartNo, validateQty } from '../validation.js'
import { EVENT_TYPES, INSPECTION_LIMITS, PRIORITIES, RESULTS, SOURCES } from './constants.js'

const { REQUEST, ASSIGN, START, COMPLETE, CANCEL, RECUR } = EVENT_TYPES
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const MAX_REASON = 200
const OPEN_STATUSES = new Set(['REQUESTED', 'ASSIGNED', 'IN_PROGRESS'])
const PRIORITY_ORDER = { HIGH: 0, MID: 1, LOW: 2 }

// 상태마다 받을 수 있는 이벤트와 바뀐 뒤 상태. RECUR(재발생)는 시스템만 만든다.
const TRANSITIONS = Object.freeze({
  REQUESTED: { [ASSIGN]: 'ASSIGNED', [CANCEL]: 'CANCELLED', [RECUR]: 'REQUESTED' },
  ASSIGNED: { [ASSIGN]: 'ASSIGNED', [START]: 'IN_PROGRESS', [CANCEL]: 'CANCELLED', [RECUR]: 'ASSIGNED' },
  IN_PROGRESS: { [COMPLETE]: 'COMPLETED', [RECUR]: 'IN_PROGRESS' },
  COMPLETED: {},
  CANCELLED: {},
})

const USER_ACTIONS = [ASSIGN, START, COMPLETE, CANCEL]

export const availableActions = (status) => USER_ACTIONS.filter((type) => TRANSITIONS[status]?.[type])

export const canTransition = (status, type) => Boolean(TRANSITIONS[status]?.[type])

export const isOpenStatus = (status) => OPEN_STATUSES.has(status)

const fail = (error) => ({ ok: false, error })

const checkLength = (value, max, label) => (value.length > max ? `${label}은(는) ${max}자 이하로 입력하세요.` : null)

const newRequestId = (makeId) => `R-${makeId()}`

const makeEvent = (requestId, type, payload, { now, makeId, actor = '' }, at = now) => ({
  id: makeId(),
  requestId,
  type,
  at,
  actor: cleanText(actor),
  payload,
})

const isPayloadTooLarge = (payload) => JSON.stringify(payload).length > INSPECTION_LIMITS.maxPayload
const PAYLOAD_TOO_LARGE = '입력한 내용이 너무 깁니다. 점검·조치 내용을 줄여 주세요.'

// 기기마다 시계가 달라도 같은 요청의 이벤트 순서가 뒤바뀌지 않도록, 마지막 이벤트보다 늦은 시각으로 찍는다
const nextEventTime = (request, now) => {
  const last = request.history.at(-1)?.at
  if (!last || now > last) return now
  return new Date(Date.parse(last) + 1).toISOString()
}

const validateRequestInput = (input, { sites, robots }) => {
  const site = sites.find((s) => s.siteId === input.siteId)
  if (!site) return { error: '현장을 고르세요.' }
  if (site.active === false) return { error: `사용 중지된 현장입니다: ${site.name}` }
  if (!robots.some((r) => r.robotId === input.robotId)) return { error: '로봇을 고르세요.' }
  const source = input.source ?? 'MANUAL'
  if (!SOURCES[source]) return { error: '알 수 없는 요청 출처입니다.' }
  if (!PRIORITIES[input.priority]) return { error: '우선순위를 고르세요.' }
  const title = cleanText(input.title)
  const detail = cleanText(input.detail)
  if (!title) return { error: '점검 제목을 입력하세요.' }
  const lengthError = checkLength(title, INSPECTION_LIMITS.maxTitle, '제목') || checkLength(detail, INSPECTION_LIMITS.maxDetail, '설명')
  if (lengthError) return { error: lengthError }
  return { value: { siteId: site.siteId, robotId: input.robotId, source, priority: input.priority, title, detail } }
}

// 점검 요청을 새로 만든다. 센서·로그가 만든 요청은 규칙 ID와 측정값을 함께 남긴다.
export const createRequestEvent = (input, masters, context) => {
  const checked = validateRequestInput(input ?? {}, masters)
  if (checked.error) return fail(checked.error)
  const extra = {
    ...(input.ruleId ? { ruleId: String(input.ruleId) } : {}),
    ...(input.reading ? { reading: { metric: String(input.reading.metric), value: Number(input.reading.value) } } : {}),
  }
  const payload = { ...checked.value, ...extra }
  if (isPayloadTooLarge(payload)) return fail(PAYLOAD_TOO_LARGE)
  return { ok: true, value: makeEvent(newRequestId(context.makeId), REQUEST, payload, context) }
}

const validateUsedParts = (rawList = []) => {
  if (!Array.isArray(rawList)) return { error: '사용 부품 목록이 올바르지 않습니다.' }
  if (rawList.length > INSPECTION_LIMITS.maxUsedParts) return { error: `사용 부품은 ${INSPECTION_LIMITS.maxUsedParts}종까지 적을 수 있습니다.` }
  const seen = new Set()
  const list = []
  for (const raw of rawList) {
    const partNo = normalizePartNo(raw?.partNo)
    if (!partNo) return { error: '사용 부품의 품번을 고르세요.' }
    if (seen.has(partNo)) return { error: `같은 부품은 한 번만 적으세요: ${partNo}` }
    const qty = validateQty(raw.qty)
    if (!qty.ok) return { error: `${partNo} 수량: ${qty.error}` }
    seen.add(partNo)
    list.push({ partNo, qty: qty.value })
  }
  return { value: list }
}

const PAYLOAD_BUILDERS = {
  [ASSIGN]: (input) => {
    const assignee = cleanText(input.assignee)
    const dueDate = cleanText(input.dueDate)
    if (!assignee) return { error: '담당자를 입력하세요.' }
    if (assignee.length > INSPECTION_LIMITS.maxName) return { error: `담당자는 ${INSPECTION_LIMITS.maxName}자 이하로 입력하세요.` }
    if (dueDate && !DATE_KEY.test(dueDate)) return { error: '예정일 날짜 형식이 올바르지 않습니다.' }
    return { value: { assignee, dueDate } }
  },
  [START]: () => ({ value: {} }),
  [COMPLETE]: (input) => {
    if (!RESULTS[input.result]) return { error: '점검 결과를 고르세요.' }
    const findings = cleanText(input.findings)
    const actions = cleanText(input.actions)
    const lengthError = checkLength(findings, INSPECTION_LIMITS.maxNote, '점검 내용') || checkLength(actions, INSPECTION_LIMITS.maxNote, '조치 내용')
    if (lengthError) return { error: lengthError }
    const usedParts = validateUsedParts(input.usedParts)
    if (usedParts.error) return usedParts
    return { value: { result: input.result, findings, actions, usedParts: usedParts.value } }
  },
  [CANCEL]: (input) => {
    const reason = cleanText(input.reason)
    if (!reason) return { error: '취소 사유를 입력하세요.' }
    if (reason.length > MAX_REASON) return { error: `취소 사유는 ${MAX_REASON}자 이하로 입력하세요.` }
    return { value: { reason } }
  },
  [RECUR]: (input) => ({ value: { reading: { metric: String(input.reading?.metric ?? ''), value: Number(input.reading?.value) } } }),
}

const ACTION_LABELS = { [ASSIGN]: '배정', [START]: '점검 시작', [COMPLETE]: '완료', [CANCEL]: '취소', [RECUR]: '재발생 기록' }

// 요청의 현재 상태에서 할 수 있는 일인지 확인하고 이벤트를 만든다
export const createTransitionEvent = (request, type, input, context) => {
  if (!request) return fail('점검 요청을 찾을 수 없습니다.')
  const builder = PAYLOAD_BUILDERS[type]
  if (!builder) return fail('알 수 없는 작업입니다.')
  if (!TRANSITIONS[request.status]?.[type]) return fail(`지금 상태(${request.status})에서는 ${ACTION_LABELS[type]}을(를) 할 수 없습니다.`)
  const payload = builder(input ?? {})
  if (payload.error) return fail(payload.error)
  if (isPayloadTooLarge(payload.value)) return fail(PAYLOAD_TOO_LARGE)
  return { ok: true, value: makeEvent(request.requestId, type, payload.value, context, nextEventTime(request, context.now)) }
}

const startRequest = (event) => ({
  requestId: event.requestId,
  ...event.payload,
  status: 'REQUESTED',
  requestedAt: event.at,
  requestedBy: event.actor,
  assignee: '',
  dueDate: '',
  startedAt: null,
  completedAt: null,
  completion: null,
  cancelReason: '',
  recurCount: 0,
  lastRecurAt: null,
  lastReading: event.payload.reading ?? null,
  history: [event],
  skipped: [],
})

const APPLY = {
  [ASSIGN]: (r, e) => ({ assignee: e.payload.assignee, dueDate: e.payload.dueDate || '' }),
  [START]: (r, e) => ({ startedAt: e.at }),
  [COMPLETE]: (r, e) => ({ completedAt: e.at, completion: e.payload }),
  [CANCEL]: (r, e) => ({ cancelReason: e.payload.reason }),
  [RECUR]: (r, e) => ({ recurCount: r.recurCount + 1, lastRecurAt: e.at, lastReading: e.payload.reading ?? r.lastReading }),
}

const byTime = (a, b) => a.at.localeCompare(b.at) || (a.type === REQUEST ? -1 : b.type === REQUEST ? 1 : a.id.localeCompare(b.id))

// 이벤트를 시각 순서로 접어서 요청별 현재 상태를 만든다.
// 허용되지 않는 순서의 이벤트(다른 기기가 먼저 완료한 뒤의 완료 등)는 반영하지 않고 skipped에 모은다.
export const foldRequests = (events) => {
  const requests = new Map()
  ;[...events].sort(byTime).forEach((event) => {
    if (event.type === REQUEST) {
      if (!requests.has(event.requestId)) requests.set(event.requestId, startRequest(event))
      return
    }
    const current = requests.get(event.requestId)
    if (!current) return
    const nextStatus = TRANSITIONS[current.status]?.[event.type]
    if (!nextStatus) {
      if (event.type !== RECUR) requests.set(event.requestId, { ...current, skipped: [...current.skipped, event] })
      return
    }
    requests.set(event.requestId, { ...current, ...APPLY[event.type](current, event), status: nextStatus, history: [...current.history, event] })
  })
  return requests
}

const matches = (request, { status, siteId }) => {
  if (siteId && request.siteId !== siteId) return false
  if (status === 'open') return isOpenStatus(request.status)
  if (status && status !== 'all') return request.status === status
  return true
}

const compareRequests = (a, b) => {
  const openDiff = Number(!isOpenStatus(a.status)) - Number(!isOpenStatus(b.status))
  if (openDiff !== 0) return openDiff
  if (isOpenStatus(a.status)) {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (priorityDiff !== 0) return priorityDiff
  }
  return b.requestedAt.localeCompare(a.requestedAt)
}

// 목록 화면 순서: 열린 요청 먼저(긴급 → 최근), 끝난 요청은 최근 순
export const sortRequests = (requests, filters = {}) => [...requests].filter((r) => matches(r, filters)).sort(compareRequests)

export const listRequests = (events, filters = {}) => sortRequests(foldRequests(events).values(), filters)
