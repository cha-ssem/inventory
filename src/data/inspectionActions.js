// 입출고 저장소와 점검 저장소를 함께 쓰는 동작

const PARTNER = '현장점검'

// 점검 완료: 입력을 먼저 확인하고 → 쓴 부품을 한 번에 출고하고 → 완료 기록을 남긴다.
// 출고가 실패하면(재고 부족 등) 완료하지 않는다.
export const completeInspection = ({ store, inspection }, requestId, input, actor = '') => {
  const checked = inspection.checkTransition(requestId, 'COMPLETE', input, actor)
  if (!checked.ok) return checked
  const { usedParts } = checked.value.payload
  let outbound = { ok: true, low: [] }
  if (usedParts.length > 0) {
    outbound = store.recordOutboundBatch(
      usedParts.map((u) => ({ partNo: u.partNo, qty: u.qty, partner: PARTNER, worker: actor, memo: `점검 ${requestId}` })),
    )
    if (!outbound.ok) return outbound
  }
  const completed = inspection.transition(requestId, 'COMPLETE', checked.value.payload, actor)
  const warning = outbound.warning || completed.warning
  return { ...completed, low: outbound.low, ...(warning ? { warning } : {}) }
}
