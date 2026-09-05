import type { RankPeriod } from "../shared/stats.ts";
import { requireElement } from "./dom.ts";
import type { Locale } from "./i18n/locale.ts";
import { fetchStats, renderStats, type StatsElements } from "./stats.ts";
import { readCount } from "./storage.ts";

/** 통계 요청 취소와 기간 선택을 소유한다. 늦게 온 이전 응답은 표시하지 않는다. */
export function createStatsDialog(
  getStrings: () => Locale,
  onOnlineCount: (online: number) => void,
) {
  const els = {
    statsDialog: requireElement("[data-stats-dialog]", HTMLDialogElement),
    plusCount: requireElement("[data-plus-count]", HTMLSpanElement),
    minusCount: requireElement("[data-minus-count]", HTMLSpanElement),
    showStats: requireElement("[data-show-stats]", HTMLButtonElement),
    statsOnline: requireElement("[data-online-count]", HTMLParagraphElement),
    rankList: requireElement("[data-rank-list]", HTMLOListElement),
    recentList: requireElement("[data-recent-list]", HTMLOListElement),
    chart: requireElement("[data-hourly-chart]", SVGSVGElement),
    chartCaption: requireElement("[data-hourly-caption]", HTMLParagraphElement),
  };

  const rankTabs = [...document.querySelectorAll<HTMLButtonElement>("[data-rank-period]")];

  const statsElements: StatsElements = {
    online: els.statsOnline,
    rankTabs,
    rankList: els.rankList,
    recentList: els.recentList,
    chart: els.chart,
    chartCaption: els.chartCaption,
  };

  let rankPeriod: RankPeriod = "today";
  let statsRequest: AbortController | null = null;

  async function loadStats(): Promise<void> {
    statsRequest?.abort();
    const controller = new AbortController();
    statsRequest = controller;
    try {
      const snapshot = await fetchStats(controller.signal);
      if (controller.signal.aborted) return;
      if (snapshot === null) {
        els.statsOnline.textContent = getStrings().statsError;
        return;
      }
      onOnlineCount(snapshot.online);
      renderStats(statsElements, snapshot, rankPeriod, getStrings());
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn("통계를 가져오지 못했습니다", error);
        els.statsOnline.textContent = getStrings().statsError;
      }
    }
  }

  for (const tab of rankTabs) {
    tab.addEventListener("click", () => {
      const period = tab.dataset.rankPeriod;
      if (period !== "today" && period !== "allTime") return;
      if (period === rankPeriod) return;
      rankPeriod = period;
      void loadStats();
    });
  }

  els.showStats.addEventListener("click", () => {
    els.plusCount.textContent = String(readCount("plus"));
    els.minusCount.textContent = String(readCount("minus"));
    els.statsDialog.showModal();
    void loadStats();
  });

  return {
    renderStrings() {
      if (els.statsDialog.open) void loadStats();
    },
  };
}
