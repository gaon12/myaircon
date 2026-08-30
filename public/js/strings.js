/**
 * 화면에 나오는 문자열을 한 곳에 모은다.
 *
 * 기존에는 버튼은 영어("Online mode is off", "Stats", "About"), 안내는
 * 한국어("너무 잦은 요청", "조절한 사람")로 섞여 있었고 문자열이 마크업과
 * 스크립트 여기저기에 흩어져 있었다.
 */
const ko = {
  title: "온라인 에어컨",
  nicknameLabel: "닉네임",
  nicknamePlaceholder: "닉네임 (선택)",
  start: "시작",
  onlineOn: "온라인 모드 켜짐",
  onlineOff: "온라인 모드 꺼짐",
  connecting: "연결 중…",
  soundOn: "소리 끄기",
  soundOff: "소리 켜기",
  warmer: "온도 올리기",
  cooler: "온도 내리기",
  adjustedBy: (name) => `조절한 사람: ${name}`,
  rateLimited: (seconds) => `요청이 너무 잦습니다. ${seconds}초 후 다시 시도하세요`,
  atMax: "이미 가장 높은 온도입니다",
  atMin: "이미 가장 낮은 온도입니다",
  audioFailed: "브라우저가 오디오를 시작하지 못했습니다 (https 또는 localhost 필요)",
  connectionLost: "서버와 연결이 끊겼습니다. 다시 연결 중…",
  connectionFailed: "서버에 연결할 수 없습니다",
  serverError: "서버에서 오류가 발생했습니다",
  stats: "통계",
  about: "정보",
  close: "닫기",
  plusCount: "＋ 누른 횟수",
  minusCount: "－ 누른 횟수",
  aboutLines: [
    "집중과 휴식을 위한 브라운 노이즈 생성기입니다.",
    "온라인 모드를 켜면 접속한 모든 사람과 에어컨 하나를 같이 씁니다 (전기 절약).",
    "원작: YouTube @codingapple",
  ],
};

const en = {
  title: "Online Aircon",
  nicknameLabel: "Nickname",
  nicknamePlaceholder: "nickname (optional)",
  start: "Start",
  onlineOn: "Online mode is on",
  onlineOff: "Online mode is off",
  connecting: "Connecting…",
  soundOn: "Mute",
  soundOff: "Unmute",
  warmer: "Increase temperature",
  cooler: "Decrease temperature",
  adjustedBy: (name) => `Adjusted by ${name}`,
  rateLimited: (seconds) => `Too many requests. Try again in ${seconds}s`,
  atMax: "Already at the highest temperature",
  atMin: "Already at the lowest temperature",
  audioFailed: "The browser could not start audio (requires https or localhost)",
  connectionLost: "Disconnected from the server. Reconnecting…",
  connectionFailed: "Could not reach the server",
  serverError: "The server ran into an error",
  stats: "Stats",
  about: "About",
  close: "Close",
  plusCount: "+ button pressed",
  minusCount: "- button pressed",
  aboutLines: [
    "A brown noise generator to focus and relax.",
    "Turn on online mode to share one aircon with everyone (saves electricity).",
    "Original: YouTube @codingapple",
  ],
};

const locale = navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en";

export const strings = locale === "ko" ? ko : en;
export const language = locale;
