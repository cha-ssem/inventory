import { formatNumber, html } from '../dom.js'

const partLine = (part) => html`<div class="result-part"><span class="mono">${part.partNo}</span> ${part.name}</div>`

export const successCard = ({ label, part, qty, after, low, sign }) => html`
  <div class="result-card ${low ? 'is-warning' : 'is-success'} flash" data-testid="scan-result" data-state="${low ? 'warning' : 'success'}">
    <div class="result-title">${low ? `${label} 완료 · 안전재고 미달` : `${label} 완료`}</div>
    ${partLine(part)}
    <div class="result-meta">
      <span>수량 <strong class="big">${sign}${formatNumber(qty)}</strong> ${part.unit}</span>
      <span>현재고 <strong class="big" data-testid="scan-after">${formatNumber(after)}</strong></span>
      <span>안전재고 ${formatNumber(part.safetyStock)}</span>
    </div>
    ${low ? html`<p>현재고가 안전재고(${formatNumber(part.safetyStock)})보다 적습니다. 보충이 필요합니다.</p>` : ''}
  </div>
`

export const selectedCard = ({ part, stock, label }) => html`
  <div class="result-card is-pending flash" data-testid="scan-result" data-state="selected">
    <div class="result-title">선택됨 · 아직 저장되지 않았습니다</div>
    ${partLine(part)}
    <div class="result-meta">
      <span>현재고 <strong class="big">${formatNumber(stock)}</strong> ${part.unit}</span>
      <span>안전재고 ${formatNumber(part.safetyStock)}</span>
    </div>
    <p>수량과 작업자를 확인하고 <strong>[입력]</strong>을 누르면 ${label}됩니다.</p>
    <button type="button" class="btn btn-sm" data-action="clear">선택 취소</button>
  </div>
`

export const unknownCard = (partNo) => html`
  <div class="result-card is-error flash" data-testid="scan-result" data-state="unknown">
    <div class="result-title">등록되지 않은 품번입니다</div>
    <div class="result-part mono">${partNo}</div>
    <p>바코드가 맞다면 새 부품으로 등록하세요.</p>
    <button type="button" class="btn btn-primary" data-action="register" data-part-no="${partNo}">새 부품으로 등록</button>
  </div>
`

export const errorCard = (message) => html`
  <div class="result-card is-error flash" data-testid="scan-result" data-state="error">
    <div class="result-title">처리하지 못했습니다</div>
    <p>${message}</p>
  </div>
`

export const idleCard = (label) => html`
  <div class="result-card" data-testid="scan-result" data-state="idle">
    <div class="result-title">바코드를 스캔하세요</div>
    <p class="muted">USB 스캐너로 찍거나 품번을 입력하고 Enter를 누르면 부품이 선택됩니다. 수량과 작업자를 확인한 뒤 <strong>[입력]</strong>을 누르면 ${label}됩니다.</p>
  </div>
`
