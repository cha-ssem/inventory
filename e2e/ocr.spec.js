import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { STATEMENTS } from '../scripts/statements/data.js'
import { FAKE_TOKEN, FAKE_URL, createFakeAppsScript } from './fakeAppsScript.js'
import { loadSample } from './helpers.js'

// 가상 거래명세서 견본(materials/statement-forms)을 AI가 읽었다고 치고 같은 내용을 돌려준다
const asOcrResult = (file) => {
  const s = STATEMENTS.find((st) => st.file === file)
  return {
    statementNo: s.no,
    date: s.date,
    supplier: s.supplier.name,
    items: s.items.map((i) => ({ ourPartNo: i.partNo, supplierCode: i.code, name: i.name, spec: i.spec, unit: i.unit, qty: i.qty })),
  }
}
const imageOf = (file) => resolve(import.meta.dirname, '../../materials/statement-forms', `${file}.png`)

const connect = async (page) => {
  await page.goto('/#/settings')
  await page.getByLabel('Apps Script 웹 앱 주소').fill(FAKE_URL)
  await page.getByLabel('연결 토큰').fill(FAKE_TOKEN)
  await page.getByRole('button', { name: '연결', exact: true }).click()
  await expect(page.locator('#sync-badge')).toHaveText('시트 연결됨')
}

const upload = async (page, file) => {
  await page.goto('/#/inbound')
  await page.getByRole('link', { name: '📄 서류 사진으로 입고' }).click()
  await page.getByTestId('ocr-file').setInputFiles(imageOf(file))
  await expect(page.getByTestId('ocr-table')).toBeVisible()
}

// 부품 고르기 목록에도 품명이 들어 있으므로, 서류 품목 칸의 품명으로만 행을 찾는다
const rowOf = (page, name) => page.getByTestId('ocr-row').filter({ has: page.locator('.ocr-doc strong').getByText(name, { exact: true }) })

const setup = async (page, context, file) => {
  const server = createFakeAppsScript()
  server.db.ocrResult = asOcrResult(file)
  await server.attach(context)
  await loadSample(page)
  await connect(page)
  return server
}

