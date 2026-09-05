import { pickCharacter } from "../shared/characters.ts";
import { runChallenge } from "./challenge.ts";
import { requireElement } from "./dom.ts";
import type { Locale } from "./i18n/locale.ts";

/** 확인 화면과 작업증명을 관리한다. 서버가 발급한 토큰만 연결 계층에 전달한다. */
export function createVerifyDialog({
  getStrings,
  isOnline,
  isConnected,
  onVerified,
}: {
  getStrings: () => Locale;
  isOnline: () => boolean;
  isConnected: () => boolean;
  onVerified: (token: string) => void;
}) {
  const els = {
    verifyDialog: requireElement("[data-verify-dialog]", HTMLDialogElement),
    verifyImage: requireElement("[data-verify-image]", HTMLImageElement),
    verifyTitle: requireElement("[data-verify-title]", HTMLHeadingElement),
    verifyBody: requireElement("[data-verify-body]", HTMLParagraphElement),
    verifyProgress: requireElement("[data-verify-progress]", HTMLParagraphElement),
    verifyRetry: requireElement("[data-verify-retry]", HTMLButtonElement),
  };

  const character = pickCharacter();

  /**
   * 확인 다이얼로그를 상태에 맞게 그린다.
   *   scanning - 사람인지 확인하는 중
   *   caught   - 접속이 거부됨
   */
  function showVerifyDialog(mode: "scanning" | "caught"): void {
    const scanning = mode === "scanning";
    els.verifyImage.src = `/img/${scanning ? "scan" : "catch"}_${character}.png`;
    els.verifyTitle.textContent = scanning ? getStrings().verifyTitle : getStrings().blockedTitle;
    els.verifyBody.textContent = scanning
      ? getStrings().verifyBody
      : getStrings().connectionBlocked;
    els.verifyProgress.textContent = "";
    els.verifyRetry.hidden = true;
    els.verifyDialog.classList.toggle("is-caught", !scanning);
    if (!els.verifyDialog.open) els.verifyDialog.showModal();
  }

  let verifying = false;

  async function verifyThenReconnect(): Promise<void> {
    if (verifying) return;
    verifying = true;
    showVerifyDialog("scanning");

    try {
      const token = await runChallenge((attempts) => {
        els.verifyProgress.textContent = getStrings().verifyProgress(attempts);
      });
      if (token === null) {
        els.verifyProgress.textContent = getStrings().verifyFailed;
        els.verifyRetry.hidden = false;
        return;
      }
      onVerified(token);
    } finally {
      verifying = false;
    }
  }

  els.verifyDialog.addEventListener("cancel", (event) => event.preventDefault());
  els.verifyDialog.addEventListener("close", () => {
    // 접속이 끝나면 onStatus가 정상적으로 닫는다. 그 전에 닫혔다면 사용자가
    // Esc를 누른 것이므로 되돌린다.
    if (isOnline() && !isConnected()) {
      showVerifyDialog(els.verifyDialog.classList.contains("is-caught") ? "caught" : "scanning");
    }
  });

  els.verifyRetry.addEventListener("click", () => void verifyThenReconnect());
  return {
    verify: verifyThenReconnect,
    showBlocked: () => showVerifyDialog("caught"),
    close: () => els.verifyDialog.close(),
    renderStrings() {
      if (els.verifyDialog.open)
        showVerifyDialog(els.verifyDialog.classList.contains("is-caught") ? "caught" : "scanning");
    },
  };
}
