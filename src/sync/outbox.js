// 아직 구글 시트로 보내지 못한 변경 목록. 기록은 ID로, 부품은 품번으로 한 건씩만 둔다.
export const EMPTY_OUTBOX = Object.freeze({ parts: [], transactions: [] })

export const outboxSize = (box) => box.parts.length + box.transactions.length

export const enqueueChange = (box, { parts = [], transactions = [] }) => {
  const txIds = new Set(box.transactions.map((t) => t.id))
  const newTx = transactions.filter((t) => !txIds.has(t.id))
  const changedPartNos = new Set(parts.map((p) => p.partNo))
  return {
    parts: [...box.parts.filter((p) => !changedPartNos.has(p.partNo)), ...parts],
    transactions: [...box.transactions, ...newTx],
  }
}

export const takeBatch = (box, max) => ({
  parts: box.parts.slice(0, max),
  transactions: box.transactions.slice(0, max),
})

// 서버가 처리한 것만 지운다. 보낸 뒤 다시 수정된 부품(수정일시가 다름)은 남겨서 다음에 보낸다.
export const ackBatch = (box, { txIds = [], partNos = [], sentParts = null }) => {
  const doneTx = new Set(txIds)
  const sentVersion = new Map((sentParts || []).map((p) => [p.partNo, p.updatedAt]))
  const isDonePart = (p) => partNos.includes(p.partNo) && (!sentParts || sentVersion.get(p.partNo) === p.updatedAt)
  return {
    parts: box.parts.filter((p) => !isDonePart(p)),
    transactions: box.transactions.filter((t) => !doneTx.has(t.id)),
  }
}
