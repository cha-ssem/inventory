import { BLANK_ROWS, BUYER } from './data.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])
const won = (n) => (n === '' || n === undefined ? '' : Number(n).toLocaleString('ko-KR'))

const VAT_RATE = 0.1

const withAmounts = (item) => {
  const amount = item.qty * item.price
  return { ...item, amount, vat: Math.round(amount * VAT_RATE) }
}

const STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #111; background: #fff; }
  .page { position: relative; width: 210mm; height: 297mm; padding: 14mm 12mm; overflow: hidden; }
  .watermark { position: absolute; top: 120mm; left: 0; right: 0; text-align: center; font-size: 46mm; font-weight: 900;
    color: rgba(200, 30, 30, 0.07); transform: rotate(-18deg); pointer-events: none; letter-spacing: 8mm; }
  .head { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 0.8mm solid #111; padding-bottom: 2mm; }
  h1 { margin: 0; font-size: 9mm; letter-spacing: 4mm; }
  .copy { font-size: 3.4mm; color: #444; margin-left: 2mm; letter-spacing: 0; }
  .doc-meta { font-size: 3.8mm; text-align: right; line-height: 1.6; }
  .doc-meta b { display: inline-block; min-width: 34mm; text-align: left; font-family: Menlo, Consolas, monospace; font-size: 4.2mm; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  .party th, .party td { border: 0.3mm solid #333; padding: 1.4mm 2mm; font-size: 3.4mm; text-align: left; height: 7mm; }
  .party th { width: 22mm; background: #f1f1f1; font-weight: 700; white-space: nowrap; }
  .party caption { caption-side: top; text-align: left; font-weight: 800; font-size: 3.8mm; padding-bottom: 1mm; }
  .total { margin-top: 4mm; display: flex; justify-content: space-between; align-items: center; border: 0.5mm solid #111; padding: 2.5mm 4mm; font-size: 4.2mm; }
  .total b { font-size: 5.4mm; font-family: Menlo, Consolas, monospace; }
  .items { margin-top: 4mm; }
  .items th, .items td { border: 0.3mm solid #333; padding: 1.2mm 1.5mm; font-size: 3.3mm; height: 8.6mm; }
  .items th { background: #e9edf3; font-weight: 800; text-align: center; }
  .items td.num { text-align: right; font-family: Menlo, Consolas, monospace; }
  .items td.code { font-family: Menlo, Consolas, monospace; font-size: 3.1mm; }
  .items td.center { text-align: center; }
  .items tfoot td { font-weight: 800; background: #f6f6f6; }
  .foot { display: grid; grid-template-columns: 1fr 60mm; gap: 3mm; margin-top: 4mm; }
  .box { border: 0.3mm solid #333; padding: 2mm 3mm; font-size: 3.4mm; min-height: 20mm; }
  .box b { display: block; margin-bottom: 1mm; }
  .notice { position: absolute; bottom: 8mm; left: 12mm; right: 12mm; font-size: 2.8mm; color: #777; text-align: center; }
`

const partyTable = (caption, rows) => `
  <table class="party">
    <caption>${esc(caption)}</caption>
    ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
  </table>`

const itemRow = (item, index) =>
  item
    ? `<tr>
        <td class="center">${index + 1}</td>
        <td class="code">${esc(item.partNo)}</td>
        <td class="code">${esc(item.code)}</td>
        <td>${esc(item.name)}</td>
        <td>${esc(item.spec)}</td>
        <td class="center">${esc(item.unit)}</td>
        <td class="num">${won(item.qty)}</td>
        <td class="num">${won(item.price)}</td>
        <td class="num">${won(item.amount)}</td>
        <td class="num">${won(item.vat)}</td>
        <td></td>
      </tr>`
    : `<tr><td class="center">${index + 1}</td>${'<td></td>'.repeat(10)}</tr>`

export const renderStatement = (statement) => {
  const blank = !statement
  const s = statement || { no: '', date: '', supplier: {}, items: [], note: '' }
  const items = s.items.map(withAmounts)
  const sum = items.reduce((acc, i) => ({ amount: acc.amount + i.amount, vat: acc.vat + i.vat, qty: acc.qty + i.qty }), { amount: 0, vat: 0, qty: 0 })
  const rows = Array.from({ length: BLANK_ROWS }, (_, i) => itemRow(items[i], i)).join('')
  const v = (value) => (blank ? '' : value)

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>거래명세서 ${esc(s.no)}</title><style>${STYLE}</style></head>
<body><div class="page">
  <div class="watermark">견 본</div>
  <div class="head">
    <h1>거래명세서<span class="copy">(공급받는자 보관용)</span></h1>
    <div class="doc-meta">명세서 번호 <b>${esc(s.no)}</b><br />거래 일자 <b>${esc(s.date)}</b></div>
  </div>
  <div class="parties">
    ${partyTable('공급자', [
      ['등록번호', s.supplier.bizNo], ['상호', s.supplier.name], ['대표자', s.supplier.ceo],
      ['주소', s.supplier.address], ['업태/종목', s.supplier.type], ['전화', s.supplier.phone],
    ])}
    ${partyTable('공급받는자', [
      ['등록번호', BUYER.bizNo], ['상호', BUYER.name], ['담당', BUYER.contact],
      ['주소', BUYER.address], ['', ''], ['', ''],
    ])}
  </div>
  <div class="total"><span>합계금액 (공급가액 + 세액)</span><b>${blank ? '' : `₩ ${won(sum.amount + sum.vat)}`}</b></div>
  <table class="items">
    <colgroup>
      <col style="width:7mm" /><col style="width:22mm" /><col style="width:22mm" /><col /><col style="width:22mm" />
      <col style="width:11mm" /><col style="width:13mm" /><col style="width:16mm" /><col style="width:19mm" /><col style="width:15mm" /><col style="width:11mm" />
    </colgroup>
    <thead><tr>
      <th>No</th><th>귀사 품번</th><th>공급사 코드</th><th>품명</th><th>규격</th><th>단위</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th>비고</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="6" style="text-align:center">합 계</td>
      <td class="num">${v(won(sum.qty))}</td><td></td>
      <td class="num">${v(won(sum.amount))}</td><td class="num">${v(won(sum.vat))}</td><td></td>
    </tr></tfoot>
  </table>
  <div class="foot">
    <div class="box"><b>비고</b>${esc(s.note)}</div>
    <div class="box"><b>인수자 확인</b>성명:<br /><br />서명:</div>
  </div>
  <div class="notice">본 서류는 강의·시스템 시험용 가상 견본이며 실제 거래와 관계없습니다.</div>
</div></body></html>`
}
