import { PRIORITIES, RESULTS, ROBOT_MODELS, SECTORS, SOURCES, STATUSES } from '../domain/inspection/constants.js'
import { html } from './dom.js'

const INSPECTOR_KEY = 'samkwang-inventory:inspector'

export const statusBadge = (status) => html`<span class="badge badge-st-${status}">${STATUSES[status] ?? status}</span>`

export const priorityBadge = (priority) => html`<span class="badge badge-pr-${priority}">${PRIORITIES[priority] ?? priority}</span>`

export const resultBadge = (result) => html`<span class="badge badge-rs-${result}">${RESULTS[result] ?? result}</span>`

export const sourceLabel = (source) => SOURCES[source] ?? source

export const siteLabel = (sites, siteId) => {
  const site = sites.find((s) => s.siteId === siteId)
  return site ? `${site.name} (${SECTORS[site.sector]})` : siteId
}

export const robotLabel = (robots, robotId) => {
  const robot = robots.find((r) => r.robotId === robotId)
  return robot ? `${robot.name} · ${ROBOT_MODELS[robot.model]}` : robotId
}

export const option = (value, label, selected) => html`<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`

// 점검자 이름은 이 브라우저에만 기억해 둔다 (입력 편의용, 실패해도 그만)
export const rememberedInspector = () => {
  try {
    return globalThis.localStorage?.getItem(INSPECTOR_KEY) ?? ''
  } catch {
    return ''
  }
}

export const rememberInspector = (name) => {
  try {
    if (name) globalThis.localStorage?.setItem(INSPECTOR_KEY, name)
  } catch {
    // 저장하지 못해도 다음에 다시 입력하면 된다
  }
}
