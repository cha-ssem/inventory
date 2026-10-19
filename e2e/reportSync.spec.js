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

const newDraft = async (page) => {
  await page.goto('/#/reports')
  await page.getByRole('button', { name: '새 보고서' }).click()
  await page.getByRole('dialog').getByLabel('기간 *').selectOption('WEEKLY')
  await page.getByRole('dialog').getByRole('button', { name: '초안 만들기' }).click()
}

test('한 기기에서 확정·제출한 보고서가 다른 기기의 보고서 목록에도 보인다 (초안은 안 보임)', async ({ browser }) => {
  const server = createFakeAppsScript()
  const office = await browser.newContext()
  const field = await browser.newContext()
  await server.attach(office)
  await server.attach(field)
  const pc = await office.newPage()
  const phone = await field.newPage()

  await loadInspectionSample(pc)
  await connect(pc)
  await connect(phone)

  // PC: 초안 하나는 그대로 두고, 하나는 확정 후 제출
  await newDraft(pc)
  await newDraft(pc)
  await pc.getByRole('button', { name: '확정', exact: true }).click()
  await pc.getByRole('dialog').getByRole('button', { name: '확정' }).click()
  await expect(pc.locator('.page-head .badge-rp-FINALIZED')).toBeVisible()
  await pc.getByRole('button', { name: '제출 (시트 기록·메일)' }).click()
  await pc.getByRole('dialog').getByRole('button', { name: '제출' }).click()
  await expect(pc.locator('.page-head .badge-rp-SUBMITTED')).toBeVisible()
  await syncNow(pc)

  await syncNow(phone)
  await phone.goto('/#/reports')
  const rows = phone.locator('tr[data-report-id]')
  await expect(rows).toHaveCount(1)
  await expect(rows.first().locator('.badge-rp-SUBMITTED')).toBeVisible()
  await rows.first().getByRole('link').click()
  await expect(phone.getByTestId('report-sheet')).toContainText('메일 보냄')

  await office.close()
  await field.close()
})
