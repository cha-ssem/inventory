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

const finalizedReport = async (page) => {
  await page.goto('/#/reports')
  await page.getByRole('button', { name: '새 보고서' }).click()
  await page.getByRole('dialog').getByLabel('기간 *').selectOption('WEEKLY')
  await page.getByRole('dialog').getByRole('button', { name: '초안 만들기' }).click()
  await page.getByRole('button', { name: '확정', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '확정' }).click()
  await expect(page.locator('.page-head .badge-rp-FINALIZED')).toBeVisible()
}

const submit = async (page) => {
  await page.getByRole('button', { name: '제출 (시트 기록·메일)' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '제출' }).click()
}

test.describe('보고서 제출', () => {
  test('확정본을 제출하면 시트에 기록되고 메일이 한 번 나가며, 상태가 "제출 완료 · 메일 보냄"이 된다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    await server.attach(context)
    await loadInspectionSample(page)
    await connect(page)
    await finalizedReport(page)
    await submit(page)

    await expect(page.locator('.page-head .badge-rp-SUBMITTED')).toBeVisible()
    await expect(page.getByTestId('report-sheet')).toContainText('제출 완료')
    await expect(page.getByTestId('report-sheet')).toContainText('메일 보냄')
    await expect(page.getByRole('button', { name: '메일 다시 보내기' })).toHaveCount(0)
    expect(server.db.reports).toHaveLength(1)
    expect(server.db.mails).toHaveLength(1)
    expect(server.db.mails[0].subject).toMatch(/^\[점검 보고서\] 주간 점검 보고서/)

    await page.goto('/#/reports')
    await expect(page.locator('tbody .badge-rp-SUBMITTED')).toBeVisible()
  })

  test('메일이 실패하면 시트 기록은 남고 [메일 다시 보내기]로 메일만 다시 보낸다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    server.db.mailFails = true
    await server.attach(context)
    await loadInspectionSample(page)
    await connect(page)
    await finalizedReport(page)
    await submit(page)
    await expect(page.getByTestId('report-sheet')).toContainText('메일 못 보냄')
    await expect(page.locator('#toasts')).toContainText('메일을 보내지 못했습니다')

    server.db.mailFails = false
    await page.getByRole('button', { name: '메일 다시 보내기' }).click()
    await expect(page.getByTestId('report-sheet')).toContainText('메일 보냄')
    expect(server.db.reports).toHaveLength(1)
    expect(server.db.mails).toHaveLength(1)
  })

  test('연결하지 않았으면 제출하지 않고 안내한다', async ({ page }) => {
    await loadInspectionSample(page)
    await finalizedReport(page)
    await page.getByRole('button', { name: '제출 (시트 기록·메일)' }).click()
    await expect(page.locator('#toasts')).toContainText('구글 시트(Apps Script)에 연결')
    await expect(page.locator('.page-head .badge-rp-FINALIZED')).toBeVisible()
  })

  test('초안에는 제출 단추가 없다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/reports')
    await page.getByRole('button', { name: '새 보고서' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '초안 만들기' }).click()
    await expect(page.getByTestId('report-sheet')).toBeVisible()
    await expect(page.getByRole('button', { name: '제출 (시트 기록·메일)' })).toHaveCount(0)
  })
})
