import { formatDateTime } from '../../domain/dates.js'
import { findPart } from '../../domain/parts.js'
import { LIMITS, normalizePartNo } from '../../domain/validation.js'
import { formatNumber, formValues, html, qs, setHtml } from '../dom.js'
import { beep, notifyResult, toast } from '../feedback.js'
import { openCameraScanner } from '../components/cameraScanner.js'
import { openCancelDialog } from '../components/cancelDialog.js'
import { openPartForm } from '../components/partForm.js'
import { errorCard, idleCard, selectedCard, successCard, unknownCard } from './scanCards.js'

const CONFIG = {
  IN: { label: '입고', sign: '+', partnerLabel: '거래처', partnerHint: '예: 대한수지', record: 'recordInbound', boxClass: '' },
  OUT: { label: '출고', sign: '-', partnerLabel: '사용처', partnerHint: '예: 사출 1라인', record: 'recordOutbound', boxClass: 'is-out' },
}

const INTERACTIVE = 'input, select, textarea, button, a, label'

const recentPartners = (transactions, type) =>
  [...new Set([...transactions].reverse().filter((t) => t.type === type && t.partner).map((t) => t.partner))].slice(0, 20)

const layout = (cfg, partners) => html`
  <div class="page-head"><h1>${cfg.label}</h1></div>
  <div class="scan-layout">
    <section class="panel scan-box ${cfg.boxClass}">
      <form class="scan-form" data-testid="scan-form" autocomplete="off">
        <label for="scan-input" class="field"><strong>바코드 / 품번</strong></label>
        <div class="scan-row">
          <input id="scan-input" class="scan-input" name="code" placeholder="스캔하거나 품번 입력 후 Enter" maxlength="${LIMITS.maxPartNo}" autofocus />
          <button type="button" class="btn" data-action="camera" title="카메라로 스캔" aria-label="카메라로 스캔">📷</button>
        </div>
        <div class="scan-status" data-testid="scan-status">스캐너 대기 중</div>
      </form>
      <div class="result-area"></div>
      <form class="options-form form-grid" novalidate>
        <div class="field">
          <label for="opt-qty">수량</label>
          <input id="opt-qty" class="input" name="qty" type="number" min="1" step="1" value="1" inputmode="numeric" />
        </div>
        <div class="field">
          <label for="opt-partner">${cfg.partnerLabel}</label>
          <input id="opt-partner" class="input" name="partner" list="partner-options" maxlength="${LIMITS.maxText}" placeholder="${cfg.partnerHint}" />
        </div>
        <div class="field">
          <label for="opt-worker">작업자</label>
          <input id="opt-worker" class="input" name="worker" maxlength="${LIMITS.maxText}" placeholder="예: 김자재" />
        </div>
        <div class="field">
          <label for="opt-memo">메모</label>
          <input id="opt-memo" class="input" name="memo" maxlength="${LIMITS.maxMemo}" />
        </div>
        <datalist id="partner-options">${partners.map((p) => html`<option value="${p}"></option>`)}</datalist>
      </form>
      <label class="check"><input type="checkbox" data-action="continuous" /> 연속 스캔 모드 (같은 바코드를 다시 찍으면 수량 +1)</label>
      <button type="button" class="btn btn-primary btn-submit" data-action="submit">입력</button>
    </section>
    <aside class="panel">
      <div class="panel-head"><h2>이번 작업 기록</h2><a href="#/history">전체 이력</a></div>
      <div class="session-area"></div>
    </aside>
  </div>
`

const sessionList = (txs, partsByNo, cancelledIds) =>
  txs.length === 0
    ? html`<div class="empty">아직 기록이 없습니다.</div>`
    : html`<ul class="session-list" data-testid="session-list">
        ${txs.map((t) => html`<li>
          <span>
            <strong class="mono">${t.partNo}</strong> ${partsByNo.get(t.partNo)?.name || ''}<br />
            <span class="muted">${formatDateTime(t.createdAt)} · ${formatNumber(t.qty)}개${t.partner ? ` · ${t.partner}` : ''}${t.worker ? ` · ${t.worker}` : ''}</span>
          </span>
          ${cancelledIds.has(t.id)
            ? html`<span class="badge badge-CANCEL">취소됨</span>`
            : html`<button type="button" class="btn btn-sm" data-cancel="${t.id}">취소</button>`}
        </li>`)}
      </ul>`

