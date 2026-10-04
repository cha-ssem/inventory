import { LIMITS } from '../../domain/validation.js'
import { formValues, html, raw, showFieldErrors } from '../dom.js'
import { notifyResult, openModal } from '../feedback.js'

const field = ({ name, label, value = '', hint = '', required = false, attrs = '' }) => html`
  <div class="field">
    <label for="pf-${name}">${label}${required ? ' *' : ''}</label>
    <input class="input" id="pf-${name}" name="${name}" value="${value}" ${raw(attrs)} />
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
    <span class="error" data-error-for="${name}"></span>
  </div>
`

const formContent = (part, initialPartNo, editing) => html`
  <form class="part-form" novalidate>
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

// part를 넘기면 수정, 없으면 새로 등록한다
export const openPartForm = ({ store, part = null, initialPartNo = '', onSaved }) => {
  const editing = Boolean(part)
  openModal({
    title: editing ? `부품 수정 · ${part.partNo}` : '새 부품 등록',
    content: formContent(part, initialPartNo, editing),
    onMount: (dialog, close) => {
      const form = dialog.querySelector('form')
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
