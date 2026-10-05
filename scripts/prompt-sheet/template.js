// 프롬프트 모음집 A4 1장 HTML. 흑백으로 인쇄해도 읽히게 진한 글자와 옅은 배경만 쓴다.
import { FORMULA, POLISH, SAFETY, SECTIONS, STUCK, SUBTITLE, TITLE } from './content.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch])

// [ ] 칸은 밑줄 상자로 보여서 바꿔 쓰는 곳이 한눈에 보이게 한다
const withBlanks = (text) => esc(text).replace(/\[([^\]]+)\]/g, '<span class="blank">$1</span>')

const section = ({ title, items }) => `
  <section>
    <h2>${esc(title)}</h2>
    ${items.map((it) => `<div class="item"><div class="name">${esc(it.name)}</div><p>${withBlanks(it.prompt)}</p></div>`).join('')}
  </section>`

const STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #111; font-size: 8.6pt; line-height: 1.42; }
  .page { width: 210mm; height: 297mm; padding: 11mm 12mm 9mm; display: flex; flex-direction: column; gap: 3.2mm; overflow: hidden; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 2mm; }
  h1 { margin: 0; font-size: 17pt; letter-spacing: -0.3pt; }
  .sub { font-size: 8pt; color: #444; }
  .top { display: grid; grid-template-columns: 1.55fr 1fr; gap: 3mm; }
  .box { border: 1.2px solid #111; border-radius: 2mm; padding: 2.2mm 3mm; }
  .box h3 { margin: 0 0 1.2mm; font-size: 9.5pt; }
  .formula { display: flex; gap: 1.5mm; align-items: center; margin-bottom: 1.4mm; flex-wrap: wrap; }
  .chip { border: 1px solid #111; border-radius: 1.2mm; padding: 0.3mm 2mm; font-weight: 700; background: #eee; }
  .plus { font-weight: 700; }
  .ex { margin: 0.6mm 0; display: flex; gap: 2mm; }
  .tag { flex: 0 0 4mm; font-weight: 700; }
  .safety { margin: 0; padding-left: 4mm; }
  .safety li { margin: 0.3mm 0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 4mm; align-content: start; }
  section h2 { margin: 0 0 1.2mm; font-size: 10.5pt; padding: 0.6mm 2mm; background: #e6e6e6; border-left: 2.2mm solid #111; }
  .item { margin: 0 0 1.6mm; break-inside: avoid; }
  .name { font-weight: 700; font-size: 8.8pt; }
  .item p { margin: 0.3mm 0 0; padding: 1mm 2mm; border: 1px solid #bbb; border-radius: 1.2mm; background: #fafafa; }
  .blank { border-bottom: 1.2px solid #111; padding: 0 0.6mm; font-weight: 700; }
  .bottom { display: grid; grid-template-columns: 1fr 1.25fr; gap: 3mm; }
  .polish { display: flex; flex-wrap: wrap; gap: 1.2mm; }
  .polish span { border: 1px solid #111; border-radius: 3mm; padding: 0.2mm 2mm; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.5mm 1mm; vertical-align: top; border-top: 1px solid #ccc; }
  td:first-child { font-weight: 700; white-space: nowrap; width: 30mm; }
  footer { display: flex; justify-content: space-between; font-size: 7.4pt; color: #555; border-top: 1px solid #999; padding-top: 1.4mm; }
  /* 남는 공간은 메모 칸이 차지한다 (직접 적어 쓰는 칸) */
  .memo { flex: 1 1 13mm; min-height: 13mm; border: 1px dashed #777; border-radius: 2mm; padding: 1.4mm 3mm; color: #666; font-size: 8pt; }
`

export const renderPromptSheet = () => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(TITLE)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="page">
    <header>
      <div><h1>${esc(TITLE)}</h1><div class="sub">${esc(SUBTITLE)}</div></div>
      <div class="sub">claude.ai · 복사해서 <span class="blank">밑줄 칸</span>만 바꿔 쓰세요</div>
    </header>

    <div class="top">
      <div class="box">
        <h3>좋은 프롬프트 공식</h3>
        <div class="formula">${FORMULA.parts.map((p) => `<span class="chip">${esc(p)}</span>`).join('<span class="plus">+</span>')}</div>
        <p class="ex"><span class="tag">✗</span><span>${esc(FORMULA.bad)}</span></p>
        <p class="ex"><span class="tag">✓</span><span>${withBlanks(FORMULA.good)}</span></p>
      </div>
      <div class="box">
        <h3>꼭 지킬 것</h3>
        <ul class="safety">${SAFETY.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
    </div>

    <div class="cols">${SECTIONS.map(section).join('')}</div>

    <div class="bottom">
      <div class="box">
        <h3>다듬기 한마디 (답이 나온 뒤 이어서)</h3>
        <div class="polish">${POLISH.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
      </div>
      <div class="box">
        <h3>막힐 때</h3>
        <table>${STUCK.map((s) => `<tr><td>${esc(s.when)}</td><td>${esc(s.what)}</td></tr>`).join('')}</table>
      </div>
    </div>

    <div class="memo">나만의 프롬프트 메모:</div>

    <footer><span>AI가 만든 결과는 초안입니다. 숫자·품번은 원본과 대조하세요.</span><span>강의 자료 · 2026</span></footer>
  </div>
</body>
</html>`
