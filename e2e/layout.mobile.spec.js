import { test, expect } from '@playwright/test'
import { loadInspectionSample, loadSample } from './helpers.js'

// 휴대폰(Pixel 7, 412px 폭)과 작은 휴대폰(360px)에서 메뉴·표·체크박스가 쓰기 좋게 나오는지
const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

for (const width of [412, 360]) {
  test.describe(`${width}px 화면`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 860 })
      await loadSample(page)
      await loadInspectionSample(page)
    })

    test('메뉴는 옆으로 밀지 않아도 모두 보이고, 입출고와 확장 메뉴가 두 줄로 나뉜다', async ({ page }) => {
      await page.goto('/#/')
      const links = page.locator('.app-nav a')
      await expect(links).toHaveCount(10)
      const boxes = await links.evaluateAll((els) => els.map((el) => ({ text: el.textContent.trim(), ...el.getBoundingClientRect().toJSON() })))
      boxes.forEach((b) => {
        expect(b.left, b.text).toBeGreaterThanOrEqual(0)
        expect(b.right, b.text).toBeLessThanOrEqual(width)
      })
      const top = (text) => boxes.find((b) => b.text === text).top
      // 입출고 6개는 한 줄, 확장 메뉴와 설정은 다음 줄
      expect(new Set(['대시보드', '입고', '출고', '재고 현황', '이력', '부품 관리'].map(top)).size).toBe(1)
      expect(new Set(['현장점검', '모니터링', '보고서', '설정'].map(top)).size).toBe(1)
      expect(top('현장점검')).toBeGreaterThan(top('대시보드'))
      await page.getByRole('link', { name: '보고서', exact: true }).click()
      await expect(page).toHaveURL(/#\/reports/)
    })

    test('재고 현황은 품목마다 카드로 보이고, 부족 품목은 빨간 테두리', async ({ page }) => {
      await page.goto('/#/stock')
      const table = page.getByTestId('stock-table')
      await expect(table.locator('thead')).toBeHidden()
      const card = table.locator('tbody tr').first()
      await expect(card).toHaveCSS('display', 'flex')
      await expect(card.locator('td.card-title')).toBeVisible()
      await expect(table.locator('tr.is-low').first()).toHaveCSS('border-top-color', 'rgb(194, 42, 42)')
      expect(await fitsWidth(page)).toBe(true)
      // 카드 안의 모든 칸이 화면 안에 있다 (옆으로 밀 필요 없음)
      const rights = await card.locator('td').evaluateAll((tds) => tds.map((td) => td.getBoundingClientRect().right))
      rights.forEach((r) => expect(r).toBeLessThanOrEqual(width))
    })

    test('현장점검 목록은 요청마다 카드로 보이고, 제목을 누르면 상세로 간다', async ({ page }) => {
      await page.goto('/#/inspections')
      const card = page.locator('.inspection-table tbody tr').first()
      await expect(card).toHaveCSS('display', 'flex')
      await expect(card.locator('td[data-label="현장"]')).toBeVisible()
      const rights = await card.locator('td').evaluateAll((tds) => tds.map((td) => td.getBoundingClientRect().right))
      rights.forEach((r) => expect(r).toBeLessThanOrEqual(width))
      await card.locator('td.card-title a').click()
      await expect(page).toHaveURL(/#\/inspection\?id=/)
    })

    test('부품 관리 표의 체크박스는 손가락으로 누르기 좋은 크기다', async ({ page }) => {
      await page.goto('/#/parts')
      const box = await page.locator('td input[type="checkbox"]').first().boundingBox()
      expect(box.width).toBeGreaterThanOrEqual(24)
      expect(box.height).toBeGreaterThanOrEqual(24)
    })
  })
}
