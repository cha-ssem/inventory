// 강의 배포용 프롬프트 모음집(A4 1장)을 HTML·PDF·PNG로 만든다.
// 실행: npm run prompt-sheet  →  ../materials/prompt-sheet/
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { renderPromptSheet } from './template.js'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../materials/prompt-sheet')
const FILE = 'prompt-sheet'
const A4_PX = { width: 794, height: 1123 } // 96dpi 기준 A4

// 내용이 넘쳐 2쪽이 되면 실패로 알린다 (1장 인쇄물이어야 하므로)
const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true })
  const htmlPath = resolve(OUT_DIR, `${FILE}.html`)
  await writeFile(htmlPath, renderPromptSheet(), 'utf-8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: A4_PX, deviceScaleFactor: 2 })
    await page.goto(`file://${htmlPath}`)
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.page')
      return el.scrollHeight - el.clientHeight
    })
    if (overflow > 0) throw new Error(`내용이 A4 한 장보다 ${overflow}px 깁니다. content.js를 줄이세요.`)
    const pdfPath = resolve(OUT_DIR, `${FILE}.pdf`)
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true })
    await page.screenshot({ path: resolve(OUT_DIR, `${FILE}.png`), fullPage: true })
    const pages = countPages(await readFile(pdfPath))
    if (pages !== 1) throw new Error(`PDF가 ${pages}쪽입니다. 1쪽이어야 합니다.`)
    process.stdout.write(`생성: ${OUT_DIR}/${FILE}.{html,pdf,png} (1쪽)\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('프롬프트 모음집 생성 실패:', error.message)
  process.exitCode = 1
})
