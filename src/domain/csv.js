import { LIMITS, validatePart } from './validation.js'

export const BOM = '﻿'

// 엑셀이 수식으로 실행하지 않도록 막는다 (CSV 인젝션 방지)
const FORMULA_PREFIX = /^[=+\-@\t\r]/

const escapeCell = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  const text = FORMULA_PREFIX.test(String(value)) ? `'${value}` : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const toCsv = (rows) => BOM + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')

// RFC 4180 방식: 따옴표는 셀 맨 앞에서만 특별한 뜻을 가진다. 닫히지 않은 따옴표는 오류로 본다.
export const parseCsv = (text) => {
  const source = text.startsWith(BOM) ? text.slice(1) : text
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let atCellStart = true

  const endCell = () => {
    row.push(cell)
    cell = ''
    atCellStart = true
  }
  const endRow = () => {
    endCell()
    if (row.some((c) => c.trim() !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"' && atCellStart) {
      quoted = true
      atCellStart = false
    } else if (ch === ',') {
      endCell()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      endRow()
    } else {
      cell += ch
      atCellStart = false
    }
  }
  if (quoted) throw new Error('따옴표(")가 닫히지 않은 셀이 있습니다. 파일을 확인하세요.')
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

const HEADER_ALIASES = {
  partNo: ['품번', 'partno', 'part_no', 'part no'],
  name: ['품명', 'name'],
  spec: ['규격', 'spec'],
  unit: ['단위', 'unit'],
  safetyStock: ['안전재고', 'safetystock', 'safety_stock'],
  location: ['보관위치', '보관 위치', '위치', 'location'],
}

const mapHeaders = (headerRow) =>
  Object.fromEntries(
    Object.entries(HEADER_ALIASES)
      .map(([field, aliases]) => [field, headerRow.findIndex((h) => aliases.includes(h.trim().toLowerCase()))])
      .filter(([, index]) => index >= 0),
  )

// 내보낼 때 수식 방지로 붙인 작은따옴표를 되돌린다
const unescapeCell = (value) => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value)

const rowToInput = (row, columns) =>
  Object.fromEntries(Object.entries(columns).map(([field, index]) => [field, unescapeCell(row[index] ?? '')]))

const safeParse = (text) => {
  try {
    return { rows: parseCsv(text) }
  } catch (error) {
    return { error: error.message }
  }
}

export const parsePartsCsv = (text, existingParts) => {
  const parsed = safeParse(text)
  if (parsed.error) return { parts: [], errors: [{ line: 1, message: parsed.error }] }
  const [header = [], ...body] = parsed.rows
  const columns = mapHeaders(header)
  if (columns.partNo === undefined) {
    return { parts: [], errors: [{ line: 1, message: '첫 줄에 "품번" 머리글이 있어야 합니다.' }] }
  }
  if (body.length > LIMITS.maxCsvRows) {
    return { parts: [], errors: [{ line: 1, message: `한 번에 ${LIMITS.maxCsvRows}개까지만 등록할 수 있습니다.` }] }
  }

  return body.reduce(
    (acc, row, index) => {
      const result = validatePart(rowToInput(row, columns), [...existingParts, ...acc.parts])
      if (result.ok) return { ...acc, parts: [...acc.parts, result.value] }
      const message = Object.values(result.errors).join(' ')
      return { ...acc, errors: [...acc.errors, { line: index + 2, message }] }
    },
    { parts: [], errors: [] },
  )
}
