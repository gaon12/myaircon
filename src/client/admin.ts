import {
  type AdminOverview,
  adminOverviewSchema,
  type BanRecordView,
  type SessionInfo,
} from "../shared/admin.ts";
import { requireElement } from "./dom.ts";

/**
 * 관리 화면.
 *
 * 토큰은 sessionStorage에만 둔다. localStorage와 달리 탭을 닫으면 사라져서,
 * 공용 컴퓨터에 남을 위험이 적다. 서버는 이 토큰을 Bearer로 확인한다.
 */
const TOKEN_KEY = "myaircon:adminToken";
const REFRESH_MS = 5000;
const DEFAULT_BAN_MINUTES = 10;

const els = {
  form: requireElement("[data-auth-form]", HTMLFormElement),
  token: requireElement("[data-token]", HTMLInputElement),
  status: requireElement("[data-status]", HTMLParagraphElement),
  panel: requireElement("[data-panel]", HTMLElement),
  online: requireElement("[data-online]", HTMLSpanElement),
  sessions: requireElement("[data-sessions]", HTMLTableSectionElement),
  bans: requireElement("[data-bans]", HTMLTableSectionElement),
};

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeToken(value: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
  } catch {
    // 저장이 안 되는 환경이면 이번 세션 동안 입력값만 쓴다.
  }
}

async function call(path: string, body?: unknown): Promise<Response> {
  const token = els.token.value;
  return fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setStatus(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.classList.toggle("is-error", isError);
}

const relative = (until: number, now: number): string => {
  const minutes = Math.max(0, Math.ceil((until - now) / 60_000));
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
};

const cell = (text: string, className?: string): HTMLTableCellElement => {
  const td = document.createElement("td");
  td.textContent = text;
  if (className !== undefined) td.className = className;
  return td;
};

function renderSessions(sessions: readonly SessionInfo[], now: number): void {
  if (sessions.length === 0) {
    const row = document.createElement("tr");
    const empty = cell("접속 중인 사람이 없습니다");
    empty.colSpan = 5;
    empty.className = "admin-empty";
    row.append(empty);
    els.sessions.replaceChildren(row);
    return;
  }

  els.sessions.replaceChildren(
    ...sessions.map((session) => {
      const row = document.createElement("tr");
      const action = document.createElement("td");
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "link is-danger";
      kick.textContent = "kick";
      kick.addEventListener("click", () => void kickSession(session));
      action.append(kick);

      row.append(
        cell(session.tag, "mono"),
        cell(session.nickname === "" ? "—" : session.nickname),
        cell(session.ip, "mono"),
        cell(`${Math.max(0, Math.round((now - session.connectedAt) / 60_000))}분 전`),
        action,
      );
      return row;
    }),
  );
}

function renderBans(bans: readonly BanRecordView[], now: number): void {
  if (bans.length === 0) {
    const row = document.createElement("tr");
    const empty = cell("차단된 주소가 없습니다");
    empty.colSpan = 5;
    empty.className = "admin-empty";
    row.append(empty);
    els.bans.replaceChildren(row);
    return;
  }

  els.bans.replaceChildren(
    ...bans.map((ban) => {
      const row = document.createElement("tr");
      const action = document.createElement("td");
      const lift = document.createElement("button");
      lift.type = "button";
      lift.className = "link";
      lift.textContent = "해제";
      lift.addEventListener("click", () => void unban(ban.ip));
      action.append(lift);

      row.append(
        cell(ban.tag, "mono"),
        cell(ban.ip, "mono"),
        cell(relative(ban.until, now)),
        cell(ban.reason === "" ? "—" : ban.reason),
        action,
      );
      return row;
    }),
  );
}

async function kickSession(session: SessionInfo): Promise<void> {
  const answer = window.prompt(
    `${session.tag} (${session.nickname === "" ? "이름 없음" : session.nickname})\n차단 시간(분). 0이면 끊기만 합니다.`,
    String(DEFAULT_BAN_MINUTES),
  );
  if (answer === null) return;
  const minutes = Number(answer);
  if (!Number.isInteger(minutes) || minutes < 0) {
    setStatus("차단 시간은 0 이상의 정수여야 합니다", true);
    return;
  }

  const response = await call("/api/admin/kick", {
    target: { ip: session.ip },
    minutes,
    reason: "admin",
  });
  if (!response.ok) {
    setStatus(`kick 실패 (${response.status})`, true);
    return;
  }
  const result = (await response.json()) as { disconnected: number };
  setStatus(`${result.disconnected}개 연결을 끊었습니다`);
  await refresh();
}

async function unban(ip: string): Promise<void> {
  const response = await call("/api/admin/unban", { ip });
  if (!response.ok) {
    setStatus(`해제 실패 (${response.status})`, true);
    return;
  }
  setStatus("차단을 해제했습니다");
  await refresh();
}

let timer: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
  let response: Response;
  try {
    response = await call("/api/admin/overview");
  } catch {
    setStatus("서버에 연결할 수 없습니다", true);
    return;
  }

  if (response.status === 401) {
    setStatus("토큰이 올바르지 않습니다", true);
    stopPolling();
    els.panel.hidden = true;
    return;
  }
  if (response.status === 404) {
    setStatus("관리 API가 꺼져 있습니다 (ADMIN_TOKEN 미설정)", true);
    stopPolling();
    els.panel.hidden = true;
    return;
  }
  if (!response.ok) {
    setStatus(`불러오지 못했습니다 (${response.status})`, true);
    return;
  }

  const parsed = adminOverviewSchema.parse(await response.json(), "overview");
  if (!parsed.ok) {
    setStatus(`응답 형식이 올바르지 않습니다: ${parsed.error}`, true);
    return;
  }

  show(parsed.value);
}

function show(overview: AdminOverview): void {
  els.panel.hidden = false;
  els.online.textContent = String(overview.online);
  renderSessions(overview.sessions, overview.at);
  renderBans(overview.bans, overview.at);
  setStatus(`${new Date(overview.at).toLocaleTimeString()} 기준`);
}

function startPolling(): void {
  stopPolling();
  timer = setInterval(() => void refresh(), REFRESH_MS);
}

function stopPolling(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  writeToken(els.token.value);
  startPolling();
  void refresh();
});

els.token.value = readToken();
if (els.token.value !== "") {
  startPolling();
  void refresh();
} else {
  setStatus("관리 토큰을 입력하세요");
}
