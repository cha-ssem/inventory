import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { loadInspectionSample } from './helpers.js'

test.describe('센서 모니터링', () => {
  test('누수를 넣으면 긴급 점검 요청이 한 번만 생기고 현장점검 탭에 나온다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/monitor')
    const card = page.locator('[data-robot-id="RV-02"]')
    await expect(card.locator('.robot-state')).toHaveText('정상')
    await card.getByLabel('넣을 이상').selectOption('leak')
    await card.getByRole('button', { name: '이상 넣기' }).click()
    await expect(card.locator('.robot-state')).toHaveAttribute('data-state', 'alert')
    await expect(page.getByTestId('alert-feed')).toContainText('누수 감지 (V1 영상 2호기)')
    // 몇 초 더 지나도 같은 요청을 또 만들지 않는다 (대기 시간 안에서는 재발생도 기록하지 않음)
    await page.waitForTimeout(2500)
    await expect(page.getByTestId('alert-feed').locator('li')).toHaveCount(1)

    await page.goto('/#/inspections')
    await expect(page.getByTestId('insp-open')).toContainText('4')
    await page.getByRole('link', { name: '누수 감지 (V1 영상 2호기)' }).click()
    await expect(page.locator('.detail-list')).toContainText('센서 감지 · 누수 감지 1')
  })

  test('자동 생성을 끄면 이상이 보여도 요청을 만들지 않는다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/monitor')
    await page.getByLabel('기준을 넘으면 점검 요청 자동 생성').uncheck()
    const card = page.locator('[data-robot-id="RV-02"]')
    await card.getByLabel('넣을 이상').selectOption('leak')
    await card.getByRole('button', { name: '이상 넣기' }).click()
    await expect(card.locator('.robot-state')).toHaveAttribute('data-state', 'alert')
    await expect(page.getByTestId('alert-feed').locator('li')).toHaveCount(0)
  })

  test('샘플 로그를 내려받아 다시 올리면 이상 구간을 찾고 점검 요청을 만든다', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/monitor')
    await page.getByLabel('기준을 넘으면 점검 요청 자동 생성').uncheck()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '샘플 로그 내려받기' }).click()
    const file = await (await download).path()
    await page.locator('[data-log-file]').setInputFiles({ name: 'log.csv', mimeType: 'text/csv', buffer: readFileSync(file) })
    await expect(page.getByTestId('log-summary')).toContainText('기준을 넘은 구간')
    await expect(page.locator('.log-result')).toContainText('소나 신호 약함')
    await page.getByRole('button', { name: '선택한 구간으로 점검 요청 만들기' }).click()
    await expect(page.getByTestId('alert-feed')).toContainText('로그 분석: 소나 신호 약함')
  })

  test('다른 화면으로 가면 센서 갱신을 멈춘다 (타이머 정리)', async ({ page }) => {
    await loadInspectionSample(page)
    await page.goto('/#/monitor')
    await page.goto('/#/inspections')
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })
})
