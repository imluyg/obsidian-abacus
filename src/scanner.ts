import type {
  FileStatInfo,
  LedgerEntry,
  StatsSettings,
  Vec,
  VaultIO,
} from "./types";
import { isZeroVec, subVec, vec } from "./types";
import { countMarkdown, diffCounts } from "./counter";
import { StatsStore } from "./store";
import { isExcludedPath } from "./stats";

/**
 * 扫描器：唯一负责“把文件内容变成账本事件”的地方。
 *
 * 三条约定：
 * 1. 首次建库只写快照、不写账本（baseline），否则几十万字全砸在今天。
 * 2. 文件路径是身份，重命名只搬家不记账（否则会凭空多出一次“写作”）。
 * 3. 有上一次文本时用 diffCounts 精确拆分增删，没有时退化成净值。
 */

const TEXT_CACHE_LIMIT = 32;
/** 全量扫描时并发读文件；计数仍在主线程，这里只重叠 I/O */
const READ_CONCURRENCY = 4;

export interface ScanCallbacks {
  onProgress?: (done: number, total: number) => void;
  onChange?: () => void;
  /** 内容真的变了之后回调，用于把字数写回 frontmatter */
  onCounted?: (path: string, vec: Vec) => void;
}

export class Scanner {
  private timers = new Map<string, number>();
  private textCache = new Map<string, string>();
  private scanning = false;

  constructor(
    private io: VaultIO,
    private store: StatsStore,
    private getSettings: () => StatsSettings,
    private cb: ScanCallbacks = {}
  ) {}

  get isScanning(): boolean {
    return this.scanning;
  }

  isExcluded(path: string): boolean {
    return isExcludedPath(path, this.getSettings());
  }

  /* --------------------------- 全量扫描 --------------------------- */

  async fullScan(rebaseline = false): Promise<{ files: number; changed: number; baseline: boolean }> {
    if (this.scanning) return { files: 0, changed: 0, baseline: false };
    this.scanning = true;
    const opts = this.getSettings();
    if (rebaseline) this.store.clear();
    const firstRun = this.store.size() === 0;

    const files = this.io.listFiles().filter((f) => !this.isExcluded(f.path));
    const seen = new Set<string>();
    const pending: FileStatInfo[] = [];
    const entries: LedgerEntry[] = [];
    let changed = 0;
    let done = 0;

    try {
      for (const f of files) {
        seen.add(f.path);
        const rec = this.store.get(f.path);
        if (rec && rec.size === f.size && rec.mtime === f.mtime) continue;
        pending.push(f);
      }
      done = files.length - pending.length;
      this.cb.onProgress?.(done, files.length);

      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const idx = cursor++;
          if (idx >= pending.length) return;
          const f = pending[idx];
          const rec = this.store.get(f.path);

          const text = await this.io.readFile(f.path);
          const v = countMarkdown(text, opts);
          changed++;

          if (rec) {
            const { add, del } = this.splitDelta(rec.vec, v);
            if (!isZeroVec(add) || !isZeroVec(del)) {
              entries.push({ t: Date.now(), p: f.path, add: toTuple(add), del: toTuple(del), src: "scan" });
            }
          } else if (!firstRun) {
            // 快照里没有 = 关机期间新建的文件，算真实新增
            entries.push({
              t: Date.now(),
              p: f.path,
              add: toTuple(v),
              del: [0, 0],
              src: "scan",
            });
          }

          this.store.set(f.path, { size: f.size, mtime: f.mtime, vec: v });
          if (this.textCache.size < TEXT_CACHE_LIMIT) this.textCache.set(f.path, text);

          done++;
          if (done % 50 === 0) {
            this.cb.onProgress?.(done, files.length);
            await yieldToUi();
          }
        }
      };
      const workers = Array.from(
        { length: Math.min(READ_CONCURRENCY, pending.length) },
        () => worker()
      );
      await Promise.all(workers);

