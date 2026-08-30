const PREFIX = "myaircon:";

/**
 * localStorage 래퍼.
 *
 * 기존 코드는 키로 '+'와 '-'라는 한 글자를 네임스페이스 없이 썼고, 시크릿
 * 모드나 사이트 데이터 차단 설정에서 localStorage 접근 자체가 던진다는 점을
 * 고려하지 않았다. 여기서는 접두사를 붙이고 모든 접근을 감싼다.
 */
export function readCount(name) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

export function incrementCount(name) {
  try {
    const next = readCount(name) + 1;
    localStorage.setItem(PREFIX + name, String(next));
    return next;
  } catch {
    // 저장이 안 되는 환경이라도 앱은 계속 동작해야 한다.
    return 0;
  }
}
