import { TX_TYPES } from './transactions.js'
import { PART_NO_PATTERN } from './validation.js'

const APP_ID = 'samkwang-inventory'
const VERSION = 1

export const serializeBackup = ({ parts, transactions }, now) =>
  JSON.stringify({ app: APP_ID, version: VERSION, exportedAt: now, parts, transactions }, null, 2)

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0
const isOptionalString = (v) => v === undefined || v === null || typeof v === 'string'
const isDateString = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const hasUnique = (list, key) => new Set(list.map((item) => item[key])).size === list.length

const isValidPart = (p) =>
  Boolean(p) &&
  typeof p.partNo === 'string' &&
  PART_NO_PATTERN.test(p.partNo) &&
  typeof p.name === 'string' &&
  typeof p.unit === 'string' &&
  Number.isInteger(p.safetyStock) &&
  p.safetyStock >= 0 &&
  (p.active === undefined || typeof p.active === 'boolean') &&
  isOptionalString(p.spec) &&
  isOptionalString(p.location)

const isValidTransaction = (t) =>
  Boolean(t) &&
  isNonEmptyString(t.id) &&
  Boolean(TX_TYPES[t.type]) &&
  isNonEmptyString(t.partNo) &&
  Number.isInteger(t.qty) &&
  t.qty > 0 &&
  isDateString(t.createdAt) &&
  isOptionalString(t.partner) &&
  isOptionalString(t.worker) &&
  isOptionalString(t.memo)

// 취소 기록은 존재하는 입고·출고 기록을 하나씩만 가리켜야 한다
const hasValidCancels = (transactions) => {
  const byId = new Map(transactions.map((t) => [t.id, t]))
  const cancels = transactions.filter((t) => t.type === TX_TYPES.CANCEL)
  const refsValid = cancels.every((c) => {
    const target = byId.get(c.refId)
    return Boolean(target) && target.type !== TX_TYPES.CANCEL && target.partNo === c.partNo
  })
  return refsValid && hasUnique(cancels, 'refId')
}

export const isValidState = (data) =>
  Boolean(data) &&
  Array.isArray(data.parts) &&
  Array.isArray(data.transactions) &&
  data.parts.every(isValidPart) &&
  hasUnique(data.parts, 'partNo') &&
  data.transactions.every(isValidTransaction) &&
  hasUnique(data.transactions, 'id') &&
  hasValidCancels(data.transactions)

export const parseBackup = (text) => {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: '백업 파일을 읽을 수 없습니다. JSON 형식이 아닙니다.' }
  }
  if (!data || data.app !== APP_ID) return { ok: false, error: '이 프로그램의 백업 파일이 아닙니다.' }
  if (!isValidState(data)) return { ok: false, error: '백업 파일의 데이터 형식이 올바르지 않습니다.' }
  return { ok: true, value: { parts: data.parts, transactions: data.transactions } }
}
