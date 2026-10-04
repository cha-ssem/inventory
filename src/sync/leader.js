const LOCK_NAME = 'samkwang-inventory-sync'

// 같은 브라우저의 여러 탭이 동시에 동기화하지 않도록 Web Locks API로 한 탭만 돌린다.
// waitForLock=false(자동 동기화)면 다른 탭이 돌고 있을 때 건너뛰고, true(직접 누름)면 끝날 때까지 기다린다.
// Web Locks가 없는 환경(테스트, 오래된 브라우저)에서는 그냥 실행한다.
export const withSyncLeader = (fn, { waitForLock = true } = {}) => {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return fn()
  return locks.request(LOCK_NAME, { ifAvailable: !waitForLock }, (lock) => (lock ? fn() : null))
}
