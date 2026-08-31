import {
  type HourlyEntry,
  type RankEntry,
  type RankPeriod,
  type RecentEntry,
  type StatsSnapshot,
  statsSnapshotSchema,
} from "../shared/stats.ts";
import type { Locale } from "./i18n/locale.ts";

/** 서버에서 통계를 가져온다. 형태가 맞지 않으면 null. */
export async function fetchStats(signal?: AbortSignal): Promise<StatsSnapshot | null> {
  const response = await fetch("/api/stats", signal === undefined ? {} : { signal });
  if (!response.ok) return null;
  const parsed = statsSnapshotSchema.parse(await response.json(), "stats");
  if (!parsed.ok) {
    console.warn(`통계 응답 형식이 올바르지 않습니다: ${parsed.error}`);
    return null;
  }
  return parsed.value;
}

/** "방금" / "5분 전" / "3시간 전". */
export function relativeTime(at: number, now: number, strings: Locale): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return strings.timeJustNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return strings.timeMinutes(minutes);
  return strings.timeHours(Math.floor(minutes / 60));
}

/** epoch 시(hour) 번호를 사람이 읽는 시각(0~23)으로. */
export const hourOfDay = (hour: number): number => new Date(hour * 3_600_000).getHours();

// ---------------------------------------------------------------- 순위

export function renderRanking(
  list: HTMLOListElement,
  entries: readonly RankEntry[],
  strings: Locale,
): void {
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rank-empty";
    empty.textContent = strings.rankEmpty;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(
    ...entries.map((entry, index) => {
      const item = document.createElement("li");
      item.className = "rank-row";

      const place = document.createElement("span");
      place.className = "rank-place";
      place.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "rank-name";
      name.textContent = entry.username;

      const count = document.createElement("span");
      count.className = "rank-count";
      count.textContent = strings.changesUnit(entry.count);

      item.append(place, name, count);
      return item;
    }),
  );
}

// ---------------------------------------------------------------- 최근 기록

export function renderRecent(
  list: HTMLOListElement,
  entries: readonly RecentEntry[],
  now: number,
  strings: Locale,
): void {
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rank-empty";
    empty.textContent = strings.recentEmpty;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("li");
      item.className = "recent-row";

      const name = document.createElement("span");
      name.className = "recent-name";
      name.textContent = entry.username;

      const arrow = document.createElement("span");
      // 방향은 화살표만으로 두지 않는다. aria-label로 의미를 함께 준다.
      arrow.className = `recent-arrow is-${entry.direction}`;
      arrow.textContent = entry.direction === "up" ? "▲" : "▼";
      arrow.setAttribute("aria-label", entry.direction === "up" ? strings.warmer : strings.cooler);

      const temp = document.createElement("span");
      temp.className = "recent-temp";
      temp.textContent = `${entry.temp}℃`;

      const when = document.createElement("time");
      when.className = "recent-time";
      when.dateTime = new Date(entry.at).toISOString();
      when.textContent = relativeTime(entry.at, now, strings);

      item.append(name, arrow, temp, when);
      return item;
    }),
  );
}

// ---------------------------------------------------------------- 시간대별 차트

const CHART = {
  width: 340,
  height: 72,
  /** 막대 사이를 배경색으로 벌리는 간격. 테두리 대신 이걸로 구분한다. */
  gap: 2,
  /** 값이 아주 작아도 보이도록 하는 최소 높이. */
  minBar: 2,
  radius: 2,
};

/**
 * 최근 24시간 활동 막대 차트.
 *
 * 단일 계열이라 색은 하나만 쓴다. 값이 클수록 진하게 칠하고 싶어지지만,
 * 그건 막대 길이가 이미 보여주는 것을 색으로 한 번 더 인코딩하는 것이라
 * 하지 않는다(범주에 자연 순서가 없을 때의 흔한 실수).
 * 계열이 하나뿐이므로 범례도 두지 않는다 -- 제목이 무엇을 그린 것인지 말한다.
 *
 * 막대마다 <title>과 tabindex를 줘서 마우스·키보드·스크린리더 모두에서
 * 값을 읽을 수 있게 한다. 좁은 다이얼로그라 별도 표 대신 이 방식을 택했다.
 */
