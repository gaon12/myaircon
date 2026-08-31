import { createHmac, randomBytes } from "node:crypto";

/** 표시용 태그 길이 (16진수 문자 수). */
const TAG_LENGTH = 3;

/**
 * 접속자를 화면에서 구분하기 위한 짧은 태그.
 *
 * 왜 IP에서 유도하나
 *   닉네임은 인증도 유일성도 없는 자유 문자열이라 "가온" 두 사람을 구분할
 *   방법이 없다. 그렇다고 클라이언트가 보내는 UUID를 쓸 수는 없다 -- 클라이언트가
 *   만드는 값은 클라이언트가 언제든 바꿀 수 있어서 구분에도 제재에도 쓸모가 없다.
 *   서버가 스스로 확인할 수 있는 것은 접속 주소뿐이다.
 *
 * 왜 IP를 그대로 쓰지 않나
 *   화면에 IP를 노출할 수는 없다. HMAC을 거쳐 앞 3자리만 쓰면
 *     - 클라이언트가 위조할 수 없고 (비밀키를 모른다)
 *     - 새로고침해도 같은 태그가 나오고
 *     - 쿠키나 localStorage를 쓰지 않으니 추적 식별자가 아니고
 *     - 태그만으로 원래 IP를 되돌릴 수 없다
 *
 * 한계
 *   같은 집이나 사무실은 하나의 태그를 공유한다. 모바일에서 IP가 바뀌면
 *   태그도 바뀐다. 완전한 신원이 아니라 "대체로 같은 사람"을 가리키는 표시다.
 *   3자리(4096가지)라 사람이 많아지면 우연히 겹칠 수 있는데, 이름과 함께
 *   보이므로 실사용에서는 충분하다.
 */
export type IdentityTagger = {
  /** 주소에서 표시용 태그를 만든다. 예: "7c2" */
  tag: (ip: string) => string;
  /** "가온#7c2" 형태의 표시 이름. */
  label: (username: string, ip: string) => string;
};

export function createIdentityTagger(secret: string): IdentityTagger {
  const cache = new Map<string, string>();

  const tag = (ip: string): string => {
    const cached = cache.get(ip);
    if (cached !== undefined) return cached;
    const digest = createHmac("sha256", secret).update(ip).digest("hex").slice(0, TAG_LENGTH);
    // 접속 주소 수만큼만 자라며, 한 항목이 몇十 바이트다. 그래도 무한히 두지는
    // 않는다. 가득 차면 통째로 비운다(태그는 순수 함수라 다시 계산하면 같다).
    if (cache.size > 10_000) cache.clear();
    cache.set(ip, digest);
    return digest;
  };

  return {
    tag,
    label: (username, ip) => `${username}#${tag(ip)}`,
  };
}

/** 설정에 비밀키가 없을 때 쓸 새 비밀키를 만든다. */
export function generateIdentitySecret(): string {
  return randomBytes(32).toString("hex");
}
