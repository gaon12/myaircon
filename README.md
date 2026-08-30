# myaircon

모두가 함께 쓰는 **온라인 에어컨**. 접속한 사람 전원이 온도계 하나를 공유하고,
Web Audio API로 만든 브라운 노이즈가 온도에 따라 음량을 바꾼다.
겨울에는 에어컨 대신 **온풍기**가 뜬다.

한국어 · English · 日本語 · 简体中文 · 繁體中文 · 라이트/다크 · 반응형

[codingapple1/myaircon.online](https://github.com/codingapple1/myaircon.online)의 fork다.
원본은 서비스가 종료됐고, 이 저장소는 재오픈을 위해 런타임과 의존성을 최신으로
올리고 알려진 버그를 정리한 버전이다.

<p>
  <img src="docs/screenshot.png" alt="라이트 모드 화면" width="380">
  <img src="docs/screenshot-dark.png" alt="다크 모드 화면" width="380">
</p>

## 요구 사항

- Node.js **24 이상**

## 실행

```bash
npm install         # prepare 훅이 TypeScript를 빌드한다
npm start           # http://localhost:8080
```

개발 중에는 파일 변경 시 자동 재시작 (빌드 없이 소스를 그대로 실행):

```bash
npm run dev
```

> **오디오는 secure context에서만 동작한다.**
> `AudioWorklet.addModule()`은 `localhost` 또는 `https`에서만 성공한다.
> 그 외 환경에서는 소리가 나지 않고 화면에 안내가 뜬다(앱은 정상 동작).

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run build` | TypeScript 컴파일 (`dist/`, `public/js/`) |
| `npm start` | 서버 실행 (`prestart`가 먼저 빌드한다) |
| `npm run dev` | 소스를 그대로 실행하며 자동 재시작 |
| `npm run typecheck` | 서버/클라이언트/테스트 타입 검사 |
| `npm test` | 테스트 (Node 내장 러너, 빌드 불필요) |
| `npm run test:watch` | 테스트 watch 모드 |
| `npm run lint` | Biome 린트 |
| `npm run format` | Biome 포맷 적용 |
| `npm run check` | 린트 + 포맷 자동 수정 |
| `npm run ci` | `biome ci` + 타입 검사 + 테스트 (CI용, 파일을 고치지 않음) |

## 설정

모든 설정은 환경변수로 하며 전부 선택 사항이다. 전체 목록과 기본값은
[`.env.example`](.env.example)에 있고, 검증 로직은 [`src/config.js`](src/config.js)에 있다.
잘못된 값은 부팅 시점에 바로 에러가 난다.

자주 쓰는 것만:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | 바인딩 주소 |
| `TRUST_PROXY_HOPS` | `0` | 신뢰하는 리버스 프록시 홉 수 (아래 참고) |
| `DEVICE_MODE` | `auto` | `auto` / `aircon` / `heater` (아래 참고) |
| `WINTER_MONTHS` | `11,12,1,2,3` | 온풍기로 취급할 월 |
| `SEASON_TIMEZONE` | (서버 로컬) | 계절 판정에 쓸 IANA 시간대 |
| `TEMP_MIN` / `TEMP_MAX` | `18` / `30` | 온도 범위 |
| `PERSIST_STATE` | `true` | 공유 온도를 디스크에 저장할지 |
| `RATE_LIMIT_POINTS` | `10` | `RATE_LIMIT_DURATION_SECONDS`(기본 2초)당 허용 횟수 |
| `HSTS_MAX_AGE` | `0` (끔) | https 뒤에 배포할 때만 켤 것 |

## 에어컨 / 온풍기

계절에 따라 기기가 바뀐다. 공유 기기이므로 **서버가 정해서 접속자 전원에게 같은
값을 내려준다** — 사용자마다 다른 기기를 보면 "다 같이 쓰는 온도계"가 성립하지 않는다.

| `DEVICE_MODE` | 동작 |
| --- | --- |
| `auto` (기본) | 현재 월이 `WINTER_MONTHS`에 있으면 온풍기, 아니면 에어컨 |
| `aircon` | 계절과 무관하게 에어컨 고정 |
| `heater` | 계절과 무관하게 온풍기 고정 |

판단 기준은 **서버 시간**이다. 접속자의 시간대가 아니다 — 보는 사람마다 계절이
달라지면 안 되기 때문이다.

기본값은 서버 프로세스의 로컬 시간대인데, 대부분의 컨테이너는 UTC라 배포
환경에 따라 결과가 달라진다. `SEASON_TIMEZONE=Asia/Seoul` 처럼 명시하면
어디에 배포하든 같은 기준으로 판정한다 (잘못된 이름은 부팅 시점에 거부된다).
예를 들어 `2026-10-31 15:30 UTC`는 UTC로 보면 10월(에어컨), `Asia/Seoul`로
보면 11월(온풍기)이다.
서버가 몇 달씩 떠 있을 수 있으므로 부팅 때 한 번 정하고 끝내지 않고, 1시간마다
(`DEVICE_RECHECK_INTERVAL_MS`) 다시 확인해 바뀌면 접속 중인 클라이언트에
`deviceChange`를 보낸다.

온풍기는 높게 맞출수록, 에어컨은 낮게 맞출수록 세게 돌아간다. 브라운 노이즈의
음량 방향도 기기에 따라 뒤집힌다.

### 온풍기 이미지 넣기

**온풍기 전용 이미지는 아직 없다.** 지금은 에어컨 이미지로 폴백한다.
`public/` 아래에 아래 이름으로 파일을 떨어뜨리면 서버가 자동으로 그 경로를
내려보낸다. 코드는 건드릴 필요가 없다.

```
public/heater0.png      본체
public/heater-fan.png   팬
public/heater-air.png   바람
```

폴백은 **파일 단위**라 본체만 먼저 넣고 팬/바람은 에어컨 것을 그대로 써도 된다.
기존 에어컨 이미지와 크기·여백을 맞춰야 팬 위치(`--fan-offset`)가 어긋나지 않는다.

## 배포

### 리버스 프록시 뒤에 둘 때는 `TRUST_PROXY_HOPS`를 반드시 설정할 것

rate limit은 클라이언트 주소를 키로 쓴다. 기본값 `0`에서는 `X-Forwarded-For`를
**무시하고** TCP 소켓의 원격 주소만 본다. 프록시 뒤에서 이 값을 그대로 두면
모든 사용자가 프록시의 주소 하나를 공유하게 되어 전체가 한 버킷에 갇힌다.

반대로 프록시가 없는데 `1` 이상으로 두면, 클라이언트가 헤더를 위조해 rate limit을
통째로 무력화할 수 있다. **실제 구성과 정확히 일치시킬 것.**

```
nginx 한 대 뒤        TRUST_PROXY_HOPS=1
CDN + nginx 두 단 뒤   TRUST_PROXY_HOPS=2
```

### 프로세스 관리

pm2 등으로 띄우고 싶다면 전역에 설치해서 쓴다. 프로세스 매니저는 배포 환경의
책임이지 애플리케이션의 런타임 의존성이 아니므로 `dependencies`에 넣지 않았다.

```bash
npm i -g pm2
pm2 start npm --name myaircon -- start
```

`SIGTERM`/`SIGINT`를 받으면 열린 소켓을 정리하고 마지막 온도를 저장한 뒤 종료한다.

### 헬스체크

```
GET /healthz  ->  {"status":"ok","temp":18,"min":18,"max":30,"device":"aircon","uptimeSeconds":42}
```

### 상태 파일

공유 온도는 `data/state.json`(`STATE_FILE`)에 저장되어 재시작 후에도 이어진다.
컨테이너로 배포한다면 이 경로를 볼륨으로 잡거나 `PERSIST_STATE=false`로 끈다.

## 다국어

현재 한국어 / English / 日本語 / 简体中文 / 繁體中文.
브라우저의 `navigator.languages`로 협상하고, 푸터의 선택 상자로 직접 바꿀 수 있다
(선택은 저장되며 브라우저 선호 언어보다 우선한다).

중국어는 지역 코드만으로는 자형을 알 수 없어 별도로 매핑한다.
`zh-CN`/`zh-SG` → 간체, `zh-TW`/`zh-HK`/`zh-MO` → 번체, 맨 `zh` → 간체.

### 언어 추가하기

1. `public/js/i18n/locales/<code>.js`를 만든다. 기존 파일 하나를 복사해서
   값만 바꾸는 것이 가장 빠르다.
2. `public/js/i18n/index.js`의 `locales`에 한 줄 추가한다. 여기 나열한 순서가
   곧 선택 목록의 순서다.

각 로케일 파일은 `satisfies Locale`로 계약을 검사받는다. 키를 빠뜨리면 화면에
`undefined`가 뜨는 대신 **컴파일이 실패**한다. `npm test`도 같은 것을 확인한다
(빌드를 건너뛰고 Node로 바로 실행하는 경로가 있기 때문).

## 테마

시스템 / 밝게 / 어둡게 세 가지. 기본은 시스템 설정(`prefers-color-scheme`)을
따르고, 푸터에서 고정할 수 있다. 선택은 저장된다.

색은 전부 CSS 커스텀 프로퍼티다. 다크 값은
`@media (prefers-color-scheme: dark)` 안의 `:root:not([data-theme="light"])`와
`:root[data-theme="dark"]` 두 곳에서 덮어쓴다 — 이 구조라야 "OS 자동"과
"사용자 고정"이 양방향으로 올바르게 동작한다.

> 에어컨 본체 그림은 테마와 무관하게 항상 흰색이다. 그 위에 얹히는 온도
> 텍스트만 `--on-device-ink`로 분리해 어둡게 고정했다. 어두운 색 기기 에셋을
> 넣는다면 이 값도 함께 조정해야 한다.

## 반응형

`--aircon-width: clamp(180px, min(88vw, 58vh), 350px)` 하나로 전체가 스케일한다.
팬과 텍스트 위치는 모두 이 값에 대한 비율이라 크기가 달라져도 정렬이 유지된다.
화면 폭뿐 아니라 높이도 제한하므로 가로 모드에서도 잘리지 않는다.

## 구조

TypeScript로 작성하고 `tsc`가 두 갈래로 컴파일한다.

```
src/
  shared/         서버와 클라이언트가 함께 쓰는 것
    validate.ts   런타임 검증 유틸 (의존성 0)
    protocol.ts   와이어 메시지 스키마 + 타입
  server/
    config.ts       환경변수 기반 설정 (부팅 시점 검증)
    device.ts       계절에 따른 기기 종류 판정과 이미지 경로 해석
    thermostat.ts   공유 온도값. I/O 없는 순수 로직
    nickname.ts     신뢰할 수 없는 닉네임 입력 정규화
    client-ip.ts    rate limit 키가 될 클라이언트 주소 해석
    state-store.ts  온도값 영속화 (디바운스 + 원자적 쓰기)
    realtime.ts     socket.io 이벤트 핸들러
    app.ts          Fastify + socket.io 조립 (listen 안 함)
    server.ts       부트스트랩 / 시그널 처리
  client/
    app.ts        진입점. DOM 배선과 상태
    dom.ts        필수 요소 조회 (없으면 시작 시점에 던진다)
    socket.ts     서버 연결 생명주기 + 수신 메시지 검증
    audio.ts      브라운 노이즈 재생, 게인 스테이징
    worklet.ts    AudioWorkletProcessor + 순수 DSP
    storage.ts    localStorage 래퍼
    theme.ts      라이트/다크 테마
    i18n/         로케일 등록, BCP-47 협상, Locale 계약
public/
  index.html      마크업 (인라인 script/style 없음)
  styles.css
test/             Node 내장 러너 기반 테스트 (*.test.ts)
```

| 소스 | 산출물 | 쓰임 |
| --- | --- | --- |
| `src/server` + `src/shared` | `dist/` | `npm start`가 실행 |
| `src/client` + `src/shared` | `public/js/` | 정적 서빙 |

산출물은 둘 다 `.gitignore` 대상이고 `npm install`의 `prepare` 훅이 만들어 준다.

`buildApp()`은 조립만 하고 `listen()`은 `server.ts`가 한다. 덕분에 테스트에서
포트 0으로 임의 포트에 띄울 수 있다.

### 빌드 없이 실행되는 이유

소스에서는 `./foo.ts`로 import 하고, `rewriteRelativeImportExtensions`가 컴파일
시 `./foo.js`로 바꿔 내보낸다. 덕분에 **Node 24가 소스를 그대로 실행**할 수 있어
(타입 스트리핑) 테스트와 `npm run dev`는 빌드가 필요 없다. 배포는 컴파일된
`dist/`를 쓴다.

`erasableSyntaxOnly`가 `enum`/`namespace`처럼 "지울 수 없는 문법"을 금지해서
이 성질이 실수로 깨지지 않도록 강제한다.

## 런타임 검증

TypeScript의 타입은 컴파일 시점에 전부 지워진다. 바깥에서 들어오는 값은
타입을 적어둬도 런타임에는 아무것도 확인되지 않으므로, 경계마다 실제로 검사한다.

`src/shared/validate.ts`는 의존성 없는 작은 검증기다. 스키마 하나에서
런타임 검사와 컴파일 타임 타입을 함께 얻는다.

```ts
const initMessageSchema = object({
  temp: integer(), min: integer(), max: integer(), device: deviceInfoSchema,
});
type InitMessage = Infer<typeof initMessageSchema>;
```

검사하는 지점:

| 경계 | 하는 일 |
| --- | --- |
| 클라이언트가 받는 서버 메시지 | 형태가 다르면 화면을 건드리지 않고 콘솔에만 남긴다 |
| 서버가 읽는 `state.json` | 손상·손편집·구버전 형식을 걸러내고 초기값으로 시작 |
| 환경변수 | 범위·열거형·시간대까지 부팅 시점에 검사하고 던진다 |
| 클라이언트가 보내는 닉네임 | `unknown`으로 받아 어떤 입력이든 안전한 문자열로 정규화 |
| DOM 조회 | 없는 요소를 시작 시점에 이름과 함께 던진다 |

`object`는 모르는 키를 조용히 버린다. 서버가 필드를 추가해도 예전 클라이언트가
깨지지 않는다.

zod 대신 직접 만든 이유는 클라이언트에 번들러가 없기 때문이다. 브라우저 코드는
`tsc`가 뱉은 ESM을 그대로 서빙하므로, 의존성을 하나 추가하면 그 패키지의 브라우저
빌드까지 따로 서빙해야 한다.

## 실시간 프로토콜

| 방향 | 이벤트 | 페이로드 |
| --- | --- | --- |
| 서버 → 클라 | `init` | `{ temp, min, max, device }` — 접속·재접속 시 |
| 클라 → 서버 | `plus` / `minus` | 닉네임 문자열 (무엇이 오든 서버가 정규화한다) |
| 서버 → 전체 | `tempChange` | `{ temp, changed, direction, username, at }` |
| 서버 → 클라 | `blocked` | `{ reason, retryAfterMs }` |
| 서버 → 클라 | `deviceChange` | `{ kind, assets, usingFallback }` — 계절이 바뀌었을 때 |
| 서버 → 클라 | `server-error` | `{ reason }` |

온도 범위와 기기 종류를 서버가 내려주므로 클라이언트는 `18`/`30`도 이미지 경로도
하드코딩하지 않는다. `changed`는 경계값에서 눌러 값이 그대로일 때를 구분하기 위한 것이다.
`device`는 `{ kind: "aircon"|"heater", assets: { body, fan, air }, usingFallback }` 형태다.

## 보안

- **외부 출처 없음.** socket.io 클라이언트 번들을 CDN이 아니라
  `/vendor/socket.io/`에서 직접 서빙한다. 서버가 쓰는 socket.io와 같은 의존성
  트리에서 나오므로 버전이 어긋날 수 없다.
- **CSP**에 `unsafe-inline`도 외부 출처도 없다
  (`default-src 'self'`). 그래서 인라인 `<script>`/`<style>`을 쓸 수 없다 —
  스타일은 `public/styles.css`, 스크립트는 `public/js/`에 둘 것.
- 닉네임은 서버에서 정규화한다: 타입 검사, 제어문자·bidi override 제거,
  NFC 정규화, grapheme 단위 절단.
- 그 외 `nosniff`, `Referrer-Policy`, `X-Frame-Options`, COOP, `Permissions-Policy`.

## 테스트

```bash
npm test
```

Node 내장 테스트 러너를 쓴다. 별도 테스트 프레임워크 의존성은 없고, 빌드 없이
`.ts`를 그대로 실행한다.

서버 유닛 테스트, `app.inject()` 기반 HTTP 통합 테스트, 실제 socket.io 접속을
사용하는 실시간 통합 테스트, 오디오 DSP·게인 스테이징, 검증 유틸과 와이어
프로토콜 스키마 테스트가 있다.

타입 검사는 별도다:

```bash
npm run typecheck   # 서버 / 클라이언트 / 테스트
npm run ci          # lint + typecheck + test (파일을 고치지 않음)
```

## 라이선스

[ISC](LICENSE). 원저작자 [codingapple](https://github.com/codingapple1),
fork 관리자 [gaon12](https://github.com/gaon12).
