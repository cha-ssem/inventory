import { planAlerts } from '../domain/monitor/alerts.js'
import { getCancelledIds } from '../domain/transactions.js'

// 입출고 저장소와 점검 저장소를 함께 쓰는 동작

const PARTNER = '현장점검'

const rollback = (store, txs, requestId) =>
  txs.forEach((tx) => store.cancelTransaction(tx.id, { memo: `점검 ${requestId} 완료 저장 실패로 되돌림` }))

// 점검 완료: 입력을 먼저 확인하고 → 쓴 부품을 한 번에 출고하고(기록 ID = 완료 이벤트 ID-OUT-n) → 완료 기록을 남긴다.
// 출고가 실패하면(재고 부족 등) 완료하지 않고, 완료 저장이 실패하면 방금 한 출고를 취소 기록으로 되돌린다.
export const completeInspection = ({ store, inspection }, requestId, input, actor = '') => {
  const checked = inspection.checkTransition(requestId, 'COMPLETE', input, actor)
  if (!checked.ok) return checked
  const event = checked.value
  const { usedParts } = event.payload
  let outbound = { ok: true, value: [], low: [] }
  if (usedParts.length > 0) {
    outbound = store.recordOutboundBatch(
      usedParts.map((u) => ({ partNo: u.partNo, qty: u.qty, partner: PARTNER, worker: actor, memo: `점검 ${requestId}` })),
      { idPrefix: event.id },
    )
    if (!outbound.ok) return outbound
  }
  const completed = inspection.commitEvent(event)
  if (!completed.ok) {
    rollback(store, outbound.value, requestId)
    return completed
  }
  const warning = outbound.warning || completed.warning
  return { ...completed, low: outbound.low, ...(warning ? { warning } : {}) }
}

// 반영되지 않은 완료(다른 기기가 먼저 완료함) 가운데, 함께 나간 출고가 아직 취소되지 않은 것.
// 요청이 실제로 완료된 경우에만 본다 (완료되지 않았는데 되돌리면 실제로 쓴 부품의 재고가 틀어진다).
export const pendingReverts = (store, request) => {
  if (request?.status !== 'COMPLETED') return []
  const { transactions } = store.getState()
  const cancelled = getCancelledIds(transactions)
  return (request?.skipped ?? [])
    .filter((e) => e.type === 'COMPLETE')
    .map((e) => ({ eventId: e.id, txIds: transactions.filter((t) => t.id.startsWith(`${e.id}-OUT-`) && !cancelled.has(t.id)).map((t) => t.id) }))
    .filter((r) => r.txIds.length > 0)
}

export const revertSkippedCompletion = ({ store, inspection }, requestId, eventId) => {
  const request = inspection.getRequest(requestId)
  if (!request?.skipped.some((e) => e.id === eventId)) return { ok: false, error: '되돌릴 완료 기록을 찾을 수 없습니다.' }
  const target = pendingReverts(store, request).find((r) => r.eventId === eventId)
  const results = (target?.txIds ?? []).map((id) => store.cancelTransaction(id, { memo: `점검 ${requestId} 중복 완료 되돌림` }))
  const failed = results.find((r) => !r.ok)
  if (failed) return failed
  return { ok: true, reverted: results.length }
}

const MONITOR_ACTOR = '센서 감시'
const NOT_DEPLOYED = '현장에 배치되지 않았거나, 로봇·현장이 사용 중지되어 점검 요청을 만들 수 없습니다.'

// 지금 로봇·현장 정보로 바꾼다 (화면을 연 뒤 로봇이 옮겨졌거나 사용 중지된 경우)
const withLatestRobot = (violations, { robots, sites }) =>
  violations.map((v) => {
    const robot = robots.find((r) => r.robotId === v.robot.robotId)
    const site = robot && sites.find((s) => s.siteId === robot.siteId)
    const usable = robot && robot.active !== false && site && site.active !== false
    return usable ? { ...v, robot } : { ...v, error: NOT_DEPLOYED }
  })

const applyAlert = (inspection, action, result) => {
  if (action.kind === 'RECUR') {
    const recur = inspection.transition(action.requestId, 'RECUR', { reading: action.reading }, MONITOR_ACTOR)
    return recur.ok ? { ...result, recurred: result.recurred + 1, warnings: recur.warning ? [...result.warnings, recur.warning] : result.warnings } : result
  }
  const added = inspection.addRequest(action.input, MONITOR_ACTOR)
  if (added.ok) return { ...result, created: [...result.created, added.value], warnings: added.warning ? [...result.warnings, added.warning] : result.warnings }
  if (added.code === 'DUPLICATE_ALERT') return result
  return { ...result, failed: [...result.failed, { key: `${action.input.robotId}|${action.input.ruleId}`, error: added.error }] }
}

// 센서·로그 위반을 점검 요청으로 기록한다 (중복·대기 시간 판단은 planAlerts, 시각은 저장소 시계).
// 돌려주는 값: created(새 요청), recurred(재발생 수), warnings(저장 경고), failed(만들지 못한 것과 이유)
export const raiseAlerts = (inspection, violations, { source = 'SENSOR' } = {}) => {
  const empty = { created: [], recurred: 0, warnings: [], failed: [] }
  if (violations.length === 0) return empty
  inspection.refresh()
  const checked = withLatestRobot(violations, inspection.getState())
  const failed = checked.filter((v) => v.error).map((v) => ({ key: `${v.robot.robotId}|${v.rule.id}`, error: v.error }))
  const usable = checked.filter((v) => !v.error)
  const actions = planAlerts(usable, inspection.listRequests(), inspection.now(), { source })
  return actions.reduce((result, action) => applyAlert(inspection, action, result), { ...empty, failed })
}
