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

const newWeeklyReport = async (page) => {
  await page.goto('/#/reports')
  await page.getByRole('button', { name: '새 보고서' }).click()
  await page.getByRole('dialog').getByLabel('기간 *').selectOption('WEEKLY')
  await page.getByRole('dialog').getByRole('button', { name: '초안 만들기' }).click()
  await expect(page.getByTestId('report-sheet')).toBeVisible()
}

const AI_BODY = {
  summary: '이번 주 점검 3건을 마쳤고 그중 2건은 조치가 필요했습니다.',
  findings: '- 가람대교 교각 P7 · 균열 폭 0.3mm 확인',
  actions: '- 청솔댐 취수탑 · 배터리팩 교체',
  nextPlan: '- [보통] 남해항 방파제 · 케이슨 이음부 스캔',
}

test.describe('AI 보고서 초안', () => {
  test('연결돼 있으면 AI 초안이 네 문단에 들어가고, 보고서에 "AI 초안 사용"이 표시된다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    server.db.reportResult = AI_BODY
    await server.attach(context)
    await loadInspectionSample(page)
    await connect(page)
    await newWeeklyReport(page)

    await page.getByRole('button', { name: 'AI 초안 쓰기' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'AI 초안 쓰기' }).click()
    await expect(page.getByLabel('요약')).toHaveValue(AI_BODY.summary)
    await expect(page.getByLabel('주요 발견 사항')).toHaveValue(AI_BODY.findings)
    await expect(page.getByTestId('report-sheet')).toContainText('AI 초안 사용')

    // 보낸 데이터에는 점검 기록이 담기고, 작성자 이름은 담기지 않는다
    expect(server.db.reportInputs).toHaveLength(1)
    expect(server.db.reportInputs[0].completed.length).toBeGreaterThan(0)
  })

  test('연결하지 않았으면 연결하라고 안내하고 요청하지 않는다', async ({ page }) => {
    await loadInspectionSample(page)
    await newWeeklyReport(page)
    const before = await page.getByLabel('요약').inputValue()
    await page.getByRole('button', { name: 'AI 초안 쓰기' }).click()
    await expect(page.locator('#toasts')).toContainText('구글 시트(Apps Script)에 연결')
    await expect(page.getByLabel('요약')).toHaveValue(before)
  })

  test('서버가 실패하면 이유를 보여 주고 문장은 그대로 둔다', async ({ page, context }) => {
    const server = createFakeAppsScript()
    server.db.reportResult = { ok: false, code: 'REPORT_QUOTA', error: '오늘 AI 보고서 초안 한도(20회)를 다 썼습니다.' }
    await server.attach(context)
    await loadInspectionSample(page)
    await connect(page)
    await newWeeklyReport(page)
    const before = await page.getByLabel('요약').inputValue()
    await page.getByRole('button', { name: 'AI 초안 쓰기' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'AI 초안 쓰기' }).click()
    await expect(page.locator('#toasts')).toContainText('한도')
    await expect(page.getByLabel('요약')).toHaveValue(before)
    await expect(page.getByRole('button', { name: 'AI 초안 쓰기' })).toBeEnabled()
  })
})
