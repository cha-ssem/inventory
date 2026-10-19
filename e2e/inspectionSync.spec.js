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

test('두 기기가 같은 로봇의 누수를 동시에 감지해도, 동기화 뒤 열린 요청은 하나다', async ({ browser }) => {
  const server = createFakeAppsScript()
  const one = await browser.newContext()
  const two = await browser.newContext()
  await server.attach(one)
  await server.attach(two)
  const a = await one.newPage()
  const b = await two.newPage()
  await loadInspectionSample(a)
  await connect(a)
  await connect(b)

  // 동기화 전에 두 기기가 각자 감지 → 각자 요청을 만든다
  for (const page of [a, b]) {
    await page.goto('/#/monitor')
    const card = page.locator('[data-robot-id="RV-02"]')
    await card.getByLabel('넣을 이상').selectOption('leak')
    await card.getByRole('button', { name: '이상 넣기' }).click()
    await expect(page.getByTestId('alert-feed')).toContainText('누수 감지 (V1 영상 2호기)')
  }
  await syncNow(a)
  await syncNow(b)
  await syncNow(a)

  for (const page of [a, b]) {
    await page.goto('/#/inspections')
    await expect(page.getByTestId('insp-open')).toContainText('4')
    await expect(page.getByRole('link', { name: '누수 감지 (V1 영상 2호기)' })).toHaveCount(1)
  }
  await one.close()
  await two.close()
})
