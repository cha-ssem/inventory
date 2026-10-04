import { formatDateTime } from '../../domain/dates.js'
import { TX_LABELS } from '../../domain/transactions.js'
import { LIMITS } from '../../domain/validation.js'
import { formValues, formatNumber, html } from '../dom.js'
import { notifyResult, openModal } from '../feedback.js'

export const openCancelDialog = ({ store, txId, onDone }) => {
  const tx = store.getState().transactions.find((t) => t.id === txId)
  if (!tx) return
  openModal({
    title: '입출고 기록 취소',
    content: html`<form novalidate>
      <p class="confirm-message">
        ${formatDateTime(tx.createdAt)} · ${TX_LABELS[tx.type]} · <strong class="mono">${tx.partNo}</strong> ·
        ${formatNumber(tx.qty)}개
      </p>
      <p class="muted">기록을 지우지 않고 "취소" 기록을 새로 남깁니다. 재고는 취소한 만큼 되돌아갑니다.</p>
      <div class="field">
        <label for="cancel-memo">취소 사유</label>
        <input class="input" id="cancel-memo" name="memo" maxlength="${LIMITS.maxMemo}" placeholder="예: 수량 착오" autofocus />
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-dismiss>닫기</button>
        <button type="submit" class="btn btn-danger">기록 취소</button>
      </div>
    </form>`,
    onMount: (dialog, close) => {
      const form = dialog.querySelector('form')
      dialog.querySelector('[data-dismiss]').addEventListener('click', close)
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const result = store.cancelTransaction(txId, formValues(form))
        notifyResult(result, '기록을 취소했습니다.')
        if (result.ok) {
          close()
          onDone?.()
        }
      })
    },
  })
}
