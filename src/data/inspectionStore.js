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
  const listeners = new Set()

  const getState = () => state

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

  const loadSample = () => commit(generateInspectionSample({ now: now() }), { ok: true }, REPLACED)

  const resetAll = () => {
    storage.clear()
    return commit(EMPTY_INSPECTION, { ok: true }, REPLACED)
  }

  return {
    getState,
    subscribe,
    reload,
    applyRemote,
    loadSample,
    resetAll,
  }
}
