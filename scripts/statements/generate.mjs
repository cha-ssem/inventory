// 가상 거래명세서(견본 3종 + 빈 양식)를 HTML·PDF·PNG로 만든다.
// 실행: npm run statements  →  ../materials/statement-forms/
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { STATEMENTS } from './data.js'
import { renderStatement } from './template.js'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../materials/statement-forms')
const A4_PX = { width: 794, height: 1123 } // 96dpi 기준 A4
const PNG_SCALE = 2 // OCR 시험용으로 약 192dpi

const documents = [
  ...STATEMENTS.map((s) => ({ file: s.file, html: renderStatement(s) })),
  { file: 'blank-form', html: renderStatement(null) },
]

const writeDocument = async (page, { file, html }) => {
  const htmlPath = resolve(OUT_DIR, `${file}.html`)
  await writeFile(htmlPath, html, 'utf-8')
  await page.goto(`file://${htmlPath}`)
  await page.pdf({ path: resolve(OUT_DIR, `${file}.pdf`), format: 'A4', printBackground: true })
  await page.screenshot({ path: resolve(OUT_DIR, `${file}.png`), fullPage: true })
  return file
}

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: A4_PX, deviceScaleFactor: PNG_SCALE })
    for (const doc of documents) {
      process.stdout.write(`생성: ${await writeDocument(page, doc)}\n`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('거래명세서 생성 실패:', error)
  process.exitCode = 1
})
