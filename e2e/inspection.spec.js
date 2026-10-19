import { test, expect } from '@playwright/test'
import { loadInspectionSample, loadSample } from './helpers.js'

test.describe('영풍산업 현장점검', () => {
  test('샘플을 불러오면 기존 입출고 데이터는 두고 로봇 부품과 재고만 더한다', async ({ page }) => {
    await loadSample(page)
    await loadInspectionSample(page)
    await expect(page.getByTestId('data-summary')).toContainText('부품 38개')

    await page.goto('/#/stock')
    await expect(page.locator('tr[data-part-no="SK-AD-001"]')).toBeVisible()
    // 초기 재고 4×3=12개에서 샘플 점검(YP-R-003)에 1개를 썼다
    await expect(page.locator('tr[data-part-no="YP-RV-001"] td.stock')).toHaveText('11')

    // 다시 불러와도 부품·기록이 두 번 들어가지 않는다
    await loadInspectionSample(page)
    await expect(page.getByTestId('data-summary')).toContainText('부품 38개')
    await page.goto('/#/stock')
    await expect(page.locator('tr[data-part-no="YP-RV-001"] td.stock')).toHaveText('11')
  })

  test('점검 데이터 지우기는 입출고 데이터를 건드리지 않는다', async ({ page }) => {
    await loadSample(page)
    await loadInspectionSample(page)
    await page.getByRole('button', { name: '점검 데이터 지우기' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '지우기' }).click()
    await expect(page.getByTestId('inspection-summary')).toContainText('현장 0곳')
    await expect(page.getByTestId('data-summary')).toContainText('부품 38개')
  })

  test('새로고침해도 점검 데이터가 남는다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.reload()
    await expect(page.getByTestId('inspection-summary')).toContainText('현장 8곳')
  })
})
