import { toCsv } from '../../domain/csv.js'
import { toDateKey } from '../../domain/dates.js'
import { buildStockRows, searchStockRows } from '../../domain/stock.js'
import { downloadFile, formatNumber, html, qs, setHtml } from '../dom.js'
import { toast } from '../feedback.js'

const statusBadge = (row) => {
  if (row.active === false) return html`<span class="badge">사용 중지</span>`
  return row.low ? html`<span class="badge badge-low">부족</span>` : html`<span class="badge badge-ok">정상</span>`
}

const rowClass = (row) => [row.low ? 'is-low' : '', row.active === false ? 'is-inactive' : ''].join(' ')

const stockTable = (rows) =>
  rows.length === 0
    ? html`<div class="empty">조건에 맞는 품목이 없습니다.</div>`
    : html`<div class="table-wrap">
        <table data-testid="stock-table">
          <thead>
            <tr>
              <th>품번</th><th>품명</th><th>규격</th><th>보관 위치</th>
              <th class="num">현재고</th><th class="num">안전재고</th><th>단위</th><th>상태</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) => html`<tr class="${rowClass(r)}" data-part-no="${r.partNo}">
                <td class="mono">${r.partNo}</td>
                <td>${r.name}</td>
                <td>${r.spec}</td>
                <td>${r.location}</td>
                <td class="num stock">${formatNumber(r.stock)}</td>
                <td class="num">${formatNumber(r.safetyStock)}</td>
                <td>${r.unit}</td>
                <td>${statusBadge(r)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`

const exportCsv = (rows) => {
  const header = ['품번', '품명', '규격', '보관위치', '현재고', '안전재고', '단위', '상태']
  const body = rows.map((r) => [
    r.partNo, r.name, r.spec, r.location, r.stock, r.safetyStock, r.unit,
    r.active === false ? '사용 중지' : r.low ? '부족' : '정상',
  ])
  downloadFile(`재고현황_${toDateKey(new Date())}.csv`, toCsv([header, ...body]), 'text/csv;charset=utf-8')
  toast(`${rows.length}개 품목을 CSV로 내보냈습니다.`, 'success')
}

export const renderStock = (container, { store, query }) => {
  setHtml(
    container,
    html`<div class="page-head">
        <h1>재고 현황</h1>
        <div class="actions"><button type="button" class="btn" data-action="export">CSV 내보내기</button></div>
      </div>
      <section class="panel">
        <form class="filters" role="search" onsubmit="return false">
          <div class="field grow">
            <label for="stock-q">검색</label>
            <input id="stock-q" class="input" name="query" placeholder="품번, 품명, 보관 위치" />
          </div>
          <label class="check"><input type="checkbox" name="lowOnly" ${query.get('low') === '1' ? 'checked' : ''} /> 부족 품목만</label>
          <label class="check"><input type="checkbox" name="includeInactive" /> 사용 중지 포함</label>
        </form>
        <p class="muted summary"></p>
        <div class="table-area"></div>
      </section>`,
  )

  const form = qs(container, '.filters')
  let visibleRows = []

  const draw = () => {
    const rows = buildStockRows(store.getState().parts, store.getStockMap())
    visibleRows = searchStockRows(rows, {
      query: form.elements.query.value,
      lowOnly: form.elements.lowOnly.checked,
      includeInactive: form.elements.includeInactive.checked,
    })
    const lowCount = visibleRows.filter((r) => r.low).length
    qs(container, '.summary').textContent = `${visibleRows.length}개 품목 · 부족 ${lowCount}개`
    setHtml(qs(container, '.table-area'), stockTable(visibleRows))
  }

  form.addEventListener('input', draw)
  qs(container, '[data-action="export"]').addEventListener('click', () => exportCsv(visibleRows))
  draw()
  return store.subscribe(draw)
}
