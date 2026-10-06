// Claude.ai로 입출고관리 웹페이지를 만드는 프롬프트 모음(A4 2장)을 HTML·PDF·PNG로 만든다.
// 실행: npm run app-prompt-sheet  →  ../materials/app-prompt-sheet/
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { renderAppPromptSheet } from './template.js'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../materials/app-prompt-sheet')
const FILE = 'app-prompt-sheet'
const PAGE_COUNT = 2
const A4_PX = { width: 794, height: 1123 } // 96dpi 기준 A4

const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true })
  const htmlPath = resolve(OUT_DIR, `${FILE}.html`)
  await writeFile(htmlPath, renderAppPromptSheet(), 'utf-8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: A4_PX, deviceScaleFactor: 2 })
    await page.goto(`file://${htmlPath}`)
    // 쪽마다 내용이 A4를 넘으면 실패로 알린다
    const overflows = await page.$$eval('.page', (pages) => pages.map((el) => el.scrollHeight - el.clientHeight))
    overflows.forEach((px, i) => {
      if (px > 0) throw new Error(`${i + 1}쪽 내용이 A4보다 ${px}px 깁니다. content.js를 줄이세요.`)
    })
    const pdfPath = resolve(OUT_DIR, `${FILE}.pdf`)
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true })
    const sheets = await page.$$('.page')
    for (const [i, sheet] of sheets.entries()) {
      await sheet.screenshot({ path: resolve(OUT_DIR, `${FILE}-${i + 1}.png`) })
    }
    const pages = countPages(await readFile(pdfPath))
    if (pages !== PAGE_COUNT) throw new Error(`PDF가 ${pages}쪽입니다. ${PAGE_COUNT}쪽이어야 합니다.`)
    process.stdout.write(`생성: ${OUT_DIR}/${FILE}.{html,pdf} + PNG ${sheets.length}장 (${pages}쪽)\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('웹페이지 만들기 프롬프트 생성 실패:', error.message)
  process.exitCode = 1
})
