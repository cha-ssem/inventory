import { parseBackup } from '../domain/backup.js'
import { parsePartsCsv } from '../domain/csv.js'
import { createPart, findPart, setPartActive, updatePart, upsertPart } from '../domain/parts.js'
import { computeStock } from '../domain/stock.js'
import { TX_TYPES, checkOutbound, createCancel, createTransaction } from '../domain/transactions.js'
import { normalizePartNo, validatePart } from '../domain/validation.js'
import { generateSampleData } from './sampleData.js'

const EMPTY_STATE = Object.freeze({ parts: [], transactions: [] })
const SAVE_WARNING = '브라우저에 저장하지 못했습니다. 화면을 닫으면 방금 내용이 사라질 수 있습니다. 백업 파일을 내려받아 두세요.'

const defaultMakeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const fail = (error, extra = {}) => ({ ok: false, error, ...extra })

// onLocalChange: 사용자가 바꾼 내용을 알린다 (구글 시트 동기화의 보낼 목록에 쓰임). 원격에서 받은 변경(applyRemote)은 알리지 않는다.
export const createStore = ({ storage, now = () => new Date().toISOString(), makeId = defaultMakeId, onLocalChange = () => {} }) => {
  let state = storage.load() ?? EMPTY_STATE
  let stockCache = { transactions: null, map: new Map() }
  const listeners = new Set()

  const getState = () => state

  const getStockMap = () => {
    if (stockCache.transactions !== state.transactions) {
      stockCache = { transactions: state.transactions, map: computeStock(state.transactions) }
    }
    return stockCache.map
  }

  // 다른 탭이 저장한 내용을 덮어쓰지 않도록, 바꾸기 직전에 저장소의 최신 상태를 읽는다
  const syncFromStorage = () => {
    const latest = storage.load()
    if (latest) state = latest
  }

  const reload = () => {
    syncFromStorage()
    listeners.forEach((listener) => listener(state))
  }

  const commit = (nextState, result, change = null) => {
    state = nextState
    const saved = storage.save(state)
    if (change) onLocalChange(change)
    listeners.forEach((listener) => listener(state))
    return saved ? result : { ...result, warning: SAVE_WARNING }
  }

  // 구글 시트에서 받은 데이터를 반영한다 (보낼 목록에 다시 넣지 않음)
  const applyRemote = (nextState) => commit(nextState, { ok: true })

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const addPart = (input) => {
    syncFromStorage()
    const result = validatePart(input, state.parts)
    if (!result.ok) return { ok: false, errors: result.errors }
    const part = createPart(result.value, now())
    return commit({ ...state, parts: [...state.parts, part] }, { ok: true, value: part }, { parts: [part] })
  }

  const editPart = (partNo, input) => {
    syncFromStorage()
    const existing = findPart(state.parts, partNo)
    if (!existing) return fail('등록되지 않은 품번입니다.')
    const result = validatePart({ ...input, partNo: existing.partNo }, state.parts, { editingPartNo: existing.partNo })
    if (!result.ok) return { ok: false, errors: result.errors }
    const part = updatePart(existing, result.value, now())
    return commit({ ...state, parts: upsertPart(state.parts, part) }, { ok: true, value: part }, { parts: [part] })
  }

  const changePartActive = (partNo, active) => {
    syncFromStorage()
    const existing = findPart(state.parts, partNo)
    if (!existing) return fail('등록되지 않은 품번입니다.')
    const part = setPartActive(existing, active, now())
    return commit({ ...state, parts: upsertPart(state.parts, part) }, { ok: true, value: part }, { parts: [part] })
  }

  const importParts = (csvText) => {
    syncFromStorage()
    const { parts, errors } = parsePartsCsv(csvText, state.parts)
    if (parts.length === 0) return { ok: false, added: 0, errors, error: '등록할 수 있는 부품이 없습니다.' }
    const created = parts.map((p) => createPart(p, now()))
    return commit({ ...state, parts: [...state.parts, ...created] }, { ok: true, added: created.length, errors }, { parts: created })
  }

  const requireActivePart = (rawPartNo) => {
    const partNo = normalizePartNo(rawPartNo)
    const part = findPart(state.parts, partNo)
    if (!part) return fail(`등록되지 않은 품번입니다: ${partNo || '(빈 값)'}`, { code: 'UNKNOWN_PART', partNo })
    if (part.active === false) return fail(`사용 중지된 부품입니다: ${partNo}`, { code: 'INACTIVE_PART', partNo })
    return { ok: true, part }
  }

  const appendTransaction = (tx, extra) =>
    commit({ ...state, transactions: [...state.transactions, tx] }, { ok: true, value: tx, ...extra }, { transactions: [tx] })

  const recordInbound = (input) => {
    syncFromStorage()
    const check = requireActivePart(input.partNo)
    if (!check.ok) return check
    const result = createTransaction({ ...input, type: TX_TYPES.IN }, { now: now(), makeId })
    if (!result.ok) return fail(result.error)
    const after = (getStockMap().get(check.part.partNo) || 0) + result.value.qty
    return appendTransaction(result.value, { after, low: after < check.part.safetyStock })
  }

  const recordOutbound = (input) => {
    syncFromStorage()
    const check = requireActivePart(input.partNo)
    if (!check.ok) return check
    const result = createTransaction({ ...input, type: TX_TYPES.OUT }, { now: now(), makeId })
    if (!result.ok) return fail(result.error)
    const stockCheck = checkOutbound(getStockMap(), check.part.partNo, result.value.qty, check.part.safetyStock)
    if (!stockCheck.ok) return fail(stockCheck.error, { code: 'INSUFFICIENT_STOCK' })
    return appendTransaction(result.value, { after: stockCheck.after, low: stockCheck.low })
  }

  const cancelTransaction = (id, { memo = '', worker = '' } = {}) => {
    syncFromStorage()
    const original = state.transactions.find((t) => t.id === id)
    if (!original) return fail('기록을 찾을 수 없습니다.')
    const result = createCancel(original, state.transactions, { now: now(), makeId, memo, worker })
    if (!result.ok) return fail(result.error)
    return appendTransaction(result.value, {})
  }

  const REPLACED = { replaced: true }

  const loadSample = () => commit(generateSampleData({ now: now() }), { ok: true }, REPLACED)

  const resetAll = () => {
    storage.clear()
    return commit(EMPTY_STATE, { ok: true }, REPLACED)
  }

  const restoreBackup = (text) => {
    const result = parseBackup(text)
    if (!result.ok) return result
    return commit(result.value, { ok: true }, REPLACED)
  }

  return {
    getState,
    getStockMap,
    subscribe,
    reload,
    applyRemote,
    addPart,
    editPart,
    setPartActive: changePartActive,
    importParts,
    recordInbound,
    recordOutbound,
    cancelTransaction,
    loadSample,
    resetAll,
    restoreBackup,
  }
}
