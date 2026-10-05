// 강사용 교재(강의 내용 전체, A4 인쇄용 PDF)를 만든다. 내용은 guide.html을 고친다.
// 실행: npm run instructor-guide  →  ../materials/instructor-guide/instructor-guide.pdf
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../../../materials/instructor-guide')
const MAX_PAGES = 40 // 인쇄 부담이 커지지 않게 상한을 둔다

const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length

const FOOTER = `<div style="width:100%;font-size:7.5pt;color:#666;padding:0 13mm;display:flex;justify-content:space-between;font-family:sans-serif">
  <span>강사용 교재 · 2026-10-07 · 배포 금지(정답 포함)</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true })
  const htmlPath = resolve(OUT_DIR, 'instructor-guide.html')
  await copyFile(resolve(HERE, 'guide.html'), htmlPath)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`file://${htmlPath}`)
    const pdfPath = resolve(OUT_DIR, 'instructor-guide.pdf')
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER,
    })
    const pages = countPages(await readFile(pdfPath))
    if (pages > MAX_PAGES) throw new Error(`${pages}쪽입니다. ${MAX_PAGES}쪽 안으로 줄이세요.`)
    process.stdout.write(`생성: ${pdfPath} (${pages}쪽)\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('강사용 교재 생성 실패:', error.message)
  process.exitCode = 1
})
