import { findPart } from '../../domain/parts.js'
import { html, qs, setHtml } from '../dom.js'
import { barcodeSvg, qrSvgMarkup } from '../components/barcode.js'

const MAX_COPIES = 50
export const labelsPath = (partNos) => `/labels?parts=${encodeURIComponent(partNos.join(','))}`

const selectionFrom = (query) => (query.get('parts') || '').split(',').filter(Boolean)

const labelShell = (part, index) => html`
  <div class="print-label" data-index="${index}">
    <div class="label-text">
      <div class="label-name">${part.name}</div>
      <div class="label-meta">${part.spec}${part.location ? ` · ${part.location}` : ''}</div>
      <div class="barcode-slot"></div>
    </div>
    <div class="qr" hidden></div>
  </div>
`

// SVG는 라이브러리가 만든 신뢰할 수 있는 결과이므로 DOM에 직접 붙인다
const fillLabel = async (el, part, kind) => {
  el.querySelector('.barcode-slot').replaceChildren()
  if (kind !== 'qr') el.querySelector('.barcode-slot').appendChild(barcodeSvg(part.partNo))
  else el.querySelector('.barcode-slot').textContent = part.partNo
  if (kind !== 'code128') {
    const qrBox = el.querySelector('.qr')
    qrBox.innerHTML = await qrSvgMarkup(part.partNo)
    qrBox.hidden = false
  }
}

export const renderLabels = (container, { store, query }) => {
  const parts = selectionFrom(query).map((no) => findPart(store.getState().parts, no)).filter(Boolean)
  setHtml(
    container,
    html`<div class="page-head no-print">
        <h1>바코드 라벨 출력</h1>
        <div class="actions">
          <a class="btn" href="#/parts">← 부품 관리</a>
          <button type="button" class="btn btn-primary" data-action="print" ${parts.length ? '' : 'disabled'}>인쇄</button>
        </div>
      </div>
      ${parts.length === 0
        ? html`<div class="panel empty">선택한 부품이 없습니다. 부품 관리에서 라벨을 출력할 부품을 선택하세요.</div>`
        : html`<section class="panel no-print">
              <form class="label-options" onsubmit="return false">
                <div class="field">
                  <label for="l-kind">코드 종류</label>
                  <select id="l-kind" class="input" name="kind">
                    <option value="both">바코드 + QR</option>
                    <option value="code128">바코드(Code128)만</option>
                    <option value="qr">QR만</option>
                  </select>
                </div>
                <div class="field">
                  <label for="l-copies">품목당 장수</label>
                  <input id="l-copies" class="input" name="copies" type="number" min="1" max="${MAX_COPIES}" value="1" />
                </div>
                <p class="muted">A4 한 장에 3열 × 8행(24칸). 인쇄할 때 배율을 "100%"로 두세요.</p>
              </form>
            </section>
            <div class="label-sheet" data-testid="label-sheet"></div>`}`,
  )
  if (parts.length === 0) return null

  const form = qs(container, '.label-options')
  const sheet = qs(container, '.label-sheet')

  const printButton = qs(container, '[data-action="print"]')
  let drawId = 0

  const draw = async () => {
    const currentDraw = ++drawId
    printButton.disabled = true
    const copies = Math.min(MAX_COPIES, Math.max(1, Number.parseInt(form.elements.copies.value, 10) || 1))
    const kind = form.elements.kind.value
    const items = parts.flatMap((part) => Array.from({ length: copies }, () => part))
    setHtml(sheet, html`${items.map((part, i) => labelShell(part, i))}`)
    await Promise.all([...sheet.querySelectorAll('.print-label')].map((el, i) => fillLabel(el, items[i], kind)))
    // QR까지 다 그려진 뒤에만 인쇄할 수 있게 한다 (옵션을 빠르게 바꾸면 마지막 그리기만 반영)
    if (currentDraw === drawId) printButton.disabled = false
  }

  form.addEventListener('change', draw)
  printButton.addEventListener('click', () => window.print())
  draw()
  return null
}
