import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../src/state-store.js";

const silent = { warn() {}, info() {}, error() {} };

describe("StateStore", () => {
  let dir;
  let file;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "myaircon-store-"));
    file = path.join(dir, "nested", "state.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("파일이 없으면 null을 주고 예외를 던지지 않는다", async () => {
    const store = new StateStore({ file, logger: silent });
    assert.equal(await store.load(), null);
  });

  it("저장한 값을 다시 읽는다 (재시작 후 온도 복원)", async () => {
    const store = new StateStore({ file, debounceMs: 0, logger: silent });
    store.schedule({ temp: 27 });
    await store.flush();

    const reopened = new StateStore({ file, logger: silent });
    assert.deepEqual(await reopened.load(), { temp: 27 });
  });

  it("없는 디렉터리를 만들어 준다", async () => {
    const store = new StateStore({ file, debounceMs: 0, logger: silent });
    store.schedule({ temp: 20 });
    await store.flush();
    assert.equal((await readFile(file, "utf8")).trim(), '{"temp":20}');
  });

  it("깨진 JSON을 만나도 null을 주고 계속 진행한다", async () => {
    const flat = path.join(dir, "state.json");
    await writeFile(flat, "{ this is not json", "utf8");
    const store = new StateStore({ file: flat, logger: silent });
    assert.equal(await store.load(), null);
  });

  it("JSON이지만 객체가 아니면 무시한다", async () => {
    const flat = path.join(dir, "state.json");
    await writeFile(flat, "42", "utf8");
    assert.equal(await new StateStore({ file: flat, logger: silent }).load(), null);
  });

  it("연속 호출을 디바운스해 마지막 값만 기록한다", async () => {
    const store = new StateStore({ file, debounceMs: 30, logger: silent });
    for (let temp = 18; temp <= 30; temp++) store.schedule({ temp });

    // 디바운스가 끝나기 전에는 아직 파일이 없어야 한다
    assert.rejects(() => readFile(file, "utf8"));

    await delay(80);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { temp: 30 });
  });

  it("flush는 예약된 쓰기를 즉시 수행한다 (종료 경로)", async () => {
    const store = new StateStore({ file, debounceMs: 60_000, logger: silent });
    store.schedule({ temp: 25 });
    await store.flush();
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { temp: 25 });
  });

  it("쓰기 후 임시 파일을 남기지 않는다 (원자적 교체)", async () => {
    const store = new StateStore({ file, debounceMs: 0, logger: silent });
    for (let i = 0; i < 5; i++) {
      store.schedule({ temp: 18 + i });
      await store.flush();
    }
    const left = await readdir(path.dirname(file));
    assert.deepEqual(left, ["state.json"]);
  });

  it("enabled=false면 아무것도 읽거나 쓰지 않는다", async () => {
    const store = new StateStore({ file, debounceMs: 0, logger: silent, enabled: false });
    assert.equal(await store.load(), null);
    store.schedule({ temp: 25 });
    await store.flush();
    await assert.rejects(() => readFile(file, "utf8"));
  });

  it("쓰기 실패해도 예외를 밖으로 던지지 않는다", async () => {
    // 디렉터리를 파일 경로로 지정해 mkdir/writeFile이 실패하게 만든다
    const store = new StateStore({ file: dir, debounceMs: 0, logger: silent });
    store.schedule({ temp: 22 });
    await assert.doesNotReject(() => store.flush());
  });

  it("예약된 것이 없으면 flush는 조용히 끝난다", async () => {
    const store = new StateStore({ file, debounceMs: 0, logger: silent });
    await assert.doesNotReject(() => store.flush());
  });
});
