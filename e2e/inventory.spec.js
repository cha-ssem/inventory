import { test, expect } from '@playwright/test'
import { loadSample, registerPart, scan, scanAndSubmit, submit } from './helpers.js'

const qtyField = (page) => page.getByLabel('수량', { exact: true })

test.describe('입출고 핵심 흐름', () => {
  test('부품 등록 → 입고 → 출고 → 재고 확인 (작업자 기록 포함)', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-TEST-01', name: '시험 덕트', safetyStock: '5' })

    await page.goto('/#/inbound')
    await scanAndSubmit(page, 'sk-test-01', { qty: 10, worker: '박입고' })
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'success')
    await expect(page.getByTestId('scan-after')).toHaveText('10')
    await expect(qtyField(page)).toHaveValue('1')

    await page.goto('/#/outbound')
    await scanAndSubmit(page, 'SK-TEST-01', { qty: 7, worker: '김자재' })
    // 출고 후 3개 → 안전재고 5 미만이므로 경고
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'warning')
    await expect(page.getByTestId('scan-after')).toHaveText('3')

    await page.goto('/#/stock')
    const row = page.locator('tr[data-part-no="SK-TEST-01"]')
    await expect(row).toHaveClass(/is-low/)
    await expect(row.locator('td.stock')).toHaveText('3')

    await page.goto('/#/history')
    await expect(page.locator('.table-area')).toContainText('박입고')
    await expect(page.locator('.table-area')).toContainText('김자재')
  })

  test('스캔(Enter)만으로는 저장되지 않고 부품만 선택된다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-ENTER-01', name: '엔터 부품' })
    await page.goto('/#/inbound')
    await scan(page, 'SK-ENTER-01')
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'selected')
    await expect(page.getByTestId('scan-result')).toContainText('엔터 부품')
    await expect(page.getByTestId('session-list')).toHaveCount(0)

    await page.goto('/#/stock')
    await expect(page.locator('tr[data-part-no="SK-ENTER-01"] td.stock')).toHaveText('0')
  })

  test('품번을 입력하고 Enter 없이 [입력]을 눌러도 저장된다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-TYPE-01', name: '직접 입력 부품' })
    await page.goto('/#/inbound')
    await page.locator('#scan-input').fill('SK-TYPE-01')
    await submit(page)
    await expect(page.getByTestId('scan-after')).toHaveText('1')
  })

  test('아무것도 고르지 않고 [입력]을 누르면 안내한다', async ({ page }) => {
    await page.goto('/#/inbound')
    await submit(page)
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'error')
  })

  test('USB 스캐너로 10번 연속 입고해도 누락·중복이 없다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-SCAN-01', name: '연속 스캔 부품' })
    await page.goto('/#/inbound')
    for (let i = 0; i < 10; i += 1) {
      await scanAndSubmit(page, 'SK-SCAN-01')
      await expect(page.getByTestId('scan-after')).toHaveText(String(i + 1))
    }
    await expect(page.getByTestId('session-list').locator('li')).toHaveCount(10)
  })

  test('연속 스캔 모드: 같은 바코드는 수량 +1, [입력]으로 저장', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-CONT-01', name: '연속 모드 부품' })
    await page.goto('/#/inbound')
    await page.getByLabel(/연속 스캔 모드/).check()
    await scan(page, 'SK-CONT-01')
    await scan(page, 'SK-CONT-01')
    await scan(page, 'SK-CONT-01')
    await expect(qtyField(page)).toHaveValue('3')
    await expect(page.getByTestId('session-list')).toHaveCount(0)
    await submit(page)
    await expect(page.getByTestId('scan-after')).toHaveText('3')
    await expect(page.getByTestId('session-list').locator('li')).toHaveCount(1)
  })

  test('미등록 품번을 스캔하면 등록 후 선택되고 [입력]으로 입고된다', async ({ page }) => {
    await page.goto('/#/inbound')
    await scan(page, 'SK-NEW-99')
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'unknown')
    await page.getByRole('button', { name: '새 부품으로 등록' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('품번 *')).toHaveValue('SK-NEW-99')
    await dialog.getByLabel('품명 *').fill('신규 부품')
    await dialog.getByRole('button', { name: '등록' }).click()
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'selected')
    await submit(page)
    await expect(page.getByTestId('scan-after')).toHaveText('1')
  })

  test('현재고보다 많이 출고하면 막는다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-LIM-01', name: '재고 부족 부품' })
    await page.goto('/#/inbound')
    await scanAndSubmit(page, 'SK-LIM-01')
    await page.goto('/#/outbound')
    await scanAndSubmit(page, 'SK-LIM-01', { qty: 5 })
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'error')
    await expect(page.getByTestId('scan-result')).toContainText('현재고(1)')
  })

  test('출고를 취소하면 재고가 되돌아간다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-CAN-01', name: '취소 부품' })
    await page.goto('/#/inbound')
    await scanAndSubmit(page, 'SK-CAN-01', { qty: 10 })
    await page.goto('/#/outbound')
    await scanAndSubmit(page, 'SK-CAN-01', { qty: 4 })
    await page.getByTestId('session-list').getByRole('button', { name: '취소' }).click()
    await page.getByRole('dialog').getByLabel('취소 사유').fill('수량 착오')
    await page.getByRole('dialog').getByRole('button', { name: '기록 취소' }).click()
    await expect(page.getByTestId('session-list')).toContainText('취소됨')

    await page.goto('/#/stock')
    await expect(page.locator('tr[data-part-no="SK-CAN-01"] td.stock')).toHaveText('10')
  })
})