test.describe('서류 사진으로 입고', () => {
  test('구글 시트에 연결하지 않았으면 연결 안내를 보여준다', async ({ page }) => {
    await page.goto('/#/inbound-ocr')
    await expect(page.getByTestId('ocr-not-connected')).toContainText('구글 시트 연결이 필요합니다')
  })

  test('사진을 올리면 검수 후 일괄 입고하고, 새 부품 연결을 기억한다', async ({ page, context }) => {
    const server = await setup(page, context, 'sample-03-packing')
    await upload(page, 'sample-03-packing')
    expect(server.db.ocrFiles).toEqual(['image/jpeg'])

    await expect(page.getByLabel('공급자 (거래처로 저장)')).toHaveValue('세진포장(가상)')
    await expect(page.getByLabel('명세서 번호 (메모로 저장)')).toHaveValue('SJ-26100045')
    await expect(rowOf(page, '포장 박스 (중)').getByTestId('ocr-status')).toHaveText('정상')
    await expect(rowOf(page, '포장 테이프').getByTestId('ocr-status')).toHaveText('품번 미확인')
    await expect(page.getByTestId('ocr-summary')).toContainText('넣을 품목 2개 · 확인 필요 1개')

    // 마스터에 없는 품목은 새 부품으로 등록한다 (품명·규격이 미리 채워짐)
    await rowOf(page, '포장 테이프').getByRole('combobox').selectOption('__new__')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('품명 *')).toHaveValue('포장 테이프')
    await dialog.getByLabel('품번 *').fill('SK-SB-006')
    await dialog.getByRole('button', { name: '등록' }).click()
    await expect(rowOf(page, '포장 테이프').getByTestId('ocr-status')).toHaveText('정상')

    await page.getByLabel('작업자').fill('김자재')
    await page.getByRole('button', { name: '일괄 입력 (3개)' }).click()
    await expect(page.getByTestId('ocr-done')).toContainText('3개 품목을 입고했습니다')

    await expect.poll(() => server.db.mappings.map((m) => [m.supplierCode, m.partNo])).toEqual([['SJ-TP-48', 'SK-SB-006']])
    await page.getByRole('link', { name: '이력 보기' }).click()
    await expect(page.locator('tbody tr').first()).toContainText('SJ-26100045')
    await expect(page.locator('tbody tr').first()).toContainText('세진포장(가상)')
  })

  test('같은 명세서를 다시 올리면 경고하고, 확인해야 입고한다', async ({ page, context }) => {
    await setup(page, context, 'sample-01-resin')
    await upload(page, 'sample-01-resin')
    await page.getByRole('button', { name: '일괄 입력 (4개)' }).click()
    await expect(page.getByTestId('ocr-done')).toBeVisible()

    await upload(page, 'sample-01-resin')
    await expect(page.getByTestId('ocr-duplicate')).toContainText('이미 입고한 명세서입니다')
    await page.getByRole('button', { name: '일괄 입력 (4개)' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '취소' }).click()
    await expect(page.getByTestId('ocr-table')).toBeVisible()
  })

  test('수량 오류 행은 고치거나 빼고 입고할 수 있다', async ({ page, context }) => {
    const server = await setup(page, context, 'sample-02-parts')
    server.db.ocrResult.items[0].qty = null
    await upload(page, 'sample-02-parts')

    // 품번이 없는 행은 품명이 같은 부품으로 연결하되, 확인하라고 알린다. [맞음]을 누른 것만 기억한다.
    await expect(rowOf(page, '고무 패킹')).toContainText('품명이 같아 연결')
    await rowOf(page, '고무 패킹').getByRole('button', { name: '맞음' }).click()
    await expect(rowOf(page, '고무 패킹')).toContainText('직접 고름')
    await expect(rowOf(page, '체결 클립').getByTestId('ocr-status')).toHaveText('수량 오류')

    await rowOf(page, '체결 클립').getByLabel('체결 클립 수량').fill('30')
    await rowOf(page, '체결 클립').getByLabel('체결 클립 수량').press('Tab')
    await expect(rowOf(page, '체결 클립').getByTestId('ocr-status')).toHaveText('정상')

    await rowOf(page, '페달 스토퍼').getByRole('checkbox').uncheck()
    await expect(page.getByTestId('ocr-summary')).toContainText('넣을 품목 4개 · 확인 필요 0개 · 뺀 품목 1개')
    await page.getByRole('button', { name: '일괄 입력 (4개)' }).click()
    await expect(page.getByTestId('ocr-done')).toContainText('4개 품목을 입고했습니다')
    await expect.poll(() => server.db.mappings.map((m) => m.supplierCode)).toEqual(['DB-PK-NBR'])
  })

  test('명세서 번호를 못 읽었으면 중복 확인을 못 한다고 알린다', async ({ page, context }) => {
    const server = await setup(page, context, 'sample-01-resin')
    server.db.ocrResult.statementNo = ''
    await upload(page, 'sample-01-resin')
    await expect(page.getByTestId('ocr-no-number')).toBeVisible()
    await page.getByLabel('명세서 번호 (메모로 저장)').fill('DS-2610-0012')
    await page.getByLabel('작업자').click()
    await expect(page.getByTestId('ocr-no-number')).toBeHidden()
  })

  test('4쪽 이상 PDF는 서버로 보내지 않고 안내한다', async ({ page, context }) => {
    const server = await setup(page, context, 'sample-01-resin')
    const pages = Array.from({ length: 4 }, () => '<< /Type /Page >>').join('\n')
    await page.goto('/#/inbound-ocr')
    await page.getByTestId('ocr-file').setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n${pages}\n%%EOF`) })
    await expect(page.getByTestId('ocr-error')).toContainText('3쪽까지만')
    expect(server.db.ocrFiles).toEqual([])
  })

  test('서버가 거부하면 이유를 보여주고 다시 올릴 수 있다', async ({ page, context }) => {
    const server = await setup(page, context, 'sample-01-resin')
    server.db.ocrResult = { ok: false, code: 'OCR_QUOTA', error: '오늘 서류 읽기 한도(50회)를 다 썼습니다.' }
    await page.goto('/#/inbound-ocr')
    await page.getByTestId('ocr-file').setInputFiles(imageOf('sample-01-resin'))
    await expect(page.getByTestId('ocr-error')).toContainText('한도')
    await expect(page.getByText('서류 사진 찍기 · 파일 고르기')).toBeVisible()
  })
})
