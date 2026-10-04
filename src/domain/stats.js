import { isSameLocalDay } from './dates.js'
import { buildHistoryRows } from './history.js'
import { buildStockRows, computeStock } from './stock.js'
import { TX_TYPES } from './transactions.js'

export const dashboardStats = ({ parts, transactions, now }) => {
  const rows = buildStockRows(parts, computeStock(transactions))
  const activeRows = rows.filter((r) => r.active !== false)
  const today = buildHistoryRows(transactions, parts).filter((r) => !r.cancelled && isSameLocalDay(r.createdAt, now))
  return {
    totalParts: activeRows.length,
    lowStockCount: activeRows.filter((r) => r.low).length,
    todayIn: today.filter((r) => r.type === TX_TYPES.IN).length,
    todayOut: today.filter((r) => r.type === TX_TYPES.OUT).length,
  }
}

export const recentTransactions = (transactions, parts, limit = 10) =>
  buildHistoryRows(transactions, parts).slice(0, limit)
