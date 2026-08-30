import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 공유 온도값을 디스크에 남겨 재시작 후에도 이어지게 한다.
 *
 * 기존에는 서버를 재시작하면 전 세계가 함께 조절하던 온도가 말없이 18로
 * 돌아갔다. 배포 한 번에 상태가 날아가는 건 "다 같이 쓰는 온도계"라는
 * 컨셉 자체를 깨뜨린다.
 *
 * 쓰기는 디바운스한다. 버튼 하나 누를 때마다 fsync 하면 초당 수십 번
 * 디스크를 때리게 되므로, 마지막 변경 후 debounceMs 만큼 잠잠해지면 한 번
 * 쓴다. 종료 시에는 flush()로 마지막 상태를 반드시 남긴다.
 */
export class StateStore {
  #file;
  #debounceMs;
  #logger;
  #enabled;
  #timer = null;
  #pending = null;
  #writing = Promise.resolve();

  constructor({ file, debounceMs = 2000, logger = console, enabled = true }) {
    this.#file = file;
    this.#debounceMs = debounceMs;
    this.#logger = logger;
    this.#enabled = enabled;
  }

  /** 저장된 상태를 읽는다. 파일이 없거나 깨졌으면 null을 돌려주고 계속 진행한다. */
  async load() {
    if (!this.#enabled) return null;
    try {
      const raw = await readFile(this.#file, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      if (err.code !== "ENOENT") {
        this.#logger.warn?.(
          { err, file: this.#file },
          "저장된 상태를 읽지 못해 초기값으로 시작합니다",
        );
      }
      return null;
    }
  }

  /** 다음 쓰기를 예약한다. 연속 호출되면 마지막 값 하나만 기록된다. */
  schedule(data) {
    if (!this.#enabled) return;
    this.#pending = data;
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.#debounceMs);
    // 이 타이머 하나 때문에 프로세스가 살아 있을 이유는 없다.
    this.#timer.unref?.();
  }

  /** 예약된 쓰기를 즉시 수행한다. 종료 경로에서 호출한다. */
  async flush() {
    if (!this.#enabled) return;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const data = this.#pending;
    if (data === null) return this.#writing;

    this.#pending = null;
    // 쓰기를 직렬화해 두 개의 flush가 서로의 임시 파일을 덮어쓰지 않게 한다.
    this.#writing = this.#writing.then(() => this.#write(data));
    return this.#writing;
  }

  async #write(data) {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    try {
      await mkdir(path.dirname(this.#file), { recursive: true });
      // 임시 파일에 쓰고 rename으로 갈아끼운다. 쓰는 도중에 프로세스가 죽어도
      // 반쯤 쓰인 JSON이 남지 않는다(rename은 원자적).
      await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
      await rename(tmp, this.#file);
    } catch (err) {
      this.#logger.warn?.({ err, file: this.#file }, "상태 저장에 실패했습니다");
    }
  }
}
