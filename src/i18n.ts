/**
 * 极简 i18n。
 *
 * 不引第三方库，也不做键值查找表 —— 直接给两种语言各写一个对象，
 * 类型由中文那份推导出来，英文那份少一个键就编译不过。
 *
 * 注意：生成的报告（周报 / 年度报告 / CSV 表头）目前只有中文，
 * 它们写进你的库当文档，不随界面语言变。
 */

export type Lang = "zh" | "en";

const zh = {
  // 面板
  viewName: "字数统计",
  today: "今日",
  rescan: "重新扫描",
  reading: "正在读取…",
  scanning: (done: number, total: number) => `扫描中 ${done} / ${total}`,
  cjk: "汉字",
  latinWords: (n: string) => `英文词 ${n}`,
  deleted: (c: string, l: string) => `　删改 −${c} / −${l}`,
  streak: (n: number) => `　连续 ${n} 天`,
  goalText: (done: string, goal: string, pct: number) => `${done} / ${goal} 字 · ${pct}%`,
  week: "本周",
  month: "本月",
  all: "全库",
  weekGoalText: (done: string, goal: string, pct: number) => `本周 ${done} / ${goal} 字 · ${pct}%`,
  weekGoalTitle: (goal: string) => `本周目标 ${goal} 汉字`,
  projects: "项目",
  runningTotal: "累计",
  projectTip: (name: string, m: string, ml: string, t: string, tl: string) =>
    `${name}\n本月 汉字 ${m} / 词 ${ml}\n累计 汉字 ${t} / 词 ${tl}\n点击查看该项目下的文件`,
  noChangesThisMonth: "本月没有改动",
  fileTip: (path: string, m: string, ml: string, t: string, tl: string) =>
    `${path}\n本月新增 汉字 ${m} / 词 ${ml}\n全文 汉字 ${t} / 词 ${tl}`,
  currentFile: "当前文件",
  currentNum: (c: string, l: string) => `汉字 ${c}　英文词 ${l}`,
  chartTip: (day: string, c: string, l: string) => `${day}　汉字 ${c}　英文词 ${l}`,
  healthChecking: "账本检查中…",
  healthOk: (months: number, entries: string) => `账本正常 · ${months} 个月 · ${entries} 条`,
  healthBad: (n: number) => `⚠ 账本异常 ${n} 项 · 点击排查`,
  foot: (files: string, time: string) => `${files} 个文件　更新于 ${time}`,
  wordsShort: (n: string) => `词 ${n}`,
  rangeDays: (n: number) => `${n}天`,
  rangeYear: "全年",
  rangeCumulative: "累计",
  cumulativeTip: (month: string, totalC: string, totalL: string, addC: string, addL: string) =>
    `${month}　累计 汉字 ${totalC} / 英文词 ${totalL}（本月 +${addC} / +${addL}）`,
  cumulativeNote: "自账本启用起累计新增，不含启用前的存量。",
  heatTitle: (year: number) => `全年热力图 ${year}`,
  heatWeekdays: ["一", "三", "五"],
  monthShort: (m: number) => `${m}月`,
  heatLess: "少",
  heatMore: "多",

  // 命令
  cmdOpen: "打开统计面板",
  cmdRebuild: "重建全库快照",
  cmdWeekly: "生成本周周报",
  cmdWeeklyLast: "补生成上周周报",
  cmdYear: "生成年度报告",
  cmdCsv: "导出账本 CSV",
  cmdBackup: "导出账本备份",
  cmdRestore: "从备份恢复账本",
  cmdSyncFm: "把字数写入当前笔记属性",
  cmdAudit: "检查账本完整性",

  // 通知
  noticeBaseline: (n: number) => `已建立快照：${n} 个文件。从今天起开始记账。`,
  noticeRebuilding: "正在重建快照…",
  noticeRebuilt: (n: number) => `快照已重建：${n} 个文件。账本未改动。`,
  noticeWeekly: (p: string) => `周报已写入 ${p}`,
  noticeWeeklyFail: (e: string) => `写周报失败：${e}`,
  noticeYear: (p: string) => `年度报告已写入 ${p}`,
  noticeYearFail: (e: string) => `写年度报告失败：${e}`,
  noticeCsv: (days: number, p: string) => `已导出 ${days} 天到 ${p}`,
  noticeCsvFail: (e: string) => `导出 CSV 失败：${e}`,
  noticeBackup: (p: string, n: number) => `账本已导出：${p}（${n} 条）`,
  noticeBackupFail: (e: string) => `导出失败：${e}`,
  noticeRestoreEmpty: "备份目录里没有可导入的 JSON 文件。",
  noticeRestoreInvalid: (e: string) => `备份无法读取：${e}`,
  noticeRestoreNoEntries: "备份里没有有效条目。",
  noticeRestoreNothing: (total: number, dup: number, bad: number) =>
    `备份共 ${total} 条，全部重复，没有需要导入的内容（重复 ${dup}，坏行 ${bad}）。`,
  noticeRestoreDone: (added: number, dup: number, bad: number, safety: string | null) =>
    `已导入 ${added} 条（跳过重复 ${dup}，坏行 ${bad}）。` +
    (safety ? `安全备份：${safety}` : ""),
  noticeRestoreFail: (e: string) => `导入失败：${e}`,
  noticeRestoreCancelled: "导入前的安全备份失败，已取消导入。",
  noticeAutoBackup: (p: string) => `已自动备份账本到 ${p}`,
  noticeLedgerEmpty: "账本还是空的，没有可导出的内容。",
  noticeFmWritten: (k: string, n: number) => `已写入 ${k}: ${n}`,
  noticeFmLatest: (k: string, n: number) => `${k} 已经是最新（${n}）`,
  noticeFmFail: (e: string) => `写入属性失败：${e}`,
  noticeNoFile: "没有打开的笔记。",
  noticeNotCounted: "这篇还没统计到，先保存一次。",
  noticeAuditOk: (months: number, entries: number) => `账本正常：${months} 个月 · ${entries} 条事件`,
  noticeAuditBad: (n: number, p: string) => `账本体检发现 ${n} 项问题，已写入 ${p}`,
  noticeRepair: (n: number) => `账本末尾发现截断，已丢弃 ${n} 个字符的残行后继续记录。`,

  // 状态栏
  statusToday: (c: string, l: string) => `今日 +${c}字 +${l}词`,
  statusTodayCombined: (n: string) => `今日 +${n}`,
  statusTodayZero: "今日 +0",
  statusTitleWeek: (c: string, l: string) => `本周 汉字 ${c} / 词 ${l}`,
  statusTitleStreak: (n: number) => `连续 ${n} 天`,
  statusTitleTotal: (c: string, l: string) => `全库 汉字 ${c} / 词 ${l}`,
  statusTitleClick: "点击打开面板",

  // 备份恢复
  restorePickPlaceholder: "搜索备份文件…",
  restoreTitle: "导入账本备份",
  restoreSummary: (total: number, fresh: number, dup: number, bad: number) =>
    `备份共 ${total} 条：可新增 ${fresh}，重复 ${dup}，无法解析 ${bad}。`,
  restoreSource: "备份文件",
  restoreVault: "来源库",
  restoreDevice: "设备",
  restoreOtherDevice:
    "这份备份由另一台设备导出。如果本机也记录过同一段写作，可能出现重复计数；导入后建议跑一次账本体检。",
  restoreOtherVault: "这份备份来自另一个库，路径可能对不上；确认后再导入。",
  restoreNewerVersion: (v: number) =>
    `备份由更新版本的 Abacus 生成（v${v}），已按当前格式导入已知字段。`,
  restoreSafety: "导入前会先把当前账本导出到备份目录（文件名带 -pre-restore 时间后缀）。",
  restoreConfirm: "导入",
  cancel: "取消",

  // 设置：口径
  sCounter: "统计口径",
  sCounterDesc: "改动这里会重建快照（不产生写作记录），已记录的账本不受影响。",
  sFrontmatter: "计入 YAML frontmatter",
  sFrontmatterDesc: "默认不计入：属性区是元数据，不是正文。",
  sCode: "计入代码块与行内代码",
  sCodeDesc: "默认不计入。",
  sExclude: "排除的文件夹",
  sExcludeDesc: "每行一个，相对库根目录；这些目录不扫描、不统计。",
  // 设置：属性
  sProps: "笔记属性",
  sPropsDesc: "把汉字数写进笔记的 frontmatter，供 Bases / Dataview 排序、筛选、做公式。这会修改你的笔记，所以默认关闭。",
  sWriteProp: "保存时把字数写进属性",
  sWritePropDesc: "只在内容真的变化时写；值没变不会动文件，所以不会触发死循环。",
  sPropKey: "属性名",
  sPropKeyDesc: "默认 words。只写汉字数，英文词去账本里看。",
  // 设置：显示
  sDisplay: "显示",
  sLatinPrimary: "主指标包含英文词",
  sLatinPrimaryDesc:
    "开启后状态栏的今日数字把英文词并入汉字，只显示一个合计；关闭时分别显示汉字和英文词。面板始终分开显示两个分量。",
  // 设置：目标
  sGoals: "目标",
  sGoalsDesc: "按汉字计。填 0 或留空表示不设目标；设了目标，面板会出现进度条，周报里会多一行达标天数。",
  sDailyGoal: "每日目标（汉字）",
  sWeeklyGoal: "每周目标（汉字）",
  // 设置：项目
  sProject: "项目分组",
  sProjectDesc:
    "默认按路径前两段分组（创作/小说、归档/日记……）。需要更细的粒度就写规则，每行一条：`名称 = 路径前缀`，或只写路径前缀（名称取末段）。规则按前缀最长优先。",
  sRules: "分组规则",
  // 设置：周报
  sReport: "报告",
  sYearReport: "生成年度报告",
  sYearReportDesc: "含热力图、逐月、项目与文件排行，写入同目录的 `年度报告 YYYY.md`。",
  sCsv: "导出账本 CSV",
  sCsvDesc: "按天汇总成 CSV，方便在 Excel 或脚本里再分析。",
  sWeekly: "生成本周周报",
  sWeeklyDesc: "写入 `周报 YYYY-Www.md`，同名会覆盖。",
  sGenerate: "生成",
  sExport: "导出",
  sAutoWeekly: "自动补生成上周周报",
  sAutoWeeklyDesc: "每次启动检查一次：上周有写作、但还没有周报文件时自动生成。",
  sReportFolder: "周报目录",
  sReportFolderDesc: "生成的周报会写到这里。该目录自动排除在统计之外，否则周报会被算成“今天写的字”。",
  // 设置：数据
  sData: "数据",
  sDataDesc:
    "数据目录：.obsidian/plugins/abacus/stats/。snapshot.json 是存量（可删，会自动重建），ledger/*.jsonl 是按月追加的事件账本——后者删掉就永久丢失。",
  sRebuild: "立即重建快照",
  sRebuildBtn: "重建",
  sBackup: "导出账本备份",
  sBackupDesc: "把账本合并成一个 JSON 写入下面这个目录。账本本体在 .obsidian 里不一定被同步，这份才是异地备份。",
  sBackupFolder: "账本备份目录",
  sRestore: "从备份恢复",
  sRestoreDesc:
    "从备份目录选择一个 JSON，合并回账本；重复事件自动跳过。导入前会先导出当前账本。",
  sRestoreBtn: "选择备份",
  sAutoBackup: "自动备份间隔（天）",
  sAutoBackupDesc:
    "0 表示关闭。启动时如果本机最近一份备份早于这个天数，会自动导出一份完整账本。",
};

