// 웹페이지 만들기 프롬프트 A4 2장 HTML. 1쪽은 사용법과 ①·②, 2쪽은 ③·④와 막힐 때.
// 흑백으로 인쇄해도 읽히게 진한 글자와 옅은 배경만 쓴다 (prompt-sheet와 같은 모양).
import { HOW_TO, SAFETY, STEPS, STUCK, SUBTITLE, TITLE } from './content.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch])

const step = ({ no, title, scope, needs, prompt }) => `
  <section class="step">
    <h2><span class="no">${esc(no)}</span>${esc(title)}</h2>
    <div class="meta"><span><b>만드는 것</b> ${esc(scope)}</span><span><b>필요한 것</b> ${esc(needs)}</span></div>
    <pre class="prompt">${esc(prompt)}</pre>
  </section>`

const footer = (pageNo) =>
  `<footer><span>AI가 만든 코드는 초안입니다. 샘플 데이터로 끝까지 시험한 뒤 쓰세요.</span><span>강의 자료 · 2026 · ${pageNo} / 2</span></footer>`

const STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #111; font-size: 8.6pt; line-height: 1.42; }
  .page { width: 210mm; height: 297mm; padding: 11mm 12mm 9mm; display: flex; flex-direction: column; gap: 2.8mm; overflow: hidden; break-after: page; }
  .page:last-child { break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 2mm; }
  h1 { margin: 0; font-size: 17pt; letter-spacing: -0.3pt; }
  .sub { font-size: 8pt; color: #444; }
  .box { border: 1.2px solid #111; border-radius: 2mm; padding: 2.2mm 3mm; }
  .box h3 { margin: 0 0 1.2mm; font-size: 9.5pt; }
  .box ol, .box ul { margin: 0; padding-left: 4.5mm; }
  .box li { margin: 0.3mm 0; }
  .step { display: flex; flex-direction: column; gap: 1.2mm; }
  .step h2 { margin: 0; font-size: 10.5pt; padding: 0.6mm 2mm; background: #e6e6e6; border-left: 2.2mm solid #111; display: flex; gap: 1.6mm; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.4mm 5mm; font-size: 8pt; color: #333; }
  .meta b { margin-right: 1mm; }
  .prompt { margin: 0; padding: 2mm 2.6mm; border: 1px solid #bbb; border-radius: 1.2mm; background: #fafafa;
    font-family: inherit; font-size: 8.4pt; line-height: 1.45; white-space: pre-wrap; word-break: keep-all; }
  .grow { flex: 1 1 auto; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.5mm 1mm; vertical-align: top; border-top: 1px solid #ccc; }
  td:first-child { font-weight: 700; white-space: nowrap; width: 38mm; }
  .bottom { display: grid; grid-template-columns: 1.2fr 1fr; gap: 3mm; }
  footer { display: flex; justify-content: space-between; font-size: 7.4pt; color: #555; border-top: 1px solid #999; padding-top: 1.4mm; margin-top: auto; }
`

export const renderAppPromptSheet = () => {
  const FIRST_PAGE_STEPS = 2
  const first = STEPS.slice(0, FIRST_PAGE_STEPS)
  const rest = STEPS.slice(FIRST_PAGE_STEPS)
  return `<!doctype html>
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
      <div class="sub">claude.ai · 상자 안을 그대로 복사해 붙여넣으세요</div>
    </header>
    <div class="box">
      <h3>쓰는 방법</h3>
      <ol>${HOW_TO.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    </div>
    ${first.map(step).join('')}
    ${footer(1)}
  </div>

  <div class="page">
    ${rest.map(step).join('')}
    <div class="bottom">
      <div class="box">
        <h3>막힐 때 (이어서 입력)</h3>
        <table>${STUCK.map((s) => `<tr><td>${esc(s.when)}</td><td>${esc(s.what)}</td></tr>`).join('')}</table>
      </div>
      <div class="box">
        <h3>꼭 지킬 것</h3>
        <ul>${SAFETY.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
    </div>
    ${footer(2)}
  </div>
</body>
</html>`
}
