import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { FAKE_TOKEN, FAKE_URL, createFakeAppsScript } from './fakeAppsScript.js'
import { registerPart, scanAndSubmit } from './helpers.js'

test('스마트폰 화면에서 입고할 수 있고 가로 스크롤이 생기지 않는다', async ({ page }) => {
  await registerPart(page, { partNo: 'SK-MOB-01', name: '모바일 부품' })
  await page.goto('/#/inbound')
  await scanAndSubmit(page, 'SK-MOB-01')
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'success')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('스마트폰에서 서류 사진으로 입고할 수 있고 가로 스크롤이 생기지 않는다', async ({ page, context }) => {
  const server = createFakeAppsScript()
  server.db.ocrResult = {
    statementNo: 'DS-2610-0012',
    date: '2026-10-02',
    supplier: '대한수지(가상)',
    items: [{ ourPartNo: 'SK-MOB-02', supplierCode: 'DH-PP-25', name: '모바일 수지', spec: '25kg/포', unit: 'BAG', qty: 40 }],
  }
  await server.attach(context)
  await registerPart(page, { partNo: 'SK-MOB-02', name: '모바일 수지' })
  await page.goto('/#/settings')
  await page.getByLabel('Apps Script 웹 앱 주소').fill(FAKE_URL)
  await page.getByLabel('연결 토큰').fill(FAKE_TOKEN)
  await page.getByRole('button', { name: '연결', exact: true }).click()
  await expect(page.locator('#sync-badge')).toHaveText('시트 연결됨')

  await page.goto('/#/inbound-ocr')
  await page.getByTestId('ocr-file').setInputFiles(resolve(import.meta.dirname, '../../materials/statement-forms/sample-01-resin.png'))
  await page.getByRole('button', { name: '일괄 입력 (1개)' }).click()
  await expect(page.getByTestId('ocr-done')).toContainText('1개 품목을 입고했습니다')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
