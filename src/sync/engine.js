import { isValidPart, isValidTransaction } from '../domain/backup.js'
import { validateSyncConfig } from './config.js'
import { withSyncLeader } from './leader.js'
import { mergeRemote } from './merge.js'
import { EMPTY_OUTBOX, ackBatch, enqueueChange, outboxSize, takeBatch } from './outbox.js'

export const SYNC_KEYS = Object.freeze({
  config: 'samkwang-inventory:sync-config',
  outbox: 'samkwang-inventory:sync-outbox',
  meta: 'samkwang-inventory:sync-meta',
})

const BATCH_SIZE = 500
const INTERVAL_MS = 30_000
const DEBOUNCE_MS = 800
const EMPTY_META = Object.freeze({
  dataVersion: null,
  revision: null,
  txOffset: 0,
  lastRowId: null,
  pendingReplace: false,
  forceReplace: false,
})
const ABORTED = Object.freeze({ ok: false, code: 'ABORTED' })

const readJson = (kv, key, fallback) => {
  try {
    const raw = kv?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (error) {
    console.error('동기화 정보를 읽지 못했습니다:', error)
    return fallback
  }
}

const writeJson = (kv, key, value) => {
  try {
    if (value === null) kv?.removeItem(key)
    else kv?.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error('동기화 정보를 저장하지 못했습니다:', error)
  }
}

const allEntities = (state) => ({ parts: state.parts, transactions: state.transactions })

const assertShape = (condition, what) => {
  if (!condition) throw new Error(`서버 응답 형식이 올바르지 않습니다 (${what}).`)
}

// 보낼 목록·연결 정보·진행 상태는 kv(localStorage)에 두어 새로고침하거나 다른 탭에서도 이어진다
export const createSyncEngine = ({ store, kv, createClient, now = () => new Date().toISOString() }) => {
  let status = { state: 'idle', message: '', lastSyncAt: null, rejected: [], conflict: false }
  let running = null
  let rerun = false
  let timers = null
  let generation = 0 // 연결 해제하면 올라간다. 진행 중이던 동기화의 결과를 버리는 데 쓴다.
  const listeners = new Set()

  const config = () => readJson(kv, SYNC_KEYS.config, null)
  const outbox = () => readJson(kv, SYNC_KEYS.outbox, EMPTY_OUTBOX)
  const meta = () => ({ ...EMPTY_META, ...readJson(kv, SYNC_KEYS.meta, EMPTY_META) })
  const saveOutbox = (box) => writeJson(kv, SYNC_KEYS.outbox, box)
  const saveMeta = (changes) => writeJson(kv, SYNC_KEYS.meta, { ...meta(), ...changes })

  const getStatus = () => ({ ...status, connected: Boolean(config()), pending: outboxSize(outbox()) })
  const notify = () => listeners.forEach((listener) => listener(getStatus()))
  const setStatus = (changes) => {
    status = { ...status, ...changes }
    notify()
  }

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const scheduleSoon = () => {
    if (!timers) return
    clearTimeout(timers.debounce)
    timers.debounce = setTimeout(() => syncNow({ background: true }), DEBOUNCE_MS)
  }

  const recordLocalChange = (change) => {
    if (!config()) return
    if (change.replaced) {
      saveOutbox(EMPTY_OUTBOX)
      saveMeta({ pendingReplace: true })
    } else {
      saveOutbox(enqueueChange(outbox(), change))
    }
    notify()
    scheduleSoon()
  }

  const failWith = (result) => {
    if (result.code === 'NETWORK') return setStatus({ state: 'offline', message: '오프라인: 연결되면 자동으로 보냅니다.' })
    if (result.code === 'CONFLICT') {
      return setStatus({
        state: 'error',
        conflict: true,
        message: '다른 기기가 그사이 시트를 바꿔서 전체 바꾸기를 멈췄습니다. 설정에서 어떻게 할지 고르세요.',
      })
    }
    return setStatus({ state: 'error', message: result.error })
  }

  // 보낸 스냅샷에 들어 있던 것만 보낼 목록에서 지운다 (요청 중에 들어온 변경은 남김)
  const replaceRemote = async (client, isCurrent) => {
    const { revision, forceReplace } = meta()
    const snapshot = allEntities(store.getState())
    const result = await client.request('replaceAll', { ...snapshot, expectedRevision: revision, force: forceReplace })
    if (!isCurrent()) return ABORTED
    if (!result.ok) return result
    assertShape(Number.isInteger(result.transactions), 'replaceAll')
    saveOutbox(
      ackBatch(outbox(), {
        txIds: snapshot.transactions.map((t) => t.id),
        partNos: snapshot.parts.map((p) => p.partNo),
        sentParts: snapshot.parts,
      }),
    )
    saveMeta({
      dataVersion: result.dataVersion,
      revision: result.revision ?? null,
      txOffset: result.transactions,
      lastRowId: result.lastRowId ?? null,
      pendingReplace: false,
      forceReplace: false,
    })
    return result
  }

  const pushOutbox = async (client, isCurrent) => {
    while (outboxSize(outbox()) > 0) {
      const before = outbox()
      const batch = takeBatch(before, BATCH_SIZE)
      const result = await client.request('push', batch)
      if (!isCurrent()) return ABORTED
      if (!result.ok) return result
      assertShape(Array.isArray(result.acceptedIds) && Array.isArray(result.duplicateIds) && Array.isArray(result.rejected), 'push')
      const handled = [...result.acceptedIds, ...result.duplicateIds, ...result.rejected.map((r) => r.id)]
      const after = ackBatch(outbox(), { txIds: handled, partNos: batch.parts.map((p) => p.partNo), sentParts: batch.parts })
      saveOutbox(after)
      // 내 push 사이에 다른 기기가 쓰지 않았을 때만 리비전을 따라간다 (아니면 다음 pull에서 맞춘다)
      if (result.previousRevision !== undefined && result.previousRevision === meta().revision) saveMeta({ revision: result.revision })
      const rejected = [...result.rejected, ...(result.rejectedParts || [])]
      if (rejected.length > 0) status = { ...status, rejected: [...status.rejected, ...rejected].slice(-50) }
      if (outboxSize(after) >= outboxSize(before)) {
        return { ok: false, code: 'NO_PROGRESS', error: '시트가 보낸 내용을 처리하지 않았습니다. Apps Script 배포가 최신인지 확인하세요.' }
      }
    }
    return { ok: true }
  }

  const pullRemote = async (client, isCurrent) => {
    const { dataVersion, txOffset, lastRowId } = meta()
    const result = await client.request('pull', { dataVersion, txOffset, lastRowId })
    if (!isCurrent()) return ABORTED
    if (!result.ok) return result
    assertShape(Array.isArray(result.parts) && Array.isArray(result.transactions) && Number.isInteger(result.txTotal), 'pull')

    // 형식이 깨진 행은 받지 않는다 (서버가 거르고, 여기서 한 번 더 확인)
    const transactions = result.transactions.filter(isValidTransaction)
    const parts = result.parts.filter(isValidPart)
    const invalid = (result.invalidCount || 0) + (result.transactions.length - transactions.length) + (result.parts.length - parts.length)
    const remote = { ...result, transactions, parts }

    const applied = store.applyRemote((current) => mergeRemote(current, remote, outbox()).state)
    // 브라우저에 저장하지 못했으면 받은 위치를 옮기지 않는다 (다음에 다시 받음)
    if (applied.warning) return { ok: false, code: 'SAVE_FAILED', error: '받은 데이터를 브라우저에 저장하지 못했습니다. 저장 공간을 확인하세요.' }
    saveMeta({ dataVersion: result.dataVersion, revision: result.revision ?? null, txOffset: result.txTotal, lastRowId: result.lastRowId ?? null })
    return { ok: true, notice: invalid > 0 ? `시트에 형식이 잘못된 행 ${invalid}개는 받지 않았습니다. 시트를 직접 고치지 마세요.` : '' }
  }

  const runSync = async () => {
    const current = config()
    if (!current) return getStatus()
    const startGeneration = generation
    const isCurrent = () => generation === startGeneration
    const client = createClient(current)
    setStatus({ state: 'syncing', message: '' })
    try {
      const steps = [meta().pendingReplace ? replaceRemote : null, pushOutbox, pullRemote].filter(Boolean)
      let notice = ''
      for (const step of steps) {
        const result = await step(client, isCurrent)
        if (result === ABORTED) return getStatus()
        if (!result.ok) {
          failWith(result)
          return getStatus()
        }
        notice = result.notice || notice
      }
      setStatus({ state: 'ok', message: notice, conflict: false, lastSyncAt: now() })
    } catch (error) {
      console.error('동기화 실패:', error)
      if (isCurrent()) failWith({ code: 'CLIENT_ERROR', error: error.message || '동기화 중 오류가 났습니다.' })
    }
    return getStatus()
  }

  // 동기화가 진행 중이면 끝난 뒤 한 번 더 돌려서 그 사이 변경도 보낸다
  const runLoop = () => {
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      let result
      do {
        rerun = false
        result = await runSync()
      } while (rerun)
      return result
    })().finally(() => {
      running = null
    })
    return running
  }

  // background: 주기·자동 동기화. 숨겨진 탭은 쉬고, 여러 탭 중 한 탭만 돌린다.
  const syncNow = async ({ background = false } = {}) => {
    if (background && typeof document !== 'undefined' && document.hidden) return getStatus()
    const result = await withSyncLeader(runLoop, { waitForLock: !background })
    return result ?? getStatus()
  }

  const testConnection = async (input) => {
    const checked = validateSyncConfig(input)
    if (!checked.ok) return { ok: false, errors: checked.errors, error: Object.values(checked.errors)[0] }
    return createClient(checked.value).request('ping')
  }

  const disconnect = () => {
    generation += 1
    writeJson(kv, SYNC_KEYS.config, null)
    writeJson(kv, SYNC_KEYS.outbox, null)
    writeJson(kv, SYNC_KEYS.meta, null)
    setStatus({ state: 'idle', message: '', rejected: [], conflict: false })
  }

  // mode: upload(이 기기 데이터로 시트를 바꿈) · download(시트 데이터로 이 기기를 바꿈) · merge(양쪽을 합침)
  // 연결 중 실패하면 연결을 되돌리고 이 기기 데이터는 그대로 둔다
  const connect = async (input, mode) => {
    const ping = await testConnection(input)
    if (!ping.ok) return ping
    writeJson(kv, SYNC_KEYS.config, validateSyncConfig(input).value)
    saveOutbox(mode === 'merge' ? allEntities(store.getState()) : EMPTY_OUTBOX)
    writeJson(kv, SYNC_KEYS.meta, { ...EMPTY_META, pendingReplace: mode === 'upload', forceReplace: mode === 'upload' })
    const result = await syncNow()
    if (result.state === 'ok') return { ok: true }
    const error = result.message
    disconnect()
    return { ok: false, error }
  }

  // 전체 바꾸기 충돌 후: download는 내 바꾸기를 취소하고 시트 전체를 받는다, overwrite는 그래도 덮어쓴다
  const resolveConflict = (mode) => {
    if (mode === 'download') saveMeta({ pendingReplace: false, forceReplace: false, dataVersion: null, txOffset: 0, lastRowId: null })
    else saveMeta({ pendingReplace: true, forceReplace: true })
    setStatus({ conflict: false })
    return syncNow()
  }

  const onOnline = () => syncNow({ background: true })
  const onVisible = () => {
    if (document.visibilityState === 'visible') syncNow({ background: true })
  }

  // 브라우저에서만 부른다: 주기적 동기화와 온라인 복귀·화면 복귀 시 동기화
  const start = () => {
    if (timers) return
    timers = { interval: setInterval(() => syncNow({ background: true }), INTERVAL_MS), debounce: null }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    syncNow({ background: true })
  }

  const stop = () => {
    if (!timers) return
    clearInterval(timers.interval)
    clearTimeout(timers.debounce)
    timers = null
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }

  return {
    getStatus,
    getConfig: config,
    subscribe,
    recordLocalChange,
    syncNow,
    testConnection,
    connect,
    disconnect,
    resolveConflict,
    start,
    stop,
  }
}
