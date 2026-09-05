import { stripDisallowed } from "../shared/nickname-charset.ts";
import { requireElement } from "./dom.ts";
import type { Locale } from "./i18n/locale.ts";
import { readValue } from "./storage.ts";

/** 닉네임 입력·복원·변경을 관리한다. 서버 검증은 별도로 적용된다. */
export function createNicknameDialog({
  getStrings,
  getUsername,
  hasStarted,
  onRename,
  onStart,
}: {
  getStrings: () => Locale;
  getUsername: () => string;
  hasStarted: () => boolean;
  onRename: (name: string) => void;
  onStart: (name: string) => void;
}) {
  const els = {
    nicknameDialog: requireElement("[data-nickname-dialog]", HTMLDialogElement),
    nicknameForm: requireElement("[data-nickname-form]", HTMLFormElement),
    nicknameInput: requireElement("[data-nickname-input]", HTMLInputElement),
    nicknameError: requireElement("[data-nickname-error]", HTMLParagraphElement),
    nicknameSubmit: requireElement("[data-nickname-submit]", HTMLButtonElement),
    nicknameCancel: requireElement("[data-nickname-cancel]", HTMLButtonElement),
    rename: requireElement("[data-rename]", HTMLButtonElement),
  };

  let nicknameMode: "start" | "rename" = "start";
  function savedNickname(): string | null {
    const raw = readValue("nickname");
    if (raw === null) return null;
    const cleaned = cleanNickname(raw);
    return cleaned === "" ? null : cleaned;
  }

  /** 서버와 문자 규칙을 공유한다. 최종 길이 검증은 서버가 맡는다. */
  function cleanNickname(raw: string): string {
    return stripDisallowed(raw.normalize("NFC")).replace(/\s+/g, " ").trim();
  }

  /** 최초 입력은 완료해야 진행할 수 있고, 이름 변경은 취소할 수 있다. */
  function openNicknameDialog(mode: "start" | "rename"): void {
    nicknameMode = mode;
    els.nicknameInput.value = mode === "rename" ? getUsername() : (savedNickname() ?? "");
    els.nicknameSubmit.textContent = mode === "rename" ? getStrings().save : getStrings().start;
    els.nicknameCancel.hidden = mode !== "rename";
    hideNicknameError();
    if (!els.nicknameDialog.open) els.nicknameDialog.showModal();
    els.nicknameInput.focus();
    els.nicknameInput.select();
  }

  function hideNicknameError(): void {
    els.nicknameError.hidden = true;
    els.nicknameError.textContent = "";
  }

  els.nicknameInput.addEventListener("input", () => {
    const before = els.nicknameInput.value;
    const after = stripDisallowed(before);
    if (after === before) return;
    const caret = els.nicknameInput.selectionStart ?? after.length;
    const removedBeforeCaret =
      before.slice(0, caret).length - stripDisallowed(before.slice(0, caret)).length;
    els.nicknameInput.value = after;
    const next = Math.max(0, caret - removedBeforeCaret);
    els.nicknameInput.setSelectionRange(next, next);
    hideNicknameError();
  });

  els.nicknameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = cleanNickname(els.nicknameInput.value);
    if (name === "") {
      // 전부 지워졌다는 것은 쓸 수 없는 문자만 넣었다는 뜻이다. 이때만 말한다.
      els.nicknameError.textContent = getStrings().nicknameInvalid;
      els.nicknameError.hidden = false;
      return;
    }
    els.nicknameDialog.close();
    if (nicknameMode === "rename") {
      onRename(name);
      return;
    }
    onStart(name);
  });

  els.nicknameCancel.addEventListener("click", () => els.nicknameDialog.close());
  els.rename.addEventListener("click", () => openNicknameDialog("rename"));

  // 최초 입력은 cancel과 close 양쪽에서 지켜 브라우저의 강제 닫기에도 복구한다.
  els.nicknameDialog.addEventListener("cancel", (event) => {
    if (nicknameMode === "start") event.preventDefault();
  });
  els.nicknameDialog.addEventListener("close", () => {
    if (nicknameMode === "start" && !hasStarted()) openNicknameDialog("start");
  });

  return {
    open: openNicknameDialog,
    remembered: savedNickname,
    activate: () => {
      els.rename.hidden = false;
    },
    renderStrings() {
      els.nicknameInput.placeholder = getStrings().nicknamePlaceholder;
      els.nicknameSubmit.textContent =
        nicknameMode === "rename" ? getStrings().save : getStrings().start;
    },
  };
}
