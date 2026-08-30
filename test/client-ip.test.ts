import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIp, resolveClientIp, UNKNOWN_IP } from "../src/server/client-ip.ts";

const hs = (address?: string, xff?: string | string[]) => ({
  address,
  headers: xff === undefined ? {} : { "x-forwarded-for": xff },
});

describe("normalizeIp", () => {
  it("IPv4-mapped IPv6를 IPv4로 편다", () => {
    // 같은 클라이언트가 ::ffff:1.2.3.4 와 1.2.3.4 두 키로 갈라지면
    // 사실상 rate limit 할당량이 두 배가 된다.
    assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(normalizeIp("::FFFF:203.0.113.7"), "203.0.113.7");
  });

  it("대괄호와 포트를 벗겨낸다", () => {
    assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
  });

  it("공백을 정리하고 대소문자를 통일한다", () => {
    assert.equal(normalizeIp("  2001:DB8::1  "), "2001:db8::1");
  });

  it("쓸 수 없는 값은 null", () => {
    for (const bad of ["", "   ", undefined, null, 123, {}, []]) {
      assert.equal(normalizeIp(bad), null, `${String(bad)} -> null`);
    }
  });
});

describe("resolveClientIp — 프록시를 신뢰하지 않을 때 (기본값)", () => {
  const opts = { trustProxyHops: 0 };

  it("소켓의 원격 주소를 쓴다", () => {
    assert.equal(resolveClientIp(hs("203.0.113.7"), opts), "203.0.113.7");
  });

  it("X-Forwarded-For를 완전히 무시한다", () => {
    // 이게 핵심이다. 기존 코드는 이 헤더를 그대로 키로 썼기 때문에,
    // 매 요청 다른 값을 넣는 것만으로 rate limit이 통째로 무력화됐다.
    const spoofed = hs("203.0.113.7", "1.2.3.4");
    assert.equal(resolveClientIp(spoofed, opts), "203.0.113.7");

    // 요청마다 위조 값을 바꿔도 키는 언제나 같아야 한다
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => resolveClientIp(hs("203.0.113.7", `9.9.9.${i}`), opts)),
    );
    assert.equal(keys.size, 1);
  });

  it("주소가 없으면 undefined가 아니라 고정된 대체 키를 쓴다", () => {
    // 기존에는 undefined가 키가 되어 모든 사용자가 한 버킷을 공유했다.
    assert.equal(resolveClientIp(hs(undefined), opts), UNKNOWN_IP);
    assert.equal(resolveClientIp({}, opts), UNKNOWN_IP);
    assert.equal(resolveClientIp(undefined, opts), UNKNOWN_IP);
    assert.ok(UNKNOWN_IP.length > 0);
  });
});

describe("resolveClientIp — 프록시 뒤에 있을 때", () => {
  it("1단 프록시: 목록의 마지막 항목이 실제 클라이언트다", () => {
    const h = hs("10.0.0.1", "203.0.113.7");
    assert.equal(resolveClientIp(h, { trustProxyHops: 1 }), "203.0.113.7");
  });

  it("1단 프록시에서 클라이언트가 앞에 가짜를 끼워 넣어도 속지 않는다", () => {
    // 클라이언트가 XFF: "1.2.3.4"를 보내면 nginx가 뒤에 실제 IP를 붙여
    // "1.2.3.4, 203.0.113.7"이 된다. 오른쪽에서 1칸이 우리가 믿을 수 있는 값.
    const h = hs("10.0.0.1", "1.2.3.4, 203.0.113.7");
    assert.equal(resolveClientIp(h, { trustProxyHops: 1 }), "203.0.113.7");
  });

  it("2단 프록시(CDN + nginx)", () => {
    const h = hs("10.0.0.1", "203.0.113.7, 198.51.100.2");
    assert.equal(resolveClientIp(h, { trustProxyHops: 2 }), "203.0.113.7");

    const spoofed = hs("10.0.0.1", "1.2.3.4, 203.0.113.7, 198.51.100.2");
    assert.equal(resolveClientIp(spoofed, { trustProxyHops: 2 }), "203.0.113.7");
  });

  it("홉 수가 목록보다 크면 가장 왼쪽으로 클램프한다", () => {
    const h = hs("10.0.0.1", "203.0.113.7");
    assert.equal(resolveClientIp(h, { trustProxyHops: 5 }), "203.0.113.7");
  });

  it("공백이 섞인 목록을 파싱한다", () => {
    const h = hs("10.0.0.1", "  1.2.3.4 ,   203.0.113.7  ");
    assert.equal(resolveClientIp(h, { trustProxyHops: 1 }), "203.0.113.7");
  });

  it("헤더가 배열로 들어와도(중복 헤더) 처리한다", () => {
    const h = hs("10.0.0.1", ["1.2.3.4", "203.0.113.7"]);
    assert.equal(resolveClientIp(h, { trustProxyHops: 1 }), "203.0.113.7");
  });

  it("목록 안의 IPv4-mapped 주소도 정규화한다", () => {
    const h = hs("10.0.0.1", "::ffff:203.0.113.7");
    assert.equal(resolveClientIp(h, { trustProxyHops: 1 }), "203.0.113.7");
  });

  it("XFF가 비었거나 쓰레기값이면 소켓 주소로 되돌아간다", () => {
    assert.equal(resolveClientIp(hs("10.0.0.1", ""), { trustProxyHops: 1 }), "10.0.0.1");
    assert.equal(resolveClientIp(hs("10.0.0.1", " , , "), { trustProxyHops: 1 }), "10.0.0.1");
    assert.equal(resolveClientIp(hs("10.0.0.1"), { trustProxyHops: 1 }), "10.0.0.1");
  });

  it("어떤 입력에도 비어 있지 않은 문자열을 돌려준다", () => {
    for (const hops of [0, 1, 3]) {
      for (const h of [undefined, {}, hs(undefined, undefined), hs("", "")]) {
        const key = resolveClientIp(h, { trustProxyHops: hops });
        assert.equal(typeof key, "string");
        assert.ok(key.length > 0);
      }
    }
  });
});
