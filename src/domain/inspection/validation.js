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

const isValidRequestPayload = (p) => isNonEmptyString(p.siteId) && isNonEmptyString(p.robotId) && isNonEmptyString(p.title)

export const isValidEvent = (e) =>
  Boolean(e) &&
  isNonEmptyString(e.id) &&
  isNonEmptyString(e.requestId) &&
  Boolean(EVENT_TYPES[e.type]) &&
  isDateString(e.at) &&
  isOptionalString(e.actor) &&
  Boolean(e.payload) &&
  typeof e.payload === 'object' &&
  (e.type !== EVENT_TYPES.REQUEST || isValidRequestPayload(e.payload))

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
