// 확장편 용어 풀이(A4)를 HTML·PDF·PNG로 만든다. 내용은 content.js를 고친다.
// 실행: npm run expansion-glossary  →  ../materials/expansion-glossary/
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { GROUPS, NOTE, SUBTITLE, TITLE } from './content.js'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../materials/expansion-glossary')
const FILE = 'expansion-glossary'
const A4_PX = { width: 794, height: 1123 } // 96dpi 기준 A4
// 쪽마다 넣을 묶음 (GROUPS 순서 기준). 넘치면 생성이 실패하므로 여기서 나눈다.
const PAGES = [[0, 1, 2, 3], [4, 5, 6]]

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch])
const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length

const group = ({ title, terms }) => `
  <section>
    <h2>${esc(title)}</h2>
    <table>${terms
      .map(([term, meaning, isNew]) => `<tr><td class="term">${esc(term)}${isNew ? '<span class="new">새</span>' : ''}</td><td>${esc(meaning)}</td></tr>`)
      .join('')}</table>
  </section>`

const footer = (pageNo) => `<footer><span>${esc(NOTE)}</span><span>강의 자료 · 2026 · ${pageNo} / ${PAGES.length}</span></footer>`

// 흑백으로 인쇄해도 읽히게 진한 글자와 옅은 배경만 쓴다 (프롬프트 시트와 같은 모양)
const STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #111; font-size: 9pt; line-height: 1.45; }
  .page { width: 210mm; height: 297mm; padding: 11mm 12mm 9mm; display: flex; flex-direction: column; gap: 3.2mm; overflow: hidden; break-after: page; }
  .page:last-child { break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 2mm; }
  h1 { margin: 0; font-size: 17pt; letter-spacing: -0.3pt; }
  .sub { font-size: 8pt; color: #444; }
  h2 { margin: 0 0 1.2mm; font-size: 10.5pt; padding: 0.6mm 2mm; background: #e6e6e6; border-left: 2.2mm solid #111; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1mm 1.4mm; vertical-align: top; border-bottom: 1px solid #ccc; }
  td.term { font-weight: 700; width: 46mm; }
  .new { display: inline-block; margin-left: 1.4mm; padding: 0 1.2mm; border: 1px solid #111; border-radius: 1mm; font-size: 6.8pt; font-weight: 700; line-height: 1.4; vertical-align: 1px; }
  footer { display: flex; justify-content: space-between; gap: 4mm; font-size: 7.4pt; color: #555; border-top: 1px solid #999; padding-top: 1.4mm; margin-top: auto; }
`

const render = () => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(TITLE)}</title>
  <style>${STYLE}</style>
</head>
<body>
${PAGES.map(
  (indexes, i) => `  <div class="page">
    ${i === 0 ? `<header><div><h1>${esc(TITLE)}</h1><div class="sub">${esc(SUBTITLE)}</div></div><div class="sub">가나다순이 아니라 강의에서 나오는 순서</div></header>` : ''}
    ${indexes.map((g) => group(GROUPS[g])).join('')}
    ${footer(i + 1)}
  </div>`,
).join('\n')}
</body>
</html>`

const main = async () => {
  const used = PAGES.flat()
  if (used.length !== GROUPS.length || new Set(used).size !== GROUPS.length) throw new Error('PAGES에 모든 묶음을 한 번씩 넣으세요.')
  await mkdir(OUT_DIR, { recursive: true })
  const htmlPath = resolve(OUT_DIR, `${FILE}.html`)
  await writeFile(htmlPath, render(), 'utf-8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: A4_PX, deviceScaleFactor: 2 })
    await page.goto(`file://${htmlPath}`)
    const overflows = await page.$$eval('.page', (pages) => pages.map((el) => el.scrollHeight - el.clientHeight))
    overflows.forEach((px, i) => {
      if (px > 0) throw new Error(`${i + 1}쪽 내용이 A4보다 ${px}px 깁니다. PAGES 나누기나 content.js를 고치세요.`)
    })
    const pdfPath = resolve(OUT_DIR, `${FILE}.pdf`)
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true })
    const sheets = await page.$$('.page')
    for (const [i, sheet] of sheets.entries()) await sheet.screenshot({ path: resolve(OUT_DIR, `${FILE}-${i + 1}.png`) })
    const pages = countPages(await readFile(pdfPath))
    if (pages !== PAGES.length) throw new Error(`PDF가 ${pages}쪽입니다. ${PAGES.length}쪽이어야 합니다.`)
    process.stdout.write(`생성: ${OUT_DIR}/${FILE}.{html,pdf} + PNG ${sheets.length}장 (${pages}쪽)\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('용어 풀이 생성 실패:', error.message)
  process.exitCode = 1
})
