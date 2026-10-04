import { expect } from '@playwright/test'

// USB 바코드 스캐너는 키보드처럼 글자를 입력하고 마지막에 Enter를 보낸다
export const scan = async (page, code) => {
  const input = page.locator('#scan-input')
  await expect(input).toBeFocused()
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press('Enter')
}

// 입고·출고는 [입력] 단추를 눌러야 저장된다
export const submit = async (page) => {
  await page.getByRole('button', { name: '입력', exact: true }).click()
}

// 스캔해서 부품을 고른 뒤 수량 등을 넣고 [입력]을 누른다
export const scanAndSubmit = async (page, code, { qty, worker } = {}) => {
  await page.locator('#scan-input').focus()
  await scan(page, code)
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-state', 'selected')
  if (qty !== undefined) await page.getByLabel('수량', { exact: true }).fill(String(qty))
  if (worker !== undefined) await page.getByLabel('작업자').fill(worker)
  await submit(page)
}

export const loadSample = async (page) => {
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '샘플 데이터 불러오기' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '불러오기' }).click()
  await expect(page.getByTestId('data-summary')).toContainText('부품 25개')
}

export const registerPart = async (page, { partNo, name, safetyStock = '5' }) => {
  await page.goto('/#/parts')
  await page.getByRole('button', { name: '부품 등록' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('품번 *').fill(partNo)
  await dialog.getByLabel('품명 *').fill(name)
  await dialog.getByLabel('안전재고').fill(safetyStock)
  await dialog.getByRole('button', { name: '등록' }).click()
  await expect(page.getByTestId('parts-table')).toContainText(partNo)
}
