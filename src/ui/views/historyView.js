import { toCsv } from '../../domain/csv.js'
import { addDays, formatDateTime, toDateKey } from '../../domain/dates.js'
import { buildHistoryRows, filterHistory } from '../../domain/history.js'
import { TX_LABELS } from '../../domain/transactions.js'
import { downloadFile, formValues, html, qs, setHtml } from '../dom.js'
import { toast } from '../feedback.js'
import { openCancelDialog } from '../components/cancelDialog.js'
import { txTable } from '../components/txTable.js'

const MAX_ROWS = 300
const DEFAULT_DAYS = 7

const exportCsv = (rows) => {
  const header = ['일시', '구분', '품번', '품명', '수량', '거래처·사용처', '작업자', '메모', '상태']
  const body = rows.map((r) => [
    formatDateTime(r.createdAt), TX_LABELS[r.type], r.partNo, r.partName, r.qty, r.partner, r.worker, r.memo,
    r.type === 'CANCEL' ? '취소 기록' : r.cancelled ? '취소됨' : '',
  ])
  downloadFile(`입출고이력_${toDateKey(new Date())}.csv`, toCsv([header, ...body]), 'text/csv;charset=utf-8')
  toast(`${rows.length}건을 CSV로 내보냈습니다.`, 'success')
}

// 주소로 조건을 받는다: today=1(오늘), month=1(이번 달 1일부터), type, q(품번·품명)
const initialFrom = (query, today) => {
  if (query.get('today') === '1') return today
  if (query.get('month') === '1') return `${today.slice(0, 7)}-01`
  return addDays(today, -(DEFAULT_DAYS - 1))
}

const initialFilters = (query) => {
  const today = toDateKey(new Date())
  return { from: initialFrom(query, today), to: today, type: query.get('type') || '', query: query.get('q') || '' }
}

const typeOption = (value, label, selected) =>
  html`<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`

export const renderHistory = (container, { store, query }) => {
  const init = initialFilters(query)
  setHtml(
    container,
    html`<div class="page-head">
        <h1>입출고 이력</h1>
        <div class="actions"><button type="button" class="btn" data-action="export">CSV 내보내기</button></div>
      </div>
      <section class="panel">
        <form class="filters" onsubmit="return false">
          <div class="field"><label for="h-from">시작일</label><input id="h-from" class="input" type="date" name="from" value="${init.from}" /></div>
          <div class="field"><label for="h-to">종료일</label><input id="h-to" class="input" type="date" name="to" value="${init.to}" /></div>
          <div class="field">
            <label for="h-type">구분</label>
            <select id="h-type" class="input" name="type">
              ${typeOption('', '전체', init.type)}${typeOption('IN', '입고', init.type)}${typeOption('OUT', '출고', init.type)}${typeOption('CANCEL', '취소', init.type)}
            </select>
          </div>
          <div class="field grow"><label for="h-q">품번·품명</label><input id="h-q" class="input" name="query" placeholder="검색" value="${init.query}" /></div>
          <button type="button" class="btn" data-action="all">전체 기간</button>
        </form>
        <p class="muted summary"></p>
        <div class="table-area"></div>
      </section>`,
  )

  const form = qs(container, '.filters')
  let filtered = []

  const draw = () => {
    const { parts, transactions } = store.getState()
    filtered = filterHistory(buildHistoryRows(transactions, parts), formValues(form))
    const shown = filtered.slice(0, MAX_ROWS)
    qs(container, '.summary').textContent =
      filtered.length > MAX_ROWS ? `${filtered.length}건 중 최근 ${MAX_ROWS}건 표시 (CSV에는 전체 포함)` : `${filtered.length}건`
    setHtml(qs(container, '.table-area'), txTable(shown, { showCancel: true, emptyText: '조건에 맞는 기록이 없습니다.' }))
  }

  form.addEventListener('input', draw)
  container.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action
    const cancelId = event.target.closest('[data-cancel]')?.dataset.cancel
    if (action === 'export') exportCsv(filtered)
    if (action === 'all') {
      form.elements.from.value = ''
      form.elements.to.value = ''
      draw()
    }
    if (cancelId) openCancelDialog({ store, txId: cancelId })
  })
  draw()
  return store.subscribe(draw)
}
