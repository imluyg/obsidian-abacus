import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import type { FileStatInfo, LedgerEntry, StatsAdapter, StatsSettings, VaultIO, Vec } from "./types";
import { DEFAULT_SETTINGS, vec } from "./types";
import { StatsStore, dayKey, monthKey } from "./store";
import { Scanner } from "./scanner";
import { StatsView, VIEW_TYPE_STATS, type DayBar, type PanelData } from "./view";
import { StatsSettingTab, type SettingsDirtyKind } from "./settings";
import {
  addDays,
  byDay,
  monthsBetween,
  startOfDay,
  startOfMonth,
  startOfWeek,
  sumDeletions,
  sumWriting,
} from "./stats";

const WEEK_CHARS = ["日", "一", "二", "三", "四", "五", "六"];
const LEDGER_TTL = 3000;

export default class SixColorStats extends Plugin {
  settings: StatsSettings = { ...DEFAULT_SETTINGS };
  store!: StatsStore;
  scanner!: Scanner;

  private statusBar!: HTMLElement;
  private ledgerCache = new Map<string, { at: number; entries: LedgerEntry[] }>();
  private refreshTimer: number | null = null;
  private progress: { done: number; total: number } | null = null;
  private baseDir = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    this.baseDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    const adapter = this.app.vault.adapter as unknown as StatsAdapter;
    this.store = new StatsStore(this.baseDir, adapter, 1);
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
      onChange: () => {
        this.ledgerCache.clear();
        this.scheduleRefresh(200);
      },
    });

    this.registerView(VIEW_TYPE_STATS, (leaf: WorkspaceLeaf) => new StatsView(leaf, () => this.rebuild()));

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("scs-statusbar");
    this.statusBar.setText("统计中…");
    this.statusBar.onclick = () => void this.activateView();
    this.statusBar.title = "点击打开字数统计面板";

    this.addRibbonIcon("calculator", "字数统计", () => void this.activateView());

    this.addCommand({
      id: "open-panel",
      name: "打开统计面板",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "rebuild",
      name: "重建全库快照",
      callback: () => void this.rebuild(),
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
  }

  async rebuild(): Promise<void> {
    new Notice("正在重建快照…");
    this.store.clear();
    const res = await this.scanner.fullScan(true);
    this.ledgerCache.clear();
    this.progress = null;
    await this.refresh();
    new Notice(`快照已重建：${res.files} 个文件。账本未改动。`);
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
    this.statusBar.setText(
      today === 0 ? "今日 +0" : `今日 +${data.todayAdd.cjk.toLocaleString("en-US")}字 +${data.todayAdd.lat.toLocaleString("en-US")}词`
    );
    this.statusBar.title =
      `本周 汉字 ${data.weekAdd.cjk.toLocaleString("en-US")} / 词 ${data.weekAdd.lat.toLocaleString("en-US")}\n` +
      `全库 汉字 ${data.total.cjk.toLocaleString("en-US")} / 词 ${data.total.lat.toLocaleString("en-US")}\n` +
      `点击打开面板`;
  }

  private async buildPanelData(): Promise<PanelData> {
    const now = Date.now();
    const chartDays = Math.max(1, this.settings.chartDays);
    const chartFrom = addDays(startOfDay(now), -(chartDays - 1));
    const from = Math.min(startOfMonth(now), startOfWeek(now), chartFrom);
    const entries = await this.readMonths(monthsBetween(from, now + 1));

    const todayAdd = sumWriting(entries, startOfDay(now), now + 1).add;
    const editDel = sumWriting(entries, startOfDay(now), now + 1).del;
    const fileDel = sumDeletions(entries, startOfDay(now), now + 1).del;
    const todayDel = vec(editDel.cjk + fileDel.cjk, editDel.lat + fileDel.lat);

    const perDay = byDay(entries);
    const days: DayBar[] = [];
    for (let i = 0; i < chartDays; i++) {
      const ts = addDays(chartFrom, i);
      const key = dayKey(ts);
      days.push({
        day: key,
        label: WEEK_CHARS[new Date(ts).getDay()],
        vec: perDay.get(key) ?? vec(0, 0),
        isToday: key === dayKey(now),
      });
    }

    const active = this.app.workspace.getActiveFile();
    const rec = active ? this.store.get(active.path) : undefined;

    return {
      todayAdd,
      todayDel,
      weekAdd: sumWriting(entries, startOfWeek(now), now + 1).add,
      monthAdd: sumWriting(entries, startOfMonth(now), now + 1).add,
      total: this.store.total(),
      fileCount: this.store.size(),
      current: active && rec ? { path: active.path, vec: rec.vec } : undefined,
      days,
      scanning: this.scanner?.isScanning ?? false,
      progress: this.progress ?? undefined,
      updatedAt: now,
    };
  }

  private async readMonths(yms: string[]): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = [];
    const now = Date.now();
    for (const ym of yms) {
      const hit = this.ledgerCache.get(ym);
      if (hit && now - hit.at < LEDGER_TTL) {
        out.push(...hit.entries);
        continue;
      }
      const entries = await this.store.readMonth(ym);
      this.ledgerCache.set(ym, { at: now, entries });
      out.push(...entries);
    }
    return out;
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

export type { Vec };
export { monthKey };
