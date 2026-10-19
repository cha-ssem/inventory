import { EVENT_TYPES, INSPECTION_LIMITS, ROBOT_ID_PATTERN, ROBOT_MODELS, SECTORS, SITE_ID_PATTERN } from './constants.js'

// 저장소·동기화로 들어온 값의 형식 확인 (사용자 입력 검사는 flow.js에서 한다)
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0
const isOptionalString = (v) => v === undefined || v === null || typeof v === 'string'
const isDateString = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const isOptionalBoolean = (v) => v === undefined || typeof v === 'boolean'
const isShortName = (v) => isNonEmptyString(v) && v.length <= INSPECTION_LIMITS.maxName
const hasUnique = (list, key) => new Set(list.map((item) => item[key])).size === list.length

export const isValidSite = (s) =>
  Boolean(s) &&
  typeof s.siteId === 'string' &&
  SITE_ID_PATTERN.test(s.siteId) &&
  isShortName(s.name) &&
  Boolean(SECTORS[s.sector]) &&
  isOptionalString(s.region) &&
  isOptionalString(s.contact) &&
  isOptionalBoolean(s.active) &&
  isDateString(s.updatedAt)

export const isValidRobot = (r) =>
  Boolean(r) &&
  typeof r.robotId === 'string' &&
  ROBOT_ID_PATTERN.test(r.robotId) &&
  Boolean(ROBOT_MODELS[r.model]) &&
  isShortName(r.name) &&
  isOptionalString(r.serial) &&
  (r.siteId === null || (typeof r.siteId === 'string' && SITE_ID_PATTERN.test(r.siteId))) &&
  isOptionalBoolean(r.active) &&
  isDateString(r.updatedAt)

const isUsedPart = (u) => Boolean(u) && isNonEmptyString(u.partNo) && Number.isInteger(u.qty) && u.qty > 0

// 종류별로 화면이 쓰는 항목이 있는지 본다 (apps-script/InspectionLogic.gs의 PAYLOAD_CHECKS와 같은 규칙)
const PAYLOAD_CHECKS = {
  [EVENT_TYPES.REQUEST]: (p) => isNonEmptyString(p.siteId) && isNonEmptyString(p.robotId) && isNonEmptyString(p.title),
  [EVENT_TYPES.ASSIGN]: (p) => typeof p.assignee === 'string',
  [EVENT_TYPES.START]: () => true,
  [EVENT_TYPES.COMPLETE]: (p) => typeof p.result === 'string' && Array.isArray(p.usedParts) && p.usedParts.every(isUsedPart),
  [EVENT_TYPES.CANCEL]: (p) => typeof p.reason === 'string',
  [EVENT_TYPES.RECUR]: (p) => Boolean(p.reading) && typeof p.reading === 'object',
}

export const isValidEvent = (e) =>
  Boolean(e) &&
  isNonEmptyString(e.id) &&
  isNonEmptyString(e.requestId) &&
  Boolean(EVENT_TYPES[e.type]) &&
  isDateString(e.at) &&
  isOptionalString(e.actor) &&
  Boolean(e.payload) &&
  typeof e.payload === 'object' &&
  PAYLOAD_CHECKS[e.type](e.payload)

export const isValidInspectionState = (data) =>
  Boolean(data) &&
  Array.isArray(data.sites) &&
  Array.isArray(data.robots) &&
  Array.isArray(data.events) &&
  data.sites.every(isValidSite) &&
  data.robots.every(isValidRobot) &&
  data.events.every(isValidEvent) &&
  hasUnique(data.sites, 'siteId') &&
  hasUnique(data.robots, 'robotId') &&
  hasUnique(data.events, 'id')

const keepLatest = (list, key) => {
  const byKey = new Map()
  list.forEach((item) => {
    const current = byKey.get(item[key])
    if (!current || item.updatedAt > current.updatedAt) byKey.set(item[key], item)
  })
  return [...byKey.values()]
}

const keepFirst = (list, key) => {
  const seen = new Set()
  return list.filter((item) => !seen.has(item[key]) && seen.add(item[key]))
}

// 저장된 값을 불러올 때: 형식이 틀린 항목과 중복 ID만 빼고 나머지는 살린다 (항목 하나 때문에 전체가 사라지지 않도록)
export const normalizeInspectionState = (data) => {
  if (!data || !Array.isArray(data.sites) || !Array.isArray(data.robots) || !Array.isArray(data.events)) return data
  return {
    sites: keepLatest(data.sites.filter(isValidSite), 'siteId'),
    robots: keepLatest(data.robots.filter(isValidRobot), 'robotId'),
    events: keepFirst(data.events.filter(isValidEvent), 'id'),
  }
}
