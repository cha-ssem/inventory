import { createPart } from '../domain/parts.js'
import {
  SAMPLE_DESTINATIONS,
  SAMPLE_LOW_PARTS,
  SAMPLE_PARTS,
  SAMPLE_SUPPLIERS,
  SAMPLE_WORKERS,
} from './sampleCatalog.js'

const DAY_MS = 86_400_000
const HISTORY_DAYS = 14
const EVENTS_PER_PART = 3

// 같은 seed면 항상 같은 값을 내는 의사 난수 (mulberry32)
const createRandom = (seed) => {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296
  }
}

const createContext = (now, seed) => {
  const random = createRandom(seed)
  const nowMs = new Date(now).getTime()
  let counter = 0
  return {
    random,
    int: (min, max) => min + Math.floor(random() * (max - min + 1)),
    pick: (list) => list[Math.floor(random() * list.length)],
    // dayOffset일 전, 근무 시간대 어딘가 (현재 시각을 넘지 않음)
    timeAt: (dayOffset, minMinutes = 30) => {
      const minutesBefore = minMinutes + Math.floor(random() * 420)
      return new Date(nowMs - dayOffset * DAY_MS - minutesBefore * 60_000).toISOString()
    },
    nextId: () => `S-${String(++counter).padStart(4, '0')}`,
  }
}

const makeTx = (ctx, type, part, qty, createdAt) => ({
  id: ctx.nextId(),
  type,
  partNo: part.partNo,
  qty,
  partner: type === 'IN' ? ctx.pick(SAMPLE_SUPPLIERS) : ctx.pick(SAMPLE_DESTINATIONS),
  worker: ctx.pick(SAMPLE_WORKERS),
  memo: '',
  refId: null,
  createdAt,
})

const pickDistinctDays = (ctx, count) => {
  const pool = Array.from({ length: HISTORY_DAYS - 1 }, (_, i) => i + 1)
  const shuffled = pool.reduce((acc, _, i) => {
    const j = i + Math.floor(ctx.random() * (acc.length - i))
    return acc.map((v, k) => (k === i ? acc[j] : k === j ? acc[i] : v))
  }, pool)
  return shuffled.slice(0, count).sort((a, b) => b - a)
}

const generatePartHistory = (ctx, part) => {
  const opening = part.safetyStock * ctx.int(2, 3)
  const txs = [makeTx(ctx, 'IN', part, opening, ctx.timeAt(HISTORY_DAYS))]
  // 하루에 한 건씩만 두어야 처리 순서와 시각 순서가 어긋나지 않는다
  const days = pickDistinctDays(ctx, EVENTS_PER_PART)

  let stock = opening
  days.forEach((day) => {
    const isInbound = ctx.random() < 0.3
    const qty = isInbound ? part.safetyStock : Math.min(stock, Math.ceil(part.safetyStock * (0.3 + ctx.random() * 0.5)))
    if (qty <= 0) return
    stock += isInbound ? qty : -qty
    txs.push(makeTx(ctx, isInbound ? 'IN' : 'OUT', part, qty, ctx.timeAt(day)))
  })
  return { txs, stock }
}

// 시연에서 보여줄 상태(미달 품목 3~4개)가 되도록 오늘 기록을 하나씩 덧붙인다.
const adjustToTarget = (ctx, part, stock) => {
  const shouldBeLow = SAMPLE_LOW_PARTS.includes(part.partNo)
  if (shouldBeLow && stock >= part.safetyStock) {
    const target = Math.floor(part.safetyStock * 0.6)
    return [makeTx(ctx, 'OUT', part, stock - target, ctx.timeAt(0, 10))]
  }
  if (!shouldBeLow && stock < part.safetyStock) {
    return [makeTx(ctx, 'IN', part, part.safetyStock * 2 - stock, ctx.timeAt(0, 10))]
  }
  return []
}

export const generateSampleData = ({ now = new Date().toISOString(), seed = 20261004 } = {}) => {
  const ctx = createContext(now, seed)
  const parts = SAMPLE_PARTS.map((p) => createPart(p, ctx.timeAt(HISTORY_DAYS, 500)))
  const transactions = parts
    .flatMap((part) => {
      const { txs, stock } = generatePartHistory(ctx, part)
      return [...txs, ...adjustToTarget(ctx, part, stock)]
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { parts, transactions }
}
