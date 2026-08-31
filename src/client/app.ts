import { missingFeatures, showLegacyNotice } from "./compat.ts";

/**
 * 진입점. 브라우저를 먼저 확인하고, 통과할 때만 본체를 불러온다.
 *
 * 동적 import라 지원되지 않는 브라우저는 본체를 내려받지도 않는다.
 * 어차피 실행하지 못할 코드를 받게 할 이유가 없다.
 */
const missing = missingFeatures();
if (missing.length > 0) {
  showLegacyNotice(missing);
} else {
  await import("./main.ts");
}
