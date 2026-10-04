import { STORAGE_KEY, createStorage, getBrowserStorageBackend } from './data/storage.js'
import { createStore } from './data/store.js'
import { createSyncClient } from './sync/client.js'
import { SYNC_KEYS, createSyncEngine } from './sync/engine.js'
import { closeActiveModal, toast } from './ui/feedback.js'
import { renderSyncBadge } from './ui/components/syncBadge.js'
import { renderDashboard } from './ui/views/dashboard.js'
import { renderHistory } from './ui/views/historyView.js'
import { renderLabels } from './ui/views/labelsView.js'
import { renderParts } from './ui/views/partsView.js'
import { createScanView } from './ui/views/scanView.js'
import { renderSettings } from './ui/views/settingsView.js'
import { renderStock } from './ui/views/stockView.js'

const routes = {
  '/': renderDashboard,
  '/inbound': createScanView('IN'),
  '/outbound': createScanView('OUT'),
  '/stock': renderStock,
  '/history': renderHistory,
  '/parts': renderParts,
  '/labels': renderLabels,
  '/settings': renderSettings,
}

const NAV_PARENT = { '/labels': '/parts' }

const parseHash = () => {
  const [path, search = ''] = (window.location.hash.slice(1) || '/').split('?')
  return { path: routes[path] ? path : '/', query: new URLSearchParams(search) }
}

const navigate = (path) => {
  window.location.hash = `#${path}`
}

const highlightNav = (path) => {
  const active = NAV_PARENT[path] || path
  document.querySelectorAll('.app-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === active)
    if (a.dataset.route === active) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
}

const start = () => {
  const backend = getBrowserStorageBackend()
  const engineRef = {}
  const store = createStore({
    storage: createStorage(backend),
    onLocalChange: (change) => engineRef.sync?.recordLocalChange(change),
  })
  const sync = createSyncEngine({ store, kv: backend, createClient: (config) => createSyncClient(config) })
  engineRef.sync = sync
  const app = document.getElementById('app')
  let cleanup = null

  const render = () => {
    closeActiveModal()
    cleanup?.()
    const { path, query } = parseHash()
    // 화면마다 새 요소를 써서 이전 화면의 이벤트가 남지 않게 한다
    const view = document.createElement('div')
    app.replaceChildren(view)
    highlightNav(path)
    try {
      cleanup = routes[path](view, { store, sync, query, navigate }) || null
    } catch (error) {
      console.error('화면을 그리지 못했습니다:', error)
      view.textContent = '화면을 표시하는 중 문제가 생겼습니다. 새로고침해 주세요.'
      cleanup = null
    }
    window.scrollTo(0, 0)
  }

  window.addEventListener('hashchange', render)
  // 다른 탭에서 저장하면 이 탭의 화면도 최신 데이터로 다시 그린다
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) store.reload()
    if (Object.values(SYNC_KEYS).includes(event.key)) renderSyncBadge(sync.getStatus())
  })
  render()
  sync.subscribe(renderSyncBadge)
  renderSyncBadge(sync.getStatus())
  sync.start()
  if (!backend) toast('이 브라우저에서는 데이터를 저장할 수 없습니다. 창을 닫으면 내용이 사라집니다.', 'warning')
}

start()
