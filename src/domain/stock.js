import { getCancelledIds } from './transactions.js'

const SIGN = { IN: 1, OUT: -1 }

export const computeStock = (transactions) => {
  const cancelled = getCancelledIds(transactions)
  return transactions.reduce((acc, tx) => {
    const sign = SIGN[tx.type]
    if (!sign || cancelled.has(tx.id)) return acc
    acc.set(tx.partNo, (acc.get(tx.partNo) || 0) + sign * tx.qty)
    return acc
  }, new Map())
}

export const isLowStock = (stock, safetyStock) => stock < safetyStock

const compareRows = (a, b) => {
  if (a.low !== b.low) return a.low ? -1 : 1
  if (a.active !== b.active) return a.active ? -1 : 1
  return a.partNo.localeCompare(b.partNo)
}

export const buildStockRows = (parts, stockMap) =>
  parts
    .map((part) => {
      const stock = stockMap.get(part.partNo) || 0
      return { ...part, stock, low: part.active !== false && isLowStock(stock, part.safetyStock) }
    })
    .sort(compareRows)

const matchesQuery = (row, query) => {
  if (!query) return true
  const q = query.trim().toLowerCase()
  return [row.partNo, row.name, row.location].some((field) => String(field || '').toLowerCase().includes(q))
}

export const searchStockRows = (rows, { query = '', lowOnly = false, includeInactive = false } = {}) =>
  rows.filter(
    (row) => (includeInactive || row.active !== false) && (!lowOnly || row.low) && matchesQuery(row, query),
  )
