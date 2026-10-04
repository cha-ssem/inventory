// 부품은 수정일시가 더 최신인 쪽을 남긴다
const mergeParts = (baseParts, incoming) => {
  const byNo = new Map(baseParts.map((p) => [p.partNo, p]))
  let changed = false
  incoming.forEach((p) => {
    const current = byNo.get(p.partNo)
    if (!current || p.updatedAt > current.updatedAt) {
      byNo.set(p.partNo, p)
      changed = true
    }
  })
  return { parts: changed ? [...byNo.values()] : baseParts, changed }
}

// 기록은 지우지 않고 추가만 하므로 ID 기준 합집합이면 충돌이 없다
const mergeTransactions = (baseTx, incoming) => {
  const ids = new Set(baseTx.map((t) => t.id))
  const added = incoming.filter((t) => !ids.has(t.id))
  return { transactions: added.length > 0 ? [...baseTx, ...added] : baseTx, changed: added.length > 0 }
}

// full이면 서버 데이터를 기준으로 하되 아직 못 보낸 내 변경(outbox)은 얹는다
export const mergeRemote = (local, remote, outbox) => {
  if (remote.full) {
    const parts = mergeParts(remote.parts, outbox.parts).parts
    const transactions = mergeTransactions(remote.transactions, outbox.transactions).transactions
    return { state: { parts, transactions }, changed: true }
  }
  const p = mergeParts(local.parts, remote.parts)
  const t = mergeTransactions(local.transactions, remote.transactions)
  if (!p.changed && !t.changed) return { state: local, changed: false }
  return { state: { parts: p.parts, transactions: t.transactions }, changed: true }
}
