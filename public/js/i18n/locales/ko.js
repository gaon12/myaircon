export default {
  code: "ko",
  name: "한국어",
  device: { aircon: "에어컨", heater: "온풍기" },
  appName: (device) => `온라인 ${device}`,

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

  language: "언어",
  theme: "테마",
  themeSystem: "시스템",
  themeLight: "밝게",
  themeDark: "어둡게",

  aboutLines: (device) => [
    "집중과 휴식을 위한 브라운 노이즈 생성기입니다.",
    `온라인 모드를 켜면 접속한 모든 사람과 ${device} 하나를 같이 씁니다 (전기 절약).`,
    "원작: YouTube @codingapple",
  ],
};
