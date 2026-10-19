import { isValidEvent, isValidRobot, isValidSite } from '../domain/inspection/validation.js'
import { readJson, writeJson } from './kvJson.js'
import { mergeLatest, unionById } from './merge.js'

// 현장점검 데이터를 입출고와 같은 구글 시트 연결로 주고받는 동기화 채널 (engine.js의 channels에 붙인다).
// 현장·로봇은 수정일시가 최신인 쪽, 점검 이벤트는 지우지 않고 추가만 하므로 ID 합집합으로 합친다.
export const INSPECTION_SYNC_KEYS = Object.freeze({
  outbox: 'samkwang-inventory:insp-sync-outbox',
  meta: 'samkwang-inventory:insp-sync-meta',
})

const EMPTY_OUTBOX = Object.freeze({ sites: [], robots: [], events: [] })
const EMPTY_META = Object.freeze({ offset: 0, lastRowId: null })
const MASTERS = [
  ['sites', 'siteId'],
  ['robots', 'robotId'],
]
const BATCH_SIZE = 500
const ABORTED = Object.freeze({ ok: false, code: 'ABORTED' })
const UNSUPPORTED_NOTICE = '점검 기록은 아직 시트에 올리지 못했습니다. Apps Script를 최신 버전으로 다시 배포하세요.'

const outboxSize = (box) => box.sites.length + box.robots.length + box.events.length

const enqueue = (box, change) => {
  const next = { events: unionById(box.events, change.events ?? []).items }
  MASTERS.forEach(([name, key]) => {
    const incoming = change[name] ?? []
    const changedKeys = new Set(incoming.map((item) => item[key]))
    next[name] = [...box[name].filter((item) => !changedKeys.has(item[key])), ...incoming]
  })
  return next
}

const takeBatch = (box) => ({
  sites: box.sites.slice(0, BATCH_SIZE),
  robots: box.robots.slice(0, BATCH_SIZE),
  events: box.events.slice(0, BATCH_SIZE),
})

// 서버가 처리한 이벤트와, 보낸 뒤 다시 바뀌지 않은 현장·로봇만 지운다
const ackBatch = (box, sent, handledIds) => {
  const handled = new Set(handledIds)
  const next = { events: box.events.filter((e) => !handled.has(e.id)) }
  MASTERS.forEach(([name, key]) => {
    const sentVersion = new Map(sent[name].map((item) => [item[key], item.updatedAt]))
    next[name] = box[name].filter((item) => sentVersion.get(item[key]) !== item.updatedAt)
  })
  return next
}

// 점검 기능이 없던 예전 Apps Script 배포인지 (그때는 BAD_REQUEST로 답했다)
const isUnsupported = (result) =>
  result.code === 'UNKNOWN_ACTION' || (result.code === 'BAD_REQUEST' && /알 수 없는 요청/.test(result.error || ''))

const assertShape = (condition, what) => {
  if (!condition) throw new Error(`서버 응답 형식이 올바르지 않습니다 (${what}).`)
}

// 받은 데이터를 이 기기 데이터와 합친다. 점검 데이터는 지우지 않으므로 전체를 다시 받아도 합치기만 하면 된다.
const mergeInspection = (local, remote) => {
  const sites = mergeLatest(local.sites, remote.sites, 'siteId')
  const robots = mergeLatest(local.robots, remote.robots, 'robotId')
  const events = unionById(local.events, remote.events)
  if (!sites.changed && !robots.changed && !events.changed) return local
  return { sites: sites.items, robots: robots.items, events: events.items }
}

const joinNotices = (...notices) => notices.filter(Boolean).join(' ')

