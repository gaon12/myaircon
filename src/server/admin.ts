import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  type AdminOverview,
  type BanRecordView,
  type KickResult,
  kickRequestSchema,
  unbanRequestSchema,
} from "../shared/admin.ts";
import type { BanStore } from "./ban-store.ts";
import type { AppConfig } from "./config.ts";
import type { Guard } from "./guard.ts";
import type { IdentityTagger } from "./identity.ts";
import type { RealtimeHandle } from "./realtime.ts";

export type AdminDeps = {
  config: AppConfig;
  realtime: RealtimeHandle;
  bans: BanStore;
  tagger: IdentityTagger;
  /** 토큰 무차별 대입을 늦춘다. */
  guard: Guard;
};

/** 길이가 달라도 시간이 새지 않게 비교한다. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual은 길이가 다르면 던진다. 길이 자체는 어차피 숨길 수 없으니
  // 먼저 확인하되, 내용 비교는 상수 시간으로 한다.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 관리 API.
 *
 * ADMIN_TOKEN이 설정돼 있을 때만 등록된다. 미설정이면 라우트 자체가 없다 --
 * 빈 토큰으로 열려 있는 것보다 아예 없는 편이 안전하다.
 *
 * 제재 대상은 IP다. 닉네임은 자유 문자열이라 대상이 될 수 없고, 클라이언트가
 * 보내는 식별자는 클라이언트가 바꿀 수 있다. 서버가 확인할 수 있는 것은
 * 접속 주소뿐이다. 다만 IP 차단은 VPN이나 모바일 IP 변경으로 우회되므로,
 * 완전한 차단이 아니라 장난의 비용을 올리는 장치로 본다.
 */
export function registerAdmin(app: FastifyInstance, deps: AdminDeps): void {
  const { config, realtime, bans, tagger, guard } = deps;
  const token = config.admin.token;
  if (token === null) {
    app.log.info("ADMIN_TOKEN is not set; admin API disabled");
    return;
  }

  const toView = (record: {
    ip: string;
    until: number;
    reason: string;
    createdAt: number;
  }): BanRecordView => ({ ...record, tag: tagger.tag(record.ip) });

  /** 토큰이 맞지 않으면 401. 어떤 라우트든 이걸 먼저 통과해야 한다. */
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/admin/")) return;

    // 토큰이 길어 현실적으로 뚫리지 않더라도, 무제한 시도를 허용할 이유가 없다.
    if (await guard.isAdminLocked(request.ip)) {
      app.log.warn({ ip: request.ip }, "admin locked out after repeated failures");
      await reply.code(429).send({ error: "too_many_attempts" });
      return;
    }

    const header = request.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (tokenMatches(provided, token)) {
      await guard.clearAdminFailures(request.ip);
      return;
    }

    const locked = await guard.noteAdminFailure(request.ip);
    app.log.warn({ ip: request.ip, url: request.url, locked }, "rejected admin request");
    await reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/api/admin/overview", async (): Promise<AdminOverview> => {
    return {
      sessions: realtime.sessions(),
      bans: bans.list().map(toView),
      online: realtime.online,
      at: Date.now(),
    };
  });

  app.post("/api/admin/kick", async (request, reply) => {
    const parsed = kickRequestSchema.parse(request.body, "body");
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }
    const { target, minutes, reason } = parsed.value;

    // 태그로 지정하면 지금 붙어 있는 연결 중에서 주소를 찾는다. 이미 나간
    // 사람은 태그만으로 주소를 알 수 없다(태그는 되돌릴 수 없는 값이다).
    const ip =
      "ip" in target
        ? target.ip
        : (realtime.sessions().find((session) => session.tag === target.tag)?.ip ?? null);

    if (ip === null) {
      return reply.code(404).send({ error: "no connected session matches that tag" });
    }

    const disconnected = realtime.disconnectIp(ip);
    let bannedUntil = 0;
    if (minutes > 0) {
      bannedUntil = bans.add(ip, minutes * 60_000, reason).until;
    }

    app.log.warn(
      { ip, tag: tagger.tag(ip), disconnected, minutes, reason },
      "admin kicked a client",
    );
    return { disconnected, bannedUntil } satisfies KickResult;
  });

  app.post("/api/admin/unban", async (request, reply) => {
    const parsed = unbanRequestSchema.parse(request.body, "body");
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }
    const removed = bans.remove(parsed.value.ip);
    app.log.warn({ ip: parsed.value.ip, removed }, "admin lifted a ban");
    return { removed };
  });

  app.log.info("admin API enabled at /api/admin");
}
