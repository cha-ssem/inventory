import { formatDateTime } from '../../domain/dates.js'
import { TX_LABELS } from '../../domain/transactions.js'
import { formatNumber, html } from '../dom.js'

export const typeBadge = (type) => html`<span class="badge badge-${type}">${TX_LABELS[type] || type}</span>`

const statusCell = (row, showCancel) => {
  if (row.type === 'CANCEL') return html`<span class="muted">원 기록 취소</span>`
  if (row.cancelled) return html`<span class="badge badge-CANCEL">취소됨</span>`
  return showCancel ? html`<button type="button" class="btn btn-sm" data-cancel="${row.id}">취소</button>` : ''
}

const rowHtml = (row, showCancel) => html`
  <tr class="${row.cancelled ? 'is-cancelled' : ''}">
    <td>${formatDateTime(row.createdAt)}</td>
    <td>${typeBadge(row.type)}</td>
    <td class="mono">${row.partNo}</td>
    <td>${row.partName}</td>
    <td class="num qty">${formatNumber(row.qty)}</td>
    <td>${row.partner}</td>
    <td>${row.worker}</td>
    <td>${row.memo}</td>
    <td>${statusCell(row, showCancel)}</td>
  </tr>
`

export const txTable = (rows, { showCancel = false, emptyText = '기록이 없습니다.' } = {}) =>
  rows.length === 0
    ? html`<div class="empty">${emptyText}</div>`
    : html`<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>일시</th>
              <th>구분</th>
              <th>품번</th>
              <th>품명</th>
              <th class="num">수량</th>
              <th>거래처·사용처</th>
              <th>작업자</th>
              <th>메모</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => rowHtml(row, showCancel))}
          </tbody>
        </table>
      </div>`
