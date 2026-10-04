import { LIMITS, cleanText, normalizePartNo, validateQty } from './validation.js'

export const TX_TYPES = Object.freeze({ IN: 'IN', OUT: 'OUT', CANCEL: 'CANCEL' })

export const TX_LABELS = Object.freeze({ IN: '입고', OUT: '출고', CANCEL: '취소' })

export const getCancelledIds = (transactions) =>
  new Set(transactions.filter((t) => t.type === TX_TYPES.CANCEL && t.refId).map((t) => t.refId))

const validateTexts = ({ partner, worker, memo }) => {
  if (partner.length > LIMITS.maxText || worker.length > LIMITS.maxText) {
    return `거래처·사용처·작업자는 ${LIMITS.maxText}자 이하로 입력하세요.`
  }
  if (memo.length > LIMITS.maxMemo) return `메모는 ${LIMITS.maxMemo}자 이하로 입력하세요.`
  return null
}

export const createTransaction = (input, { now, makeId }) => {
  if (!TX_TYPES[input.type]) return { ok: false, error: '알 수 없는 입출고 구분입니다.' }
  const partNo = normalizePartNo(input.partNo)
  if (!partNo) return { ok: false, error: '품번을 입력하거나 바코드를 스캔하세요.' }
  const qty = validateQty(input.qty)
  if (!qty.ok) return { ok: false, error: qty.error }

  const texts = { partner: cleanText(input.partner), worker: cleanText(input.worker), memo: cleanText(input.memo) }
  const textError = validateTexts(texts)
  if (textError) return { ok: false, error: textError }

  return {
    ok: true,
    value: {
      id: makeId(),
      type: input.type,
      partNo,
      qty: qty.value,
      ...texts,
      refId: input.refId || null,
      createdAt: now,
    },
  }
}

export const checkOutbound = (stockMap, partNo, qty, safetyStock) => {
  const current = stockMap.get(partNo) || 0
  if (qty > current) {
    return { ok: false, error: `현재고(${current.toLocaleString()})보다 많이 출고할 수 없습니다.` }
  }
  const after = current - qty
  return { ok: true, after, low: after < safetyStock }
}

const stockAfterCancellingInbound = (original, transactions) => {
  const cancelled = getCancelledIds(transactions)
  const current = transactions
    .filter((t) => t.partNo === original.partNo && !cancelled.has(t.id))
    .reduce((sum, t) => sum + (t.type === TX_TYPES.IN ? t.qty : t.type === TX_TYPES.OUT ? -t.qty : 0), 0)
  return current - original.qty
}

export const createCancel = (original, transactions, { now, makeId, memo = '', worker = '' }) => {
  if (original.type === TX_TYPES.CANCEL) return { ok: false, error: '취소 기록은 다시 취소할 수 없습니다.' }
  if (getCancelledIds(transactions).has(original.id)) return { ok: false, error: '이미 취소된 기록입니다.' }
  if (original.type === TX_TYPES.IN && stockAfterCancellingInbound(original, transactions) < 0) {
    return { ok: false, error: '이 입고를 취소하면 재고가 0보다 적어집니다. 관련 출고를 먼저 취소하세요.' }
  }
  return createTransaction(
    { type: TX_TYPES.CANCEL, partNo: original.partNo, qty: original.qty, memo, worker, refId: original.id },
    { now, makeId },
  )
}
