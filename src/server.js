import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { Server as SocketIOServer } from "socket.io";

const rateLimiter = new RateLimiterMemory({
  points: 10, // 초당 x회 limit
  duration: 2,
});

const app = Fastify();

// fastify-socket.io는 peerDependencies가 fastify@4.x.x에 묶여 있어 Fastify 5로
// 올라올 수 없다. socket.io를 app.server(Fastify가 감싸고 있는 node:http 서버)에
// 직접 붙이면 플러그인 없이 동일하게 동작한다.
const io = new SocketIOServer(app.server, {
  transports: ["websocket"],
  // Fastify 5는 node:http의 'request' 이벤트를 경유하지 않고 요청을 처리하기
  // 때문에, socket.io가 리스너를 가로채서 클라이언트 번들을 서빙하는
  // serveClient 기능이 동작하지 않는다(항상 Fastify의 404로 떨어짐).
  // 클라이언트 번들은 별도로 정적 서빙하고 여기서는 꺼둔다.
  serveClient: false,
});

await app.register(fastifyStatic, {
  root: path.join(import.meta.dirname, "..", "public"),
});

let temp = 18;

app.get("/", (_req, reply) => reply.sendFile("index.html"));

io.on("connection", (socket) => {
  socket.emit("init", temp);

  socket.on("disconnect", () => {});

  socket.on("plus", async (arg) => {
    try {
      await rateLimiter.consume(socket.handshake.headers["x-forwarded-for"]);
      if (temp < 30) {
        temp++;
      }
      io.emit("tempChange", { temp: temp, username: arg.substring(0, 9) });
    } catch {
      socket.emit("blocked", "너무 잦은 요청");
    }
  });

  socket.on("minus", async (arg) => {
    try {
      await rateLimiter.consume(socket.handshake.headers["x-forwarded-for"]);
      if (temp > 18) {
        temp--;
      }
      io.emit("tempChange", { temp: temp, username: arg.substring(0, 9) });
    } catch {
      socket.emit("blocked", "너무 잦은 요청");
    }
  });
});

// Fastify 5는 listen()이 완료된 뒤에 라우트를 추가하면 던진다. 기존 코드처럼
// listen()을 파일 상단에서 부르지 않고, 모든 등록이 끝난 마지막에 await 한다.
try {
  await app.listen({ port: 8080 });
  console.log("http://localhost:8080");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