// isConnected·requestSync: 엔진의 연결 여부와 "곧 동기화" 요청 (엔진이 채널보다 나중에 만들어져서 함수로 받는다)
export const createInspectionChannel = ({ store, kv, isConnected, requestSync }) => {
  const outbox = () => readJson(kv, INSPECTION_SYNC_KEYS.outbox, EMPTY_OUTBOX)
  const meta = () => ({ ...EMPTY_META, ...readJson(kv, INSPECTION_SYNC_KEYS.meta, EMPTY_META) })
  const saveOutbox = (box) => writeJson(kv, INSPECTION_SYNC_KEYS.outbox, box)
  const saveMeta = (changes) => writeJson(kv, INSPECTION_SYNC_KEYS.meta, { ...meta(), ...changes })

  // 통째로 바뀌면(샘플 불러오기) 지금 데이터를 모두 보낸다. 시트에 이미 있는 이벤트는 서버가 중복으로 처리한다.
  const recordLocalChange = (change) => {
    if (!isConnected()) return
    saveOutbox(enqueue(outbox(), change.replaced ? store.getState() : change))
    requestSync()
  }

  const push = async (client, isCurrent) => {
    let rejectedCount = 0
    while (outboxSize(outbox()) > 0) {
      const before = outbox()
      const batch = takeBatch(before)
      const result = await client.request('inspPush', batch)
      if (!isCurrent()) return ABORTED
      if (!result.ok) return isUnsupported(result) ? { ok: true, unsupported: true } : result
      assertShape(Array.isArray(result.acceptedIds) && Array.isArray(result.duplicateIds) && Array.isArray(result.rejected), 'inspPush')
      const handled = [...result.acceptedIds, ...result.duplicateIds, ...result.rejected.map((r) => r.id)]
      const after = ackBatch(outbox(), batch, handled)
      saveOutbox(after)
      rejectedCount += result.rejected.length + (result.rejectedMasters?.length ?? 0)
      if (outboxSize(after) >= outboxSize(before)) {
        return { ok: false, code: 'NO_PROGRESS', error: '시트가 점검 기록을 처리하지 않았습니다. Apps Script 배포가 최신인지 확인하세요.' }
      }
    }
    return { ok: true, notice: rejectedCount > 0 ? `시트가 받지 않은 점검 기록 ${rejectedCount}건이 있습니다.` : '' }
  }

  const pull = async (client, isCurrent) => {
    const { offset, lastRowId } = meta()
    const result = await client.request('inspPull', { offset, lastRowId })
    if (!isCurrent()) return ABORTED
    if (!result.ok) return isUnsupported(result) ? { ok: true, unsupported: true } : result
    assertShape(Array.isArray(result.sites) && Array.isArray(result.robots) && Array.isArray(result.events) && Number.isInteger(result.total), 'inspPull')

    const remote = { sites: result.sites.filter(isValidSite), robots: result.robots.filter(isValidRobot), events: result.events.filter(isValidEvent) }
    const dropped = (result.invalidCount || 0) + result.events.length - remote.events.length
    const applied = store.applyRemote((current) => mergeInspection(current, remote))
    // 브라우저에 저장하지 못했으면 받은 위치를 옮기지 않는다 (다음에 다시 받음)
    if (applied.warning) return { ok: false, code: 'SAVE_FAILED', error: '받은 점검 데이터를 브라우저에 저장하지 못했습니다. 저장 공간을 확인하세요.' }
    saveMeta({ offset: result.total, lastRowId: result.lastRowId ?? null })
    return { ok: true, notice: dropped > 0 ? `시트에 형식이 잘못된 점검 행 ${dropped}개는 받지 않았습니다.` : '' }
  }

  const sync = async (client, isCurrent) => {
    const pushed = await push(client, isCurrent)
    if (!pushed.ok) return pushed
    if (pushed.unsupported) return { ok: true, notice: UNSUPPORTED_NOTICE }
    const pulled = await pull(client, isCurrent)
    if (!pulled.ok) return pulled
    if (pulled.unsupported) return { ok: true, notice: UNSUPPORTED_NOTICE }
    return { ok: true, notice: joinNotices(pushed.notice, pulled.notice) }
  }

  // 연결 방식(입출고 기준: 올리기·받기·합치기)과 상관없이 점검 데이터는 늘 양쪽을 합친다.
  // 입출고가 비어서 "받기"가 골라져도 이 기기에만 있던 점검 기록을 잃지 않도록.
  const onConnect = () => {
    saveOutbox(enqueue(EMPTY_OUTBOX, store.getState()))
    writeJson(kv, INSPECTION_SYNC_KEYS.meta, EMPTY_META)
  }

  const reset = () => {
    writeJson(kv, INSPECTION_SYNC_KEYS.outbox, null)
    writeJson(kv, INSPECTION_SYNC_KEYS.meta, null)
  }

  return {
    name: 'inspection',
    keys: Object.values(INSPECTION_SYNC_KEYS),
    pending: () => outboxSize(outbox()),
    recordLocalChange,
    sync,
    onConnect,
    reset,
  }
}
