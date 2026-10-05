import type { LedgerEntry, LedgerSrc } from "./types";
import { entryKey } from "./types";

/**
 * 备份的读取侧。
 *
 * 账本本身是追加式、不可重建的；备份格式因此要能长期向后兼容：
 * - 旧备份没有 format/version/exportedBy/vault，也接受
 * - 有 format 但不是本插件的，直接拒绝
 * - 坏条目只计数，不中断整个导入
 */

export const BACKUP_FORMAT = "abacus-ledger-backup";
export const BACKUP_VERSION = 1;

const SRCS = new Set<LedgerSrc>(["baseline", "edit", "scan", "delete"]);
const BACKUP_NAME = /^账本备份 (\d{4}-\d{2}-\d{2})(?:\.([A-Za-z0-9_-]+))?\.json$/;

export interface BackupCandidate {
  name: string;
  path: string;
  date?: string;
  device?: string;
}

export interface ParsedBackup {
  entries: LedgerEntry[];
  bad: number;
  exportedAt?: string;
  exportedBy?: string;
  vault?: string;
  /** 备份版本比当前插件新时，保留已知字段并提示 */
  newerVersion?: number;
}

export interface FreshEntries {
  fresh: LedgerEntry[];
  duplicates: number;
}

export function parseBackup(raw: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("不是合法的 JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("备份不是一个 JSON 对象");
  }

  const obj = data as Record<string, unknown>;
  if (obj.format !== undefined && obj.format !== BACKUP_FORMAT) {
    throw new Error("不是 Abacus 的账本备份");
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error("备份里没有 entries 数组");
  }

  const entries: LedgerEntry[] = [];
  let bad = 0;
  for (const item of obj.entries) {
    const e = normalizeEntry(item);
    if (e) entries.push(e);
    else bad++;
  }

  const version = typeof obj.version === "number" ? obj.version : undefined;
  return {
    entries,
    bad,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
    exportedBy: typeof obj.exportedBy === "string" ? obj.exportedBy : undefined,
    vault: typeof obj.vault === "string" ? obj.vault : undefined,
    newerVersion: version !== undefined && version > BACKUP_VERSION ? version : undefined,
  };
}

/**
 * 只保留真正新增的事件：与现有账本、以及 incoming 内部重复的都跳过。
 * 重复的定义与体检一致，都是 entryKey。
 */
export function filterNewEntries(
  incoming: LedgerEntry[],
  existing: Iterable<LedgerEntry>
): FreshEntries {
  const seen = new Set<string>();
  for (const e of existing) seen.add(entryKey(e));

  const fresh: LedgerEntry[] = [];
  let duplicates = 0;
  for (const e of incoming) {
    const key = entryKey(e);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    fresh.push(e);
  }
  return { fresh, duplicates };
}

export function backupNameMeta(name: string): { date: string; device?: string } | null {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  return { date: m[1], device: m[2] };
}

/**
 * 是否该自动备份。
 *
 * 只把「本机备份」和无设备后缀的旧备份算进间隔：另一台设备今天备份过，
 * 不代表本机最近的账本也被备走了。文件名匹配不上（比如手动改过名）就忽略。
 */
export function shouldAutoBackup(
  names: string[],
  intervalDays: number,
  currentDevice: string,
  today = Date.now()
): boolean {
  if (intervalDays <= 0) return false;

  let latest = -Infinity;
  for (const name of names) {
    const meta = backupNameMeta(name);
    if (!meta) continue;
    if (meta.device !== undefined && meta.device !== currentDevice) continue;
    const day = utcDay(meta.date);
    if (day !== null && day > latest) latest = day;
  }

  if (latest === -Infinity) return true;

  const d = new Date(today);
  const todayDay = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((todayDay - latest) / 86_400_000) >= intervalDays;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function tuple(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  return isCount(a) && isCount(b) ? [a, b] : null;
}

function normalizeEntry(item: unknown): LedgerEntry | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  if (typeof o.t !== "number" || !Number.isSafeInteger(o.t) || o.t < 0) return null;
  if (typeof o.p !== "string" || o.p.length === 0 || o.p.length > 4096) return null;
  const add = tuple(o.add);
  const del = tuple(o.del);
  if (!add || !del) return null;
  if (typeof o.src !== "string" || !SRCS.has(o.src as LedgerSrc)) return null;
  return { t: o.t, p: o.p, add, del, src: o.src as LedgerSrc };
}

/** 本地日期键 → UTC 日序号；用 UTC 是为了避开 DST 的 23/25 小时天 */
function utcDay(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo - 1, d);
  const check = new Date(ts);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return ts;
}
