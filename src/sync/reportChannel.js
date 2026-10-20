import { isSharedReport, isValidRemoteReport, mergeReports } from '../domain/report/sync.js'
import { ABORTED, assertShape, isUnsupported, joinNotices } from './channelUtils.js'
import { readJson, writeJson } from './kvJson.js'

// 확정·제출한 점검 보고서를 입출고와 같은 구글 시트 연결로 주고받는 동기화 채널 (engine.js의 channels에 붙인다).
// 초안은 쓰던 기기에만 둔다. 보낼 목록에는 보고서 ID만 두고, 보낼 때 저장소의 최신 내용을 읽는다.
export const REPORT_SYNC_KEYS = Object.freeze({
  outbox: 'samkwang-inventory:report-sync-outbox',
  meta: 'samkwang-inventory:report-sync-meta',
})

const EMPTY_META = Object.freeze({ rev: 0 })
// 보고서 하나가 수십 KB가 될 수 있어 한 번에 조금씩 보낸다
const BATCH_SIZE = 10
const MAX_ROUNDS = 20
// 받은 보고서를 저장 공간이 모자라 못 넣으면, 같은 쪽을 30초마다 다시 받지 않도록 간격을 늘린다 (1분 → 최대 30분)
const BACKOFF_BASE_MS = 60_000
const BACKOFF_MAX_MS = 30 * 60_000
const PULL_SAVE_FAILED = Object.freeze({
  ok: false,
  code: 'SAVE_FAILED',
  error: '받은 보고서를 브라우저에 저장하지 못했습니다. 저장 공간을 확인하세요. (오래된 보고서를 PDF로 저장한 뒤 백업·정리하면 됩니다)',
})
const UNSUPPORTED_NOTICE = '보고서는 아직 다른 기기와 주고받지 못합니다. Apps Script를 최신 버전으로 다시 배포하세요.'

const unique = (ids) => [...new Set(ids)]

