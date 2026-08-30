# myaircon

모두가 함께 쓰는 **온라인 에어컨**. 접속한 사람 전원이 온도계 하나를 공유하고,
Web Audio API로 만든 브라운 노이즈가 온도에 따라 음량을 바꾼다.

[codingapple1/myaircon.online](https://github.com/codingapple1/myaircon.online)의 fork다.
원본은 서비스가 종료됐고, 이 저장소는 재오픈을 위해 런타임과 의존성을 최신으로
올리고 알려진 버그를 정리한 버전이다.

<img src="docs/screenshot.png" alt="온라인 에어컨 화면" width="420">

## 요구 사항

- Node.js **22 이상** (`.nvmrc`는 24)

## 실행

```bash
npm install
npm start           # http://localhost:8080
```

개발 중에는 파일 변경 시 자동 재시작:

```bash
npm run dev
```

> **오디오는 secure context에서만 동작한다.**
> `AudioWorklet.addModule()`은 `localhost` 또는 `https`에서만 성공한다.
> 그 외 환경에서는 소리가 나지 않고 화면에 안내가 뜬다(앱은 정상 동작).

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm start` | 서버 실행 |
| `npm run dev` | 자동 재시작 모드 |
| `npm test` | 테스트 (Node 내장 러너) |
| `npm run test:watch` | 테스트 watch 모드 |
| `npm run lint` | Biome 린트 |
| `npm run format` | Biome 포맷 적용 |
| `npm run check` | 린트 + 포맷 자동 수정 |
| `npm run ci` | `biome ci` + 테스트 (CI용, 파일을 고치지 않음) |

## 설정

모든 설정은 환경변수로 하며 전부 선택 사항이다. 전체 목록과 기본값은
[`.env.example`](.env.example)에 있고, 검증 로직은 [`src/config.js`](src/config.js)에 있다.
잘못된 값은 부팅 시점에 바로 에러가 난다.

자주 쓰는 것만:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | 바인딩 주소 |
| `TRUST_PROXY_HOPS` | `0` | 신뢰하는 리버스 프록시 홉 수 (아래 참고) |
| `TEMP_MIN` / `TEMP_MAX` | `18` / `30` | 온도 범위 |
| `PERSIST_STATE` | `true` | 공유 온도를 디스크에 저장할지 |
| `RATE_LIMIT_POINTS` | `10` | `RATE_LIMIT_DURATION_SECONDS`(기본 2초)당 허용 횟수 |
| `HSTS_MAX_AGE` | `0` (끔) | https 뒤에 배포할 때만 켤 것 |

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
GET /healthz  ->  {"status":"ok","temp":18,"min":18,"max":30,"uptimeSeconds":42}
```

### 상태 파일

공유 온도는 `data/state.json`(`STATE_FILE`)에 저장되어 재시작 후에도 이어진다.
컨테이너로 배포한다면 이 경로를 볼륨으로 잡거나 `PERSIST_STATE=false`로 끈다.

## 구조

```
src/
  config.js       환경변수 기반 설정 (범위 검증 포함)
  thermostat.js   공유 온도값. I/O 없는 순수 로직
  nickname.js     신뢰할 수 없는 닉네임 입력 정규화
  client-ip.js    rate limit 키가 될 클라이언트 주소 해석
  state-store.js  온도값 영속화 (디바운스 + 원자적 쓰기)
  realtime.js     socket.io 이벤트 핸들러
  app.js          Fastify + socket.io 조립 (listen 안 함)
  server.js       부트스트랩 / 시그널 처리
public/
  index.html      마크업 (인라인 script/style 없음)
  styles.css
  js/
    app.js        진입점. DOM 배선과 상태
    socket.js     서버 연결 생명주기
    audio.js      브라운 노이즈 재생, 게인 스테이징
    worklet.js    AudioWorkletProcessor + 순수 DSP
    storage.js    localStorage 래퍼
    strings.js    ko/en 문자열
test/             Node 내장 러너 기반 테스트
```

`buildApp()`은 조립만 하고 `listen()`은 `server.js`가 한다. 덕분에 테스트에서
포트 0으로 임의 포트에 띄울 수 있다.

## 실시간 프로토콜

| 방향 | 이벤트 | 페이로드 |
| --- | --- | --- |
| 서버 → 클라 | `init` | `{ temp, min, max }` — 접속·재접속 시 |
| 클라 → 서버 | `plus` / `minus` | 닉네임 문자열 (무엇이 오든 서버가 정규화한다) |
| 서버 → 전체 | `tempChange` | `{ temp, changed, direction, username, at }` |
| 서버 → 클라 | `blocked` | `{ reason, retryAfterMs }` |
| 서버 → 클라 | `server-error` | `{ reason }` |

온도 범위를 서버가 내려주므로 클라이언트는 `18`/`30`을 하드코딩하지 않는다.
`changed`는 경계값에서 눌러 값이 그대로일 때를 구분하기 위한 것이다.

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

Node 내장 테스트 러너를 쓴다. 별도 테스트 프레임워크 의존성은 없다.
서버 유닛 테스트, `app.inject()` 기반 HTTP 통합 테스트, 실제 socket.io 접속을
사용하는 실시간 통합 테스트, 그리고 오디오 DSP·게인 스테이징 테스트가 있다.

## 라이선스

[ISC](LICENSE). 원저작자 [codingapple](https://github.com/codingapple1),
fork 관리자 [gaon12](https://github.com/gaon12).
