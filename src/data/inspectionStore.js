import { canTransition, createRequestEvent, createTransitionEvent, foldRequests, isOpenStatus, sortRequests } from '../domain/inspection/flow.js'
import { generateInspectionSample } from './inspectionSample.js'

export const INSPECTION_STORAGE_KEY = 'samkwang-inventory:inspection:v1'
export const EMPTY_INSPECTION = Object.freeze({ sites: [], robots: [], events: [] })

const SAVE_WARNING = '브라우저에 저장하지 못했습니다. 화면을 닫으면 방금 내용이 사라질 수 있습니다.'
const REPLACED = Object.freeze({ replaced: true })

const defaultMakeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// 현장점검 데이터(현장·로봇·점검 이벤트). 입출고 데이터와 저장 키를 나눠서, 입출고 동기화·복원이 이 데이터를 건드리지 않게 한다.
// onLocalChange: 사용자가 바꾼 내용을 알린다 (동기화 채널의 보낼 목록에 쓰임)
export const createInspectionStore = ({ storage, now = () => new Date().toISOString(), makeId = defaultMakeId, onLocalChange = () => {} }) => {
  let state = storage.load() ?? EMPTY_INSPECTION
  let foldCache = { events: null, map: new Map() }
  const listeners = new Set()

  const getState = () => state

  const getRequests = () => {
    if (foldCache.events !== state.events) foldCache = { events: state.events, map: foldRequests(state.events) }
    return foldCache.map
  }
  const getRequest = (requestId) => getRequests().get(requestId)
  const listRequests = (filters) => sortRequests(getRequests().values(), filters)

  // 다른 탭이 저장한 내용을 덮어쓰지 않도록, 바꾸기 직전에 저장소의 최신 상태를 읽는다
  const syncFromStorage = () => {
    const latest = storage.load()
    if (latest) state = latest
  }

  const notify = () => listeners.forEach((listener) => listener(state))

  const reload = () => {
    syncFromStorage()
    notify()
  }

  const commit = (nextState, result, change = null) => {
    state = nextState
    const saved = storage.save(state)
    if (change) onLocalChange(change)
    notify()
    return saved ? result : { ...result, warning: SAVE_WARNING }
  }

  const applyRemote = (mergeFn) => {
    syncFromStorage()
    const next = mergeFn(state)
    if (next === state) return { ok: true, changed: false }
    return commit(next, { ok: true, changed: true })
  }

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const appendEvent = (event) =>
    commit({ ...state, events: [...state.events, event] }, { ok: true, value: event }, { events: [event] })

  const context = (actor) => ({ now: now(), makeId, actor })

  // 같은 로봇·기준의 자동 요청이 이미 열려 있는지 (저장 직전 최신 상태로 한 번 더 확인)
  const hasOpenAutoRequest = ({ source, ruleId, robotId }) =>
    source !== undefined && source !== 'MANUAL' && Boolean(ruleId) &&
    [...getRequests().values()].some((r) => r.source !== 'MANUAL' && r.ruleId === ruleId && r.robotId === robotId && isOpenStatus(r.status))

  const addRequest = (input, actor = '') => {
    syncFromStorage()
    if (hasOpenAutoRequest(input)) return { ok: false, code: 'DUPLICATE_ALERT', error: '같은 이상으로 열린 점검 요청이 이미 있습니다.' }
    const result = createRequestEvent(input, state, context(actor))
    return result.ok ? appendEvent(result.value) : result
  }

  // 저장하지 않고 입력만 확인한다 (완료 전에 부품 출고를 먼저 해야 할 때)
  const checkTransition = (requestId, type, input, actor = '') => {
    syncFromStorage()
    return createTransitionEvent(getRequest(requestId), type, input, context(actor))
  }

  // checkTransition으로 만든 이벤트를 저장한다. 그사이 다른 탭·기기가 상태를 바꿨으면 거부한다.
  const commitEvent = (event) => {
    syncFromStorage()
    const request = getRequest(event.requestId)
    if (!request) return { ok: false, error: '점검 요청을 찾을 수 없습니다.' }
    if (!canTransition(request.status, event.type)) return { ok: false, error: '그사이 요청 상태가 바뀌었습니다. 화면을 확인하고 다시 시도하세요.' }
    return appendEvent(event)
  }

  const transition = (requestId, type, input, actor = '') => {
    const result = checkTransition(requestId, type, input, actor)
    return result.ok ? commitEvent(result.value) : result
  }

  const loadSample = () => commit(generateInspectionSample({ now: now() }), { ok: true }, REPLACED)

  const resetAll = () => {
    storage.clear()
    return commit(EMPTY_INSPECTION, { ok: true }, REPLACED)
  }

  return {
    getState,
    getRequest,
    listRequests,
    subscribe,
    reload,
    applyRemote,
    addRequest,
    // 다른 탭이 방금 저장한 내용을 알림 없이 읽는다 (자동 요청 판단 직전)
    refresh: syncFromStorage,
    now,
    checkTransition,
    commitEvent,
    transition,
    loadSample,
    resetAll,
  }
}
