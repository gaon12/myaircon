export const UNKNOWN_IP = "unknown";

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const BRACKETED_IPV6 = /^\[([^\]]+)](?::\d+)?$/;

/**
 * 주소 문자열을 rate limit 키로 쓰기 좋게 정규화한다.
 * - `::ffff:203.0.113.7` -> `203.0.113.7` (같은 클라이언트가 두 개의 키로
 *   갈라져서 사실상 제한이 두 배가 되는 것을 막는다)
 * - `[2001:db8::1]:443` -> `2001:db8::1`
 * @returns {string|null} 정규화된 주소, 쓸 수 없으면 null
 */
export function normalizeIp(value) {
  if (typeof value !== "string") return null;
  let ip = value.trim();
  if (ip === "") return null;

  const bracketed = BRACKETED_IPV6.exec(ip);
  if (bracketed) ip = bracketed[1];

  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped) return mapped[1];

  return ip.toLowerCase();
}

/**
 * socket.io 핸드셰이크에서 rate limit에 쓸 클라이언트 식별자를 뽑는다.
 *
 * 기존 코드는 `socket.handshake.headers['x-forwarded-for']`를 그대로 키로
 * 썼는데 세 가지가 동시에 잘못돼 있었다.
 *   1. X-Forwarded-For는 클라이언트가 임의로 보낼 수 있는 헤더다. 매 요청마다
 *      다른 값을 넣으면 rate limit이 통째로 무력화된다.
 *   2. 프록시 없이 직접 접속하면 undefined가 되고, 그러면 모든 사용자가
 *      `undefined`라는 키 하나를 공유해 서로의 할당량을 잡아먹는다.
 *   3. XFF는 원래 `client, proxy1, proxy2` 형태의 목록인데 파싱하지 않아
 *      프록시가 한 단 늘어나면 키가 통째로 달라진다.
 *
 * 그래서 기본값(trustProxyHops=0)에서는 XFF를 아예 보지 않고 TCP 소켓의
 * 원격 주소만 쓴다. 리버스 프록시 뒤에 배포할 때만 홉 수를 명시적으로 켠다.
 *
 * @param {{ address?: string, headers?: Record<string, string|string[]|undefined> }} handshake
 * @param {{ trustProxyHops: number }} options
 * @returns {string} 항상 비어 있지 않은 문자열
 */
export function resolveClientIp(handshake, { trustProxyHops }) {
  const direct = normalizeIp(handshake?.address);

  if (trustProxyHops > 0) {
    const header = handshake?.headers?.["x-forwarded-for"];
    const joined = Array.isArray(header) ? header.join(",") : (header ?? "");
    const chain = joined
      .split(",")
      .map(normalizeIp)
      .filter((ip) => ip !== null);

    if (chain.length > 0) {
      // 목록은 [클라이언트, 프록시1, ..., 프록시N] 순으로 왼쪽이 원본이다.
      // 신뢰하는 홉 수만큼 오른쪽에서 세어 들어간 위치가 우리가 믿을 수 있는
      // 가장 왼쪽 항목이다. 그보다 왼쪽은 클라이언트가 위조했을 수 있다.
      const index = Math.max(0, chain.length - trustProxyHops);
      return chain[Math.min(index, chain.length - 1)];
    }
  }

  return direct ?? UNKNOWN_IP;
}
