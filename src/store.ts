import type { LedgerEntry, StatsAdapter, Vec } from "./types";
import { isZeroVec, vec, ZERO } from "./types";

/**
 * 持久层。两件事分开存：
 *
 * - snapshot：当前每篇多少字（“存量”，可全量重建）
 * - ledger  ：逐次追加的事件（“流量”，永不改写）
 *
 * 账本按自然月分文件，追加写，天然可合并。不用 Obsidian 的
 * saveData/loadData，避免和设置混在一个 data.json 里反复全量覆盖。
 */

const SNAPSHOT_REL = "stats/snapshot.json";
const LEDGER_REL = "stats/ledger";

/** 与持久化格式解耦的内存结构 */
export interface Record2 {
  size: number;
  mtime: number;
  vec: Vec;
}

export class StatsStore {
  private records = new Map<string, Record2>();
  private loaded = false;

  constructor(
    private baseDir: string,
    private adapter: StatsAdapter,
    private snapshotVersion = 1
  ) {}

  private saveTimer: number | null = null;

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** 重建快照时清空内存态；磁盘上的旧快照会被下一次 save 覆盖 */
  clear(): void {
    this.records.clear();
  }

  entries(): [string, Record2][] {
    return [...this.records.entries()];
  }

  get(path: string): Record2 | undefined {
    return this.records.get(path);
  }

  size(): number {
    return this.records.size;
  }

  set(path: string, rec: Record2): void {
    this.records.set(path, rec);
  }

  remove(path: string): Record2 | undefined {
    const r = this.records.get(path);
    this.records.delete(path);
    return r;
  }

  rename(oldPath: string, newPath: string): void {
    const r = this.records.get(oldPath);
    if (!r) return;
    this.records.delete(oldPath);
    this.records.set(newPath, r);
  }

  total(): Vec {
    let cjk = 0;
    let lat = 0;
    for (const [, r] of this.records) {
      cjk += r.vec.cjk;
      lat += r.vec.lat;
    }
    return vec(cjk, lat);
  }

  /* ------------------------------ 读写 ------------------------------ */

  async load(): Promise<void> {
    try {
      const raw = await this.adapter.read(this.path(SNAPSHOT_REL));
      const data = JSON.parse(raw) as {
        version?: number;
        files?: Record<string, { s: number; m: number; c: [number, number] }>;
      };
      if (data?.files) {
        for (const [path, r] of Object.entries(data.files)) {
          if (!r || !Array.isArray(r.c)) continue;
          this.records.set(path, { size: r.s ?? 0, mtime: r.m ?? 0, vec: vec(r.c[0], r.c[1]) });
        }
      }
    } catch {
      // 首次运行 / 文件损坏：从空快照开始，下一次全量扫描会重建
    }
    this.loaded = true;
  }

  async saveSnapshot(): Promise<void> {
    const files: Record<string, { s: number; m: number; c: [number, number] }> = {};
    for (const [path, r] of this.records) {
      files[path] = { s: r.size, m: r.mtime, c: [r.vec.cjk, r.vec.lat] };
    }
    const payload = JSON.stringify({ version: this.snapshotVersion, updatedAt: Date.now(), files });
    await this.ensureDir("stats");
    await this.adapter.write(this.path(SNAPSHOT_REL), payload);
  }

  /**
   * 快照写盘很贵（上千条记录），编辑时不要每次都写。
   * 攒 4 秒，崩溃最多丢掉这 4 秒的“存量”，账本不受影响。
   */
  scheduleSave(delay = 4000): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSnapshot();
    }, delay);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.loaded) await this.saveSnapshot();
  }

  /** 追加一批事件；同一批次内按月份归并，各只写一次 */
  async append(entries: LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const byMonth = new Map<string, string[]>();
    for (const e of entries) {
      if (isZeroVec(vec(e.add[0], e.add[1])) && isZeroVec(vec(e.del[0], e.del[1]))) continue;
      const ym = monthKey(e.t);
      const line = JSON.stringify(e);
      const arr = byMonth.get(ym);
      if (arr) arr.push(line);
      else byMonth.set(ym, [line]);
    }
    if (byMonth.size === 0) return;
    await this.ensureDir("stats");
    await this.ensureDir(LEDGER_REL);
    for (const [ym, lines] of byMonth) {
      const rel = this.ledgerPath(ym);
      let prev = "";
      try {
        prev = await this.adapter.read(this.path(rel));
      } catch {
        prev = "";
      }
      const next = (prev && !prev.endsWith("\n") ? prev + "\n" : prev) + lines.join("\n") + "\n";
      await this.adapter.write(this.path(rel), next);
    }
  }

  /** 读某个月的全部事件；文件不存在返回空 */
  async readMonth(ym: string): Promise<LedgerEntry[]> {
    try {
      const raw = await this.adapter.read(this.path(this.ledgerPath(ym)));
      return parseLedger(raw);
    } catch {
      return [];
    }
  }

  async readMonths(yms: string[]): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = [];
    for (const ym of yms) out.push(...(await this.readMonth(ym)));
    return out;
  }

  /** 账本里已有的月份，升序 */
  async listLedgerMonths(): Promise<string[]> {
    try {
      const res = await this.adapter.list(this.path(LEDGER_REL));
      return res.files
        .map((f) => f.split("/").pop() ?? "")
        .filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
        .map((f) => f.replace(/\.jsonl$/, ""))
        .sort();
    } catch {
      return [];
    }
  }

  /* ------------------------------ 工具 ------------------------------ */

  private path(rel: string): string {
    const base = this.baseDir.replace(/\/+$/, "");
    return base ? `${base}/${rel}` : rel;
  }

  private ledgerPath(ym: string): string {
    return `${LEDGER_REL}/${ym}.jsonl`;
  }

  private async ensureDir(rel: string): Promise<void> {
    const p = this.path(rel);
    try {
      if (!(await this.adapter.exists(p))) await this.adapter.mkdir(p);
    } catch {
      // 已存在或无权限：交给后续 write 报错
    }
  }
}

export function parseLedger(raw: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const e = JSON.parse(s) as LedgerEntry;
      if (typeof e.t === "number" && typeof e.p === "string" && Array.isArray(e.add)) out.push(e);
    } catch {
      // 坏行跳过：可能是同步冲突写坏的半行
    }
  }
  return out;
}

/** 本地时区的 YYYY-MM */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

/** 本地时区的 YYYY-MM-DD */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export { ZERO };
