import { normalizePartNo } from './validation.js'

export const createPart = (value, now) => ({
  ...value,
  active: true,
  createdAt: now,
  updatedAt: now,
})

export const updatePart = (part, changes, now) => {
  const { partNo: _ignored, createdAt: _keep, ...rest } = changes
  return { ...part, ...rest, updatedAt: now }
}

export const setPartActive = (part, active, now) => ({ ...part, active, updatedAt: now })

export const findPart = (parts, partNo) => {
  const key = normalizePartNo(partNo)
  return parts.find((p) => p.partNo === key)
}

export const upsertPart = (parts, part) => {
  const exists = parts.some((p) => p.partNo === part.partNo)
  return exists ? parts.map((p) => (p.partNo === part.partNo ? part : p)) : [...parts, part]
}
