// 강의 한 장 요약 인포그래픽(A4 세로)을 PDF·PNG로 만든다. 내용은 infographic.html을 고친다.
// 실행: npm run infographic  →  ../materials/infographic/
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../../../materials/infographic')
const NAME = '강의_한장요약'
const A4_PX = { width: 794, height: 1123 }

const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true })
  const htmlPath = resolve(OUT_DIR, `${NAME}.html`)
  await copyFile(resolve(HERE, 'infographic.html'), htmlPath)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: A4_PX, deviceScaleFactor: 3 })
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    // 내용이 A4 한 장을 넘으면 실패로 알린다
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.page')
      return el.scrollHeight - el.clientHeight
    })
    if (overflow > 0) throw new Error(`내용이 A4 한 장보다 ${overflow}px 깁니다.`)
    const pdfPath = resolve(OUT_DIR, `${NAME}.pdf`)
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true })
    await page.screenshot({ path: resolve(OUT_DIR, `${NAME}.png`), fullPage: true })
    const pages = countPages(await readFile(pdfPath))
    if (pages !== 1) throw new Error(`PDF가 ${pages}쪽입니다.`)
    process.stdout.write(`생성: ${OUT_DIR}/${NAME}.{pdf,png} (1쪽)\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('인포그래픽 생성 실패:', error.message)
  process.exitCode = 1
})