// clock: 저장 실패 후 다시 받을 때를 재는 시계 (테스트에서 바꿈)
export const createReportChannel = ({ store, kv, isConnected, requestSync, clock = () => Date.now() }) => {
  const outbox = () => {
    const ids = readJson(kv, REPORT_SYNC_KEYS.outbox, [])
    return Array.isArray(ids) ? ids : []
  }
  const meta = () => ({ ...EMPTY_META, ...readJson(kv, REPORT_SYNC_KEYS.meta, EMPTY_META) })
  // 보낼 목록을 저장하지 못하면(저장 공간 부족) 다음 동기화 때 확정·제출본을 모두 다시 넣는다 (서버가 중복은 거름)
  let resendAll = false
  const saveOutbox = (ids) => {
    const saved = writeJson(kv, REPORT_SYNC_KEYS.outbox, ids)
    if (!saved) resendAll = true
    return saved
  }
  const sharedIds = () => store.list().filter(isSharedReport).map((r) => r.reportId)
  let backoff = { failures: 0, until: 0 }

  const recordLocalChange = (report) => {
    if (!isConnected() || !isSharedReport(report)) return
    saveOutbox(unique([...outbox(), report.reportId]))
    requestSync()
  }

  // 서버가 처리한 것 중, 보낸 뒤 다시 바뀌지 않은 것만 지운다. 이 기기에서 사라진 보고서도 지운다.
  const ackBatch = (ids, sent, handledIds) => {
    const handled = new Set(handledIds)
    const sentVersion = new Map(sent.map((r) => [r.reportId, r.updatedAt]))
    return ids.filter((id) => {
      const current = store.get(id)
      if (!current || !isSharedReport(current)) return false
      return !(handled.has(id) && (!sentVersion.has(id) || sentVersion.get(id) === current.updatedAt))
    })
  }

  const push = async (client, isCurrent) => {
    let rejectedCount = 0
    // 보내는 사이 계속 바뀌어도 끝없이 돌지 않도록 횟수를 제한한다 (남은 것은 다음 동기화 때)
    for (let round = 0; round < MAX_ROUNDS && outbox().length > 0; round += 1) {
      const before = outbox()
      const candidates = before.slice(0, BATCH_SIZE).map((id) => store.get(id)).filter(isSharedReport)
      // 다른 기기가 받지 못할 모양(예전 버전에서 만든 보고서)은 보내지 않고 알린다
      const batch = candidates.filter(isValidRemoteReport)
      const skipped = candidates.filter((r) => !isValidRemoteReport(r)).map((r) => r.reportId)
      rejectedCount += skipped.length
      if (batch.length === 0) {
        if (!saveOutbox(ackBatch(before, [], []).filter((id) => !skipped.includes(id)))) {
          return { ok: false, code: 'SAVE_FAILED', error: '브라우저 저장 공간이 부족해 보낼 목록을 정리하지 못했습니다.' }
        }
        continue
      }
      const result = await client.request('reportPush', { reports: batch })
      if (!isCurrent()) return ABORTED
      if (!result.ok) return isUnsupported(result) ? { ok: true, unsupported: true } : result
      assertShape(Array.isArray(result.acceptedIds) && Array.isArray(result.duplicateIds) && Array.isArray(result.rejected), 'reportPush')
      const handled = [...result.acceptedIds, ...result.duplicateIds, ...result.rejected.map((r) => r.id)]
      const after = ackBatch(outbox(), batch, [...handled, ...skipped])
      if (!saveOutbox(after)) return { ok: false, code: 'SAVE_FAILED', error: '브라우저 저장 공간이 부족해 보낸 보고서를 정리하지 못했습니다.' }
      rejectedCount += result.rejected.length
      // 보내는 사이 바뀐 보고서는 목록에 남아 다시 보내므로, 줄었는지가 아니라 서버가 처리했는지로 본다
      const sentIds = new Set(batch.map((r) => r.reportId))
      if (!handled.some((id) => sentIds.has(id))) {
        return { ok: false, code: 'NO_PROGRESS', error: '시트가 보고서를 처리하지 않았습니다. Apps Script 배포가 최신인지 확인하세요.' }
      }
    }
    return { ok: true, notice: rejectedCount > 0 ? `다른 기기와 주고받지 못한 보고서 ${rejectedCount}건이 있습니다.` : '' }
  }

  // 받은 위치(rev) 이후에 시트에 쓰인 보고서를 한 쪽 받아 저장한다
  const pullPage = async (client, isCurrent) => {
    const result = await client.request('reportPull', { sinceRev: meta().rev })
    if (!isCurrent()) return ABORTED
    if (!result.ok) return isUnsupported(result) ? { ok: true, unsupported: true } : result
    assertShape(Array.isArray(result.reports) && Number.isInteger(result.rev), 'reportPull')

    const remote = result.reports.filter(isValidRemoteReport)
    const dropped = (result.invalidCount || 0) + result.reports.length - remote.length
    const applied = store.applyRemote((current) => mergeReports(current, remote))
    // 브라우저에 저장하지 못했으면 받은 위치를 옮기지 않고, 다음에 받을 때까지 간격을 늘린다
    if (!applied.ok) {
      const failures = backoff.failures + 1
      backoff = { failures, until: clock() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)) }
      return PULL_SAVE_FAILED
    }
    backoff = { failures: 0, until: 0 }
    writeJson(kv, REPORT_SYNC_KEYS.meta, { ...meta(), rev: result.rev })
    return { ok: true, more: result.more === true, dropped }
  }

  // 시트가 한 쪽씩 주므로 남았다고(more) 하면 이어 받는다
  const pull = async (client, isCurrent) => {
    if (clock() < backoff.until) return PULL_SAVE_FAILED
    let dropped = 0
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const page = await pullPage(client, isCurrent)
      if (!page.ok || page.unsupported) return page
      dropped += page.dropped
      if (!page.more) break
    }
    return { ok: true, notice: dropped > 0 ? `시트에 형식이 잘못된 보고서 ${dropped}건은 받지 않았습니다.` : '' }
  }

  const sync = async (client, isCurrent) => {
    // 보고서 동기화가 생기기 전부터 연결돼 있던 기기는 [연결]을 다시 누르지 않으므로(onConnect가 불리지 않음),
    // 이 기기의 확정·제출본을 아직 한 번도 넣지 않았으면(seeded 없음) 모두 보낼 목록에 넣는다.
    // 받은 위치(rev)만 보고 판단하면, 이 처리가 없던 버전에서 한 번 받아 둔 기기가 빠진다.
    if (!meta().seeded) {
      resendAll = true
      writeJson(kv, REPORT_SYNC_KEYS.meta, { ...meta(), seeded: true })
    }
    if (resendAll) {
      resendAll = false
      if (!saveOutbox(unique([...outbox(), ...sharedIds()]))) {
        return { ok: false, code: 'SAVE_FAILED', error: '브라우저 저장 공간이 부족해 보고서를 보낼 목록에 넣지 못했습니다. 백업 후 불필요한 데이터를 지우세요.' }
      }
    }
    const pushed = await push(client, isCurrent)
    if (!pushed.ok) return pushed
    if (pushed.unsupported) return { ok: true, notice: UNSUPPORTED_NOTICE }
    const pulled = await pull(client, isCurrent)
    if (!pulled.ok) return pulled
    if (pulled.unsupported) return { ok: true, notice: UNSUPPORTED_NOTICE }
    return { ok: true, notice: joinNotices(pushed.notice, pulled.notice) }
  }

  // 연결 방식과 상관없이 이 기기의 확정·제출본을 모두 보내고, 시트의 보고서를 처음부터 받는다
  const onConnect = () => {
    saveOutbox(sharedIds())
    writeJson(kv, REPORT_SYNC_KEYS.meta, { ...EMPTY_META, seeded: true })
    backoff = { failures: 0, until: 0 }
  }

  const reset = () => {
    resendAll = false
    backoff = { failures: 0, until: 0 }
    writeJson(kv, REPORT_SYNC_KEYS.outbox, null)
    writeJson(kv, REPORT_SYNC_KEYS.meta, null)
  }

  return {
    name: 'report',
    label: '보고서',
    keys: Object.values(REPORT_SYNC_KEYS),
    pending: () => outbox().length,
    recordLocalChange,
    sync,
    onConnect,
    reset,
  }
}
