import { countPdfPages } from '../../domain/ocr.js'

// 서류 파일을 AI에 보낼 형태(base64)로 바꾼다. 사진은 긴 변을 줄여서 올리는 시간과 AI 사용료를 줄인다.
const MAX_EDGE = 1568
const JPEG_QUALITY = 0.85
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_PDF_BYTES = 5 * 1024 * 1024
// 쪽이 많으면 AI 응답이 Apps Script 외부 요청 시간(약 1분)을 넘을 수 있다
const MAX_PDF_PAGES = 3
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const OCR_ACCEPT = [...IMAGE_TYPES, 'application/pdf'].join(',')

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 열 수 없습니다.'))
    img.src = url
  })

const shrinkImage = async (url) => {
  const img = await loadImage(url)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  // 투명한 PNG가 검게 나오지 않도록 흰 바탕을 깐다
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1]
}

// 결과: { ok, value: { mediaType, data, previewUrl, name, isPdf } } 또는 { ok: false, error }
// previewUrl은 화면을 떠날 때 URL.revokeObjectURL로 풀어야 한다
export const prepareOcrFile = async (file) => {
  if (!file) return { ok: false, error: '파일을 고르세요.' }
  const isPdf = file.type === 'application/pdf'
  if (!isPdf && !IMAGE_TYPES.includes(file.type)) return { ok: false, error: 'JPG, PNG, WEBP 사진이나 PDF 파일만 올릴 수 있습니다.' }
  if (isPdf && file.size > MAX_PDF_BYTES) return { ok: false, error: 'PDF는 5MB 이하만 올릴 수 있습니다. 사진으로 찍어서 올려 주세요.' }
  if (!isPdf && file.size > MAX_IMAGE_BYTES) return { ok: false, error: '사진이 너무 큽니다(20MB 초과).' }

  const previewUrl = URL.createObjectURL(file)
  try {
    const pdfBytes = isPdf ? new Uint8Array(await file.arrayBuffer()) : null
    if (pdfBytes && countPdfPages(pdfBytes) > MAX_PDF_PAGES) {
      URL.revokeObjectURL(previewUrl)
      return { ok: false, error: `PDF는 ${MAX_PDF_PAGES}쪽까지만 올릴 수 있습니다. 명세서 쪽만 사진으로 찍어 올려 주세요.` }
    }
    const data = pdfBytes ? toBase64(pdfBytes) : await shrinkImage(previewUrl)
    return { ok: true, value: { mediaType: isPdf ? 'application/pdf' : 'image/jpeg', data, previewUrl, name: file.name, isPdf } }
  } catch (error) {
    console.error('서류 파일 준비 실패:', error)
    URL.revokeObjectURL(previewUrl)
    return { ok: false, error: '파일을 읽지 못했습니다. 다른 사진으로 다시 시도하세요.' }
  }
}
