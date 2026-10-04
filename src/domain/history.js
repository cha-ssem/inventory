import { toDateKey } from './dates.js'
import { getCancelledIds } from './transactions.js'

export const buildHistoryRows = (transactions, parts) => {
  const names = new Map(parts.map((p) => [p.partNo, p.name]))
  const cancelled = getCancelledIds(transactions)
  return transactions
    .map((tx) => ({ ...tx, partName: names.get(tx.partNo) || '', cancelled: cancelled.has(tx.id) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

const inRange = (row, from, to) => {
  const key = toDateKey(row.createdAt)
  return (!from || key >= from) && (!to || key <= to)
}

const matchesQuery = (row, query) => {
  if (!query) return true
  const q = query.trim().toLowerCase()
  return row.partNo.toLowerCase().includes(q) || row.partName.toLowerCase().includes(q)
}

export const filterHistory = (rows, { from = '', to = '', type = '', query = '' } = {}) =>
  rows.filter((row) => inRange(row, from, to) && (!type || row.type === type) && matchesQuery(row, query))
