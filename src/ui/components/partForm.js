import { CATEGORY_LABELS, categoryChoices, suggestFromName } from '../../domain/partNo.js'
import { LIMITS } from '../../domain/validation.js'
import { formValues, html, raw, setHtml, showFieldErrors } from '../dom.js'
import { notifyResult, openModal } from '../feedback.js'

const field = ({ name, label, value = '', hint = '', required = false, attrs = '' }) => html`
  <div class="field">
    <label for="pf-${name}">${label}${required ? ' *' : ''}</label>
    <input class="input" id="pf-${name}" name="${name}" value="${value}" ${raw(attrs)} />
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
    <span class="error" data-error-for="${name}"></span>
  </div>
`

// 제안 품번의 이유와, 다른 분류로 바꾸는 단추
const suggestionNote = (suggestion) => html`<div class="part-suggestion" data-testid="part-suggestion">
  <span>💡 제안 품번 <strong class="mono">${suggestion.partNo}</strong>: ${suggestion.reason}</span>
  ${suggestion.alternatives.map((alt) => html`<button type="button" class="btn btn-sm" data-suggest="${alt.partNo}">${alt.partNo}${CATEGORY_LABELS[alt.category] ? ` (${CATEGORY_LABELS[alt.category]})` : ''}로 바꾸기</button>`)}
</div>`

// 부품 관리용: 품명을 입력할 때마다 바뀌는 제안과, 분류별 다음 번호 단추
const liveNoteContent = (suggestion, choices) => html`
  <span>${suggestion
    ? html`💡 ${suggestion.reason} 제안 품번 <strong class="mono">${suggestion.partNo}</strong>`
    : '💡 품명을 입력하면 품번을 제안합니다. 아래에서 분류를 직접 골라도 됩니다.'}</span>
  <span class="muted">분류별 다음 번호</span>
  ${choices.map((c) => html`<button type="button" class="btn btn-sm" data-suggest="${c.partNo}">${c.partNo} ${c.label}</button>`)}`

const formContent = (part, initialPartNo, editing, suggestion, live) => html`
  <form class="part-form" novalidate>
    ${suggestion ? suggestionNote(suggestion) : ''}
    ${live ? html`<div class="part-suggestion" data-testid="part-suggestion" data-live>${liveNoteContent(null, live.choices)}</div>` : ''}
    <div class="form-grid">
      ${editing
        ? html`<div class="field">
            <label>품번</label>
            <div class="input mono" aria-readonly="true">${part.partNo}</div>
            <span class="hint">품번은 바꿀 수 없습니다.</span>
          </div>`
        : field({
            name: 'partNo',
            label: '품번',
            value: initialPartNo,
            required: true,
            hint: '영문 대문자, 숫자, 하이픈. 예: SK-AD-001',
            attrs: `maxlength="${LIMITS.maxPartNo}" autocomplete="off" autofocus`,
          })}
      ${field({ name: 'name', label: '품명', value: part?.name, required: true, attrs: `maxlength="${LIMITS.maxText}"` })}
      ${field({ name: 'spec', label: '규격', value: part?.spec, attrs: `maxlength="${LIMITS.maxText}"` })}
      ${field({ name: 'unit', label: '단위', value: part?.unit ?? 'EA', required: true, hint: 'EA, BOX, BAG, KG 등', attrs: `maxlength="${LIMITS.maxText}" list="unit-options"` })}
      ${field({ name: 'safetyStock', label: '안전재고', value: part?.safetyStock ?? 0, hint: '이보다 적으면 부족으로 표시', attrs: 'type="number" min="0" step="1" inputmode="numeric"' })}
      ${field({ name: 'location', label: '보관 위치', value: part?.location, hint: '예: A-01-03', attrs: `maxlength="${LIMITS.maxText}"` })}
    </div>
    <datalist id="unit-options">
      <option value="EA"></option>
      <option value="BOX"></option>
      <option value="BAG"></option>
      <option value="KG"></option>
      <option value="SET"></option>
    </datalist>
    <div class="form-actions">
      <button type="button" class="btn" data-close>취소</button>
      <button type="submit" class="btn btn-primary">${editing ? '저장' : '등록'}</button>
    </div>
  </form>
`

// 부품 관리: 품번을 직접 고치기 전까지는 품명에 맞춰 제안 품번을 채운다
const attachLiveSuggestion = (dialog, form, parts, choices, state) => {
  const note = dialog.querySelector('[data-live]')
  form.elements.name.addEventListener('input', () => {
    const suggestion = suggestFromName(form.elements.name.value, parts)
    setHtml(note, liveNoteContent(suggestion, choices))
    if (!state.partNoTouched) form.elements.partNo.value = suggestion?.partNo ?? ''
  })
  form.elements.partNo.addEventListener('input', () => {
    state.partNoTouched = true
  })
}

// part를 넘기면 수정, 없으면 새로 등록한다. initial: 새로 등록할 때 미리 채울 품명·규격·단위,
// suggestion: 제안 품번(domain/partNo.js의 suggestPartNo 결과). 둘 다 서류로 입고에서 쓴다.
// liveSuggest: 품명을 입력하면 품번을 제안한다 (부품 관리에서 씀)
export const openPartForm = ({ store, part = null, initialPartNo = '', initial = null, suggestion = null, liveSuggest = false, onSaved, onClose }) => {
  const editing = Boolean(part)
  const parts = store.getState().parts
  const live = liveSuggest && !editing ? { choices: categoryChoices(parts) } : null
  const state = { partNoTouched: false }
  openModal({
    title: editing ? `부품 수정 · ${part.partNo}` : '새 부품 등록',
    content: formContent(part ?? initial, suggestion?.partNo ?? initialPartNo, editing, editing ? null : suggestion, live),
    onClose,
    onMount: (dialog, close) => {
      const form = dialog.querySelector('form')
      // 제안 단추는 다시 그려지므로 창 전체에서 받는다. 고른 품번은 직접 고친 것으로 본다.
      dialog.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-suggest]')
        if (!btn) return
        form.elements.partNo.value = btn.dataset.suggest
        state.partNoTouched = true
        form.elements.partNo.focus()
      })
      if (live) attachLiveSuggestion(dialog, form, parts, live.choices, state)
      dialog.querySelector('form [data-close]').addEventListener('click', close)
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const values = formValues(form)
        const result = editing ? store.editPart(part.partNo, values) : store.addPart(values)
        if (!result.ok) {
          showFieldErrors(form, result.errors)
          if (result.error) notifyResult(result)
          return
        }
        notifyResult(result, editing ? '부품 정보를 저장했습니다.' : `${result.value.partNo} 부품을 등록했습니다.`)
        close()
        onSaved?.(result.value)
      })
    },
  })
}
