// 새 부품 품번 제안: 품번 체계 SK-분류-일련번호 (PRD 8장). AI 없이 규칙으로만 정한다.
import { normalizeSupplier } from './ocr.js'
import { TX_TYPES } from './transactions.js'
import { LIMITS, PART_NO_PATTERN } from './validation.js'

const PREFIX = 'SK'
const SERIAL_WIDTH = 3
const SCHEME = /^SK-([A-Z]+)-(\d+)$/

export const CATEGORY_LABELS = Object.freeze({ AD: '에어벤트 덕트', PD: '페달 부품', CS: '케이스류', RM: '원자재', SB: '부자재' })

// 품명에 이 낱말이 있으면 그 분류일 가능성이 높다
const KEYWORDS = Object.freeze({
  AD: ['덕트', '벤트'],
  PD: ['페달'],
  CS: ['케이스', '커버', '하우징', '트레이'],
  RM: ['수지', '원료', '레진', '마스터배치', '펠릿'],
  SB: ['클립', '패킹', '스크류', '볼트', '너트', '와셔', '포장', '박스', '패드', '테이프', '라벨', '봉투'],
})

// 근거마다 점수. 같은 명세서의 다른 품목이 가장 강한 단서다.
const WEIGHT = Object.freeze({ sibling: 3, supplier: 1, keyword: 2 })
const SOURCE_ORDER = ['sibling', 'supplier', 'keyword']

const categoryOf = (partNo) => SCHEME.exec(partNo || '')?.[1] ?? null

export const nextPartNo = (parts, category) => {
  const serials = parts.map((p) => SCHEME.exec(p.partNo)).filter((m) => m && m[1] === category).map((m) => Number(m[2]))
  const next = serials.length === 0 ? 1 : Math.max(...serials) + 1
  return `${PREFIX}-${category}-${String(next).padStart(SERIAL_WIDTH, '0')}`
}

const addScore = (scores, category, source, amount, detail) => {
  const current = scores.get(category) || { total: 0, sources: {} }
  const prev = current.sources[source] || { amount: 0, details: [] }
  const details = detail && !prev.details.includes(detail) ? [...prev.details, detail] : prev.details
  return new Map(scores).set(category, {
    total: current.total + amount,
    sources: { ...current.sources, [source]: { amount: prev.amount + amount, details } },
  })
}

// 이 공급사에서 입고한 부품의 분류. 입고가 많은 부품 하나가 이기지 않도록 부품 종류마다 한 번만 센다.
const supplierCategories = (transactions, supplier) => {
  const key = normalizeSupplier(supplier)
  if (!key) return []
  const partNos = new Set(transactions.filter((t) => t.type === TX_TYPES.IN && normalizeSupplier(t.partner) === key).map((t) => t.partNo))
  return [...partNos].map(categoryOf).filter(Boolean)
}

const keywordHits = (name) =>
  Object.entries(KEYWORDS).flatMap(([category, words]) => words.filter((w) => (name || '').includes(w)).map((word) => ({ category, word })))

const scoreCategories = ({ item, supplier, transactions, siblingPartNos }) => {
  let scores = new Map()
  siblingPartNos.map(categoryOf).filter(Boolean).forEach((c) => {
    scores = addScore(scores, c, 'sibling', WEIGHT.sibling)
  })
  supplierCategories(transactions, supplier).forEach((c) => {
    scores = addScore(scores, c, 'supplier', WEIGHT.supplier)
  })
  keywordHits(item.name).forEach(({ category, word }) => {
    scores = addScore(scores, category, 'keyword', WEIGHT.keyword, word)
  })
  return [...scores.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
}

const label = (category) => (CATEGORY_LABELS[category] ? `${category}(${CATEGORY_LABELS[category]})` : category)

const reasonFor = (category, { sources }, supplier) => {
  const source = SOURCE_ORDER.find((s) => sources[s])
  if (source === 'sibling') return `같은 명세서의 다른 품목이 ${label(category)} 분류입니다.`
  if (source === 'supplier') return `${supplier.trim()}에서 받은 부품이 주로 ${label(category)} 분류입니다.`
  const words = sources.keyword.details.map((w) => `"${w}"`).join(', ')
  return `품명에 ${words}가 있어 ${label(category)} 분류로 봤습니다.`
}

// 결과: { partNo, category, reason, alternatives: [{ partNo, category }] } 또는 단서가 없으면 null
export const suggestPartNo = ({ item, supplier, parts, transactions, siblingPartNos }) => {
  const own = (item.ourPartNo || '').trim().toUpperCase()
  const ownUsable = own && own.length <= LIMITS.maxPartNo && PART_NO_PATTERN.test(own) && !parts.some((p) => p.partNo === own)
  const ranked = scoreCategories({ item, supplier, transactions, siblingPartNos })
  // 다른 후보는 근거가 강한 것(같은 명세서, 품명 낱말)만 낸다. 공급사 이력만으로는 엉뚱한 분류가 나올 수 있다.
  const alternativesAfter = (skip) =>
    ranked
      .filter(([c, score]) => c !== skip && (score.sources.sibling || score.sources.keyword))
      .slice(0, 2)
      .map(([c]) => ({ partNo: nextPartNo(parts, c), category: c }))

  if (ownUsable) return { partNo: own, category: categoryOf(own), reason: '서류에 적힌 귀사 품번입니다.', alternatives: alternativesAfter(categoryOf(own)) }
  if (ranked.length === 0) return null
  const [category, score] = ranked[0]
  return { partNo: nextPartNo(parts, category), category, reason: reasonFor(category, score, supplier), alternatives: alternativesAfter(category) }
}
