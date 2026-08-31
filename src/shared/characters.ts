/**
 * 캐릭터 아트에 대한 사실. 클라이언트와 서버가 모두 알아야 해서 여기에 둔다.
 *
 * 클라이언트는 확인 화면과 구형 브라우저 안내에, 서버는 오류 페이지에 쓴다.
 * 서버가 쓰기 시작하면서 `src/client/challenge.ts`에서 옮겨 왔다 -- 파일
 * 개수를 늘리는 것보다 클라이언트 모듈을 서버가 import 하는 쪽이 훨씬 나쁘다.
 */

/** 캐릭터 수. public/img/{scan,catch}_N.png */
export const CHARACTER_COUNT = 3;

/**
 * 캐릭터 하나를 고른다. 탐색 중에는 scan, 막혔을 때는 catch 포즈라
 * 같은 캐릭터로 이어져야 한 사람이 쫓아온 것처럼 읽힌다.
 *
 * random을 주입받는 것은 시험 때문이다. 실제로는 Math.random을 쓴다.
 */
export function pickCharacter(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * CHARACTER_COUNT);
}
