import { test, expect } from '@playwright/test'
import { registerPart, scanAndSubmit } from './helpers.js'

test('스마트폰 화면에서 입고할 수 있고 가로 스크롤이 생기지 않는다', async ({ page }) => {
  await registerPart(page, { partNo: 'SK-MOB-01', name: '모바일 부품' })
  await page.goto('/#/inbound')
  await scanAndSubmit(page, 'SK-MOB-01')
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'success')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