export function renderHourlyChart(
  svg: SVGSVGElement,
  caption: HTMLElement,
  hourly: readonly HourlyEntry[],
  strings: Locale,
): void {
  const NS = "http://www.w3.org/2000/svg";
  const total = hourly.reduce((sum, entry) => sum + entry.changes, 0);
  const peak = Math.max(1, ...hourly.map((entry) => entry.changes));
  const band = CHART.width / Math.max(1, hourly.length);
  const barWidth = Math.max(1, band - CHART.gap);

  const defaultCaption = strings.hourlySummary(total);
  caption.textContent = defaultCaption;

  svg.setAttribute("viewBox", `0 0 ${CHART.width} ${CHART.height}`);

  // 차트 전체를 하나의 그림으로 읽히게 한다. <title>은 마크업에 이미 있고
  // (스크립트가 실패해도 남는다) 여기서 현재 요약으로 갱신한다.
  const chartTitle = svg.querySelector("title") ?? document.createElementNS(NS, "title");
  chartTitle.textContent = `${strings.hourlyTitle}. ${defaultCaption}`;

  // 활동이 없는 시간에는 막대를 그리지 않는다. 0을 1px 막대로 그리면 간격
  // 때문에 점선처럼 보여서, 기준선이 아니라 데이터인 척하는 노이즈가 된다.
  // 대신 바닥에 실선 하나를 깔아 어디가 0인지 보이게 한다.
  const baseline = document.createElementNS(NS, "line");
  baseline.setAttribute("class", "chart-baseline");
  baseline.setAttribute("x1", "0");
  baseline.setAttribute("x2", String(CHART.width));
  baseline.setAttribute("y1", String(CHART.height - 0.5));
  baseline.setAttribute("y2", String(CHART.height - 0.5));

  const marks = hourly.flatMap((entry, index) => {
    if (entry.changes === 0) return [];
    const scaled = (entry.changes / peak) * (CHART.height - 2);
    const barHeight = Math.max(CHART.minBar, scaled);

    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", String(index * band));
    rect.setAttribute("y", String(CHART.height - barHeight));
    rect.setAttribute("width", String(barWidth));
    rect.setAttribute("height", String(barHeight));
    rect.setAttribute("class", "bar");
    rect.setAttribute("rx", String(CHART.radius));
    rect.setAttribute("tabindex", "0");

    const detail = strings.hourlyDetail(hourOfDay(entry.hour), entry.changes, entry.averageTemp);
    const title = document.createElementNS(NS, "title");
    title.textContent = detail;
    rect.append(title);

    const show = (): void => {
      caption.textContent = detail;
    };
    const reset = (): void => {
      caption.textContent = defaultCaption;
    };
    rect.addEventListener("pointerenter", show);
    rect.addEventListener("focus", show);
    rect.addEventListener("pointerleave", reset);
    rect.addEventListener("blur", reset);

    return [rect];
  });

  svg.replaceChildren(chartTitle, baseline, ...marks);
}

// ---------------------------------------------------------------- 조립

export type StatsElements = {
  online: HTMLElement;
  rankTabs: readonly HTMLButtonElement[];
  rankList: HTMLOListElement;
  recentList: HTMLOListElement;
  chart: SVGSVGElement;
  chartCaption: HTMLElement;
};

/** 한 번 받아온 스냅샷을 화면 전체에 반영한다. */
export function renderStats(
  elements: StatsElements,
  snapshot: StatsSnapshot,
  period: RankPeriod,
  strings: Locale,
): void {
  elements.online.textContent = strings.onlineCount(snapshot.online);
  renderRanking(elements.rankList, snapshot[period], strings);
  renderRecent(elements.recentList, snapshot.recent, snapshot.at, strings);
  renderHourlyChart(elements.chart, elements.chartCaption, snapshot.hourly, strings);

  for (const tab of elements.rankTabs) {
    const selected = tab.dataset.rankPeriod === period;
    tab.setAttribute("aria-selected", String(selected));
    tab.classList.toggle("is-selected", selected);
  }
}
