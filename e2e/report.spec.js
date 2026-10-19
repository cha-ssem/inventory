import { test, expect } from '@playwright/test'
import { loadInspectionSample } from './helpers.js'

const newWeeklyReport = async (page) => {
  await page.goto('/#/reports')
  await page.getByRole('button', { name: '새 보고서' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('기간 *').selectOption('WEEKLY')
  await dialog.getByLabel('작성자').fill('김수중')
  await dialog.getByRole('button', { name: '초안 만들기' }).click()
  await expect(page.getByTestId('report-sheet')).toBeVisible()
}

test.describe('점검 보고서', () => {
  test('주간 초안을 만들고 → 문장을 고치면 미리 보기에 바로 보이고 → 확정 → 수정본(버전 2)을 만든다', async ({ page }) => {
    await loadInspectionSample(page)
    await newWeeklyReport(page)
    const sheet = page.getByTestId('report-sheet')
    await expect(sheet).toContainText('주간 점검 보고서')
    await expect(sheet).toContainText('초안 (확정 전)')
    await expect(sheet.locator('.rs-stat').first()).toContainText('완료')

    await page.getByLabel('요약').fill('이번 주 주요 현장 점검을 모두 마쳤습니다.')
    await expect(sheet.locator('[data-section="summary"]')).toContainText('이번 주 주요 현장 점검을 모두 마쳤습니다.')
    await page.getByRole('button', { name: '저장', exact: true }).click()

    await page.getByRole('button', { name: '확정', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '확정' }).click()
    await expect(page.locator('.page-head .badge-rp-FINALIZED')).toBeVisible()
    await expect(page.getByLabel('요약')).toHaveCount(0)
    await expect(sheet).toContainText('이번 주 주요 현장 점검을 모두 마쳤습니다.')

    await page.getByRole('button', { name: '수정본 만들기' }).click()
    await expect(page.getByTestId('report-sheet')).toContainText('버전 2')
    await expect(page.getByLabel('요약')).toHaveValue('이번 주 주요 현장 점검을 모두 마쳤습니다.')

    await page.goto('/#/reports')
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('확정본은 인쇄로 PDF를 저장하고, 인쇄할 때는 보고서만 보인다', async ({ page }) => {
    await loadInspectionSample(page)
    await newWeeklyReport(page)
    await page.getByRole('button', { name: '확정', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '확정' }).click()
    await page.evaluate(() => {
      window.__printed = 0
      window.print = () => (window.__printed += 1)
    })
    await page.getByRole('button', { name: 'PDF 저장 (인쇄)' }).click()
    expect(await page.evaluate(() => window.__printed)).toBe(1)

    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.app-header')).toBeHidden()
    await expect(page.getByTestId('section-banner')).toBeHidden()
    await expect(page.locator('.page-head')).toBeHidden()
    await expect(page.getByTestId('report-sheet')).toBeVisible()
  })

  test('초안은 지울 수 있다', async ({ page }) => {
    await loadInspectionSample(page)
    await newWeeklyReport(page)
    await page.getByRole('button', { name: '삭제' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '지우기' }).click()
    await expect(page.locator('.table-area')).toContainText('아직 만든 보고서가 없습니다')
  })

  test('현장을 하나도 고르지 않으면 만들지 않는다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/reports')
    await page.getByRole('button', { name: '새 보고서' }).click()
    const dialog = page.getByRole('dialog')
    for (const box of await dialog.locator('[name="siteId"]').all()) await box.uncheck()
    await dialog.getByRole('button', { name: '초안 만들기' }).click()
    await expect(dialog.locator('[data-form-error]')).toContainText('현장')
  })
})
