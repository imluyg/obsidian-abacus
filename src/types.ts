/**
 * 核心思想：只存分量，不存合成值。
 *
 * 一个汉字和一个英文词并不等价，把它们加成 "72.7 万字" 是没有语义的。
 * 所以底层一律用 Vec（向量）表示，合成只发生在展示层。
 * 将来想加“数字 / 标点 / 段落”只需扩展 Vec，历史数据不用迁移。
 */

export interface Vec {
  /** 汉字字数（CJK Unified Ideographs） */
  cjk: number;
  /** 英文与数字词（按连续字母数字切分） */
  lat: number;
}

export const ZERO: Vec = Object.freeze({ cjk: 0, lat: 0 });

export function vec(cjk = 0, lat = 0): Vec {
  return { cjk, lat };
}

export function addVec(a: Vec, b: Vec): Vec {
  return { cjk: a.cjk + b.cjk, lat: a.lat + b.lat };
}

export function subVec(a: Vec, b: Vec): Vec {
  return { cjk: a.cjk - b.cjk, lat: a.lat - b.lat };
}

/** 逐分量取 max(0, x)，用于把“净变化”压成非负 */
export function clampVec(a: Vec): Vec {
  return { cjk: Math.max(0, a.cjk), lat: Math.max(0, a.lat) };
}

export function isZeroVec(a: Vec): boolean {
  return a.cjk === 0 && a.lat === 0;
}

/** 主指标：汉字优先；可选把英文词折算进来 */
export function primaryOf(a: Vec, includeLatin: boolean): number {
  return includeLatin ? a.cjk + a.lat : a.cjk;
}

export interface CounterSettings {
  /** 是否把 YAML frontmatter 计入 */
  countFrontmatter: boolean;
  /** 是否把代码块 / 行内代码计入 */
  countCodeBlocks: boolean;
}

export interface StatsSettings extends CounterSettings {
  /** 不参与统计的目录前缀（vault 相对路径） */
  excludeFolders: string[];
  /** 状态栏与排序使用的主指标是否包含英文词 */
  includeLatinInPrimary: boolean;
  /** 面板柱状图天数：7 或 30 */
  panelRange: number;
  /** 旧字段：柱状图天数，保留以兼容已保存的设置 */
  chartDays: number;
  /** 编辑去抖（毫秒） */
  debounceMs: number;
  /** 项目分组规则，每行 "名称 = 路径前缀" 或 "路径前缀" */
  projectRules: string[];
  /** 周报写入的目录 */
  reportFolder: string;
}

export const DEFAULT_SETTINGS: StatsSettings = {
  countFrontmatter: false,
  countCodeBlocks: false,
  excludeFolders: [".trash"],
  includeLatinInPrimary: false,
  panelRange: 7,
  chartDays: 14,
  debounceMs: 2500,
  projectRules: [],
  reportFolder: "归档/统计归档",
};

/* ------------------------------------------------------------------ */
/* 持久化结构                                                          */
/* ------------------------------------------------------------------ */

/** 快照：回答“每个文件现在多少字” */
export interface FileRecord {
  /** 字节大小，用于判断是否变化 */
  s: number;
  /** 修改时间，用于判断是否变化 */
  m: number;
  /** [汉字, 英文词] */
  c: [number, number];
}

export interface Snapshot {
  version: number;
  /** 快照生成时间 */
  updatedAt: number;
  files: Record<string, FileRecord>;
}

/**
 * 账本来源。它决定了某个数字算不算“我写的”：
 * - baseline：首次建库，不能算写作（否则 63 万字全砸在今天）
 * - edit：本机正常编辑，算
 * - scan：启动时发现的差异（离线期间 / 其它设备同步过来），算
 * - delete：文件删除，只记删减，不算写作
 */
export type LedgerSrc = "baseline" | "edit" | "scan" | "delete";

/**
 * 账本条目，追加写入，永不修改。
 * 一行一事件，JSONL 因此天然可合并、可重建。
 */
export interface LedgerEntry {
  /** epoch ms */
  t: number;
  /** vault 相对路径 */
  p: string;
  /** [汉字, 英文词] */
  add: [number, number];
  /** [汉字, 英文词] */
  del: [number, number];
  src: LedgerSrc;
}

export function entryAddVec(e: LedgerEntry): Vec {
  return vec(e.add[0], e.add[1]);
}

export function entryDelVec(e: LedgerEntry): Vec {
  return vec(e.del[0], e.del[1]);
}

export interface FileStatInfo {
  path: string;
  size: number;
  mtime: number;
}

/** 插件拿到的 vault 只读视图，抽成接口是为了能在 Node 里跑测试 */
export interface VaultIO {
  listFiles(): FileStatInfo[];
  readFile(path: string): Promise<string>;
  /** 存放统计数据的适配器（.obsidian/plugins/sixcolor-stats 下） */
  adapter: StatsAdapter;
}

export interface StatsAdapter {
  read(p: string): Promise<string>;
  write(p: string, d: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  mkdir(p: string): Promise<void>;
  list(p: string): Promise<{ files: string[]; folders: string[] }>;
}
