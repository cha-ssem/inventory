import { html, setHtml } from './dom.js'

const TOAST_MS = 3500

export const toast = (message, kind = 'info') => {
  const host = document.getElementById('toasts')
  if (!host) return
  const el = document.createElement('div')
  el.className = `toast toast-${kind}`
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  el.textContent = message
  host.appendChild(el)
  setTimeout(() => el.remove(), TOAST_MS)
}

let audioCtx = null

const tone = (frequency, startOffset, duration) => {
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.frequency.value = frequency
  osc.type = 'square'
  gain.gain.value = 0.05
  osc.connect(gain).connect(audioCtx.destination)
  const start = audioCtx.currentTime + startOffset
  osc.start(start)
  osc.stop(start + duration)
}

// 스캔 결과를 소리로 알린다. 소리를 낼 수 없는 환경이면 조용히 넘어간다.
export const beep = (kind = 'success') => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (kind === 'success') {
      tone(1320, 0, 0.08)
    } else if (kind === 'warning') {
      tone(880, 0, 0.1)
      tone(880, 0.15, 0.1)
    } else {
      tone(220, 0, 0.25)
    }
  } catch {
    // 소리 재생 실패는 기능에 영향이 없다
  }
}

const closeModal = (host) => {
  host.hidden = true
  setHtml(host, '')
}

let activeClose = null

// 화면을 바꿀 때 열려 있는 모달을 닫는다 (사라진 화면에 기록하지 않도록)
export const closeActiveModal = () => activeClose?.()

// content: html`` 결과. onMount(dialogEl, close)로 이벤트를 연결한다. 모달은 한 번에 하나만 연다.
export const openModal = ({ title, content, onMount, onClose, wide = false }) => {
  closeActiveModal()
  const host = document.getElementById('modal')
  const previousFocus = document.activeElement
  setHtml(
    host,
    html`<div class="modal-backdrop" data-close></div>
      <div class="modal-dialog ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${title}</h2>
          <button type="button" class="btn-icon" data-close aria-label="닫기">✕</button>
        </div>
        <div class="modal-body">${content}</div>
      </div>`,
  )
  host.hidden = false
  const dialog = host.querySelector('.modal-dialog')
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    activeClose = null
    document.removeEventListener('keydown', onKey)
    closeModal(host)
    previousFocus?.focus?.()
    onClose?.()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey)
  activeClose = close
  host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close))
  onMount?.(dialog, close)
  const firstField = dialog.querySelector('[autofocus], input, select, textarea, button.btn-primary')
  firstField?.focus()
  return close
}

// 닫기 버튼·Esc로 닫으면 취소(false)로 본다
export const confirmDialog = ({ title, message, confirmLabel = '확인', danger = false }) =>
  new Promise((resolve) => {
    openModal({
      title,
      content: html`<p class="confirm-message">${message}</p>
        <div class="form-actions">
          <button type="button" class="btn" data-answer="no">취소</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${confirmLabel}</button>
        </div>`,
      onMount: (dialog, close) => {
        dialog.querySelectorAll('[data-answer]').forEach((btn) =>
          btn.addEventListener('click', () => {
            resolve(btn.dataset.answer === 'yes')
            close()
          }),
        )
      },
      onClose: () => resolve(false),
    })
  })

export const notifyResult = (result, successMessage) => {
  if (result.warning) toast(result.warning, 'warning')
  if (result.ok && successMessage) toast(successMessage, 'success')
  if (!result.ok && result.error) toast(result.error, 'error')
}
