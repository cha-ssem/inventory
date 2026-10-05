import { isSameLocalDay, toDateKey } from './dates.js'
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

// 이번 달(한국 시간) 출고 수량이 많은 부품. 취소된 출고는 뺀다.
export const topShippedThisMonth = ({ parts, transactions, now, limit = 5 }) => {
  const month = toDateKey(now).slice(0, 7)
  const totals = buildHistoryRows(transactions, parts)
    .filter((r) => r.type === TX_TYPES.OUT && !r.cancelled && toDateKey(r.createdAt).slice(0, 7) === month)
    .reduce((map, r) => {
      const prev = map.get(r.partNo) || { partNo: r.partNo, name: r.partName, qty: 0 }
      return new Map(map).set(r.partNo, { ...prev, qty: prev.qty + r.qty })
    }, new Map())
  return [...totals.values()].sort((a, b) => b.qty - a.qty || a.partNo.localeCompare(b.partNo)).slice(0, limit)
}
