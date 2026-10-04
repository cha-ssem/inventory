import { validateSyncConfig } from './config.js'
import { EMPTY_OUTBOX, ackBatch, enqueueChange, outboxSize, takeBatch } from './outbox.js'
import { mergeRemote } from './merge.js'

export const SYNC_KEYS = Object.freeze({
  config: 'samkwang-inventory:sync-config',
  outbox: 'samkwang-inventory:sync-outbox',
  meta: 'samkwang-inventory:sync-meta',
})

const BATCH_SIZE = 500
const INTERVAL_MS = 30_000
const DEBOUNCE_MS = 800
const EMPTY_META = Object.freeze({ dataVersion: null, txOffset: 0, pendingReplace: false })

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

// 보낼 목록·연결 정보·진행 상태는 kv(localStorage)에 두어 새로고침하거나 다른 탭에서도 이어진다
export const createSyncEngine = ({ store, kv, createClient, now = () => new Date().toISOString() }) => {
  let status = { state: 'idle', message: '', lastSyncAt: null, rejected: [] }
  let running = null
  let rerun = false
  let timers = null
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
    timers.debounce = setTimeout(() => syncNow(), DEBOUNCE_MS)
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
    const offline = result.code === 'NETWORK'
    setStatus({ state: offline ? 'offline' : 'error', message: offline ? '오프라인: 연결되면 자동으로 보냅니다.' : result.error })
    return result
  }

  const replaceRemote = async (client) => {
    const state = store.getState()
    const result = await client.request('replaceAll', allEntities(state))
    if (!result.ok) return result
    saveOutbox(EMPTY_OUTBOX)
    saveMeta({ dataVersion: result.dataVersion, txOffset: state.transactions.length, pendingReplace: false })
    return result
  }

  const pushOutbox = async (client) => {
    while (outboxSize(outbox()) > 0) {
      const batch = takeBatch(outbox(), BATCH_SIZE)
      const result = await client.request('push', batch)
      if (!result.ok) return result
      const handled = [...result.acceptedIds, ...result.duplicateIds, ...result.rejected.map((r) => r.id)]
      saveOutbox(ackBatch(outbox(), { txIds: handled, partNos: batch.parts.map((p) => p.partNo), sentParts: batch.parts }))
      const rejected = [...result.rejected, ...result.rejectedParts]
      if (rejected.length > 0) status = { ...status, rejected: [...status.rejected, ...rejected].slice(-50) }
    }
    return { ok: true }
  }

  const pullRemote = async (client) => {
    const { dataVersion, txOffset } = meta()
    const result = await client.request('pull', { dataVersion, txOffset })
    if (!result.ok) return result
    const merged = mergeRemote(store.getState(), result, outbox())
    if (merged.changed) store.applyRemote(merged.state)
    saveMeta({ dataVersion: result.dataVersion, txOffset: result.txTotal })
    return result
  }

  const runSync = async () => {
    const current = config()
    if (!current) return getStatus()
    const client = createClient(current)
    setStatus({ state: 'syncing', message: '' })
    const steps = [meta().pendingReplace ? replaceRemote : null, pushOutbox, pullRemote].filter(Boolean)
    for (const step of steps) {
      const result = await step(client)
      if (!result.ok) {
        failWith(result)
        return getStatus()
      }
    }
    setStatus({ state: 'ok', message: '', lastSyncAt: now() })
    return getStatus()
  }

  // 동기화가 진행 중이면 끝난 뒤 한 번 더 돌려서 그 사이 변경도 보낸다
  const syncNow = () => {
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

  const testConnection = async (input) => {
    const checked = validateSyncConfig(input)
    if (!checked.ok) return { ok: false, errors: checked.errors, error: Object.values(checked.errors)[0] }
    return createClient(checked.value).request('ping')
  }

  // mode: upload(이 기기 데이터로 시트를 바꿈) · download(시트 데이터로 이 기기를 바꿈) · merge(양쪽을 합침)
  const connect = async (input, mode) => {
    const ping = await testConnection(input)
    if (!ping.ok) return ping
    const checked = validateSyncConfig(input).value
    writeJson(kv, SYNC_KEYS.config, checked)
    saveOutbox(mode === 'merge' ? allEntities(store.getState()) : EMPTY_OUTBOX)
    saveMeta({ ...EMPTY_META, pendingReplace: mode === 'upload' })
    if (mode === 'download') store.applyRemote({ parts: [], transactions: [] })
    const result = await syncNow()
    return result.state === 'ok' ? { ok: true } : { ok: false, error: result.message }
  }

  const disconnect = () => {
    writeJson(kv, SYNC_KEYS.config, null)
    writeJson(kv, SYNC_KEYS.outbox, null)
    writeJson(kv, SYNC_KEYS.meta, null)
    setStatus({ state: 'idle', message: '', rejected: [] })
  }

  const onOnline = () => syncNow()
  const onVisible = () => {
    if (document.visibilityState === 'visible') syncNow()
  }

  // 브라우저에서만 부른다: 주기적 동기화와 온라인 복귀·화면 복귀 시 동기화
  const start = () => {
    if (timers) return
    timers = { interval: setInterval(() => syncNow(), INTERVAL_MS), debounce: null }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    syncNow()
  }

  const stop = () => {
    if (!timers) return
    clearInterval(timers.interval)
    clearTimeout(timers.debounce)
    timers = null
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }

  return { getStatus, getConfig: config, subscribe, recordLocalChange, syncNow, testConnection, connect, disconnect, start, stop }
}
