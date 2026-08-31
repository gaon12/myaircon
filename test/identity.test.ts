import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIdentityTagger, generateIdentitySecret } from "../src/server/identity.ts";

const SECRET = "test-secret-that-is-long-enough";

describe("표시용 태그", () => {
  const tagger = createIdentityTagger(SECRET);

  it("같은 주소는 항상 같은 태그를 받는다", () => {
    // 새로고침해도 같은 사람으로 보여야 한다.
    const first = tagger.tag("203.0.113.7");
    assert.equal(tagger.tag("203.0.113.7"), first);
    assert.equal(
      createIdentityTagger(SECRET).tag("203.0.113.7"),
      first,
      "재시작 후에도 같아야 한다",
    );
  });

  it("다른 주소는 (대체로) 다른 태그를 받는다", () => {
    const tags = new Set(
      Array.from({ length: 200 }, (_, i) => tagger.tag(`203.0.113.${i % 256}.${i}`)),
    );
    // 3자리 16진수는 4096가지라 200개면 충돌이 조금 생긴다. 대부분 갈리면 충분하다.
    assert.ok(tags.size > 180, `구분된 태그가 ${tags.size}개뿐이다`);
  });

  it("비밀키가 다르면 태그도 다르다", () => {
    const other = createIdentityTagger("completely-different-secret-value");
    assert.notEqual(other.tag("203.0.113.7"), tagger.tag("203.0.113.7"));
  });

  it("태그는 짧은 16진수다", () => {
    for (const ip of ["203.0.113.7", "2001:db8::1", "unknown", ""]) {
      assert.match(tagger.tag(ip), /^[0-9a-f]{3}$/, `${ip} -> ${tagger.tag(ip)}`);
    }
  });

  it("태그에서 원래 주소를 알 수 없다", () => {
    // HMAC이라 3자리만으로는 되돌릴 수 없고, 주소 문자열이 그대로 들어가지도 않는다.
    const ip = "203.0.113.7";
    const tag = tagger.tag(ip);
    assert.ok(!ip.includes(tag) || tag.length < 3);
    assert.equal(tag.length, 3);
  });

  it("label은 이름과 태그를 붙인다", () => {
    const label = tagger.label("가온", "203.0.113.7");
    assert.match(label, /^가온#[0-9a-f]{3}$/);
  });

  it("같은 이름 다른 주소는 다른 표시가 된다 (동명이인 구분)", () => {
    const a = tagger.label("가온", "203.0.113.7");
    const b = tagger.label("가온", "198.51.100.2");
    assert.notEqual(a, b);
    assert.ok(a.startsWith("가온#") && b.startsWith("가온#"));
  });

  it("같은 주소 다른 이름은 태그를 공유한다", () => {
    const tag = tagger.tag("203.0.113.7");
    assert.equal(tagger.label("가온", "203.0.113.7"), `가온#${tag}`);
    assert.equal(tagger.label("apple", "203.0.113.7"), `apple#${tag}`);
  });

  it("캐시가 가득 차도 같은 답을 준다", () => {
    const big = createIdentityTagger(SECRET);
    const expected = big.tag("203.0.113.7");
    for (let i = 0; i < 10_050; i++) big.tag(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    assert.equal(big.tag("203.0.113.7"), expected);
  });
});

describe("generateIdentitySecret", () => {
  it("충분히 길고 매번 다르다", () => {
    const a = generateIdentitySecret();
    const b = generateIdentitySecret();
    assert.equal(a.length, 64);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  });
});
