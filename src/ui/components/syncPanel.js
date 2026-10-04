import { formatDateTime } from '../../domain/dates.js'
import { formValues, formatNumber, html, qs, setHtml, showFieldErrors } from '../dom.js'
import { confirmDialog, notifyResult, openModal, toast } from '../feedback.js'

const STATE_LABELS = {
  idle: '대기',
  syncing: '동기화 중…',
  ok: '정상',
  offline: '오프라인 (연결되면 자동 전송)',
  error: '오류',
}

const maskUrl = (url) => url.replace(/(\/s\/.{6}).+(.{4}\/exec)$/, '$1…$2')

const connectForm = () => html`
  <form class="sync-form" novalidate>
    <p class="muted">구글 시트에 연결하면 여러 PC와 스마트폰이 같은 데이터를 함께 씁니다. 설치 방법은 <strong>phase2-setup.md</strong>를 보세요.</p>
    <div class="form-grid">
      <div class="field">
        <label for="sync-url">Apps Script 웹 앱 주소</label>
        <input id="sync-url" class="input mono" name="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" />
        <span class="error" data-error-for="url"></span>
      </div>
      <div class="field">
        <label for="sync-token">연결 토큰</label>
        <input id="sync-token" class="input mono" name="token" type="password" autocomplete="off" />
        <span class="error" data-error-for="token"></span>
      </div>
    </div>
    <p class="muted sync-test-result" data-testid="sync-test-result"></p>
    <div class="form-actions" style="justify-content:flex-start">
      <button type="button" class="btn" data-sync="test">연결 확인</button>
      <button type="submit" class="btn btn-primary">연결</button>
    </div>
  </form>
`

const connectedView = (status, config) => html`
  <dl class="sync-info" data-testid="sync-info">
    <div><dt>상태</dt><dd class="sync-state-${status.state}">${STATE_LABELS[status.state] || status.state}${status.message ? ` · ${status.message}` : ''}</dd></div>
    <div><dt>보낼 목록</dt><dd data-testid="sync-pending">${formatNumber(status.pending)}건</dd></div>
    <div><dt>마지막 동기화</dt><dd>${status.lastSyncAt ? formatDateTime(status.lastSyncAt) : '-'}</dd></div>
    <div><dt>연결 주소</dt><dd class="mono">${maskUrl(config?.url || '')}</dd></div>
  </dl>
  ${status.rejected.length > 0
    ? html`<p class="error">시트가 거부한 항목 ${status.rejected.length}건:</p>
        <ul class="error-list">${status.rejected.map((r) => html`<li>${r.id || r.partNo}: ${r.reason}</li>`)}</ul>`
    : ''}
  <div class="form-actions" style="justify-content:flex-start">
    <button type="button" class="btn btn-primary" data-sync="now">지금 동기화</button>
    <button type="button" class="btn btn-danger" data-sync="disconnect">연결 해제</button>
  </div>
`

// 양쪽 모두 데이터가 있을 때만 어떻게 맞출지 묻는다
const chooseMode = (local, remote) =>
  new Promise((resolve) => {
    const choice = (mode, label, desc, primary = false) => html`
      <button type="button" class="btn ${primary ? 'btn-primary' : ''} sync-choice" data-mode="${mode}">
        <strong>${label}</strong><span>${desc}</span>
      </button>`
    openModal({
      title: '데이터를 어떻게 맞출까요?',
      content: html`<p>이 기기: 부품 ${local.parts}개 · 기록 ${local.transactions}건<br />구글 시트: 부품 ${remote.parts}개 · 기록 ${remote.transactions}건</p>
        <div class="sync-choices">
          ${choice('download', '구글 시트 데이터로 시작', '이 기기 데이터는 지우고 시트 데이터를 받습니다.', true)}
          ${choice('upload', '이 기기 데이터로 시트를 덮어쓰기', '시트의 기존 데이터는 지워집니다.')}
          ${choice('merge', '양쪽 합치기', '서로 다른 데이터를 합칩니다. 같은 입고가 두 번 들어가지 않았는지 확인하세요.')}
        </div>`,
      onMount: (dialog, close) =>
        dialog.querySelectorAll('[data-mode]').forEach((btn) =>
          btn.addEventListener('click', () => {
            resolve(btn.dataset.mode)
            close()
          }),
        ),
      onClose: () => resolve(null),
    })
  })

const pickMode = async (store, ping) => {
  const { parts, transactions } = store.getState()
  const local = { parts: parts.length, transactions: transactions.length }
  if (local.parts + local.transactions === 0) return 'download'
  if (ping.parts + ping.transactions === 0) return 'upload'
  return chooseMode(local, ping)
}

export const mountSyncPanel = (el, { store, sync }) => {
  let busy = false

  const draw = () => {
    const status = sync.getStatus()
    setHtml(el, status.connected ? connectedView(status, sync.getConfig()) : connectForm())
  }

  const setButtonsDisabled = (disabled) =>
    el.querySelectorAll('button').forEach((b) => {
      b.disabled = disabled
    })

  // 연결 폼은 입력값과 확인 결과를 지키기 위해 다시 그리지 않고 단추만 다시 켠다
  const withBusy = async (fn) => {
    if (busy) return
    busy = true
    setButtonsDisabled(true)
    try {
      await fn()
    } finally {
      busy = false
      if (sync.getStatus().connected || !el.querySelector('.sync-form')) draw()
      else setButtonsDisabled(false)
    }
  }

  const testConnection = async (form) => {
    const result = await sync.testConnection(formValues(form))
    showFieldErrors(form, result.errors)
    qs(form, '.sync-test-result').textContent = result.ok
      ? `연결됨: "${result.sheet || '구글 시트'}" · 부품 ${result.parts}개 · 기록 ${result.transactions}건`
      : result.error
    return result
  }

  const connect = async (form) => {
    const values = formValues(form)
    const ping = await testConnection(form)
    if (!ping.ok) return
    const mode = await pickMode(store, ping)
    if (!mode) return
    const result = await sync.connect(values, mode)
    notifyResult(result, '구글 시트에 연결했습니다.')
  }

  const disconnect = async () => {
    const { pending } = sync.getStatus()
    const ok = await confirmDialog({
      title: '연결 해제',
      message: pending > 0
        ? `아직 시트로 보내지 못한 변경이 ${pending}건 있습니다.\n연결을 해제하면 이 변경은 시트로 보내지지 않습니다. (이 기기 데이터는 남습니다)`
        : '구글 시트 연결을 해제할까요? 이 기기 데이터는 그대로 남습니다.',
      confirmLabel: '연결 해제',
      danger: true,
    })
    if (ok) {
      sync.disconnect()
      draw()
      toast('구글 시트 연결을 해제했습니다.', 'info')
    }
  }

  el.addEventListener('click', (event) => {
    const action = event.target.closest('[data-sync]')?.dataset.sync
    const form = el.querySelector('.sync-form')
    if (action === 'test') withBusy(() => testConnection(form))
    if (action === 'now') withBusy(() => sync.syncNow())
    if (action === 'disconnect') disconnect()
  })
  el.addEventListener('submit', (event) => {
    event.preventDefault()
    withBusy(() => connect(event.target))
  })

  draw()
  // 연결 폼을 입력하는 중에는 다시 그리지 않는다 (입력값이 지워지지 않도록)
  return sync.subscribe(() => {
    if (!busy && sync.getStatus().connected) draw()
  })
}
