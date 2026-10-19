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

test.describe('현장점검 흐름', () => {
  test('요청 등록 → 배정 → 시작 → 완료하면 쓴 부품이 출고되고 이력에 남는다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/inspections')
    await expect(page.getByTestId('insp-open')).toContainText('3')

    await page.getByRole('button', { name: '점검 요청 등록' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('현장 *').selectOption({ label: '가람대교 교각 P7' })
    await dialog.getByLabel('우선순위 *').selectOption('HIGH')
    await dialog.getByLabel('점검 제목 *').fill('교각 세굴 긴급 점검')
    await dialog.getByLabel('작성자').fill('김수중')
    await dialog.getByRole('button', { name: '요청 등록' }).click()
    await expect(page.getByTestId('insp-open')).toContainText('4')

    await page.getByRole('link', { name: '교각 세굴 긴급 점검' }).click()
    await expect(page.getByRole('heading', { name: '교각 세굴 긴급 점검' })).toBeVisible()

    await page.getByRole('button', { name: '담당자 배정' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('담당자 *').fill('이로봇')
    await dialog.getByRole('button', { name: '배정' }).click()

    await page.getByRole('button', { name: '점검 시작' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '점검 시작' }).click()

    await page.getByRole('button', { name: '점검 완료' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('점검 결과 *').selectOption('ISSUE')
    await dialog.getByLabel('점검 내용').fill('교각 기초부 세굴 0.5m')
    await dialog.getByRole('button', { name: '+ 부품 추가' }).click()
    await dialog.getByLabel('사용 부품').selectOption('YP-SP-001')
    await dialog.getByLabel('사용 수량').fill('2')
    await dialog.getByRole('button', { name: '완료' }).click()

    await expect(page.locator('.page-head')).not.toContainText('점검 완료')
    await expect(page.getByText('교각 기초부 세굴 0.5m')).toBeVisible()
    await expect(page.locator('.timeline li')).toHaveCount(4)

    // 실링 키트 초기 재고 10×3=30 → 2개 출고
    await page.goto('/#/stock')
    await expect(page.locator('tr[data-part-no="YP-SP-001"] td.stock')).toHaveText('28')
    await page.goto('/#/history')
    await expect(page.locator('.table-area')).toContainText('현장점검')
  })

  test('재고보다 많이 쓰면 완료되지 않고 이유를 보여 준다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/inspection?id=YP-R-010')
    await page.getByRole('button', { name: '점검 완료' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('점검 결과 *').selectOption('OK')
    await dialog.getByRole('button', { name: '+ 부품 추가' }).click()
    await dialog.getByLabel('사용 부품').selectOption('YP-SP-004')
    await dialog.getByLabel('사용 수량').fill('99')
    await dialog.getByRole('button', { name: '완료' }).click()
    await expect(dialog.locator('[data-form-error]')).toContainText('현재고')
    await dialog.getByRole('button', { name: '닫기', exact: true }).first().click()
    await expect(page.getByRole('button', { name: '점검 완료' })).toBeVisible()
  })

  test('샘플이 없으면 설정으로 안내한다', async ({ page }) => {
    await page.goto('/#/inspections')
    await expect(page.locator('.table-area')).toContainText('영풍산업 현장점검 샘플')
  })
})
