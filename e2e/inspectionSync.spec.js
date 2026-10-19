import { test, expect } from '@playwright/test'
import { FAKE_TOKEN, FAKE_URL, createFakeAppsScript } from './fakeAppsScript.js'
import { loadInspectionSample } from './helpers.js'

const connect = async (page) => {
  await page.goto('/#/settings')
  await page.getByLabel('Apps Script 웹 앱 주소').fill(FAKE_URL)
  await page.getByLabel('연결 토큰').fill(FAKE_TOKEN)
  await page.getByRole('button', { name: '연결', exact: true }).click()
  await expect(page.getByTestId('sync-info')).toBeVisible()
}

const syncNow = async (page) => {
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '지금 동기화' }).click()
  await expect(page.locator('#sync-badge')).toHaveAttribute('data-state', 'ok')
}

test('현장(휴대폰)에서 점검을 시작하면 사무실 PC에도 반영된다 (같은 구글 시트 연결)', async ({ browser }) => {
  const server = createFakeAppsScript()
  const office = await browser.newContext()
  const field = await browser.newContext()
  await server.attach(office)
  await server.attach(field)
  const pc = await office.newPage()
  const phone = await field.newPage()

  await loadInspectionSample(pc)
  await connect(pc)
  expect(server.db.sites).toHaveLength(8)

  await connect(phone)
  await phone.goto('/#/inspections')
  await expect(phone.getByTestId('insp-open')).toContainText('3')

  // 휴대폰: 배정된 누수 점검(YP-R-009)을 시작
  await phone.goto('/#/inspection?id=YP-R-009')
  await phone.getByRole('button', { name: '점검 시작' }).click()
  await phone.getByRole('dialog').getByRole('button', { name: '점검 시작' }).click()
  await expect(phone.locator('.badge-st-IN_PROGRESS')).toBeVisible()
  await syncNow(phone)

  await syncNow(pc)
  await pc.goto('/#/inspection?id=YP-R-009')
  await expect(pc.locator('.badge-st-IN_PROGRESS')).toBeVisible()

  await office.close()
  await field.close()
})

test('예전 Apps Script에 연결해도 입출고 동기화는 되고, 다시 배포하라고 안내한다', async ({ page, context }) => {
  const server = createFakeAppsScript()
  server.db.inspectionSupported = false
  await server.attach(context)
  await loadInspectionSample(page)
  await connect(page)
  await expect(page.locator('#sync-badge')).toHaveAttribute('data-state', 'ok')
  await expect(page.locator('.sync-slot')).toContainText('다시 배포')
})
