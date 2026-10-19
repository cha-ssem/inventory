// key 기준으로, 수정일시(updatedAt)가 더 최신인 쪽을 남긴다 (부품·현장·로봇)
export const mergeLatest = (base, incoming, key) => {
  const byKey = new Map(base.map((item) => [item[key], item]))
  let changed = false
  incoming.forEach((item) => {
    const current = byKey.get(item[key])
    if (!current || item.updatedAt > current.updatedAt) {
      byKey.set(item[key], item)
      changed = true
    }
  })
  return { items: changed ? [...byKey.values()] : base, changed }
}

// 지우지 않고 추가만 하는 기록은 ID 기준 합집합이면 충돌이 없다 (입출고 기록·점검 이벤트)
export const unionById = (base, incoming, key = 'id') => {
  const ids = new Set(base.map((item) => item[key]))
  const added = incoming.filter((item) => !ids.has(item[key]))
  return { items: added.length > 0 ? [...base, ...added] : base, changed: added.length > 0 }
}

const mergeParts = (baseParts, incoming) => {
  const { items, changed } = mergeLatest(baseParts, incoming, 'partNo')
  return { parts: items, changed }
}

const mergeTransactions = (baseTx, incoming) => {
  const { items, changed } = unionById(baseTx, incoming)
  return { transactions: items, changed }
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
