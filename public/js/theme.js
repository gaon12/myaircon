import { readValue, writeValue } from "./storage.js";

/** system은 OS 설정을 따르고, light/dark는 사용자가 명시적으로 고른 것이다. */
export const THEMES = ["system", "light", "dark"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

// 모바일 브라우저의 주소창 색. 실제 배경색과 어긋나면 이음새가 보인다.
const THEME_COLOR = { light: "#ffffff", dark: "#14161a" };

export function isTheme(value) {
  return THEMES.includes(value);
}

/**
 * 테마 상태를 들고 <html>에 반영한다.
 *
 * CSS는 세 가지 경우를 모두 처리해야 한다.
 *   - system: data-theme 속성 없음 -> prefers-color-scheme 미디어 쿼리가 결정
 *   - light : data-theme="light"   -> OS가 다크여도 라이트로 고정
 *   - dark  : data-theme="dark"    -> OS가 라이트여도 다크로 고정
 */
export function createTheme() {
  const media = window.matchMedia?.(DARK_QUERY) ?? null;
  const saved = readValue("theme");
  let current = isTheme(saved) ? saved : "system";

  /** 실제로 적용되는 색 (system이면 OS 설정을 조회한다). */
  function effective() {
    if (current !== "system") return current;
    return media?.matches ? "dark" : "light";
  }

  function apply() {
    const root = document.documentElement;
    if (current === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", current);
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLOR[effective()]);
  }

  // system 모드일 때 OS 설정이 바뀌면 주소창 색도 따라가야 한다.
  // (색 자체는 CSS 미디어 쿼리가 알아서 바꾼다)
  media?.addEventListener?.("change", () => {
    if (current === "system") apply();
  });

  apply();

  return {
    get value() {
      return current;
    },
    get effective() {
      return effective();
    },
    set(next) {
      if (!isTheme(next) || next === current) return;
      current = next;
      writeValue("theme", next);
      apply();
    },
  };
}
