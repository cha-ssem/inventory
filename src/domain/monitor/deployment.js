// 감시·점검 요청 대상: 사용 중인 현장에 나가 있는 사용 중인 로봇. 아니면 그 이유를 돌려준다 (대상이면 빈 글자).
export const blockedReason = (robot, sites) => {
  if (robot.active === false) return '사용 중지한 로봇'
  if (!robot.siteId) return '본사 정비 중'
  const site = sites.find((s) => s.siteId === robot.siteId)
  return !site || site.active === false ? '사용 중지한 현장' : ''
}

export const deployedRobots = ({ robots, sites }) => robots.filter((r) => !blockedReason(r, sites))
