import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { io } from "socket.io-client";
import { connectionOptions } from "../src/client/connection-options.ts";
import { CHALLENGE_REQUIRED, CONNECTION_BLOCKED } from "../src/shared/challenge.ts";
import type { InitMessage, TempChangeMessage } from "../src/shared/protocol.ts";
import { once, startTestServer } from "./helpers.ts";

describe("클라이언트 전송 폴백", () => {
  it("WebSocket이 거부되면 polling으로 연결하고 온도를 동기화한다", async (t) => {
    const server = await startTestServer();
    t.after(() => server.stop());
    server.io.engine.opts.transports = ["polling"];
    const client = io(server.url, { ...connectionOptions, reconnection: false });
    t.after(() => client.disconnect());
    const initialized = once<InitMessage>(client, "init", 5000);
    client.connect();
    const init = await initialized;
    assert.equal(client.io.engine.transport.name, "polling");
    assert.equal(init.temp, server.thermostat.value);
    const changed = once<TempChangeMessage>(client, "tempChange", 5000);
    client.emit("plus", "폴백사용자");
    const update = await changed;
    assert.equal(update.temp, init.temp + 1);
    assert.equal(update.temp, server.thermostat.value);
  });

  for (const policy of ["ban", "challenge"] as const) {
    it(`polling 폴백도 ${policy} 정책을 우회하지 않는다`, async (t) => {
      const server = await startTestServer({
        admin: { token: "test-admin-token-long-enough" },
        guard: { automationAction: "challenge" },
      });
      t.after(() => server.stop());
      server.io.engine.opts.transports = ["polling"];
      if (policy === "ban") server.bans.add("127.0.0.1", 60_000, "test");
      const client = io(server.url, {
        ...connectionOptions,
        reconnection: false,
        auth: { automation: { signals: ["webdriver"] } },
      });
      t.after(() => client.disconnect());
      const rejected = once<Error>(client, "connect_error", 5000);
      client.connect();
      const error = await rejected;
      assert.equal(error.message, policy === "ban" ? CONNECTION_BLOCKED : CHALLENGE_REQUIRED);
      assert.equal(client.connected, false);
      assert.equal(server.realtime.sessions().length, 0);
    });
  }
});