export type Dict = typeof zh;

const en: Dict = {
  viewName: "Writing stats",
  today: "Today",
  rescan: "Rescan",
  reading: "Loading…",
  scanning: (done, total) => `Scanning ${done} / ${total}`,
  cjk: "CJK",
  latinWords: (n) => `words ${n}`,
  deleted: (c, l) => `　edited −${c} / −${l}`,
  streak: (n) => `　${n}-day streak`,
  goalText: (done, goal, pct) => `${done} / ${goal} · ${pct}%`,
  week: "Week",
  month: "Month",
  all: "Vault",
  weekGoalText: (done, goal, pct) => `Week ${done} / ${goal} · ${pct}%`,
  weekGoalTitle: (goal) => `Weekly goal ${goal} characters`,
  projects: "Projects",
  runningTotal: "Total",
  projectTip: (name, m, ml, t, tl) =>
    `${name}\nThis month ${m} CJK / ${ml} words\nTotal ${t} CJK / ${tl} words\nClick to list files`,
  noChangesThisMonth: "No changes this month",
  fileTip: (path, m, ml, t, tl) =>
    `${path}\nThis month +${m} CJK / +${ml} words\nTotal ${t} CJK / ${tl} words`,
  currentFile: "Current note",
  currentNum: (c, l) => `${c} CJK　${l} words`,
  chartTip: (day, c, l) => `${day}　${c} CJK　${l} words`,
  healthChecking: "Checking ledger…",
  healthOk: (months, entries) => `Ledger OK · ${months} months · ${entries} entries`,
  healthBad: (n) => `⚠ ${n} ledger issue(s) · click to inspect`,
  foot: (files, time) => `${files} files　updated ${time}`,
  wordsShort: (n) => `words ${n}`,
  rangeDays: (n) => `${n}d`,
  rangeYear: "Year",
  rangeCumulative: "Total",
  cumulativeTip: (month, totalC, totalL, addC, addL) =>
    `${month}　total ${totalC} CJK / ${totalL} words (this month +${addC} / +${addL})`,
  cumulativeNote: "Cumulative additions since the ledger started; excludes pre-existing notes.",
  heatTitle: (year) => `Yearly heatmap ${year}`,
  heatWeekdays: ["Mon", "Wed", "Fri"],
  monthShort: (m) =>
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ??
    `${m}`,
  heatLess: "Less",
  heatMore: "More",

  cmdOpen: "Open stats panel",
  cmdRebuild: "Rebuild vault snapshot",
  cmdWeekly: "Generate this week's report",
  cmdWeeklyLast: "Generate last week's report",
  cmdYear: "Generate yearly report",
  cmdCsv: "Export ledger as CSV",
  cmdBackup: "Export ledger backup",
  cmdRestore: "Restore ledger from backup",
  cmdSyncFm: "Write word count to current note",
  cmdAudit: "Check ledger integrity",

  noticeBaseline: (n) => `Snapshot built: ${n} files. Recording starts today.`,
  noticeRebuilding: "Rebuilding snapshot…",
  noticeRebuilt: (n) => `Snapshot rebuilt: ${n} files. Ledger untouched.`,
  noticeWeekly: (p) => `Weekly report written to ${p}`,
  noticeWeeklyFail: (e) => `Failed to write weekly report: ${e}`,
  noticeYear: (p) => `Yearly report written to ${p}`,
  noticeYearFail: (e) => `Failed to write yearly report: ${e}`,
  noticeCsv: (days, p) => `Exported ${days} days to ${p}`,
  noticeCsvFail: (e) => `Failed to export CSV: ${e}`,
  noticeBackup: (p, n) => `Ledger exported: ${p} (${n} entries)`,
  noticeBackupFail: (e) => `Export failed: ${e}`,
  noticeRestoreEmpty: "No backup JSON found in the backup folder.",
  noticeRestoreInvalid: (e) => `Cannot read backup: ${e}`,
  noticeRestoreNoEntries: "This backup has no valid entries.",
  noticeRestoreNothing: (total, dup, bad) =>
    `All ${total} entries are already present; nothing to import (${dup} duplicates, ${bad} bad lines).`,
  noticeRestoreDone: (added, dup, bad, safety) =>
    `Imported ${added} entries (${dup} duplicates skipped, ${bad} bad lines).` +
    (safety ? ` Safety backup: ${safety}` : ""),
  noticeRestoreFail: (e) => `Import failed: ${e}`,
  noticeRestoreCancelled: "Safety backup failed; the import was cancelled.",
  noticeAutoBackup: (p) => `Ledger auto-backed up to ${p}`,
  noticeLedgerEmpty: "The ledger is still empty.",
  noticeFmWritten: (k, n) => `Wrote ${k}: ${n}`,
  noticeFmLatest: (k, n) => `${k} is already up to date (${n})`,
  noticeFmFail: (e) => `Failed to write property: ${e}`,
  noticeNoFile: "No note is open.",
  noticeNotCounted: "This note hasn't been counted yet — save it once.",
  noticeAuditOk: (months, entries) => `Ledger OK: ${months} months · ${entries} entries`,
  noticeAuditBad: (n, p) => `Ledger check found ${n} issue(s), written to ${p}`,
  noticeRepair: (n) => `Truncated tail found in the ledger; dropped ${n} characters and continued.`,

  statusToday: (c, l) => `Today +${c}c +${l}w`,
  statusTodayCombined: (n) => `Today +${n}`,
  statusTodayZero: "Today +0",
  statusTitleWeek: (c, l) => `Week ${c} CJK / ${l} words`,
  statusTitleStreak: (n) => `${n}-day streak`,
  statusTitleTotal: (c, l) => `Vault ${c} CJK / ${l} words`,
  statusTitleClick: "Click to open the panel",

  restorePickPlaceholder: "Search backup files…",
  restoreTitle: "Import ledger backup",
  restoreSummary: (total, fresh, dup, bad) =>
    `${total} entries in backup: ${fresh} new, ${dup} duplicates, ${bad} unreadable.`,
  restoreSource: "Backup file",
  restoreVault: "Source vault",
  restoreDevice: "Device",
  restoreOtherDevice:
    "This backup was exported by another device. If this vault also recorded the same writing, counts may double; run a ledger check after importing.",
  restoreOtherVault: "This backup comes from another vault; paths may not match. Continue only if you are sure.",
  restoreNewerVersion: (v) => `Created by a newer Abacus (v${v}); known fields will be imported.`,
  restoreSafety:
    "The current ledger will first be exported to the backup folder with a -pre-restore time suffix.",
  restoreConfirm: "Import",
  cancel: "Cancel",

  sCounter: "Counting rules",
  sCounterDesc: "Changing these rebuilds the snapshot (no writing is recorded). The ledger is untouched.",
  sFrontmatter: "Include YAML frontmatter",
  sFrontmatterDesc: "Off by default: properties are metadata, not prose.",
  sCode: "Include code blocks and inline code",
  sCodeDesc: "Off by default.",
  sExclude: "Excluded folders",
  sExcludeDesc: "One per line, relative to the vault root. These folders are neither scanned nor counted.",
  sProps: "Note properties",
  sPropsDesc:
    "Write the CJK count into each note's frontmatter so Bases / Dataview can sort, filter and compute on it. This modifies your notes, so it is off by default.",
  sWriteProp: "Write word count on save",
  sWritePropDesc: "Only writes when the content actually changed, so it can't loop.",
  sPropKey: "Property name",
  sPropKeyDesc: "Defaults to words. Only the CJK count is written; see the ledger for the split.",
  sDisplay: "Display",
  sLatinPrimary: "Include English words in the primary metric",
  sLatinPrimaryDesc:
    "When on, the status bar's today number folds English words into CJK and shows one total; when off, it shows both separately. The panel always shows both components.",
  sGoals: "Goals",
  sGoalsDesc:
    "Counted in CJK characters. 0 or empty means no goal; with a goal the panel shows a progress bar and the weekly report gains a streak-of-goals row.",
  sDailyGoal: "Daily goal (CJK)",
  sWeeklyGoal: "Weekly goal (CJK)",
  sProject: "Project grouping",
  sProjectDesc:
    "By default the first two path segments form a project (创作/小说, 归档/日记…). For finer control, add rules, one per line: `Name = path prefix`, or just a prefix (the name is its last segment). Longest prefix wins.",
  sRules: "Grouping rules",
  sReport: "Reports",
  sYearReport: "Generate yearly report",
  sYearReportDesc: "Heatmap, per-month, projects and top files, written to `年度报告 YYYY.md`.",
  sCsv: "Export ledger as CSV",
  sCsvDesc: "Daily totals as CSV, for analysis in Excel or a script.",
  sWeekly: "Generate this week's report",
  sWeeklyDesc: "Written to `周报 YYYY-Www.md`; an existing file is overwritten.",
  sGenerate: "Generate",
  sExport: "Export",
  sAutoWeekly: "Auto-generate last week's report",
  sAutoWeeklyDesc: "On startup, generate it if last week has writing and no report file yet.",
  sReportFolder: "Report folder",
  sReportFolderDesc:
    "Where reports are written. This folder is excluded from counting, otherwise reports would count as writing.",
  sData: "Data",
  sDataDesc:
    "Data lives in .obsidian/plugins/abacus/stats/. snapshot.json is rebuildable; ledger/*.jsonl is the append-only event log and cannot be reconstructed.",
  sRebuild: "Rebuild snapshot now",
  sRebuildBtn: "Rebuild",
  sBackup: "Export ledger backup",
  sBackupDesc:
    "Merge the ledger into one JSON in the folder below. The ledger itself may not be synced, so this is the off-site copy.",
  sBackupFolder: "Backup folder",
  sRestore: "Restore from backup",
  sRestoreDesc:
    "Choose a JSON from the backup folder and merge it back into the ledger; duplicate events are skipped. The current ledger is exported first.",
  sRestoreBtn: "Choose backup",
  sAutoBackup: "Auto-backup interval (days)",
  sAutoBackupDesc:
    "0 disables it. On startup, if this device's latest backup is older than this many days, a full ledger export is written.",
};

let current: Dict = zh;

export function setLang(lang: Lang): void {
  current = lang === "en" ? en : zh;
}

export function L(): Dict {
  return current;
}

/** Obsidian 把界面语言存在 localStorage；取不到就看浏览器语言 */
export function detectLang(): Lang {
  try {
    const raw = window.localStorage.getItem("language");
    if (raw) return raw.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    // ignore
  }
  try {
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}
