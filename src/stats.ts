import type { LedgerEntry, StatsSettings, Vec } from "./types";
import { addVec, isZeroVec, vec, ZERO } from "./types";
import { dayKey, monthKey } from "./store";

/** 只把这些来源算作“写” */
const WRITE_SRC = new Set(["edit", "scan"]);

export interface Sum {
  add: Vec;
  del: Vec;
  /** 参与了统计的事件条数 */
  n: number;
}

export function emptySum(): Sum {
  return { add: vec(0, 0), del: vec(0, 0), n: 0 };
}

export function addToSum(sum: Sum, e: LedgerEntry): Sum {
  return {
    add: addVec(sum.add, vec(e.add[0], e.add[1])),
    del: addVec(sum.del, vec(e.del[0], e.del[1])),
    n: sum.n + 1,
  };
}

/** 汇总 [from, to) 区间内、且来源属于“写作”的事件 */
export function sumWriting(entries: LedgerEntry[], from: number, to: number): Sum {
  let s = emptySum();
  for (const e of entries) {
    if (e.t < from || e.t >= to) continue;
    if (!WRITE_SRC.has(e.src)) continue;
    s = addToSum(s, e);
  }
  return s;
}

export function sumDeletions(entries: LedgerEntry[], from: number, to: number): Sum {
  let s = emptySum();
  for (const e of entries) {
    if (e.t < from || e.t >= to) continue;
    if (e.src !== "delete") continue;
    s = addToSum(s, e);
  }
  return s;
}

/** 某年 12 个自然月的写作量，未来月份为 0；用于“全年”柱状图 */
export function sumByMonth(entries: LedgerEntry[], year: number, now = Date.now()): Vec[] {
  const out: Vec[] = Array.from({ length: 12 }, () => vec(0, 0));
  const limit = now + 1;
  for (const e of entries) {
    if (e.t >= limit) continue;
    if (!WRITE_SRC.has(e.src)) continue;
    const d = new Date(e.t);
    if (d.getFullYear() !== year) continue;
    out[d.getMonth()] = addVec(out[d.getMonth()], vec(e.add[0], e.add[1]));
  }
  return out;
}

export interface CumulativeMonth {
  /** YYYY-MM */
  month: string;
  /** 当月新增 */
  add: Vec;
  /** 截至当月的账本累计新增 */
  total: Vec;
}

/**
 * 自账本第一条写作事件所在月起，逐月累计“新增”。
 *
 * 没有事件的月份也保留，累计值延续；未来时间戳（时钟不准）不计入。
 * 这是“自启用账本起写的新增”，不是全库存量——启用插件前的笔记不在账本里。
 */
export function cumulativeByMonth(entries: LedgerEntry[], now = Date.now()): CumulativeMonth[] {
  const byMonth = new Map<string, Vec>();
  let first = Infinity;

  for (const e of entries) {
    if (e.t > now) continue;
    if (!WRITE_SRC.has(e.src)) continue;
    const key = monthKey(e.t);
    byMonth.set(key, addVec(byMonth.get(key) ?? ZERO, vec(e.add[0], e.add[1])));
    if (e.t < first) first = e.t;
  }
  if (!Number.isFinite(first)) return [];

  const start = new Date(first);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(1);
  end.setHours(0, 0, 0, 0);

  const out: CumulativeMonth[] = [];
  let total = vec(0, 0);
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const key = monthKey(cursor.getTime());
    const add = byMonth.get(key) ?? ZERO;
    total = addVec(total, add);
    out.push({ month: key, add, total });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/** 按天汇总写作量，用于柱状图 */
export function byDay(entries: LedgerEntry[]): Map<string, Vec> {
  const out = new Map<string, Vec>();
  for (const e of entries) {
    if (!WRITE_SRC.has(e.src)) continue;
    const k = dayKey(e.t);
    const cur = out.get(k) ?? vec(0, 0);
    out.set(k, addVec(cur, vec(e.add[0], e.add[1])));
  }
  return out;
}

/** 某个月里“有写字”的日期集合 */
export function daysWithWriting(entries: LedgerEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (!WRITE_SRC.has(e.src)) continue;
    if (isZeroVec(vec(e.add[0], e.add[1]))) continue;
    out.add(dayKey(e.t));
  }
  return out;
}

/*
 * 全年热力图。
 *
 * 时间窗口是日历年（1 月 1 日到 12 月 31 日），格子按周优先排列：
 * week 0 的周一到周日，然后 week 1……前面的空白属于上一年，后面的属于下一年。
 * 配色档位与年度报告共用，避免面板和报告对同一天给出不同深浅。
 */

const HEAT_THRESHOLDS = [200, 500, 1000];

/** 0 = 没写；1 = 1-199；2 = 200-499；3 = 500-999；4 = 1000+（汉字+英文词） */
export function heatLevel(v: Vec): number {
  const total = v.cjk + v.lat;
  if (total <= 0) return 0;
  let lv = 1;
  for (let i = 0; i < HEAT_THRESHOLDS.length; i++) {
    if (total >= HEAT_THRESHOLDS[i]) lv = i + 2;
  }
  return lv;
}

