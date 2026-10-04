import { toCsv } from '../../domain/csv.js'
import { buildStockRows, searchStockRows } from '../../domain/stock.js'
import { downloadFile, formatNumber, html, qs, qsa, readFileAsText, setHtml } from '../dom.js'
import { confirmDialog, notifyResult, openModal, toast } from '../feedback.js'
import { openPartForm } from '../components/partForm.js'
import { labelsPath } from './labelsView.js'

const MAX_CSV_BYTES = 2 * 1024 * 1024

const partsTable = (rows, selected) =>
  rows.length === 0
    ? html`<div class="empty">등록된 부품이 없습니다. "부품 등록"이나 "CSV 일괄 등록"으로 추가하세요.</div>`
    : html`<div class="table-wrap">
        <table data-testid="parts-table">
          <thead>
            <tr>
              <th><input type="checkbox" data-select-all aria-label="전체 선택" /></th>
              <th>품번</th><th>품명</th><th>규격</th><th>단위</th><th class="num">안전재고</th><th>보관 위치</th><th class="num">현재고</th><th>상태</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) => html`<tr class="${r.active === false ? 'is-inactive' : ''}">
                <td><input type="checkbox" data-select="${r.partNo}" aria-label="${r.partNo} 선택" ${selected.has(r.partNo) ? 'checked' : ''} /></td>
                <td class="mono">${r.partNo}</td>
                <td>${r.name}</td>
                <td>${r.spec}</td>
                <td>${r.unit}</td>
                <td class="num">${formatNumber(r.safetyStock)}</td>
                <td>${r.location}</td>
                <td class="num">${formatNumber(r.stock)}</td>
                <td>${r.active === false ? html`<span class="badge">사용 중지</span>` : html`<span class="badge badge-ok">사용</span>`}</td>
                <td>
                  <button type="button" class="btn btn-sm" data-edit="${r.partNo}">수정</button>
                  <button type="button" class="btn btn-sm" data-toggle="${r.partNo}">${r.active === false ? '다시 사용' : '사용 중지'}</button>
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`

const downloadTemplate = () => {
  const rows = [
    ['품번', '품명', '규격', '단위', '안전재고', '보관위치'],
    ['SK-AD-101', '예시 덕트', 'PP 사출', 'EA', 100, 'A-03-01'],
  ]
  downloadFile('부품등록_양식.csv', toCsv(rows), 'text/csv;charset=utf-8')
}

const showImportResult = (result) =>
  openModal({
    title: 'CSV 일괄 등록 결과',
    content: html`<p><strong>${result.added || 0}개</strong> 부품을 등록했습니다.${result.errors.length ? ` 오류 ${result.errors.length}줄은 건너뛰었습니다.` : ''}</p>
      ${result.errors.length
        ? html`<ul class="error-list">${result.errors.map((e) => html`<li>${e.line}번째 줄: ${e.message}</li>`)}</ul>`
        : ''}
      <div class="form-actions"><button type="button" class="btn btn-primary" data-close-result>확인</button></div>`,
    onMount: (dialog, close) => dialog.querySelector('[data-close-result]').addEventListener('click', close),
  })

const importCsvFile = async (store, file) => {
  if (file.size > MAX_CSV_BYTES) return toast('CSV 파일은 2MB 이하만 올릴 수 있습니다.', 'error')
  try {
    const text = await readFileAsText(file)
    const result = store.importParts(text)
    notifyResult({ ...result, error: undefined })
    showImportResult(result)
  } catch (error) {
    console.error('CSV 등록 실패:', error)
    toast('CSV 파일을 읽지 못했습니다. UTF-8 형식의 CSV인지 확인하세요.', 'error')
  }
}

export const renderParts = (container, { store, navigate }) => {
  setHtml(
    container,
    html`<div class="page-head">
        <h1>부품 관리</h1>
        <div class="actions">
          <button type="button" class="btn btn-primary" data-action="new">부품 등록</button>
          <label class="btn">CSV 일괄 등록<input type="file" accept=".csv,text/csv" data-action="import" hidden /></label>
          <button type="button" class="btn" data-action="template">CSV 양식</button>
          <button type="button" class="btn" data-action="labels">선택 품목 라벨 출력</button>
        </div>
      </div>
      <section class="panel">
        <form class="filters" onsubmit="return false">
          <div class="field grow"><label for="p-q">검색</label><input id="p-q" class="input" name="query" placeholder="품번, 품명, 보관 위치" /></div>
          <label class="check"><input type="checkbox" name="includeInactive" checked /> 사용 중지 포함</label>
        </form>
        <p class="muted summary"></p>
        <div class="table-area"></div>
      </section>`,
  )

  const form = qs(container, '.filters')
  let selected = new Set()

  const draw = () => {
    const rows = buildStockRows(store.getState().parts, store.getStockMap()).sort((a, b) => a.partNo.localeCompare(b.partNo))
    const visible = searchStockRows(rows, { query: form.elements.query.value, includeInactive: form.elements.includeInactive.checked })
    qs(container, '.summary').textContent = `${visible.length}개 부품`
    setHtml(qs(container, '.table-area'), partsTable(visible, selected))
  }


  // 화면에 보이는 체크 상태를 선택 목록에 반영한다 (검색으로 숨겨진 선택은 유지)
  const updateSelection = () => {
    const boxes = qsa(container, '[data-select]')
    const visible = new Set(boxes.map((el) => el.dataset.select))
    const kept = [...selected].filter((no) => !visible.has(no))
    selected = new Set([...kept, ...boxes.filter((el) => el.checked).map((el) => el.dataset.select)])
  }

  const togglePart = async (partNo) => {
    const part = store.getState().parts.find((p) => p.partNo === partNo)
    const activate = part.active === false
    const ok = activate || (await confirmDialog({
      title: '부품 사용 중지',
      message: `${partNo} 부품을 사용 중지할까요?\n기록은 그대로 남고, 입고·출고만 막힙니다.`,
      confirmLabel: '사용 중지',
      danger: true,
    }))
    if (ok) notifyResult(store.setPartActive(partNo, activate), activate ? '다시 사용합니다.' : '사용 중지했습니다.')
  }

  const actions = {
    new: () => openPartForm({ store }),
    template: downloadTemplate,
    labels: () => {
      if (selected.size === 0) return toast('라벨을 출력할 부품을 먼저 선택하세요.', 'warning')
      navigate(labelsPath([...selected].sort()))
    },
  }

  form.addEventListener('input', draw)
  container.addEventListener('click', (event) => {
    const t = event.target
    const action = t.closest('button[data-action]')?.dataset.action
    if (action) return actions[action]?.()
    const editNo = t.closest('[data-edit]')?.dataset.edit
    if (editNo) return openPartForm({ store, part: store.getState().parts.find((p) => p.partNo === editNo) })
    const toggleNo = t.closest('[data-toggle]')?.dataset.toggle
    if (toggleNo) return togglePart(toggleNo)
    if (t.matches('[data-select-all]')) {
      qsa(container, '[data-select]').forEach((el) => {
        el.checked = t.checked
      })
      updateSelection()
    }
    if (t.matches('[data-select]')) updateSelection()
  })
  qs(container, 'input[data-action="import"]').addEventListener('change', (event) => {
    const [file] = event.target.files
    event.target.value = ''
    if (file) importCsvFile(store, file)
  })

  draw()
  return store.subscribe(draw)
}
