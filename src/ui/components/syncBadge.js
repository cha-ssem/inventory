const LABELS = {
  idle: { text: '시트 연결됨', kind: 'ok' },
  ok: { text: '시트 연결됨', kind: 'ok' },
  syncing: { text: '동기화 중', kind: 'busy' },
  offline: { text: '오프라인', kind: 'warn' },
  error: { text: '동기화 오류', kind: 'error' },
}

// 상단 메뉴 오른쪽의 동기화 상태 표시. 연결하지 않았으면 숨긴다.
export const renderSyncBadge = (status) => {
  const el = document.getElementById('sync-badge')
  if (!el) return
  el.hidden = !status.connected
  if (!status.connected) return
  const label = LABELS[status.state] || LABELS.idle
  el.className = `sync-badge sync-${label.kind}`
  el.textContent = status.pending > 0 ? `${label.text} · 보낼 ${status.pending}건` : label.text
  el.title = status.message || '구글 시트 동기화 상태 (누르면 설정으로 이동)'
  el.dataset.state = status.state
}
