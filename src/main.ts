import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import type { FileStatInfo, LedgerEntry, StatsAdapter, StatsSettings, VaultIO, Vec } from "./types";
import { addVec, DEFAULT_SETTINGS, isZeroVec, vec } from "./types";
import { StatsStore, dayKey, monthKey, type LedgerAudit } from "./store";
import { Scanner } from "./scanner";
import { StatsView, VIEW_TYPE_STATS, type DayBar, type HealthInfo, type PanelData, type ProjectRow } from "./view";
import { StatsSettingTab, type SettingsDirtyKind } from "./settings";
import {
  addDays,
  byDay,
  daysWithWriting,
  fmtDate,
  isExcludedPath,
  isWritingEntry,
  isoWeek,
  monthsBetween,
  parseProjectRules,
  projectOf,
  startOfDay,
  startOfMonth,
  startOfWeek,
  streakFrom,
  sumDeletions,
  sumWriting,
  weekdayCN,
} from "./stats";
import { buildWeeklyReport, type ReportDaily, type ReportProject, type ReportFile } from "./report";

const WEEK_CHARS = ["日", "一", "二", "三", "四", "五", "六"];
const DEVICE_KEY = "abacus-device-id";

/**
 * 设备标识，用在账本文件名里。
 * 故意放 localStorage 而不是 data.json：data.json 会跟着同步走，
 * 那样每台设备拿到的都是同一个 id，分文件就失去意义了。
 */
function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "local";
  }
}
const LEDGER_TTL = 3000;
const TOP_PROJECTS = 6;
const TOP_REPORT_FILES = 10;

export default class AbacusPlugin extends Plugin {
  settings: StatsSettings = { ...DEFAULT_SETTINGS };
  store!: StatsStore;
  scanner!: Scanner;

  private statusBar!: HTMLElement;
  private ledgerCache = new Map<string, { at: number; entries: LedgerEntry[] }>();
  private refreshTimer: number | null = null;
  private progress: { done: number; total: number } | null = null;
  private streakCache: { at: number; value: number } | null = null;
  private health: HealthInfo | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    const baseDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    const adapter = this.app.vault.adapter as unknown as StatsAdapter;
    this.store = new StatsStore(baseDir, adapter, { version: 1, deviceId: deviceId() });
    await this.store.load();

