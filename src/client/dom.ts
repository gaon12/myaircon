/**
 * 마크업에 반드시 있어야 하는 요소를 가져온다.
 *
 * 기존 코드는 document.querySelector가 돌려준 값을 그대로 썼다. 셀렉터에
 * 오타가 나거나 마크업이 바뀌면 null에 접근해 그 시점에 조용히 죽었고,
 * 어느 요소가 문제인지는 스택 트레이스를 봐야 알 수 있었다.
 *
 * 여기서는 시작하자마자, 무엇이 없는지 이름을 붙여서 던진다. 그 대가로
 * 이후 코드는 null 검사 없이 정확한 타입으로 쓸 수 있다.
 */
export function requireElement<T extends Element>(
  selector: string,
  expected: abstract new (...args: never[]) => T,
): T {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`no element matches ${selector}`);
  }
  if (!(element instanceof expected)) {
    throw new TypeError(
      `${selector} should be ${expected.name} but is ${element.constructor.name}`,
    );
  }
  return element;
}
