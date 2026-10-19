import { completeInspection } from '../../data/inspectionActions.js'
import { MODEL_PARTS } from '../../data/youngpoongCatalog.js'
import { INSPECTION_LIMITS, RESULTS } from '../../domain/inspection/constants.js'
import { formatNumber, html, qs, qsa } from '../dom.js'
import { option } from '../inspectionFormat.js'
import { actorField, formButtons, openFormModal } from './inspectionForms.js'

// 이 로봇 모델에 자주 쓰는 부품을 먼저, 그 밖의 사용 중인 부품은 뒤에 둔다
const partChoices = (store, model) => {
  const stock = store.getStockMap()
  const active = store.getState().parts.filter((p) => p.active !== false)
  const preferred = MODEL_PARTS[model] ?? []
  const rank = (p) => (preferred.includes(p.partNo) ? preferred.indexOf(p.partNo) : preferred.length)
  return [...active]
    .sort((a, b) => rank(a) - rank(b) || a.partNo.localeCompare(b.partNo))
    .map((p) => ({ partNo: p.partNo, label: `${p.partNo} ${p.name} (재고 ${formatNumber(stock.get(p.partNo) || 0)})` }))
}

const partRow = (choices) => html`<div class="used-part-row">
  <select class="input" name="usedPartNo" aria-label="사용 부품">${option('', '부품 고르기', '')}${choices.map((c) => option(c.partNo, c.label, ''))}</select>
  <input class="input qty" type="number" name="usedQty" min="1" value="1" aria-label="사용 수량" />
  <button type="button" class="btn-icon" data-remove-part aria-label="이 부품 빼기">✕</button>
</div>`

const readUsedParts = (form) => {
  const rows = qsa(form, '.used-part-row')
  return rows
    .map((row) => ({ partNo: qs(row, '[name="usedPartNo"]').value, qty: qs(row, '[name="usedQty"]').value }))
    .filter((u) => u.partNo)
}

export const openCompleteForm = ({ store, inspection, request, robot, onDone }) => {
  const choices = partChoices(store, robot?.model)
  openFormModal({
    title: '점검 완료',
    content: html`<p class="confirm-message">${request.title}</p>
      <div class="field">
        <label for="cp-result">점검 결과 *</label>
        <select class="input" id="cp-result" name="result">${option('', '고르세요', '')}${Object.entries(RESULTS).map(([k, v]) => option(k, v, ''))}</select>
      </div>
      <div class="field">
        <label for="cp-findings">점검 내용</label>
        <textarea class="input" id="cp-findings" name="findings" rows="3" maxlength="${INSPECTION_LIMITS.maxNote}" placeholder="예: 수면 아래 1.2m 지점 균열 폭 0.3mm"></textarea>
      </div>
      <div class="field">
        <label for="cp-actions">조치 내용</label>
        <textarea class="input" id="cp-actions" name="actions" rows="2" maxlength="${INSPECTION_LIMITS.maxNote}" placeholder="예: 추진기 모듈 교체"></textarea>
      </div>
      <fieldset class="used-parts">
        <legend>사용 부품 <span class="muted">(완료하면 재고에서 출고됩니다)</span></legend>
        <div class="used-part-list"></div>
        <button type="button" class="btn btn-sm" data-add-part>+ 부품 추가</button>
      </fieldset>
      ${actorField('cp-actor')} ${formButtons('완료')}`,
    onMount: (form) => {
      const list = qs(form, '.used-part-list')
      form.addEventListener('click', (event) => {
        if (event.target.closest('[data-add-part]')) {
          if (qsa(list, '.used-part-row').length >= INSPECTION_LIMITS.maxUsedParts) return
          list.insertAdjacentHTML('beforeend', String(partRow(choices)))
          qsa(list, '[name="usedPartNo"]').at(-1).focus()
        }
        event.target.closest('[data-remove-part]')?.closest('.used-part-row').remove()
      })
    },
    save: ({ actor, result, findings, actions }, form) =>
      completeInspection({ store, inspection }, request.requestId, { result, findings, actions, usedParts: readUsedParts(form) }, actor),
    successMessage: '점검을 완료했습니다.',
    onDone,
  })
}