export interface HeatDay {
  day: string;
  vec: Vec;
  /** 前后补齐的格子不属于本年 */
  inYear: boolean;
  /** 今天之后的格子 */
  future: boolean;
  isToday: boolean;
}

export interface HeatMonth {
  /** 第几列，0 起 */
  week: number;
  /** 1-12 */
  month: number;
}

export interface YearHeatmap {
  year: number;
  weeks: number;
  /** 按周优先排列，长度 = weeks × 7 */
  days: HeatDay[];
  months: HeatMonth[];
}

export function buildYearHeatmap(
  year: number,
  daily: Map<string, Vec>,
  now = Date.now()
): YearHeatmap {
  const yearStart = new Date(year, 0, 1).getTime();
  const shift = (new Date(yearStart).getDay() + 6) % 7; // 周一为一周起点
  const gridStart = addDays(yearStart, -shift);
  const lastDay = new Date(year, 11, 31).getTime();
  const spanDays = Math.round((lastDay - gridStart) / 86_400_000) + 1;
  const weeks = Math.ceil(spanDays / 7);
  const todayKey = dayKey(now);
  const days: HeatDay[] = [];
  const months: HeatMonth[] = [];

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const ts = addDays(gridStart, w * 7 + d);
      const dt = new Date(ts);
      const inYear = dt.getFullYear() === year;
      const future = ts > now;
      const key = dayKey(ts);
      days.push({
        day: key,
        vec: inYear && !future ? daily.get(key) ?? ZERO : ZERO,
        inYear,
        future,
        isToday: key === todayKey,
      });
      if (inYear && dt.getDate() === 1) {
        months.push({ week: w, month: dt.getMonth() + 1 });
      }
    }
  }

  return { year, weeks, days, months };
}

/**
 * 连续写作天数。今天还没写不算断（从昨天往回数），
 * 断一天就停——这是“连续”的唯一诚实定义。
 */
export function streakFrom(days: Set<string>, today = Date.now()): number {
  let n = 0;
  const base = startOfDay(today);
  for (let i = 0; i < 3650; i++) {
    const key = dayKey(addDays(base, -i));
    if (days.has(key)) {
      n++;
    } else if (i === 0) {
      continue; // 今天还没写，不断
    } else {
      break;
    }
  }
  return n;
}

/*
 * 项目分组。
 *
 * 默认按路径前两段分（创作/小说、归档/日记……），
 * 需要更细的粒度时用规则覆盖，例如：
 *   小说1 = 创作/小说/1
 * 规则按前缀最长匹配优先。
 */

export interface ProjectRule {
  name: string;
  prefix: string;
}

export function parseProjectRules(lines: string[]): ProjectRule[] {
  const out: ProjectRule[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) {
      const prefix = normalizePrefix(line);
      if (!prefix) continue;
      out.push({ name: prefix.split("/").pop() ?? prefix, prefix });
    } else {
      const name = line.slice(0, eq).trim();
      const prefix = normalizePrefix(line.slice(eq + 1));
      if (!name || !prefix) continue;
      out.push({ name, prefix });
    }
  }
  return out.sort((a, b) => b.prefix.length - a.prefix.length);
}

function normalizePrefix(s: string): string {
  return s
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\\/g, "/");
}

/** 文件属于哪个项目 */
export function projectOf(path: string, rules: ProjectRule[], depth = 2): string {
  for (const r of rules) {
    if (path === r.prefix || path.startsWith(r.prefix + "/")) return r.name;
  }
  const parts = path.split("/");
  if (parts.length <= 1) return "（根目录）";
  return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

/**
 * 一条路径是否不参与统计。
 * 除了用户配置的排除目录，报告目录也必须排除——
 * 否则生成的周报会在下一次统计里被当成“今天写的字”，形成自反馈。
 */
export function isExcludedPath(path: string, settings: StatsSettings): boolean {
  const prefixes = [...(settings.excludeFolders ?? [])];
  if (settings.reportFolder) prefixes.push(settings.reportFolder);
  for (const raw of prefixes) {
    const f = normalizePrefix(raw);
    if (!f) continue;
    if (path === f || path.startsWith(f + "/")) return true;
  }
  return false;
}

export function startOfDay(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfWeek(ts = Date.now()): number {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7; // 周一为一周开始
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

export function startOfMonth(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** 覆盖 [from, to) 的月份列表，用于决定读哪几个账本文件 */
export function monthsBetween(from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() < to) {
    out.push(monthKey(d.getTime()));
    d.setMonth(d.getMonth() + 1);
  }
  if (out.length === 0) out.push(monthKey(to));
  return out;
}

export function isWritingEntry(e: LedgerEntry): boolean {
  return WRITE_SRC.has(e.src) && !isZeroVec(vec(e.add[0], e.add[1]));
}

/** ISO 周号：2026-W46 */
export function isoWeek(ts = Date.now()): string {
  const d = new Date(ts);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${target.getUTCFullYear()}-W${`${week}`.padStart(2, "0")}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${`${d.getDate()}`.padStart(2, "0")}`;
}

export function weekdayCN(ts: number): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(ts).getDay()];
}
