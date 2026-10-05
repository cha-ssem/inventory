// 서류 사진으로 입고(OCR): AI가 읽은 명세서를 검수용 행으로 바꾸고, 우리 품번에 맞추는 순수 로직
import { getCancelledIds, TX_TYPES } from './transactions.js'
import { LIMITS, cleanText } from './validation.js'

// 행 상태 (OCR-06)
export const ROW_STATUS = Object.freeze({ ok: 'ok', unmatched: 'unmatched', inactive: 'inactive', badQty: 'badQty' })

// 상호 표기 차이를 줄인다: 괄호 내용(전각 포함), (주)·㈜·주식회사·유한회사, 공백을 빼고 대문자로
// (apps-script/OcrLogic.gs와 같은 규칙)
export const normalizeSupplier = (name) =>
  cleanText(name)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\([^)]*\)/g, '')
    .replace(/㈜|주식회사|유한회사/g, '')
    .replace(/\s+/g, '')
    .toUpperCase()

const normalizeName = (name) => cleanText(name).replace(/\s+/g, '')

const mappingKey = (supplier, code) => `${normalizeSupplier(supplier)}|${cleanText(code).toUpperCase()}`

// 품번 맞추기 (OCR-04): ① 귀사 품번 → ② 공급사+공급사 코드 대응표 → ③ 품명이 하나의 부품과 같으면 후보
const matchItem = (item, supplier, { byNo, byMapping, byName }) => {
  if (item.ourPartNo && byNo.has(item.ourPartNo)) return { partNo: item.ourPartNo, source: 'partNo' }
  const mapped = item.supplierCode ? byMapping.get(mappingKey(supplier, item.supplierCode)) : null
  if (mapped && byNo.has(mapped)) return { partNo: mapped, source: 'mapping' }
  const sameName = byName.get(normalizeName(item.name)) || []
  if (sameName.length === 1) return { partNo: sameName[0], source: 'name' }
  return { partNo: null, source: null }
}

const indexByName = (parts) =>
  parts.reduce((map, p) => {
    const key = normalizeName(p.name)
    return key ? new Map(map).set(key, [...(map.get(key) || []), p.partNo]) : map
  }, new Map())

export const buildReviewRows = (statement, parts, mappings) => {
  const lookup = {
    byNo: new Map(parts.map((p) => [p.partNo, p])),
    byMapping: new Map(mappings.map((m) => [mappingKey(m.supplier, m.supplierCode), m.partNo])),
    byName: indexByName(parts),
  }
  return statement.items.map((item, key) => ({
    key,
    item,
    ...matchItem(item, statement.supplier, lookup),
    qty: item.qty,
    include: true,
  }))
}

const isValidQty = (qty) => Number.isInteger(qty) && qty >= 1 && qty <= LIMITS.maxQty

export const rowStatus = (row, partsByNo) => {
  const part = row.partNo ? partsByNo.get(row.partNo) : null
  if (!part) return ROW_STATUS.unmatched
  if (part.active === false) return ROW_STATUS.inactive
  return isValidQty(row.qty) ? ROW_STATUS.ok : ROW_STATUS.badQty
}

// 부품을 직접 고르면 출처를 manual로 바꾼다. 다른 행은 그대로 둔다.
export const updateRow = (rows, key, changes) =>
  rows.map((row) => {
    if (row.key !== key) return row
    const picked = 'partNo' in changes && changes.partNo !== row.partNo ? { source: 'manual' } : {}
    return { ...row, ...changes, ...picked }
  })

const byNoOf = (parts) => new Map(parts.map((p) => [p.partNo, p]))

const readyRows = (rows, parts) => {
  const byNo = byNoOf(parts)
  return rows.filter((row) => row.include && rowStatus(row, byNo) === ROW_STATUS.ok)
}

export const reviewSummary = (rows, parts) => {
  const ready = readyRows(rows, parts).length
  const excluded = rows.filter((row) => !row.include).length
  return { ready, problems: rows.length - ready - excluded, excluded }
}

// 저장할 입고 입력값 (OCR-08): 거래처 = 공급자 상호, 메모 = 명세서 번호
export const toInboundInputs = (rows, parts, { supplier, statementNo, worker }) =>
  readyRows(rows, parts).map((row) => ({
    partNo: row.partNo,
    qty: row.qty,
    partner: cleanText(supplier),
    worker: cleanText(worker),
    memo: cleanText(statementNo),
  }))

// 사람이 직접 고르거나 [맞음]으로 확인한 연결만 대응표에 남긴다 (OCR-05).
// 품명으로 추측만 한 연결은 저장하지 않는다. 잘못된 추측이 다음부터 경고 없이 쓰이지 않도록.
export const mappingsToSave = (rows, parts, supplier) => {
  const name = cleanText(supplier)
  if (!normalizeSupplier(name)) return []
  return readyRows(rows, parts)
    .filter((row) => row.source === 'manual' && row.item.supplierCode)
    .map((row) => ({ supplier: name, supplierCode: row.item.supplierCode, partNo: row.partNo }))
}

// 같은 공급자의 같은 명세서 번호로 이미 입고한 기록 (OCR-07). 취소한 입고는 뺀다.
export const findDuplicateStatement = (transactions, supplier, statementNo) => {
  const number = cleanText(statementNo)
  if (!number) return []
  const key = normalizeSupplier(supplier)
  const cancelled = getCancelledIds(transactions)
  return transactions.filter(
    (t) => t.type === TX_TYPES.IN && !cancelled.has(t.id) && t.memo === number && normalizeSupplier(t.partner) === key,
  )
}

// 수량 칸 입력: 빈 칸은 null, 숫자만 받는다 ("1e3"·"2.5"·"-3"은 NaN → 수량 오류로 표시)
export const parseQtyInput = (text) => {
  const value = String(text ?? '').trim()
  if (value === '') return null
  return /^\d+$/.test(value) ? Number(value) : NaN
}

// PDF 쪽수를 어림한다 (/Type /Page 개수). 너무 긴 PDF를 AI에 보내기 전에 막는 데만 쓴다.
export const countPdfPages = (bytes) => {
  const text = new TextDecoder('latin1').decode(bytes)
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length
}
