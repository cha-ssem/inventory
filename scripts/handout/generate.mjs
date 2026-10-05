// 참석자 배포용 자료 폴더와 zip을 만든다. 정답 파일은 넣지 않는다.
// 실행: npm run handout  →  ../materials/handout/AI활용강의_실습자료/ (+ .zip)
// 먼저 materials/excel-practice(python3 generate.py), npm run statements, npm run prompt-sheet 결과가 있어야 한다.
import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { COURSE, FILES } from './content.js'
import { renderHandout, renderPromptText } from './template.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MATERIALS = resolve(HERE, '../../../materials')
const OUT_ROOT = resolve(MATERIALS, 'handout')
const OUT_DIR = resolve(OUT_ROOT, COURSE.folder)

// 배포 폴더 이름 ← 원본 위치. 정답(부품목록_정답.xlsx)은 넣지 않는다.
const COPIES = {
  '프롬프트_모음집.pdf': 'prompt-sheet/prompt-sheet.pdf',
  '부품목록_실습.xlsx': 'excel-practice/부품목록_실습.xlsx',
  '거래명세서_1_대한수지.png': 'statement-forms/sample-01-resin.png',
  '거래명세서_2_동방부품.png': 'statement-forms/sample-02-parts.png',
  '거래명세서_3_세진포장.png': 'statement-forms/sample-03-packing.png',
}

const FOOTER = `<div style="width:100%;font-size:7.5pt;color:#666;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif">
  <span>실습 안내 · ${COURSE.date}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`

const buildPdf = async (htmlPath, pdfPath) => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`file://${htmlPath}`)
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: FOOTER })
  } finally {
    await browser.close()
  }
}

// 한국어 윈도우에서 파일 이름이 깨지지 않도록 UTF-8 표시가 붙는 파이썬 zipfile로 묶는다
// (macOS 기본 zip 명령은 이 표시를 붙이지 않아 윈도우 탐색기에서 이름이 깨질 수 있다)
const ZIP_SCRIPT = `
import os, sys, zipfile
root, folder, out = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(os.path.join(root, folder)):
        for f in sorted(files):
            if f.startswith('.'):
                continue
            full = os.path.join(base, f)
            z.write(full, os.path.relpath(full, root))
`

const zipFolder = async () => {
  const zipPath = `${OUT_DIR}.zip`
  await rm(zipPath, { force: true })
  try {
    await promisify(execFile)('python3', ['-c', ZIP_SCRIPT, OUT_ROOT, COURSE.folder, zipPath])
    return zipPath
  } catch (error) {
    console.error('zip 만들기 실패 (폴더는 그대로 쓸 수 있음):', error.message)
    return null
  }
}

const main = async () => {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  for (const [name, from] of Object.entries(COPIES)) {
    const src = resolve(MATERIALS, from)
    await access(src).catch(() => {
      throw new Error(`원본이 없습니다: materials/${from}`)
    })
    await copyFile(src, resolve(OUT_DIR, name))
  }
  await writeFile(resolve(OUT_DIR, '실습_프롬프트.txt'), `﻿${renderPromptText()}`, 'utf-8')
  const htmlPath = resolve(OUT_ROOT, 'handout.html')
  await writeFile(htmlPath, renderHandout(), 'utf-8')
  await buildPdf(htmlPath, resolve(OUT_DIR, '실습안내.pdf'))

  const missing = []
  for (const f of FILES) await access(resolve(OUT_DIR, f.name)).catch(() => missing.push(f.name))
  if (missing.length > 0) throw new Error(`안내서 목록에 있는데 폴더에 없는 파일: ${missing.join(', ')}`)
  const zipPath = await zipFolder()
  process.stdout.write(`생성: ${OUT_DIR}/ (${FILES.length}개 파일)${zipPath ? `\n압축: ${zipPath}` : ''}\n`)
}

main().catch((error) => {
  console.error('배포 자료 생성 실패:', error.message)
  process.exitCode = 1
})