    const io: VaultIO = {
      listFiles: (): FileStatInfo[] =>
        this.app.vault.getMarkdownFiles().map((f) => ({
          path: f.path,
          size: f.stat.size,
          mtime: f.stat.mtime,
        })),
      readFile: async (path: string): Promise<string> => {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) return this.app.vault.cachedRead(f);
        throw new Error(`not a markdown file: ${path}`);
      },
      adapter,
    };

    this.scanner = new Scanner(io, this.store, () => this.settings, {
      onProgress: (done, total) => {
        this.progress = { done, total };
        this.scheduleRefresh(120);
      },
      onChange: () => this.invalidate(),
    });

    this.registerView(
      VIEW_TYPE_STATS,
      (leaf: WorkspaceLeaf) =>
        new StatsView(leaf, {
          onRescan: () => void this.rebuild(),
          onRange: (days) => void this.setRange(days),
          onAudit: () => void this.auditLedger(),
        })
    );

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("scs-statusbar");
    this.statusBar.setText("统计中…");
    this.statusBar.onclick = () => void this.activateView();
    this.statusBar.title = "点击打开字数统计面板";

    this.addRibbonIcon("calculator", "字数统计", () => void this.activateView());

    this.addCommand({ id: "open-panel", name: "打开统计面板", callback: () => void this.activateView() });
    this.addCommand({ id: "rebuild", name: "重建全库快照", callback: () => void this.rebuild() });
    this.addCommand({
      id: "weekly-report",
      name: "生成本周周报",
      callback: () => void this.generateReport(startOfWeek(Date.now()), true),
    });
    this.addCommand({
      id: "weekly-report-last",
      name: "补生成上周周报",
      callback: () => void this.generateReport(addDays(startOfWeek(Date.now()), -7), true),
    });
    this.addCommand({
      id: "export-ledger",
      name: "导出账本备份",
      callback: () => void this.exportLedger(),
    });
    this.addCommand({
      id: "audit-ledger",
      name: "检查账本完整性",
      callback: () => void this.auditLedger(),
    });

    this.addSettingTab(new StatsSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (f: TAbstractFile) => {
        if (f instanceof TFile && f.extension === "md") this.scanner.scheduleEdit(f.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (f instanceof TFile && f.extension === "md") this.scanner.scheduleEdit(f.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
        if (f instanceof TFile && f.extension === "md") this.scanner.handleRename(oldPath, f.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f: TAbstractFile) => {
        if (f instanceof TFile && f.extension === "md") void this.scanner.handleDelete(f.path);
      })
    );

    this.registerInterval(window.setInterval(() => void this.refresh(), 60_000));

    this.app.workspace.onLayoutReady(() => {
      void this.initialScan();
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    void this.store?.flushSave();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS);
  }

  /* ----------------------------- 生命周期 ----------------------------- */

  private async initialScan(): Promise<void> {
    const res = await this.scanner.fullScan(false);
    this.progress = null;
    if (res.baseline && res.files > 0) {
      new Notice(`已建立快照：${res.files} 个文件。从今天起开始记账。`);
    }
    await this.refresh();
    void this.autoWeeklyReport();
    void this.checkLedgerHealth();
  }

  async rebuild(): Promise<void> {
    new Notice("正在重建快照…");
    this.store.clear();
    const res = await this.scanner.fullScan(true);
    this.invalidate();
    this.progress = null;
    await this.refresh();
    new Notice(`快照已重建：${res.files} 个文件。账本未改动。`);
  }

  async setRange(days: number): Promise<void> {
    if (this.settings.panelRange === days) return;
    this.settings.panelRange = days;
    await this.saveData(this.settings);
    await this.refresh();
  }

  async applySettings(kinds: SettingsDirtyKind[]): Promise<void> {
    await this.saveData(this.settings);
    if (kinds.includes("counter") || kinds.includes("scan")) {
      await this.rebuild();
    } else {
      await this.refresh();
    }
  }

  /* ------------------------------ 数据流 ------------------------------ */

  private invalidate(): void {
    this.ledgerCache.clear();
    this.streakCache = null;
    this.scheduleRefresh(200);
  }

  private scheduleRefresh(delay = 250): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  async refresh(): Promise<void> {
    if (!this.store) return;
    const data = await this.buildPanelData();
    const view = this.getView();
    if (view) view.setData(data);
    this.updateStatusBar(data);
  }

  private updateStatusBar(data: PanelData): void {
    if (!this.statusBar) return;
    const today = data.todayAdd.cjk + data.todayAdd.lat;
    const warn = data.health && !data.health.ok ? " ⚠" : "";
    this.statusBar.setText(
      (today === 0
        ? "今日 +0"
        : `今日 +${data.todayAdd.cjk.toLocaleString("en-US")}字 +${data.todayAdd.lat.toLocaleString("en-US")}词`) + warn
    );
    this.statusBar.title =
      `本周 汉字 ${data.weekAdd.cjk.toLocaleString("en-US")} / 词 ${data.weekAdd.lat.toLocaleString("en-US")}\n` +
      (data.streak > 0 ? `连续 ${data.streak} 天\n` : "") +
      (data.health && !data.health.ok ? `⚠ ${data.health.problems[0]}\n` : "") +
      `全库 汉字 ${data.total.cjk.toLocaleString("en-US")} / 词 ${data.total.lat.toLocaleString("en-US")}\n` +
      `点击打开面板`;
  }

  private async buildPanelData(): Promise<PanelData> {
    const now = Date.now();
    const range = this.settings.panelRange === 30 ? 30 : 7;
    const chartFrom = addDays(startOfDay(now), -(range - 1));
    const from = Math.min(startOfMonth(now), startOfWeek(now), chartFrom);
    const entries = await this.readMonths(monthsBetween(from, now + 1));

    const todaySum = sumWriting(entries, startOfDay(now), now + 1);
    const fileDel = sumDeletions(entries, startOfDay(now), now + 1).del;
    const todayDel = vec(todaySum.del.cjk + fileDel.cjk, todaySum.del.lat + fileDel.lat);

    const perDay = byDay(entries);
    const days: DayBar[] = [];
    for (let i = 0; i < range; i++) {
      const ts = addDays(chartFrom, i);
      const key = dayKey(ts);
      days.push({
        day: key,
        label: range > 7 ? `${new Date(ts).getDate()}` : WEEK_CHARS[new Date(ts).getDay()],
        vec: perDay.get(key) ?? vec(0, 0),
        isToday: key === dayKey(now),
      });
    }

    const active = this.app.workspace.getActiveFile();
    const rec = active ? this.store.get(active.path) : undefined;

    return {
      todayAdd: todaySum.add,
      todayDel,
      weekAdd: sumWriting(entries, startOfWeek(now), now + 1).add,
      monthAdd: sumWriting(entries, startOfMonth(now), now + 1).add,
      total: this.store.total(),
      fileCount: this.store.size(),
      current: active && rec ? { path: active.path, vec: rec.vec } : undefined,
      days,
      range,
      streak: await this.computeStreak(),
      projects: this.buildProjects(entries, now),
      health: this.health ?? undefined,
      scanning: this.scanner?.isScanning ?? false,
      progress: this.progress ?? undefined,
      updatedAt: now,
    };
  }

  /** 项目：本月新增 + 全库存量，按本月新增排序 */
  private buildProjects(entries: LedgerEntry[], now: number): ProjectRow[] {
    const rules = parseProjectRules(this.settings.projectRules);
    const monthFrom = startOfMonth(now);

    const stock = new Map<string, Vec>();
    for (const [path, r] of this.store.entries()) {
      const name = projectOf(path, rules);
      stock.set(name, addVec(stock.get(name) ?? vec(0, 0), r.vec));
    }

    const flow = new Map<string, Vec>();
    for (const e of entries) {
      if (e.t < monthFrom || e.t > now) continue;
      if (!isWritingEntry(e)) continue;
      const name = projectOf(e.p, rules);
      flow.set(name, addVec(flow.get(name) ?? vec(0, 0), vec(e.add[0], e.add[1])));
    }

    const rows: ProjectRow[] = [];
    for (const [name, total] of stock) {
      rows.push({ name, month: flow.get(name) ?? vec(0, 0), total });
    }
    for (const [name, month] of flow) {
      if (!stock.has(name)) rows.push({ name, month, total: vec(0, 0) });
    }

    return rows
      .filter((r) => !isZeroVec(r.total) || !isZeroVec(r.month))
      .sort((a, b) => b.month.cjk - a.month.cjk || b.total.cjk - a.total.cjk)
      .slice(0, TOP_PROJECTS);
  }

  /**
   * 连续写作天数：从今天往回逐日查，遇到空白天就停。
   * 只加载真正走过的那几个月，不会为了一个数字把几年账本读一遍。
   */
  private async computeStreak(): Promise<number> {
    const now = Date.now();
    if (this.streakCache && now - this.streakCache.at < LEDGER_TTL) return this.streakCache.value;

    const today = startOfDay(now);
    const days = new Set<string>();
    const monthSets = new Map<string, Set<string>>();

    for (let i = 0; i < 400; i++) {
      const ts = addDays(today, -i);
      const ym = monthKey(ts);
      let set = monthSets.get(ym);
      if (!set) {
        set = daysWithWriting(await this.readMonthCached(ym));
        monthSets.set(ym, set);
      }
      const key = dayKey(ts);
      if (set.has(key)) {
        days.add(key);
      } else if (i > 0) {
        break; // 今天还没写不算断，昨天没写才算
      }
    }

    const value = streakFrom(days, today);
    this.streakCache = { at: now, value };
    return value;
  }

  private async readMonthCached(ym: string): Promise<LedgerEntry[]> {
    const now = Date.now();
    const hit = this.ledgerCache.get(ym);
    if (hit && now - hit.at < LEDGER_TTL) return hit.entries;
    const entries = await this.store.readMonth(ym);
    this.ledgerCache.set(ym, { at: now, entries });
    return entries;
  }

  private async readMonths(yms: string[]): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = [];
    for (const ym of yms) out.push(...(await this.readMonthCached(ym)));
    return out;
  }

  /* ------------------------------ 周报 ------------------------------ */

  /** 生成某一周的周报，返回是否真的写了文件 */
  async generateReport(weekStart: number, notify: boolean): Promise<boolean> {
    const weekEnd = addDays(weekStart, 7);
    const entries = await this.readMonths(monthsBetween(weekStart, weekEnd));
    const rules = parseProjectRules(this.settings.projectRules);

    const dailyVec = byDay(entries);
    const daily: ReportDaily[] = [];
    let activeDays = 0;
    for (let i = 0; i < 7; i++) {
      const ts = addDays(weekStart, i);
      const key = dayKey(ts);
      const v = dailyVec.get(key) ?? vec(0, 0);
      if (v.cjk + v.lat > 0) activeDays++;
      daily.push({ date: key, weekday: weekdayCN(ts), vec: v });
    }

    const weekSum = sumWriting(entries, weekStart, weekEnd);
    const weekDel = sumDeletions(entries, weekStart, weekEnd).del;
    // 那一周完全没数据就不生成，免得给空周留下占位文件
    if (weekSum.add.cjk + weekSum.add.lat + weekDel.cjk + weekDel.lat === 0) return false;

    const projMap = new Map<string, Vec>();
    const fileMap = new Map<string, Vec>();
    for (const e of entries) {
      if (e.t < weekStart || e.t >= weekEnd || !isWritingEntry(e)) continue;
      const v = vec(e.add[0], e.add[1]);
      const p = projectOf(e.p, rules);
      projMap.set(p, addVec(projMap.get(p) ?? vec(0, 0), v));
      fileMap.set(e.p, addVec(fileMap.get(e.p) ?? vec(0, 0), v));
    }

    const projects: ReportProject[] = [...projMap.entries()]
      .map(([name, v]) => ({ name, vec: v }))
      .sort((a, b) => b.vec.cjk - a.vec.cjk);
    const topFiles: ReportFile[] = [...fileMap.entries()]
      .map(([path, v]) => ({ path, vec: v }))
      .sort((a, b) => b.vec.cjk - a.vec.cjk)
      .slice(0, TOP_REPORT_FILES);

    const content = buildWeeklyReport({
      week: isoWeek(weekStart),
      weekStartLabel: `${new Date(weekStart).getMonth() + 1}月${new Date(weekStart).getDate()}日`,
      weekEndLabel: `${new Date(weekEnd - 86400000).getMonth() + 1}月${new Date(weekEnd - 86400000).getDate()}日`,
      add: weekSum.add,
      del: weekDel,
      activeDays,
      streak: await this.computeStreak(),
      total: this.store.total(),
      fileCount: this.store.size(),
      daily,
      projects,
      topFiles,
      generatedAt: Date.now(),
    });

    const path = this.reportPath(weekStart);
    try {
      await this.writeVaultFile(path, content);
      if (notify) new Notice(`周报已写入 ${path}`);
      return true;
    } catch (err) {
      new Notice(`写周报失败：${(err as Error).message}`);
      return false;
    }
  }

  /** 启动时补上周的周报：只做一次，已有文件就不动 */
  private async autoWeeklyReport(): Promise<void> {
    if (!this.settings.autoWeeklyReport) return;
    const lastWeek = addDays(startOfWeek(Date.now()), -7);
    if (this.app.vault.getAbstractFileByPath(this.reportPath(lastWeek))) return;
    if (await this.generateReport(lastWeek, false)) {
      new Notice(`上周周报已生成：${this.reportPath(lastWeek)}`);
    }
  }

  private reportPath(weekStart: number): string {
    const folder = normalizePath(this.settings.reportFolder || "归档/统计归档");
    return normalizePath(`${folder}/周报 ${isoWeek(weekStart)}.md`);
  }

  /**
   * 把账本导出成一个 JSON，放到会被同步的普通目录里。
   * 账本本身住在 .obsidian 下，remotely-save 不一定会同步它；
   * 这个文件是真正意义上的异地备份。
   */
  async exportLedger(): Promise<void> {
    const months = await this.store.listLedgerMonths();
    if (months.length === 0) {
      new Notice("账本还是空的，没有可导出的内容。");
      return;
    }
    const all: LedgerEntry[] = [];
    for (const ym of months) all.push(...(await this.store.readMonth(ym)));

    const folder = normalizePath(this.settings.backupFolder || "归档/统计归档/账本备份");
    const stamp = dayKey(Date.now()); // 用本地日期，别用 UTC
    const path = normalizePath(`${folder}/账本备份 ${stamp}.json`);
    try {
      await this.writeVaultFile(
        path,
        JSON.stringify({ exportedAt: new Date().toISOString(), months, count: all.length, entries: all })
      );
      new Notice(`账本已导出：${path}（${all.length} 条）`);
    } catch (err) {
      new Notice(`导出失败：${(err as Error).message}`);
    }
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder || this.app.vault.getAbstractFileByPath(folder)) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch {
      // 并发创建：忽略
    }
  }

  private async writeVaultFile(path: string, content: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");
    await this.ensureFolder(folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
  }

  /* ------------------------------ 体检 ------------------------------ */

  /** 启动时的轻量体检：只看最近两个月，只有发现问题才打扰你 */
  private async checkLedgerHealth(): Promise<void> {
    if (this.store.repairs.length > 0) {
      const dropped = this.store.repairs.reduce((n, r) => n + r.dropped, 0);
      new Notice(`账本末尾发现截断，已丢弃 ${dropped} 个字符的残行后继续记录。`, 8000);
      this.store.repairs.length = 0;
    }

    // 不再弹窗打扰：结果常驻在面板底部和状态栏角标上
    await this.refreshHealth();
  }

  private setHealth(a: LedgerAudit): void {
    this.health = {
      ok: a.problems.length === 0,
      problems: a.problems,
      months: a.months.length,
      entries: a.totalEntries,
      checkedAt: Date.now(),
    };
    this.scheduleRefresh(0);
  }

  /** 全量体检一次，结果给面板和状态栏用 */
  private async refreshHealth(): Promise<void> {
    try {
      this.setHealth(await this.store.audit());
    } catch {
      this.health = null;
    }
  }

  async auditLedger(): Promise<void> {
    const a = await this.store.audit();
    this.setHealth(a);
    if (a.problems.length === 0) {
      new Notice(`账本正常：${a.months.length} 个月 · ${a.totalEntries} 条事件`);
      return;
    }

    const lines: string[] = [
      `# 账本体检 ${dayKey(Date.now())}`,
      "",
      `- 覆盖月份：${a.months.join("、") || "（空）"}`,
      `- 事件总数：${a.totalEntries}`,
      `- 无法解析的行：${a.badLines}`,
      `- 末尾缺换行：${a.truncated.join("、") || "无"}`,
      `- 重复事件：${a.duplicates}`,
      `- 未来时间戳：${a.future}`,
      "",
      "## 问题",
      "",
      ...a.problems.map((p) => `- ${p}`),
      "",
      "> 账本无法重建。体检发现异常时，先做一次「导出账本备份」再排查。",
    ];

    const folder = this.settings.reportFolder || "归档/统计归档";
    const path = normalizePath(`${folder}/账本体检 ${dayKey(Date.now())}.md`);
    try {
      await this.writeVaultFile(path, lines.join("\n"));
      new Notice(`账本体检发现 ${a.problems.length} 项问题，已写入 ${path}`, 10000);
    } catch (err) {
      new Notice(`体检报告写入失败：${(err as Error).message}`);
    }
  }

  /* ------------------------------ 界面 ------------------------------ */

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_STATS);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
    await workspace.revealLeaf(leaf);
  }

  private getView(): StatsView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS);
    if (leaves.length === 0) return null;
    return leaves[0].view as StatsView;
  }

  /* ------------------------------ 设置 ------------------------------ */

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<StatsSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
    if (!Array.isArray(this.settings.excludeFolders)) {
      this.settings.excludeFolders = [...DEFAULT_SETTINGS.excludeFolders];
    }
    if (!Array.isArray(this.settings.projectRules)) {
      this.settings.projectRules = [];
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** 周报目录与排除规则共用一套判断，供 Scanner 调用 */
  isExcluded(path: string): boolean {
    return isExcludedPath(path, this.settings);
  }
}

export type { Vec };
export { monthKey, fmtDate };