// 스캔·Enter는 부품을 고르기만 하고, 저장은 [입력] 단추로만 한다
export const createScanView = (type) => (container, { store }) => {
  const cfg = CONFIG[type]
  let continuous = false
  let selectedPartNo = null
  let sessionIds = []

  setHtml(container, layout(cfg, recentPartners(store.getState().transactions, type)))
  const scanInput = qs(container, '#scan-input')
  const optionsForm = qs(container, '.options-form')
  const qtyInput = optionsForm.elements.qty
  const resultArea = qs(container, '.result-area')
  const sessionArea = qs(container, '.session-area')
  const status = qs(container, '[data-testid="scan-status"]')

  const focusScan = () => scanInput.focus()
  const showCard = (card) => setHtml(resultArea, card)
  const stockOf = (partNo) => store.getStockMap().get(partNo) || 0
  const showError = (card) => {
    beep('error')
    showCard(card)
  }

  const drawSession = () => {
    const { parts, transactions } = store.getState()
    const byId = new Map(transactions.map((t) => [t.id, t]))
    const cancelled = new Set(transactions.filter((t) => t.type === 'CANCEL').map((t) => t.refId))
    const txs = sessionIds.map((id) => byId.get(id)).filter(Boolean).reverse()
    setHtml(sessionArea, sessionList(txs, new Map(parts.map((p) => [p.partNo, p])), cancelled))
  }

  const clearSelection = () => {
    selectedPartNo = null
    showCard(idleCard(cfg.label))
  }

  // 같은 부품을 다시 찍으면(연속 모드) 수량 +1. 출고는 현재고를 넘지 않게 한다.
  const increaseQty = (part) => {
    const next = (Number.parseInt(qtyInput.value, 10) || 0) + 1
    if (type === 'OUT' && next > stockOf(part.partNo)) {
      showError(errorCard(`현재고(${formatNumber(stockOf(part.partNo))})보다 많이 출고할 수 없습니다. 지금 수량 그대로 [입력]을 누르세요.`))
      return
    }
    qtyInput.value = String(next)
    beep('success')
    showCard(selectedCard({ part, stock: stockOf(part.partNo), label: cfg.label }))
  }

  // 고를 수 없는 부품이면 보여줄 카드를, 고를 수 있으면 null을 돌려준다
  const rejectionCard = (code, part) => {
    if (!part) return unknownCard(code)
    if (part.active === false) return errorCard(`사용 중지된 부품입니다: ${code}`)
    if (type === 'OUT' && stockOf(code) < 1) return errorCard(`${code}는 현재고가 0이라 출고할 수 없습니다.`)
    return null
  }

  const selectPart = (rawCode) => {
    const code = normalizePartNo(rawCode)
    if (!code) return false
    const part = findPart(store.getState().parts, code)
    const rejection = rejectionCard(code, part)
    if (rejection) {
      showError(rejection)
      return false
    }

    if (continuous && selectedPartNo === code) {
      increaseQty(part)
      return true
    }
    if (selectedPartNo && selectedPartNo !== code) toast(`${selectedPartNo}는 [입력]하지 않고 ${code}로 바뀌었습니다.`, 'warning')
    if (continuous) qtyInput.value = '1'
    selectedPartNo = code
    beep('success')
    showCard(selectedCard({ part, stock: stockOf(code), label: cfg.label }))
    return true
  }

  const submit = () => {
    // 품번을 입력만 하고 Enter를 누르지 않았으면 먼저 고른다
    const typed = scanInput.value
    scanInput.value = ''
    if (typed.trim() && !selectPart(typed)) return
    if (!selectedPartNo) return showError(errorCard('바코드를 스캔하거나 품번을 입력한 뒤 [입력]을 누르세요.'))

    const result = store[cfg.record]({ ...formValues(optionsForm), partNo: selectedPartNo })
    if (!result.ok) return showError(result.code === 'UNKNOWN_PART' ? unknownCard(result.partNo) : errorCard(result.error))

    const part = findPart(store.getState().parts, selectedPartNo)
    const low = type === 'OUT' && result.low
    selectedPartNo = null
    sessionIds = [...sessionIds, result.value.id]
    beep(low ? 'warning' : 'success')
    showCard(successCard({ label: cfg.label, part, qty: result.value.qty, after: result.after, low, sign: cfg.sign }))
    notifyResult({ ...result, error: undefined })
    qtyInput.value = '1'
    optionsForm.elements.memo.value = ''
    drawSession()
  }

  qs(container, '.scan-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const value = scanInput.value
    scanInput.value = ''
    selectPart(value)
    focusScan()
  })

  // 옵션 칸에서 Enter를 눌러도 저장하지 않고 스캔 칸으로 돌아간다
  optionsForm.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      focusScan()
    }
  })

  scanInput.addEventListener('focus', () => {
    status.textContent = '스캐너 입력 대기 중 ●'
    status.classList.add('is-active')
  })
  scanInput.addEventListener('blur', () => {
    status.textContent = '스캔하려면 여기를 클릭하세요'
    status.classList.remove('is-active')
  })

  const registerPart = (partNo) =>
    openPartForm({
      store,
      initialPartNo: partNo,
      onSaved: (part) => {
        if (type === 'IN') selectPart(part.partNo)
        else showCard(errorCard(`${part.partNo}를 등록했습니다. 재고가 0이므로 먼저 입고하세요.`))
        focusScan()
      },
    })

  const actions = {
    submit: () => {
      submit()
      focusScan()
    },
    camera: () =>
      openCameraScanner({
        onDetected: (text) => {
          selectPart(text)
          focusScan()
        },
      }),
    clear: () => {
      clearSelection()
      focusScan()
    },
    register: (el) => registerPart(el.dataset.partNo),
  }

  container.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]')
    const cancelEl = event.target.closest('[data-cancel]')
    if (actionEl && actions[actionEl.dataset.action]) {
      actions[actionEl.dataset.action](actionEl)
    } else if (cancelEl) {
      openCancelDialog({
        store,
        txId: cancelEl.dataset.cancel,
        onDone: () => {
          drawSession()
          focusScan()
        },
      })
    } else if (!event.target.closest(INTERACTIVE)) {
      focusScan()
    }
  })

  qs(container, '[data-action="continuous"]').addEventListener('change', (event) => {
    continuous = event.target.checked
    focusScan()
  })

  showCard(idleCard(cfg.label))
  drawSession()
  focusScan()
  return null
}
