import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const barcodeSvg = (value) => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.classList.add('barcode')
  try {
    JsBarcode(svg, value, { format: 'CODE128', height: 44, width: 1.6, fontSize: 13, margin: 2, displayValue: true })
  } catch (error) {
    console.error('바코드를 만들지 못했습니다:', error)
    svg.textContent = ''
  }
  return svg
}

export const qrSvgMarkup = async (value) => {
  try {
    return await QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  } catch (error) {
    console.error('QR 코드를 만들지 못했습니다:', error)
    return ''
  }
}
