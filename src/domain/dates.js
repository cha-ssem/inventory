const pad = (n) => String(n).padStart(2, '0')

const toDate = (value) => {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const toDateKey = (value) => {
  const date = toDate(value)
  return date ? keyOf(date) : ''
}

export const formatDateTime = (value) => {
  const date = toDate(value)
  return date ? `${keyOf(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}

export const isSameLocalDay = (a, b) => {
  const key = toDateKey(a)
  return key !== '' && key === toDateKey(b)
}

export const addDays = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number)
  return keyOf(new Date(y, m - 1, d + days))
}
