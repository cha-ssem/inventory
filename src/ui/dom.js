import { decodeText } from '../domain/encoding.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])

class RawHtml {
  constructor(value) {
    this.value = value
  }
  toString() {
    return this.value
  }
}

// 이미 안전하다고 확인된 HTML 조각만 감싼다
export const raw = (value) => new RawHtml(value)

const renderValue = (value) => {
  if (value instanceof RawHtml) return value.value
  if (Array.isArray(value)) return value.map(renderValue).join('')
  if (value === false || value === null || value === undefined) return ''
  return escapeHtml(value)
}

// 끼워 넣는 값은 기본적으로 모두 이스케이프한다 (XSS 방지)
export const html = (strings, ...values) =>
  raw(strings.reduce((out, str, i) => out + str + (i < values.length ? renderValue(values[i]) : ''), ''))

export const qs = (root, selector) => root.querySelector(selector)
export const qsa = (root, selector) => [...root.querySelectorAll(selector)]

export const setHtml = (el, content) => {
  el.innerHTML = String(content)
}

export const formatNumber = (n) => Number(n || 0).toLocaleString('ko-KR')

export const formValues = (form) => Object.fromEntries(new FormData(form).entries())

export const showFieldErrors = (form, errors = {}) => {
  qsa(form, '[data-error-for]').forEach((el) => {
    el.textContent = errors[el.dataset.errorFor] || ''
  })
  const first = Object.keys(errors)[0]
  if (first) form.elements[first]?.focus()
}

export const downloadFile = (filename, content, type) => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// UTF-8이 아니면 EUC-KR(CP949)로 다시 읽는다 (한국어 엑셀 CSV 대응)
export const readFileAsText = async (file) => decodeText(await file.arrayBuffer())