test.describe('대시보드 · 데이터', () => {
  test('샘플 데이터를 불러오면 대시보드에 숫자와 부족 품목이 보인다', async ({ page }) => {
    await loadSample(page)
    await page.goto('/#/')
    await expect(page.getByTestId('stat-total')).toContainText('25')
    const low = Number((await page.getByTestId('stat-low').locator('.value').textContent()).trim())
    expect(low).toBeGreaterThanOrEqual(3)
    expect(low).toBeLessThanOrEqual(4)
  })

  test('데이터는 새로고침해도 남아 있다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-KEEP-01', name: '유지 부품' })
    await page.reload()
    await expect(page.getByTestId('parts-table')).toContainText('SK-KEEP-01')
  })

  test('재고 현황 CSV는 BOM이 붙은 UTF-8로 내려받아진다', async ({ page }) => {
    await loadSample(page)
    await page.goto('/#/stock')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^재고현황_\d{4}-\d{2}-\d{2}\.csv$/)
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(buffer.toString('utf-8')).toContain('에어벤트 덕트 센터')
  })

  test('사용자 입력은 HTML로 실행되지 않는다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-XSS-01', name: '<img src=x onerror="window.__xss=1">' })
    await expect(page.getByTestId('parts-table')).toContainText('<img src=x')
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })

  test('선택한 부품의 바코드 라벨을 만든다', async ({ page }) => {
    await loadSample(page)
    await page.goto('/#/parts')
    await page.getByLabel('SK-AD-001 선택').check()
    await page.getByLabel('SK-PD-001 선택').check()
    await page.getByRole('button', { name: '선택 품목 라벨 출력' }).click()
    const sheet = page.getByTestId('label-sheet')
    await expect(sheet.locator('.print-label')).toHaveCount(2)
    await expect(sheet.locator('svg.barcode').first()).toBeVisible()
    await expect(sheet.locator('.qr svg').first()).toBeVisible()
  })
})

test.describe('리뷰 반영 회귀 테스트', () => {
  test('탭 두 개에서 입고·출고해도 서로의 기록을 지우지 않는다', async ({ page, context }) => {
    await registerPart(page, { partNo: 'SK-TAB-01', name: '탭 부품' })
    const tabB = await context.newPage()
    await tabB.goto('/#/outbound')

    await page.goto('/#/inbound')
    await scanAndSubmit(page, 'SK-TAB-01', { qty: 10 })

    await scanAndSubmit(tabB, 'SK-TAB-01', { qty: 3 })
    await expect(tabB.getByTestId('scan-after')).toHaveText('7')

    await page.goto('/#/history')
    await expect(page.locator('.table-area tbody tr')).toHaveCount(2)
  })

  test('모달을 연 채 뒤로 가면 모달이 닫힌다', async ({ page }) => {
    await page.goto('/#/parts')
    await page.goto('/#/inbound')
    await scan(page, 'SK-NONE-01')
    await page.getByRole('button', { name: '새 부품으로 등록' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('출고에서 재고 0인 품목은 선택하지 않는다', async ({ page }) => {
    await registerPart(page, { partNo: 'SK-ZERO-01', name: '재고 없음' })
    await page.goto('/#/outbound')
    await scan(page, 'SK-ZERO-01')
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'error')
  })
})
