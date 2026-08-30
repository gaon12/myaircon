/**
 * socket.io 클라이언트는 CDN이 아니라 우리 서버가 /vendor/socket.io/ 로 직접
 * 서빙한다(src/server/app.ts 참고). 브라우저는 그 URL을 그대로 import 하지만
 * TypeScript는 경로로 해석하려 들기 때문에, tsconfig.client.json의 paths가
 * 그 지정자를 이 파일로 연결한다.
 *
 * 타입은 devDependency로 설치된 socket.io-client 패키지에서 그대로 빌려온다.
 * 런타임에 서빙하는 파일과 타입을 제공하는 패키지가 같은 lockfile로 잠겨
 * 있으므로 둘이 어긋날 수 없다.
 */
export * from "socket.io-client";