      // 关机期间被删掉的文件：从快照移除，记一次删除
      for (const [path, rec] of this.store.entries()) {
        if (seen.has(path)) continue;
        // 因为改了排除规则而“消失”的文件，不该记成删除
        if (this.isExcluded(path)) {
          this.store.remove(path);
          continue;
        }
        entries.push({
          t: Date.now(),
          p: path,
          add: [0, 0],
          del: toTuple(rec.vec),
          src: "delete",
        });
        this.store.remove(path);
      }

      await this.store.append(entries);
      await this.store.saveSnapshot();
      this.cb.onProgress?.(files.length, files.length);
      return { files: files.length, changed, baseline: firstRun };
    } finally {
      this.scanning = false;
      this.cb.onChange?.();
    }
  }

  /* --------------------------- 增量事件 --------------------------- */

  scheduleEdit(path: string): void {
    if (this.isExcluded(path)) return;
    const old = this.timers.get(path);
    if (old !== undefined) window.clearTimeout(old);
    const settings = this.getSettings();
    const timer = window.setTimeout(() => {
      this.timers.delete(path);
      void this.processEdit(path);
    }, Math.max(100, settings.debounceMs));
    this.timers.set(path, timer);
  }

  /** 文件重命名：只搬快照，不产生写作事件 */
  handleRename(oldPath: string, newPath: string): void {
    if (this.isExcluded(newPath)) {
      this.store.remove(oldPath);
      return;
    }
    this.store.rename(oldPath, newPath);
    const cached = this.textCache.get(oldPath);
    if (cached !== undefined) {
      this.textCache.delete(oldPath);
      this.textCache.set(newPath, cached);
    }
    this.cb.onChange?.();
  }

  async handleDelete(path: string): Promise<void> {
    const rec = this.store.remove(path);
    this.textCache.delete(path);
    if (!rec) return;
    await this.store.append([
      { t: Date.now(), p: path, add: [0, 0], del: toTuple(rec.vec), src: "delete" },
    ]);
    // 批量删目录时合并成一次快照写；onunload 会 flush
    this.store.scheduleSave(1000);
    this.cb.onChange?.();
  }

  /** 立刻把攒着的事件写盘（关窗前 / 手动保存） */
  async flush(): Promise<void> {
    for (const [, timer] of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    await this.store.flushSave();
  }

  private async processEdit(path: string): Promise<void> {
    const opts = this.getSettings();
    let text: string;
    try {
      text = await this.io.readFile(path);
    } catch {
      return; // 文件已经没了，交给 delete 事件处理
    }
    const v = countMarkdown(text, opts);
    const rec = this.store.get(path);
    const prevText = this.textCache.get(path);

    let add: Vec;
    let del: Vec;
    if (prevText !== undefined) {
      const d = diffCounts(prevText, text, opts);
      add = d.add;
      del = d.del;
    } else if (rec) {
      const d = this.splitDelta(rec.vec, v);
      add = d.add;
      del = d.del;
    } else {
      add = v;
      del = vec(0, 0);
    }

    this.textCache.set(path, text);
    if (this.textCache.size > TEXT_CACHE_LIMIT) {
      const first = this.textCache.keys().next().value;
      if (first !== undefined && first !== path) this.textCache.delete(first);
    }

    const stat = this.io.statFile(path);
    this.store.set(path, {
      size: stat?.size ?? rec?.size ?? 0,
      mtime: stat?.mtime ?? rec?.mtime ?? 0,
      vec: v,
    });

    if (!isZeroVec(add) || !isZeroVec(del)) {
      await this.store.append([
        { t: Date.now(), p: path, add: toTuple(add), del: toTuple(del), src: "edit" },
      ]);
      this.cb.onCounted?.(path, v);
    }
    this.store.scheduleSave();
    this.cb.onChange?.();
  }

  /** 只有整数净值可用时，按分量拆成增/删 */
  private splitDelta(prev: Vec, next: Vec): { add: Vec; del: Vec } {
    const d = subVec(next, prev);
    return {
      add: vec(Math.max(0, d.cjk), Math.max(0, d.lat)),
      del: vec(Math.max(0, -d.cjk), Math.max(0, -d.lat)),
    };
  }
}

function toTuple(v: Vec): [number, number] {
  return [v.cjk, v.lat];
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
