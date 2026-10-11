import type { LedgerEntry, StatsAdapter, Vec } from "./types";
import { entryKey, isZeroVec, vec, ZERO } from "./types";

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
    private opts: { version?: number; deviceId?: string } = {}
  ) {}

  private get snapshotVersion(): number {
    return this.opts.version ?? 1;
  }

  /**
   * 设备标识，写进账本文件名。
   *
   * 为什么按设备分文件：多台设备同写一个月时，单文件会被后同步的那份整个覆盖，
   * 丢的是另一台设备的全部记录，而且没有任何提示。分文件后最坏情况是
   * 「两个文件并存」，读的时候合并即可，冲突从「丢数据」降级成「多一份文件」。
   */
  private get deviceId(): string {
    return this.opts.deviceId || "local";
  }

  private saveTimer: number | null = null;
  /** 账本文件上次写完后的大小，用来判断能否直接追加 */
  private lastSize = new Map<string, number>();
  private ensuredDirs = new Set<string>();
  private appendListeners: ((entries: LedgerEntry[]) => void)[] = [];

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** 本机成功追加事件后的通知；用于让上层缓存原地追加，而不是整体失效 */
  onAppend(cb: (entries: LedgerEntry[]) => void): void {
    this.appendListeners.push(cb);
  }

  private notifyAppend(entries: LedgerEntry[]): void {
    for (const cb of this.appendListeners) cb(entries);
  }

  /** 重建快照时清空内存态；磁盘上的旧快照会被下一次 save 覆盖 */
  clear(): void {
    this.records.clear();
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  entries(): [string, Record2][] {
    return [...this.records.entries()];
  }

  /** 遍历而不复制整个 Map，供刷新等只读路径使用 */
  forEach(cb: (path: string, rec: Record2) => void): void {
    for (const [path, rec] of this.records) cb(path, rec);
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
    this.forEach((_path, r) => {
      cjk += r.vec.cjk;
      lat += r.vec.lat;
    });
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
   * 快照写盘很贵，而且它随时可以由全量扫描重建——
   * 所以不必追着每一次编辑写。攒 30 秒，崩溃最多丢这点“存量”，
   * 账本（真正不可重建的部分）是立即写盘的。
   */
  scheduleSave(delay = 30000): void {
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
    const byMonth = new Map<string, { entries: LedgerEntry[]; lines: string[] }>();
    for (const e of entries) {
      if (isZeroVec(vec(e.add[0], e.add[1])) && isZeroVec(vec(e.del[0], e.del[1]))) continue;
      const ym = monthKey(e.t);
      const line = JSON.stringify(e);
      const group = byMonth.get(ym);
      if (group) {
        group.entries.push(e);
        group.lines.push(line);
      } else {
        byMonth.set(ym, { entries: [e], lines: [line] });
      }
    }
    if (byMonth.size === 0) return;
    await this.ensureDir("stats");
    await this.ensureDir(LEDGER_REL);

    const written: LedgerEntry[] = [];
    try {
      for (const [ym, group] of byMonth) {
        const full = this.path(this.ledgerPath(ym));
        const payload = group.lines.join("\n") + "\n";

        if (await this.tryFastAppend(full, payload)) {
          written.push(...group.entries);
          continue;
        }

        // 安全路径：读全文、修尾、整写
        let prev = "";
        try {
          prev = await this.adapter.read(full);
        } catch {
          prev = "";
        }
        const { text, dropped } = repairTail(prev);
        if (dropped > 0) this.repairs.push({ ym, dropped });
        await this.adapter.write(full, text + payload);
        written.push(...group.entries);
        await this.rememberSize(full);
      }
    } finally {
      if (written.length > 0) this.notifyAppend(written);
    }
  }

  /**
   * 快路径：文件大小与上次写完后一致，说明没被外部改动过，
   * 直接追加。这样每次编辑写的是几十字节，而不是整个月账本。
   * 大小对不上（同步、手改、截断）就退回安全路径。
   */
  private async tryFastAppend(full: string, payload: string): Promise<boolean> {
    if (!this.adapter.append || !this.adapter.stat) return false;
    const expected = this.lastSize.get(full);
    if (expected === undefined) return false;
    const st = await this.adapter.stat(full);
    if (!st || st.size !== expected) return false;
    await this.adapter.append(full, payload);
    await this.rememberSize(full);
    return true;
  }

  private async rememberSize(full: string): Promise<void> {
    if (!this.adapter.stat) return;
    try {
      const st = await this.adapter.stat(full);
      if (st) this.lastSize.set(full, st.size);
    } catch {
      // stat 只是快路径的提示；失败就退回安全路径
    }
  }

  /** 读某个月的全部事件：可能有多台设备写的多个文件 */
  async readMonth(ym: string): Promise<LedgerEntry[]> {
    const files = await this.listMonthFiles(ym);
    if (files.length === 0) return [];
    const out: LedgerEntry[] = [];
    for (const name of files) {
      try {
        out.push(...parseLedger(await this.adapter.read(this.path(`${LEDGER_REL}/${name}`))));
      } catch {
        // 单个文件读不了就跳过，别的设备那份还在
      }
    }
    return dedupeEntries(out);
  }

  async readMonths(yms: string[]): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = [];
    for (const ym of yms) out.push(...(await this.readMonth(ym)));
    return out;
  }

  /**
   * 把外部备份合并进账本。
   *
   * 写独立的 imported 文件，而不是拼回原生 <ym>.<device>.jsonl：
   * 原生文件是追加式事实源，导入是低频操作，没有理由让两条路径互相影响。
   * 同一设备重复导入同一份备份会整写同一个文件，天然幂等。
   */
  async importEntries(
    entries: LedgerEntry[]
  ): Promise<{ added: number; months: string[]; badLines: number }> {
    if (entries.length === 0) return { added: 0, months: [], badLines: 0 };

    const byMonth = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      const ym = monthKey(e.t);
      const arr = byMonth.get(ym);
      if (arr) arr.push(e);
      else byMonth.set(ym, [e]);
    }

    await this.ensureDir("stats");
    await this.ensureDir(LEDGER_REL);

    let added = 0;
    let badLines = 0;
    const months: string[] = [];

    for (const [ym, incoming] of byMonth) {
      const full = this.path(`${LEDGER_REL}/${ym}.imported.${this.deviceId}.jsonl`);
      let prev: LedgerEntry[] = [];
      try {
        const parsed = parseLedgerReport(await this.adapter.read(full));
        prev = parsed.entries;
        badLines += parsed.bad;
      } catch {
        prev = [];
      }

      const existing = dedupeEntries(prev);
      const merged = dedupeEntries([...existing, ...incoming]);
      const fresh = merged.length - existing.length;
      if (fresh <= 0) continue;

      merged.sort((a, b) => a.t - b.t);
      await this.adapter.write(full, merged.map((e) => JSON.stringify(e)).join("\n") + "\n");
      added += fresh;
      months.push(ym);
    }

    return { added, months, badLines };
  }

  /** 某个月的所有账本文件名（含老版本没有设备后缀的） */
  private async listMonthFiles(ym: string): Promise<string[]> {
    const re = new RegExp(`^${ym}(\\..+)?\\.jsonl$`);
    return (await this.listLedgerFiles()).filter((f) => re.test(f));
  }

  private async listLedgerFiles(): Promise<string[]> {
    try {
      const res = await this.adapter.list(this.path(LEDGER_REL));
      return res.files
        .map((f) => f.split("/").pop() ?? "")
        .filter((f) => /^\d{4}-\d{2}(\..+)?\.jsonl$/.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  /** 账本里已有的月份，升序 */
  async listLedgerMonths(): Promise<string[]> {
    const set = new Set<string>();
    for (const f of await this.listLedgerFiles()) set.add(f.slice(0, 7));
    return [...set].sort();
  }

  /* ------------------------------ 工具 ------------------------------ */

  /** 本次运行里修掉过的截断尾巴，供上层提示 */
  readonly repairs: { ym: string; dropped: number }[] = [];

  /**
   * 体检：坏行、截断、重复、未来时间戳。
   * 只读，不改文件——发现问题由人决定怎么处理。
   */
  async audit(months?: string[]): Promise<LedgerAudit> {
    const list = months ?? (await this.listLedgerMonths());
    const now = Date.now();
    const seen = new Set<string>();
    const result: LedgerAudit = {
      months: list,
      totalEntries: 0,
      badLines: 0,
      truncated: [],
      duplicates: 0,
      future: 0,
      first: null,
      last: null,
      problems: [],
    };

    for (const ym of list) {
      for (const name of await this.listMonthFiles(ym)) {
        let raw = "";
        try {
          raw = await this.adapter.read(this.path(`${LEDGER_REL}/${name}`));
        } catch {
          continue;
        }
        if (raw.length > 0 && !raw.endsWith("\n")) result.truncated.push(name);
        const parsed = parseLedgerReport(raw);
        result.badLines += parsed.bad;
        result.totalEntries += parsed.entries.length;
        for (const e of parsed.entries) {
          const key = entryKey(e);
          if (seen.has(key)) result.duplicates++;
          else seen.add(key);
          if (e.t > now + 3_600_000) result.future++;
          if (result.first === null || e.t < result.first) result.first = e.t;
          if (result.last === null || e.t > result.last) result.last = e.t;
        }
      }
    }

    if (result.badLines > 0) result.problems.push(`${result.badLines} 行无法解析（同步冲突或写入被截断）`);
    if (result.truncated.length > 0) {
      result.problems.push(`末尾缺换行：${result.truncated.join("、")}（疑似被截断，下次追加会自动修复）`);
    }
    if (result.duplicates > 0) result.problems.push(`${result.duplicates} 条重复事件（统计时已按一条计算）`);
    if (result.future > 0) result.problems.push(`${result.future} 条时间戳在未来（时钟或时区不正确）`);
    return result;
  }

  private path(rel: string): string {
    const base = this.baseDir.replace(/\/+$/, "");
    return base ? `${base}/${rel}` : rel;
  }

  private ledgerPath(ym: string): string {
    return `${LEDGER_REL}/${ym}.${this.deviceId}.jsonl`;
  }

  private async ensureDir(rel: string): Promise<void> {
    const p = this.path(rel);
    if (this.ensuredDirs.has(p)) return;
    try {
      if (!(await this.adapter.exists(p))) await this.adapter.mkdir(p);
      this.ensuredDirs.add(p);
    } catch {
      // 已存在或无权限：交给后续 write 报错
    }
  }
}

/**
 * 按月缓存解析后的账本事件。
 *
 * 账本只追加：本机新事件由 StatsStore.onAppend 直接并进缓存，
 * 不必为了看到自己刚写的字把整年账本重读一遍。TTL 只用于兜底
 * 外部同步/手改账本的情况；导入与恢复会显式 clear。
 */
export class MonthEntryCache {
  private months = new Map<string, { at: number; entries: LedgerEntry[] }>();
  private pending = new Map<string, Promise<LedgerEntry[]>>();
  private pendingAdds = new Map<string, LedgerEntry[]>();
  private generation = 0;

  constructor(
    private load: (ym: string) => Promise<LedgerEntry[]>,
    private ttlMs: number,
    private clock: () => number = () => Date.now()
  ) {}

  async get(ym: string): Promise<LedgerEntry[]> {
    const hit = this.months.get(ym);
    if (hit && this.clock() - hit.at < this.ttlMs) return hit.entries;
    const inFlight = this.pending.get(ym);
    if (inFlight) return inFlight;

    const gen = this.generation;
    const extra: LedgerEntry[] = [];
    this.pendingAdds.set(ym, extra);
    const promise = this.load(ym).then(
      (entries) => {
        if (gen === this.generation) {
          const merged = extra.length > 0 ? mergeEntries(entries, extra) : entries;
          this.months.set(ym, { at: this.clock(), entries: merged });
          this.pendingAdds.delete(ym);
          this.pending.delete(ym);
          return merged;
        }
        return entries;
      },
      (err) => {
        if (gen === this.generation) {
          this.pendingAdds.delete(ym);
          this.pending.delete(ym);
        }
        throw err;
      }
    );
    this.pending.set(ym, promise);
    return promise;
  }

  /** 本机新写入的事件并入缓存；正在加载的月份在加载完成后合并，避免被旧读数覆盖 */
  add(entries: LedgerEntry[]): void {
    for (const e of entries) {
      const ym = monthKey(e.t);
      const loading = this.pendingAdds.get(ym);
      if (loading) {
        loading.push(e);
        continue;
      }
      const hit = this.months.get(ym);
      if (hit) hit.entries.push(e);
    }
  }

  clear(): void {
    this.generation++;
    this.months.clear();
    this.pending.clear();
    this.pendingAdds.clear();
  }
}

function mergeEntries(base: LedgerEntry[], extra: LedgerEntry[]): LedgerEntry[] {
  const seen = new Set(base.map(entryKey));
  const out = base.slice();
  for (const e of extra) {
    const key = entryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export interface LedgerAudit {
  months: string[];
  totalEntries: number;
  badLines: number;
  /** 末尾缺换行的月份文件 */
  truncated: string[];
  duplicates: number;
  future: number;
  first: number | null;
  last: number | null;
  problems: string[];
}

export function parseLedgerReport(raw: string): { entries: LedgerEntry[]; bad: number } {
  const entries: LedgerEntry[] = [];
  let bad = 0;
  if (!raw) return { entries, bad };
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const e = JSON.parse(s) as LedgerEntry;
      if (typeof e.t === "number" && typeof e.p === "string" && Array.isArray(e.add) && Array.isArray(e.del)) {
        entries.push(e);
      } else {
        bad++;
      }
    } catch {
      // 半行 / 同步冲突写坏的那一行
      bad++;
    }
  }
  return { entries, bad };
}

export function parseLedger(raw: string): LedgerEntry[] {
  return parseLedgerReport(raw).entries;
}

/**
 * 读账本时按 entryKey 去重。
 *
 * 追加式账本本身不会产生重复；重复来自同步冲突、重复导入、或两台设备
 * 各写了一份同一备份。统计按一条算，体检仍会报告原始重复，便于排查。
 */
export function dedupeEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const seen = new Set<string>();
  const out: LedgerEntry[] = [];
  for (const e of entries) {
    const key = entryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * 追加前的保险：如果文件末尾是半行（同步冲突、断电），
 * 直接往后拼会把新行粘在坏行上，坏行就永久留在账本里。
 * 这里先把它截掉，只损失那一行。
 */
export function repairTail(prev: string): { text: string; dropped: number } {
  if (!prev || prev.endsWith("\n")) return { text: prev, dropped: 0 };
  const idx = prev.lastIndexOf("\n");
  const tail = prev.slice(idx + 1);
  try {
    JSON.parse(tail);
    return { text: prev + "\n", dropped: 0 }; // 完整的一行，只是缺换行
  } catch {
    return { text: idx >= 0 ? prev.slice(0, idx + 1) : "", dropped: tail.length };
  }
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
