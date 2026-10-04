import { test, expect } from '@playwright/test'
import { FAKE_TOKEN, FAKE_URL, createFakeAppsScript } from './fakeAppsScript.js'
import { loadSample, registerPart, scanAndSubmit } from './helpers.js'

const fillConnection = async (page, token = FAKE_TOKEN) => {
  await page.goto('/#/settings')
  await page.getByLabel('Apps Script 웹 앱 주소').fill(FAKE_URL)
  await page.getByLabel('연결 토큰').fill(token)
}

const connect = async (page) => {
  await fillConnection(page)
  await page.getByRole('button', { name: '연결', exact: true }).click()
  await expect(page.getByTestId('sync-info')).toBeVisible()
}

const syncNow = async (page) => {
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '지금 동기화' }).click()
  await expect(page.locator('#sync-badge')).toHaveAttribute('data-state', 'ok')
}

test.describe('구글 시트 연동', () => {
  test('연결 확인 → 연결하면 상단에 연결 상태가 보인다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    await server.attach(context)
    await fillConnection(page)
    await page.getByRole('button', { name: '연결 확인' }).click()
    await expect(page.getByTestId('sync-test-result')).toContainText('입출고 시험 시트')
    await page.getByRole('button', { name: '연결', exact: true }).click()
    await expect(page.locator('#sync-badge')).toHaveText('시트 연결됨')
  })

  test('토큰이 틀리면 연결하지 않고 이유를 보여준다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    await server.attach(context)
    await fillConnection(page, 'wrongtoken0123456789')
    await page.getByRole('button', { name: '연결 확인' }).click()
    await expect(page.getByTestId('sync-test-result')).toContainText('토큰')
    await expect(page.locator('#sync-badge')).toBeHidden()
  })

  test('두 기기가 같은 시트로 입고·출고를 주고받는다', async ({ browser }) => {
    const server = createFakeAppsScript()
    const deviceA = await browser.newContext()
    const deviceB = await browser.newContext()
    await server.attach(deviceA)
    await server.attach(deviceB)
    const a = await deviceA.newPage()
    const b = await deviceB.newPage()

    await loadSample(a)
    await connect(a) // 시트가 비어 있으므로 이 기기 데이터를 올린다
    expect(server.db.parts).toHaveLength(25)

    await connect(b) // 이 기기가 비어 있으므로 시트 데이터를 받는다
    await b.goto('/#/settings')
    await expect(b.getByTestId('data-summary')).toContainText('부품 25개')

    await b.goto('/#/inbound')
    await scanAndSubmit(b, 'SK-RM-001', { qty: 7, worker: 'B기기' })
    await expect(b.getByTestId('scan-result')).toHaveAttribute('data-state', 'success')
    await syncNow(b)

    await syncNow(a)
    await a.goto('/#/history')
    await expect(a.locator('.table-area')).toContainText('B기기')

    await deviceA.close()
    await deviceB.close()
  })

  test('오프라인에서 입고하면 보낼 목록에 쌓았다가 연결되면 보낸다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    await server.attach(context)
    await registerPart(page, { partNo: 'SK-OFF-01', name: '오프라인 부품' })
    await connect(page)

    server.db.online = false
    await page.goto('/#/inbound')
    await scanAndSubmit(page, 'SK-OFF-01', { qty: 3 })
    await expect(page.locator('#sync-badge')).toContainText('보낼 1건')
    await expect(page.locator('#sync-badge')).toHaveAttribute('data-state', 'offline')

    server.db.online = true
    await syncNow(page)
    await expect(page.locator('#sync-badge')).toHaveText('시트 연결됨')
    expect(server.db.transactions.map((t) => t.partNo)).toEqual(['SK-OFF-01'])
  })

  test('양쪽 모두 데이터가 있으면 어떻게 맞출지 묻는다', async ({ browser }) => {
    const server = createFakeAppsScript()
    const deviceA = await browser.newContext()
    const deviceB = await browser.newContext()
    await server.attach(deviceA)
    await server.attach(deviceB)
    const a = await deviceA.newPage()
    const b = await deviceB.newPage()

    await registerPart(a, { partNo: 'SK-A-01', name: 'A 부품' })
    await connect(a)
    await registerPart(b, { partNo: 'SK-B-01', name: 'B 부품' })
    await fillConnection(b)
    await b.getByRole('button', { name: '연결', exact: true }).click()
    await expect(b.getByRole('dialog')).toContainText('데이터를 어떻게 맞출까요?')
    await b.getByRole('button', { name: /양쪽 합치기/ }).click()
    await expect(b.getByTestId('sync-info')).toBeVisible()
    await b.goto('/#/parts')
    await expect(b.getByTestId('parts-table')).toContainText('SK-A-01')
    await expect(b.getByTestId('parts-table')).toContainText('SK-B-01')

    await deviceA.close()
    await deviceB.close()
  })

  test('연결 해제하면 상단 표시가 사라지고 이 기기 데이터는 남는다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    await server.attach(context)
    await registerPart(page, { partNo: 'SK-KEEP-02', name: '남는 부품' })
    await connect(page)
    await page.getByRole('button', { name: '연결 해제' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '연결 해제' }).click()
    await expect(page.locator('#sync-badge')).toBeHidden()
    await expect(page.getByTestId('data-summary')).toContainText('부품 1개')
  })
})
