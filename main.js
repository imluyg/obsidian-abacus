/*
 * Abacus — 由 build.mjs 从 src/*.ts 生成，请勿直接编辑。
 */
"use strict";
var __hostRequire = typeof require === "function" ? require : null;
var __modules = Object.create(null);
var __cache = Object.create(null);

function __resolve(from, id) {
  var parts = from ? from.split("/") : [];
  parts.pop();
  var seg = id.split("/");
  for (var i = 0; i < seg.length; i++) {
    if (seg[i] === "." || seg[i] === "") continue;
    if (seg[i] === "..") parts.pop();
    else parts.push(seg[i]);
  }
  var base = parts.join("/");
  var candidates = [base + ".ts", base + "/index.ts", base];
  for (var j = 0; j < candidates.length; j++) {
    if (__modules[candidates[j]]) return candidates[j];
  }
  return null;
}

function __require(id, from) {
  var key = id.charAt(0) === "." ? __resolve(from, id) : id;
  if (key && __modules[key]) {
    if (__cache[key]) return __cache[key].exports;
    var m = { exports: {} };
    __cache[key] = m;
    __modules[key](m, m.exports, function (rid) { return __require(rid, key); });
    return m.exports;
  }
  if (__hostRequire) return __hostRequire(id);
  throw new Error("无法解析模块: " + id);
}
__modules["backup.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACKUP_VERSION = exports.BACKUP_FORMAT = void 0;
exports.parseBackup = parseBackup;
exports.filterNewEntries = filterNewEntries;
exports.backupNameMeta = backupNameMeta;
exports.shouldAutoBackup = shouldAutoBackup;
const types_1 = require("./types");
exports.BACKUP_FORMAT = "abacus-ledger-backup";
exports.BACKUP_VERSION = 1;
const SRCS = new Set(["baseline", "edit", "scan", "delete"]);
const BACKUP_NAME = /^账本备份 (\d{4}-\d{2}-\d{2})(?:\.([A-Za-z0-9_-]+))?\.json$/;
function parseBackup(raw) {
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch (_a) {
        throw new Error("不是合法的 JSON");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("备份不是一个 JSON 对象");
    }
    const obj = data;
    if (obj.format !== undefined && obj.format !== exports.BACKUP_FORMAT) {
        throw new Error("不是 Abacus 的账本备份");
    }
    if (!Array.isArray(obj.entries)) {
        throw new Error("备份里没有 entries 数组");
    }
    const entries = [];
    let bad = 0;
    for (const item of obj.entries) {
        const e = normalizeEntry(item);
        if (e)
            entries.push(e);
        else
            bad++;
    }
    const version = typeof obj.version === "number" ? obj.version : undefined;
    return {
        entries,
        bad,
        exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
        exportedBy: typeof obj.exportedBy === "string" ? obj.exportedBy : undefined,
        vault: typeof obj.vault === "string" ? obj.vault : undefined,
        newerVersion: version !== undefined && version > exports.BACKUP_VERSION ? version : undefined,
    };
}
function filterNewEntries(incoming, existing) {
    const seen = new Set();
    for (const e of existing)
        seen.add((0, types_1.entryKey)(e));
    const fresh = [];
    let duplicates = 0;
    for (const e of incoming) {
        const key = (0, types_1.entryKey)(e);
        if (seen.has(key)) {
            duplicates++;
            continue;
        }
        seen.add(key);
        fresh.push(e);
    }
    return { fresh, duplicates };
}
function backupNameMeta(name) {
    const m = BACKUP_NAME.exec(name);
    if (!m)
        return null;
    return { date: m[1], device: m[2] };
}
function shouldAutoBackup(names, intervalDays, currentDevice, today = Date.now()) {
    if (intervalDays <= 0)
        return false;
    let latest = -Infinity;
    for (const name of names) {
        const meta = backupNameMeta(name);
        if (!meta)
            continue;
        if (meta.device !== undefined && meta.device !== currentDevice)
            continue;
        const day = utcDay(meta.date);
        if (day !== null && day > latest)
            latest = day;
    }
    if (latest === -Infinity)
        return true;
    const d = new Date(today);
    const todayDay = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor((todayDay - latest) / 86400000) >= intervalDays;
}
function isCount(v) {
    return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function tuple(v) {
    if (!Array.isArray(v) || v.length !== 2)
        return null;
    const [a, b] = v;
    return isCount(a) && isCount(b) ? [a, b] : null;
}
function normalizeEntry(item) {
    if (!item || typeof item !== "object" || Array.isArray(item))
        return null;
    const o = item;
    if (typeof o.t !== "number" || !Number.isSafeInteger(o.t) || o.t < 0)
        return null;
    if (typeof o.p !== "string" || o.p.length === 0 || o.p.length > 4096)
        return null;
    const add = tuple(o.add);
    const del = tuple(o.del);
    if (!add || !del)
        return null;
    if (typeof o.src !== "string" || !SRCS.has(o.src))
        return null;
    return { t: o.t, p: o.p, add, del, src: o.src };
}
function utcDay(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m)
        return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const ts = Date.UTC(y, mo - 1, d);
    const check = new Date(ts);
    if (check.getUTCFullYear() !== y ||
        check.getUTCMonth() !== mo - 1 ||
        check.getUTCDate() !== d) {
        return null;
    }
    return ts;
}

};
__modules["backupModal.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RestoreConfirmModal = exports.BackupPickerModal = void 0;
const obsidian_1 = require("obsidian");
const i18n_1 = require("./i18n");
class BackupPickerModal extends obsidian_1.SuggestModal {
    constructor(app, candidates, onChoose) {
        super(app);
        this.candidates = candidates;
        this.onChoose = onChoose;
        this.setPlaceholder((0, i18n_1.L)().restorePickPlaceholder);
    }
    getSuggestions(query) {
        const q = query.trim().toLowerCase();
        if (!q)
            return this.candidates;
        return this.candidates.filter((c) => c.name.toLowerCase().includes(q));
    }
    renderSuggestion(item, el) {
        el.createDiv({ text: item.name });
        const meta = [item.date, item.device ? `${(0, i18n_1.L)().restoreDevice} ${item.device}` : ""]
            .filter(Boolean)
            .join(" · ");
        if (meta)
            el.createDiv({ cls: "setting-item-description", text: meta });
    }
    onChooseSuggestion(item) {
        this.onChoose(item);
    }
}
exports.BackupPickerModal = BackupPickerModal;
class RestoreConfirmModal extends obsidian_1.Modal {
    constructor(app, opts) {
        super(app);
        this.opts = opts;
    }
    onOpen() {
        const { contentEl } = this;
        const { parsed } = this.opts;
        const total = parsed.entries.length + parsed.bad;
        contentEl.createEl("h2", { text: (0, i18n_1.L)().restoreTitle });
        contentEl.createEl("p", {
            text: (0, i18n_1.L)().restoreSummary(total, this.opts.fresh, this.opts.duplicates, parsed.bad),
        });
        contentEl.createEl("p", { text: `${(0, i18n_1.L)().restoreSource}: ${this.opts.fileName}` });
        if (parsed.vault) {
            contentEl.createEl("p", { text: `${(0, i18n_1.L)().restoreVault}: ${parsed.vault}` });
        }
        if (parsed.exportedBy) {
            contentEl.createEl("p", { text: `${(0, i18n_1.L)().restoreDevice}: ${parsed.exportedBy}` });
        }
        if (parsed.exportedBy && parsed.exportedBy !== this.opts.currentDevice) {
            contentEl.createEl("p", { cls: "setting-item-description", text: (0, i18n_1.L)().restoreOtherDevice });
        }
        if (parsed.vault && parsed.vault !== this.opts.currentVault) {
            contentEl.createEl("p", { cls: "setting-item-description", text: (0, i18n_1.L)().restoreOtherVault });
        }
        if (parsed.newerVersion !== undefined) {
            contentEl.createEl("p", {
                cls: "setting-item-description",
                text: (0, i18n_1.L)().restoreNewerVersion(parsed.newerVersion),
            });
        }
        contentEl.createEl("p", { cls: "setting-item-description", text: (0, i18n_1.L)().restoreSafety });
        new obsidian_1.Setting(contentEl)
            .addButton((b) => b.setButtonText((0, i18n_1.L)().cancel).onClick(() => this.close()))
            .addButton((b) => b
            .setButtonText((0, i18n_1.L)().restoreConfirm)
            .setCta()
            .onClick(() => {
            this.close();
            this.opts.onConfirm();
        }));
    }
    onClose() {
        this.contentEl.empty();
    }
}
exports.RestoreConfirmModal = RestoreConfirmModal;

};
__modules["counter.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripMarkdown = stripMarkdown;
exports.countPlain = countPlain;
exports.countMarkdown = countMarkdown;
exports.diffCounts = diffCounts;
const CJK_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_G = /[A-Za-z0-9]+/g;
function stripMarkdown(src, opts) {
    let t = src.replace(/\r\n?/g, "\n");
    if (!opts.countFrontmatter) {
        t = t.replace(/^\uFEFF?---\n[\s\S]*?\n---[ \t]*(\n|$)/, "");
    }
    if (!opts.countCodeBlocks) {
        t = t.replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, " ");
        t = t.replace(/`[^`\n]*`/g, " ");
    }
    t = t.replace(/<!--[\s\S]*?-->/g, " ");
    t = t.replace(/%%[\s\S]*?%%/g, " ");
    t = t.replace(/!\[\[[^\]]*\]\]/g, " ");
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
    t = t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, (_m, _alias, label) => label !== null && label !== void 0 ? label : "");
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/https?:\/\/\S+/g, " ");
    t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
    t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
    t = t.replace(/^[ \t]{0,3}[-*+][ \t]+\[[ xX]\][ \t]+/gm, "");
    t = t.replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, "");
    t = t.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|[ \t:|-]*$/gm, "");
    t = t.replace(/\|/g, " ");
    t = t.replace(/\*\*|__|~~|==|\*/g, "");
    t = t.replace(/^[ \t]*\^[A-Za-z0-9-]+[ \t]*$/gm, "");
    t = t.replace(/<%[\s\S]*?%>/g, " ");
    t = t.replace(/\$\$[\s\S]*?\$\$/g, " ");
    return t;
}
function countPlain(text) {
    var _a, _b, _c, _d;
    const cjk = (_b = (_a = text.match(CJK_G)) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    const lat = (_d = (_c = text.match(LATIN_G)) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
    return { cjk, lat };
}
function countMarkdown(src, opts) {
    return countPlain(stripMarkdown(src, opts));
}
function diffCounts(prev, next, opts) {
    if (prev === next)
        return { add: { cjk: 0, lat: 0 }, del: { cjk: 0, lat: 0 } };
    const maxStart = Math.min(prev.length, next.length);
    let start = 0;
    while (start < maxStart && prev.charCodeAt(start) === next.charCodeAt(start))
        start++;
    const maxEnd = Math.min(prev.length, next.length) - start;
    let end = 0;
    while (end < maxEnd &&
        prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) {
        end++;
    }
    const addedPart = next.slice(start, next.length - end);
    const removedPart = prev.slice(start, prev.length - end);
    return {
        add: countMarkdown(addedPart, opts),
        del: countMarkdown(removedPart, opts),
    };
}

};
__modules["i18n.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLang = setLang;
exports.L = L;
exports.detectLang = detectLang;
const zh = {
    viewName: "字数统计",
    today: "今日",
    rescan: "重新扫描",
    reading: "正在读取…",
    scanning: (done, total) => `扫描中 ${done} / ${total}`,
    cjk: "汉字",
    latinWords: (n) => `英文词 ${n}`,
    deleted: (c, l) => `　删改 −${c} / −${l}`,
    streak: (n) => `　连续 ${n} 天`,
    goalText: (done, goal, pct) => `${done} / ${goal} 字 · ${pct}%`,
    week: "本周",
    month: "本月",
    all: "全库",
    weekGoalText: (done, goal, pct) => `本周 ${done} / ${goal} 字 · ${pct}%`,
    weekGoalTitle: (goal) => `本周目标 ${goal} 汉字`,
    projects: "项目",
    runningTotal: "累计",
    projectTip: (name, m, ml, t, tl) => `${name}\n本月 汉字 ${m} / 词 ${ml}\n累计 汉字 ${t} / 词 ${tl}\n点击查看该项目下的文件`,
    noChangesThisMonth: "本月没有改动",
    fileTip: (path, m, ml, t, tl) => `${path}\n本月新增 汉字 ${m} / 词 ${ml}\n全文 汉字 ${t} / 词 ${tl}`,
    currentFile: "当前文件",
    currentNum: (c, l) => `汉字 ${c}　英文词 ${l}`,
    chartTip: (day, c, l) => `${day}　汉字 ${c}　英文词 ${l}`,
    healthChecking: "账本检查中…",
    healthOk: (months, entries) => `账本正常 · ${months} 个月 · ${entries} 条`,
    healthBad: (n) => `⚠ 账本异常 ${n} 项 · 点击排查`,
    foot: (files, time) => `${files} 个文件　更新于 ${time}`,
    wordsShort: (n) => `词 ${n}`,
    rangeDays: (n) => `${n}天`,
    rangeYear: "全年",
    rangeCumulative: "累计",
    cumulativeTip: (month, totalC, totalL, addC, addL) => `${month}　累计 汉字 ${totalC} / 英文词 ${totalL}（本月 +${addC} / +${addL}）`,
    cumulativeNote: "自账本启用起累计新增，不含启用前的存量。",
    heatTitle: (year) => `全年热力图 ${year}`,
    heatWeekdays: ["一", "三", "五"],
    monthShort: (m) => `${m}月`,
    heatLess: "少",
    heatMore: "多",
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
    noticeBaseline: (n) => `已建立快照：${n} 个文件。从今天起开始记账。`,
    noticeRebuilding: "正在重建快照…",
    noticeRebuilt: (n) => `快照已重建：${n} 个文件。账本未改动。`,
    noticeWeekly: (p) => `周报已写入 ${p}`,
    noticeWeeklyFail: (e) => `写周报失败：${e}`,
    noticeYear: (p) => `年度报告已写入 ${p}`,
    noticeYearFail: (e) => `写年度报告失败：${e}`,
    noticeCsv: (days, p) => `已导出 ${days} 天到 ${p}`,
    noticeCsvFail: (e) => `导出 CSV 失败：${e}`,
    noticeBackup: (p, n) => `账本已导出：${p}（${n} 条）`,
    noticeBackupFail: (e) => `导出失败：${e}`,
    noticeRestoreEmpty: "备份目录里没有可导入的 JSON 文件。",
    noticeRestoreInvalid: (e) => `备份无法读取：${e}`,
    noticeRestoreNoEntries: "备份里没有有效条目。",
    noticeRestoreNothing: (total, dup, bad) => `备份共 ${total} 条，全部重复，没有需要导入的内容（重复 ${dup}，坏行 ${bad}）。`,
    noticeRestoreDone: (added, dup, bad, safety) => `已导入 ${added} 条（跳过重复 ${dup}，坏行 ${bad}）。` +
        (safety ? `安全备份：${safety}` : ""),
    noticeRestoreFail: (e) => `导入失败：${e}`,
    noticeRestoreCancelled: "导入前的安全备份失败，已取消导入。",
    noticeAutoBackup: (p) => `已自动备份账本到 ${p}`,
    noticeLedgerEmpty: "账本还是空的，没有可导出的内容。",
    noticeFmWritten: (k, n) => `已写入 ${k}: ${n}`,
    noticeFmLatest: (k, n) => `${k} 已经是最新（${n}）`,
    noticeFmFail: (e) => `写入属性失败：${e}`,
    noticeNoFile: "没有打开的笔记。",
    noticeNotCounted: "这篇还没统计到，先保存一次。",
    noticeAuditOk: (months, entries) => `账本正常：${months} 个月 · ${entries} 条事件`,
    noticeAuditBad: (n, p) => `账本体检发现 ${n} 项问题，已写入 ${p}`,
    noticeRepair: (n) => `账本末尾发现截断，已丢弃 ${n} 个字符的残行后继续记录。`,
    statusToday: (c, l) => `今日 +${c}字 +${l}词`,
    statusTodayCombined: (n) => `今日 +${n}`,
    statusTodayZero: "今日 +0",
    statusTitleWeek: (c, l) => `本周 汉字 ${c} / 词 ${l}`,
    statusTitleStreak: (n) => `连续 ${n} 天`,
    statusTitleTotal: (c, l) => `全库 汉字 ${c} / 词 ${l}`,
    statusTitleClick: "点击打开面板",
    restorePickPlaceholder: "搜索备份文件…",
    restoreTitle: "导入账本备份",
    restoreSummary: (total, fresh, dup, bad) => `备份共 ${total} 条：可新增 ${fresh}，重复 ${dup}，无法解析 ${bad}。`,
    restoreSource: "备份文件",
    restoreVault: "来源库",
    restoreDevice: "设备",
    restoreOtherDevice: "这份备份由另一台设备导出。如果本机也记录过同一段写作，可能出现重复计数；导入后建议跑一次账本体检。",
    restoreOtherVault: "这份备份来自另一个库，路径可能对不上；确认后再导入。",
    restoreNewerVersion: (v) => `备份由更新版本的 Abacus 生成（v${v}），已按当前格式导入已知字段。`,
    restoreSafety: "导入前会先把当前账本导出到备份目录（文件名带 -pre-restore 时间后缀）。",
    restoreConfirm: "导入",
    cancel: "取消",
    sCounter: "统计口径",
    sCounterDesc: "改动这里会重建快照（不产生写作记录），已记录的账本不受影响。",
    sFrontmatter: "计入 YAML frontmatter",
    sFrontmatterDesc: "默认不计入：属性区是元数据，不是正文。",
    sCode: "计入代码块与行内代码",
    sCodeDesc: "默认不计入。",
    sExclude: "排除的文件夹",
    sExcludeDesc: "每行一个，相对库根目录；这些目录不扫描、不统计。",
    sProps: "笔记属性",
    sPropsDesc: "把汉字数写进笔记的 frontmatter，供 Bases / Dataview 排序、筛选、做公式。这会修改你的笔记，所以默认关闭。",
    sWriteProp: "保存时把字数写进属性",
    sWritePropDesc: "只在内容真的变化时写；值没变不会动文件，所以不会触发死循环。",
    sPropKey: "属性名",
    sPropKeyDesc: "默认 words。只写汉字数，英文词去账本里看。",
    sDisplay: "显示",
    sLatinPrimary: "主指标包含英文词",
    sLatinPrimaryDesc: "开启后状态栏的今日数字把英文词并入汉字，只显示一个合计；关闭时分别显示汉字和英文词。面板始终分开显示两个分量。",
    sGoals: "目标",
    sGoalsDesc: "按汉字计。填 0 或留空表示不设目标；设了目标，面板会出现进度条，周报里会多一行达标天数。",
    sDailyGoal: "每日目标（汉字）",
    sWeeklyGoal: "每周目标（汉字）",
    sProject: "项目分组",
    sProjectDesc: "默认按路径前两段分组（创作/小说、归档/日记……）。需要更细的粒度就写规则，每行一条：`名称 = 路径前缀`，或只写路径前缀（名称取末段）。规则按前缀最长优先。",
    sRules: "分组规则",
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
    sData: "数据",
    sDataDesc: "数据目录：.obsidian/plugins/abacus/stats/。snapshot.json 是存量（可删，会自动重建），ledger/*.jsonl 是按月追加的事件账本——后者删掉就永久丢失。",
    sRebuild: "立即重建快照",
    sRebuildBtn: "重建",
    sBackup: "导出账本备份",
    sBackupDesc: "把账本合并成一个 JSON 写入下面这个目录。账本本体在 .obsidian 里不一定被同步，这份才是异地备份。",
    sBackupFolder: "账本备份目录",
    sRestore: "从备份恢复",
    sRestoreDesc: "从备份目录选择一个 JSON，合并回账本；重复事件自动跳过。导入前会先导出当前账本。",
    sRestoreBtn: "选择备份",
    sAutoBackup: "自动备份间隔（天）",
    sAutoBackupDesc: "0 表示关闭。启动时如果本机最近一份备份早于这个天数，会自动导出一份完整账本。",
};
const en = {
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
    projectTip: (name, m, ml, t, tl) => `${name}\nThis month ${m} CJK / ${ml} words\nTotal ${t} CJK / ${tl} words\nClick to list files`,
    noChangesThisMonth: "No changes this month",
    fileTip: (path, m, ml, t, tl) => `${path}\nThis month +${m} CJK / +${ml} words\nTotal ${t} CJK / ${tl} words`,
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
    cumulativeTip: (month, totalC, totalL, addC, addL) => `${month}　total ${totalC} CJK / ${totalL} words (this month +${addC} / +${addL})`,
    cumulativeNote: "Cumulative additions since the ledger started; excludes pre-existing notes.",
    heatTitle: (year) => `Yearly heatmap ${year}`,
    heatWeekdays: ["Mon", "Wed", "Fri"],
    monthShort: (m) => {
        var _a;
        return (_a = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]) !== null && _a !== void 0 ? _a : `${m}`;
    },
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
    noticeRestoreNothing: (total, dup, bad) => `All ${total} entries are already present; nothing to import (${dup} duplicates, ${bad} bad lines).`,
    noticeRestoreDone: (added, dup, bad, safety) => `Imported ${added} entries (${dup} duplicates skipped, ${bad} bad lines).` +
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
    restoreSummary: (total, fresh, dup, bad) => `${total} entries in backup: ${fresh} new, ${dup} duplicates, ${bad} unreadable.`,
    restoreSource: "Backup file",
    restoreVault: "Source vault",
    restoreDevice: "Device",
    restoreOtherDevice: "This backup was exported by another device. If this vault also recorded the same writing, counts may double; run a ledger check after importing.",
    restoreOtherVault: "This backup comes from another vault; paths may not match. Continue only if you are sure.",
    restoreNewerVersion: (v) => `Created by a newer Abacus (v${v}); known fields will be imported.`,
    restoreSafety: "The current ledger will first be exported to the backup folder with a -pre-restore time suffix.",
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
    sPropsDesc: "Write the CJK count into each note's frontmatter so Bases / Dataview can sort, filter and compute on it. This modifies your notes, so it is off by default.",
    sWriteProp: "Write word count on save",
    sWritePropDesc: "Only writes when the content actually changed, so it can't loop.",
    sPropKey: "Property name",
    sPropKeyDesc: "Defaults to words. Only the CJK count is written; see the ledger for the split.",
    sDisplay: "Display",
    sLatinPrimary: "Include English words in the primary metric",
    sLatinPrimaryDesc: "When on, the status bar's today number folds English words into CJK and shows one total; when off, it shows both separately. The panel always shows both components.",
    sGoals: "Goals",
    sGoalsDesc: "Counted in CJK characters. 0 or empty means no goal; with a goal the panel shows a progress bar and the weekly report gains a streak-of-goals row.",
    sDailyGoal: "Daily goal (CJK)",
    sWeeklyGoal: "Weekly goal (CJK)",
    sProject: "Project grouping",
    sProjectDesc: "By default the first two path segments form a project (创作/小说, 归档/日记…). For finer control, add rules, one per line: `Name = path prefix`, or just a prefix (the name is its last segment). Longest prefix wins.",
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
    sReportFolderDesc: "Where reports are written. This folder is excluded from counting, otherwise reports would count as writing.",
    sData: "Data",
    sDataDesc: "Data lives in .obsidian/plugins/abacus/stats/. snapshot.json is rebuildable; ledger/*.jsonl is the append-only event log and cannot be reconstructed.",
    sRebuild: "Rebuild snapshot now",
    sRebuildBtn: "Rebuild",
    sBackup: "Export ledger backup",
    sBackupDesc: "Merge the ledger into one JSON in the folder below. The ledger itself may not be synced, so this is the off-site copy.",
    sBackupFolder: "Backup folder",
    sRestore: "Restore from backup",
    sRestoreDesc: "Choose a JSON from the backup folder and merge it back into the ledger; duplicate events are skipped. The current ledger is exported first.",
    sRestoreBtn: "Choose backup",
    sAutoBackup: "Auto-backup interval (days)",
    sAutoBackupDesc: "0 disables it. On startup, if this device's latest backup is older than this many days, a full ledger export is written.",
};
let current = zh;
function setLang(lang) {
    current = lang === "en" ? en : zh;
}
function L() {
    return current;
}
function detectLang() {
    try {
        const raw = window.localStorage.getItem("language");
        if (raw)
            return raw.toLowerCase().startsWith("zh") ? "zh" : "en";
    }
    catch (_a) {
    }
    try {
        return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
    }
    catch (_b) {
        return "zh";
    }
}

};
__modules["main.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtDate = exports.monthKey = void 0;
const obsidian_1 = require("obsidian");
const types_1 = require("./types");
const backup_1 = require("./backup");
const backupModal_1 = require("./backupModal");
const store_1 = require("./store");
Object.defineProperty(exports, "monthKey", { enumerable: true, get: function () { return store_1.monthKey; } });
const i18n_1 = require("./i18n");
const scanner_1 = require("./scanner");
const view_1 = require("./view");
const settings_1 = require("./settings");
const stats_1 = require("./stats");
Object.defineProperty(exports, "fmtDate", { enumerable: true, get: function () { return stats_1.fmtDate; } });
const report_1 = require("./report");
const WEEK_CHARS = ["日", "一", "二", "三", "四", "五", "六"];
const DEVICE_KEY = "abacus-device-id";
function deviceId() {
    try {
        let id = window.localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = Math.random().toString(36).slice(2, 10);
            window.localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    }
    catch (_a) {
        return "local";
    }
}
const LEDGER_TTL = 3000;
const TOP_PROJECTS = 6;
const TOP_REPORT_FILES = 10;
class AbacusPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = { ...types_1.DEFAULT_SETTINGS };
        this.ledgerCache = new Map();
        this.refreshTimer = null;
        this.progress = null;
        this.streakCache = null;
        this.health = null;
        this.selectedProject = null;
        this.fmQueue = new Set();
        this.fmTimer = null;
    }
    async onload() {
        var _a;
        (0, i18n_1.setLang)((0, i18n_1.detectLang)());
        await this.loadSettings();
        const baseDir = (_a = this.manifest.dir) !== null && _a !== void 0 ? _a : `.obsidian/plugins/${this.manifest.id}`;
        const adapter = this.app.vault.adapter;
        this.adapter = adapter;
        this.store = new store_1.StatsStore(baseDir, adapter, { version: 1, deviceId: deviceId() });
        await this.store.load();
        const io = {
            listFiles: () => this.app.vault.getMarkdownFiles().map((f) => ({
                path: f.path,
                size: f.stat.size,
                mtime: f.stat.mtime,
            })),
            readFile: async (path) => {
                const f = this.app.vault.getAbstractFileByPath(path);
                if (f instanceof obsidian_1.TFile)
                    return this.app.vault.cachedRead(f);
                throw new Error(`not a markdown file: ${path}`);
            },
            adapter,
        };
        this.scanner = new scanner_1.Scanner(io, this.store, () => this.settings, {
            onProgress: (done, total) => {
                this.progress = { done, total };
                this.scheduleRefresh(120);
            },
            onChange: () => this.invalidate(),
            onCounted: (path) => this.queueFrontmatter(path),
        });
        this.registerView(view_1.VIEW_TYPE_STATS, (leaf) => new view_1.StatsView(leaf, {
            onRescan: () => void this.rebuild(),
            onRange: (days) => void this.setRange(days),
            onAudit: () => void this.auditLedger(),
            onProject: (name) => void this.selectProject(name),
        }));
        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("scs-statusbar");
        this.statusBar.setText((0, i18n_1.L)().reading);
        this.statusBar.onclick = () => void this.activateView();
        this.statusBar.title = (0, i18n_1.L)().statusTitleClick;
        this.addRibbonIcon("calculator", (0, i18n_1.L)().viewName, () => void this.activateView());
        this.addCommand({ id: "open-panel", name: (0, i18n_1.L)().cmdOpen, callback: () => void this.activateView() });
        this.addCommand({ id: "rebuild", name: (0, i18n_1.L)().cmdRebuild, callback: () => void this.rebuild() });
        this.addCommand({
            id: "weekly-report",
            name: (0, i18n_1.L)().cmdWeekly,
            callback: () => void this.generateReport((0, stats_1.startOfWeek)(Date.now()), true),
        });
        this.addCommand({
            id: "weekly-report-last",
            name: (0, i18n_1.L)().cmdWeeklyLast,
            callback: () => void this.generateReport((0, stats_1.addDays)((0, stats_1.startOfWeek)(Date.now()), -7), true),
        });
        this.addCommand({
            id: "export-ledger",
            name: (0, i18n_1.L)().cmdBackup,
            callback: () => void this.exportLedger(),
        });
        this.addCommand({
            id: "restore-ledger",
            name: (0, i18n_1.L)().cmdRestore,
            callback: () => void this.restoreLedger(),
        });
        this.addCommand({
            id: "year-report",
            name: (0, i18n_1.L)().cmdYear,
            callback: () => void this.writeYearReport(),
        });
        this.addCommand({
            id: "export-csv",
            name: (0, i18n_1.L)().cmdCsv,
            callback: () => void this.exportCsv(),
        });
        this.addCommand({
            id: "sync-frontmatter",
            name: (0, i18n_1.L)().cmdSyncFm,
            callback: async () => {
                const file = this.app.workspace.getActiveFile();
                if (!file) {
                    new obsidian_1.Notice((0, i18n_1.L)().noticeNoFile);
                    return;
                }
                const rec = this.store.get(file.path);
                if (!rec) {
                    new obsidian_1.Notice((0, i18n_1.L)().noticeNotCounted);
                    return;
                }
                const key = this.settings.frontmatterKey || "words";
                const changed = await this.syncFrontmatter(file.path, true);
                new obsidian_1.Notice(changed ? (0, i18n_1.L)().noticeFmWritten(key, rec.vec.cjk) : (0, i18n_1.L)().noticeFmLatest(key, rec.vec.cjk));
            },
        });
        this.addCommand({
            id: "audit-ledger",
            name: (0, i18n_1.L)().cmdAudit,
            callback: () => void this.auditLedger(),
        });
        this.addSettingTab(new settings_1.StatsSettingTab(this.app, this));
        this.registerEvent(this.app.vault.on("modify", (f) => {
            if (f instanceof obsidian_1.TFile && f.extension === "md")
                this.scanner.scheduleEdit(f.path);
        }));
        this.registerEvent(this.app.vault.on("create", (f) => {
            if (f instanceof obsidian_1.TFile && f.extension === "md")
                this.scanner.scheduleEdit(f.path);
        }));
        this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
            if (f instanceof obsidian_1.TFile && f.extension === "md")
                this.scanner.handleRename(oldPath, f.path);
        }));
        this.registerEvent(this.app.vault.on("delete", (f) => {
            if (f instanceof obsidian_1.TFile && f.extension === "md")
                void this.scanner.handleDelete(f.path);
        }));
        this.registerInterval(window.setInterval(() => void this.refresh(), 60000));
        this.app.workspace.onLayoutReady(() => {
            void this.initialScan();
        });
    }
    onunload() {
        var _a;
        if (this.refreshTimer !== null)
            window.clearTimeout(this.refreshTimer);
        void ((_a = this.store) === null || _a === void 0 ? void 0 : _a.flushSave());
        this.app.workspace.detachLeavesOfType(view_1.VIEW_TYPE_STATS);
    }
    async initialScan() {
        const res = await this.scanner.fullScan(false);
        this.progress = null;
        if (res.baseline && res.files > 0) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeBaseline(res.files));
        }
        await this.refresh();
        void this.autoWeeklyReport();
        void this.checkLedgerHealth();
        void this.autoBackupLedger();
    }
    async rebuild() {
        new obsidian_1.Notice((0, i18n_1.L)().noticeRebuilding);
        this.store.clear();
        const res = await this.scanner.fullScan(true);
        this.invalidate();
        this.progress = null;
        await this.refresh();
        new obsidian_1.Notice((0, i18n_1.L)().noticeRebuilt(res.files));
    }
    async setRange(days) {
        if (this.settings.panelRange === days)
            return;
        this.settings.panelRange = days;
        await this.saveData(this.settings);
        await this.refresh();
    }
    async applySettings(kinds) {
        await this.saveData(this.settings);
        if (kinds.includes("counter") || kinds.includes("scan")) {
            await this.rebuild();
        }
        else {
            await this.refresh();
        }
    }
    invalidate() {
        this.ledgerCache.clear();
        this.streakCache = null;
        this.scheduleRefresh(200);
    }
    scheduleRefresh(delay = 250) {
        if (this.refreshTimer !== null)
            window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            void this.refresh();
        }, delay);
    }
    async refresh() {
        if (!this.store)
            return;
        const data = await this.buildPanelData();
        const view = this.getView();
        if (view)
            view.setData(data);
        this.updateStatusBar(data);
    }
    updateStatusBar(data) {
        if (!this.statusBar)
            return;
        const t = (0, i18n_1.L)();
        const primary = (0, types_1.primaryOf)(data.todayAdd, this.settings.includeLatinInPrimary);
        const warn = data.health && !data.health.ok ? " ⚠" : "";
        const c = data.todayAdd.cjk.toLocaleString("en-US");
        const l = data.todayAdd.lat.toLocaleString("en-US");
        const text = primary === 0
            ? t.statusTodayZero
            : this.settings.includeLatinInPrimary
                ? t.statusTodayCombined(primary.toLocaleString("en-US"))
                : t.statusToday(c, l);
        this.statusBar.setText(text + warn);
        this.statusBar.title =
            t.statusTitleWeek(data.weekAdd.cjk.toLocaleString("en-US"), data.weekAdd.lat.toLocaleString("en-US")) +
                "\n" +
                (data.streak > 0 ? t.statusTitleStreak(data.streak) + "\n" : "") +
                (data.health && !data.health.ok ? `⚠ ${data.health.problems[0]}\n` : "") +
                t.statusTitleTotal(data.total.cjk.toLocaleString("en-US"), data.total.lat.toLocaleString("en-US")) +
                "\n" +
                t.statusTitleClick;
    }
    async buildPanelData() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const now = Date.now();
        const range = [7, 30, 90, 365, 0].includes(this.settings.panelRange)
            ? this.settings.panelRange
            : 7;
        const year = new Date(now).getFullYear();
        const yearStart = new Date(year, 0, 1).getTime();
        const chartFrom = range === 365 || range === 0 ? yearStart : (0, stats_1.addDays)((0, stats_1.startOfDay)(now), -(range - 1));
        const from = Math.min((0, stats_1.startOfMonth)(now), (0, stats_1.startOfWeek)(now), chartFrom, yearStart);
        const entries = range === 0
            ? await this.readMonths(await this.store.listLedgerMonths())
            : await this.readMonths((0, stats_1.monthsBetween)(from, now + 1));
        const todaySum = (0, stats_1.sumWriting)(entries, (0, stats_1.startOfDay)(now), now + 1);
        const fileDel = (0, stats_1.sumDeletions)(entries, (0, stats_1.startOfDay)(now), now + 1).del;
        const todayDel = (0, types_1.vec)(todaySum.del.cjk + fileDel.cjk, todaySum.del.lat + fileDel.lat);
        const perDay = (0, stats_1.byDay)(entries);
        const heat = (0, stats_1.buildYearHeatmap)(year, perDay, now);
        const days = [];
        if (range === 0) {
            const cum = (0, stats_1.cumulativeByMonth)(entries, now);
            for (const c of cum) {
                days.push({
                    day: c.month,
                    label: (0, i18n_1.L)().monthShort(Number(c.month.slice(5))),
                    vec: c.total,
                    isToday: c.month === (0, store_1.monthKey)(now),
                    tip: (0, i18n_1.L)().cumulativeTip(c.month, c.total.cjk.toLocaleString("en-US"), c.total.lat.toLocaleString("en-US"), c.add.cjk.toLocaleString("en-US"), c.add.lat.toLocaleString("en-US")),
                });
            }
        }
        else if (range === 365) {
            const currentMonth = new Date(now).getMonth();
            const monthSums = (0, stats_1.sumByMonth)(entries, year, now);
            for (let m = 0; m < 12; m++) {
                days.push({
                    day: `${year}-${String(m + 1).padStart(2, "0")}`,
                    label: (0, i18n_1.L)().monthShort(m + 1),
                    vec: monthSums[m],
                    isToday: m === currentMonth,
                });
            }
        }
        else {
            for (let i = 0; i < range; i++) {
                const ts = (0, stats_1.addDays)(chartFrom, i);
                const key = (0, store_1.dayKey)(ts);
                days.push({
                    day: key,
                    label: range > 30
                        ? (0, stats_1.fmtDate)(ts)
                        : range > 7
                            ? `${new Date(ts).getDate()}`
                            : WEEK_CHARS[new Date(ts).getDay()],
                    vec: (_a = perDay.get(key)) !== null && _a !== void 0 ? _a : (0, types_1.vec)(0, 0),
                    isToday: key === (0, store_1.dayKey)(now),
                });
            }
        }
        const active = this.app.workspace.getActiveFile();
        const rec = active ? this.store.get(active.path) : undefined;
        return {
            todayAdd: todaySum.add,
            todayDel,
            weekAdd: (0, stats_1.sumWriting)(entries, (0, stats_1.startOfWeek)(now), now + 1).add,
            monthAdd: (0, stats_1.sumWriting)(entries, (0, stats_1.startOfMonth)(now), now + 1).add,
            total: this.store.total(),
            fileCount: this.store.size(),
            current: active && rec ? { path: active.path, vec: rec.vec } : undefined,
            days,
            range,
            heat,
            streak: await this.computeStreak(),
            projects: this.buildProjects(entries, now),
            dailyGoal: (_b = this.settings.dailyGoal) !== null && _b !== void 0 ? _b : 0,
            weeklyGoal: (_c = this.settings.weeklyGoal) !== null && _c !== void 0 ? _c : 0,
            projectFiles: this.buildProjectFiles(entries, now),
            selectedProject: (_d = this.selectedProject) !== null && _d !== void 0 ? _d : undefined,
            health: (_e = this.health) !== null && _e !== void 0 ? _e : undefined,
            scanning: (_g = (_f = this.scanner) === null || _f === void 0 ? void 0 : _f.isScanning) !== null && _g !== void 0 ? _g : false,
            progress: (_h = this.progress) !== null && _h !== void 0 ? _h : undefined,
            updatedAt: now,
        };
    }
    buildProjects(entries, now) {
        var _a, _b, _c;
        const rules = (0, stats_1.parseProjectRules)(this.settings.projectRules);
        const monthFrom = (0, stats_1.startOfMonth)(now);
        const stock = new Map();
        for (const [path, r] of this.store.entries()) {
            const name = (0, stats_1.projectOf)(path, rules);
            stock.set(name, (0, types_1.addVec)((_a = stock.get(name)) !== null && _a !== void 0 ? _a : (0, types_1.vec)(0, 0), r.vec));
        }
        const flow = new Map();
        for (const e of entries) {
            if (e.t < monthFrom || e.t > now)
                continue;
            if (!(0, stats_1.isWritingEntry)(e))
                continue;
            const name = (0, stats_1.projectOf)(e.p, rules);
            flow.set(name, (0, types_1.addVec)((_b = flow.get(name)) !== null && _b !== void 0 ? _b : (0, types_1.vec)(0, 0), (0, types_1.vec)(e.add[0], e.add[1])));
        }
        const rows = [];
        for (const [name, total] of stock) {
            rows.push({ name, month: (_c = flow.get(name)) !== null && _c !== void 0 ? _c : (0, types_1.vec)(0, 0), total });
        }
        for (const [name, month] of flow) {
            if (!stock.has(name))
                rows.push({ name, month, total: (0, types_1.vec)(0, 0) });
        }
        const top = rows
            .filter((r) => !(0, types_1.isZeroVec)(r.total) || !(0, types_1.isZeroVec)(r.month))
            .sort((a, b) => b.month.cjk - a.month.cjk || b.total.cjk - a.total.cjk)
            .slice(0, TOP_PROJECTS);
        if (this.selectedProject && !top.some((r) => r.name === this.selectedProject)) {
            this.selectedProject = null;
        }
        return top;
    }
    async selectProject(name) {
        this.selectedProject = this.selectedProject === name ? null : name;
        await this.refresh();
    }
    buildProjectFiles(entries, now) {
        var _a;
        const project = this.selectedProject;
        if (!project)
            return [];
        const rules = (0, stats_1.parseProjectRules)(this.settings.projectRules);
        const monthFrom = (0, stats_1.startOfMonth)(now);
        const flow = new Map();
        for (const e of entries) {
            if (e.t < monthFrom || e.t > now)
                continue;
            if (!(0, stats_1.isWritingEntry)(e))
                continue;
            if ((0, stats_1.projectOf)(e.p, rules) !== project)
                continue;
            flow.set(e.p, (0, types_1.addVec)((_a = flow.get(e.p)) !== null && _a !== void 0 ? _a : (0, types_1.vec)(0, 0), (0, types_1.vec)(e.add[0], e.add[1])));
        }
        const rows = [...flow.entries()].map(([path, v]) => {
            var _a, _b;
            return ({
                path,
                month: v,
                total: (_b = (_a = this.store.get(path)) === null || _a === void 0 ? void 0 : _a.vec) !== null && _b !== void 0 ? _b : (0, types_1.vec)(0, 0),
            });
        });
        if (rows.length === 0) {
            for (const [path, rec] of this.store.entries()) {
                if ((0, stats_1.projectOf)(path, rules) !== project)
                    continue;
                rows.push({ path, month: (0, types_1.vec)(0, 0), total: rec.vec });
            }
        }
        return rows
            .sort((a, b) => b.month.cjk - a.month.cjk || b.total.cjk - a.total.cjk)
            .slice(0, 6);
    }
    async computeStreak() {
        const now = Date.now();
        if (this.streakCache && now - this.streakCache.at < LEDGER_TTL)
            return this.streakCache.value;
        const today = (0, stats_1.startOfDay)(now);
        const days = new Set();
        const monthSets = new Map();
        for (let i = 0; i < 400; i++) {
            const ts = (0, stats_1.addDays)(today, -i);
            const ym = (0, store_1.monthKey)(ts);
            let set = monthSets.get(ym);
            if (!set) {
                set = (0, stats_1.daysWithWriting)(await this.readMonthCached(ym));
                monthSets.set(ym, set);
            }
            const key = (0, store_1.dayKey)(ts);
            if (set.has(key)) {
                days.add(key);
            }
            else if (i > 0) {
                break;
            }
        }
        const value = (0, stats_1.streakFrom)(days, today);
        this.streakCache = { at: now, value };
        return value;
    }
    async readMonthCached(ym) {
        const now = Date.now();
        const hit = this.ledgerCache.get(ym);
        if (hit && now - hit.at < LEDGER_TTL)
            return hit.entries;
        const entries = await this.store.readMonth(ym);
        this.ledgerCache.set(ym, { at: now, entries });
        return entries;
    }
    async readMonths(yms) {
        const out = [];
        for (const ym of yms)
            out.push(...(await this.readMonthCached(ym)));
        return out;
    }
    async writeYearReport(year = new Date().getFullYear()) {
        var _a, _b;
        const from = new Date(year, 0, 1).getTime();
        const to = new Date(year + 1, 0, 1).getTime();
        const entries = await this.readMonths((0, stats_1.monthsBetween)(from, to));
        const rules = (0, stats_1.parseProjectRules)(this.settings.projectRules);
        const dailyMap = (0, stats_1.byDay)(entries);
        const daily = {};
        for (const [k, v] of dailyMap)
            daily[k] = v;
        const months = [];
        for (let m = 0; m < 12; m++) {
            const mFrom = new Date(year, m, 1).getTime();
            const mTo = new Date(year, m + 1, 1).getTime();
            let active = 0;
            for (let d = 1; d <= 31; d++) {
                const dt = new Date(year, m, d);
                if (dt.getMonth() !== m)
                    break;
                const v = daily[(0, store_1.dayKey)(dt.getTime())];
                if (v && v.cjk + v.lat > 0)
                    active++;
            }
            months.push({ month: m + 1, activeDays: active, vec: (0, stats_1.sumWriting)(entries, mFrom, mTo).add });
        }
        let activeDays = 0;
        let longest = 0;
        let run = 0;
        let best = null;
        for (let cursor = new Date(year, 0, 1); cursor.getFullYear() === year; cursor.setDate(cursor.getDate() + 1)) {
            const key = (0, store_1.dayKey)(cursor.getTime());
            const v = daily[key];
            const has = !!v && v.cjk + v.lat > 0;
            if (has) {
                activeDays++;
                run++;
                if (run > longest)
                    longest = run;
            }
            else {
                run = 0;
            }
            if (v && (!best || v.cjk + v.lat > best.vec.cjk + best.vec.lat))
                best = { date: key, vec: v };
        }
        const projMap = new Map();
        const fileMap = new Map();
        for (const e of entries) {
            if (e.t < from || e.t >= to || !(0, stats_1.isWritingEntry)(e))
                continue;
            const v = (0, types_1.vec)(e.add[0], e.add[1]);
            const p = (0, stats_1.projectOf)(e.p, rules);
            projMap.set(p, (0, types_1.addVec)((_a = projMap.get(p)) !== null && _a !== void 0 ? _a : (0, types_1.vec)(0, 0), v));
            fileMap.set(e.p, (0, types_1.addVec)((_b = fileMap.get(e.p)) !== null && _b !== void 0 ? _b : (0, types_1.vec)(0, 0), v));
        }
        const content = (0, report_1.buildYearReport)({
            year,
            add: (0, stats_1.sumWriting)(entries, from, to).add,
            del: (0, stats_1.sumDeletions)(entries, from, to).del,
            activeDays,
            bestDay: best,
            longestStreak: longest,
            months,
            projects: [...projMap.entries()].map(([name, v]) => ({ name, vec: v })).sort((a, b) => b.vec.cjk - a.vec.cjk),
            topFiles: [...fileMap.entries()]
                .map(([path, v]) => ({ path, vec: v }))
                .sort((a, b) => b.vec.cjk - a.vec.cjk)
                .slice(0, TOP_REPORT_FILES),
            daily,
            generatedAt: Date.now(),
        });
        const folder = this.settings.reportFolder || "归档/统计归档";
        const path = (0, obsidian_1.normalizePath)(`${folder}/年度报告 ${year}.md`);
        try {
            await this.writeVaultFile(path, content);
            new obsidian_1.Notice((0, i18n_1.L)().noticeYear(path));
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeYearFail(err.message));
        }
    }
    async exportCsv() {
        var _a;
        const months = await this.store.listLedgerMonths();
        if (months.length === 0) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeLedgerEmpty);
            return;
        }
        const entries = await this.store.readMonths(months);
        const map = new Map();
        for (const e of entries) {
            if (e.src !== "edit" && e.src !== "scan")
                continue;
            const key = (0, store_1.dayKey)(e.t);
            const row = (_a = map.get(key)) !== null && _a !== void 0 ? _a : { date: key, add: (0, types_1.vec)(0, 0), del: (0, types_1.vec)(0, 0), entries: 0 };
            row.add = (0, types_1.addVec)(row.add, (0, types_1.vec)(e.add[0], e.add[1]));
            row.del = (0, types_1.addVec)(row.del, (0, types_1.vec)(e.del[0], e.del[1]));
            row.entries++;
            map.set(key, row);
        }
        const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
        const folder = this.settings.reportFolder || "归档/统计归档";
        const path = (0, obsidian_1.normalizePath)(`${folder}/账本导出 ${(0, store_1.dayKey)(Date.now())}.csv`);
        try {
            await this.writeVaultFile(path, (0, report_1.buildCsv)(rows));
            new obsidian_1.Notice((0, i18n_1.L)().noticeCsv(rows.length, path));
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeCsvFail(err.message));
        }
    }
    queueFrontmatter(path) {
        if (!this.settings.writeFrontmatter)
            return;
        this.fmQueue.add(path);
        if (this.fmTimer !== null)
            window.clearTimeout(this.fmTimer);
        this.fmTimer = window.setTimeout(() => {
            this.fmTimer = null;
            void this.flushFrontmatter();
        }, 1500);
    }
    async flushFrontmatter() {
        const paths = [...this.fmQueue];
        this.fmQueue.clear();
        for (const p of paths)
            await this.syncFrontmatter(p);
    }
    async syncFrontmatter(path, force = false) {
        if (!force && !this.settings.writeFrontmatter)
            return false;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof obsidian_1.TFile))
            return false;
        const rec = this.store.get(path);
        if (!rec)
            return false;
        const key = this.settings.frontmatterKey || "words";
        const wanted = rec.vec.cjk;
        let changed = false;
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                if (fm[key] !== wanted) {
                    fm[key] = wanted;
                    changed = true;
                }
            });
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeFmFail(err.message));
            return false;
        }
        return changed;
    }
    async generateReport(weekStart, notify) {
        var _a, _b, _c, _d;
        const weekEnd = (0, stats_1.addDays)(weekStart, 7);
        const entries = await this.readMonths((0, stats_1.monthsBetween)(weekStart, weekEnd));
        const rules = (0, stats_1.parseProjectRules)(this.settings.projectRules);
        const dailyVec = (0, stats_1.byDay)(entries);
        const daily = [];
        let activeDays = 0;
        for (let i = 0; i < 7; i++) {
            const ts = (0, stats_1.addDays)(weekStart, i);
            const key = (0, store_1.dayKey)(ts);
            const v = (_a = dailyVec.get(key)) !== null && _a !== void 0 ? _a : (0, types_1.vec)(0, 0);
            if (v.cjk + v.lat > 0)
                activeDays++;
            daily.push({ date: key, weekday: (0, stats_1.weekdayCN)(ts), vec: v });
        }
        const goal = (_b = this.settings.dailyGoal) !== null && _b !== void 0 ? _b : 0;
        const goalDays = goal > 0 ? daily.filter((d) => d.vec.cjk >= goal).length : 0;
        const weekSum = (0, stats_1.sumWriting)(entries, weekStart, weekEnd);
        const weekDel = (0, stats_1.sumDeletions)(entries, weekStart, weekEnd).del;
        if (weekSum.add.cjk + weekSum.add.lat + weekDel.cjk + weekDel.lat === 0)
            return false;
        const projMap = new Map();
        const fileMap = new Map();
        for (const e of entries) {
            if (e.t < weekStart || e.t >= weekEnd || !(0, stats_1.isWritingEntry)(e))
                continue;
            const v = (0, types_1.vec)(e.add[0], e.add[1]);
            const p = (0, stats_1.projectOf)(e.p, rules);
            projMap.set(p, (0, types_1.addVec)((_c = projMap.get(p)) !== null && _c !== void 0 ? _c : (0, types_1.vec)(0, 0), v));
            fileMap.set(e.p, (0, types_1.addVec)((_d = fileMap.get(e.p)) !== null && _d !== void 0 ? _d : (0, types_1.vec)(0, 0), v));
        }
        const projects = [...projMap.entries()]
            .map(([name, v]) => ({ name, vec: v }))
            .sort((a, b) => b.vec.cjk - a.vec.cjk);
        const topFiles = [...fileMap.entries()]
            .map(([path, v]) => ({ path, vec: v }))
            .sort((a, b) => b.vec.cjk - a.vec.cjk)
            .slice(0, TOP_REPORT_FILES);
        const content = (0, report_1.buildWeeklyReport)({
            week: (0, stats_1.isoWeek)(weekStart),
            weekStartLabel: `${new Date(weekStart).getMonth() + 1}月${new Date(weekStart).getDate()}日`,
            weekEndLabel: `${new Date(weekEnd - 86400000).getMonth() + 1}月${new Date(weekEnd - 86400000).getDate()}日`,
            add: weekSum.add,
            del: weekDel,
            activeDays,
            goalDays,
            dailyGoal: goal,
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
            if (notify)
                new obsidian_1.Notice((0, i18n_1.L)().noticeWeekly(path));
            return true;
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeWeeklyFail(err.message));
            return false;
        }
    }
    async autoWeeklyReport() {
        if (!this.settings.autoWeeklyReport)
            return;
        const lastWeek = (0, stats_1.addDays)((0, stats_1.startOfWeek)(Date.now()), -7);
        if (this.app.vault.getAbstractFileByPath(this.reportPath(lastWeek)))
            return;
        if (await this.generateReport(lastWeek, false)) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeWeekly(this.reportPath(lastWeek)));
        }
    }
    reportPath(weekStart) {
        const folder = (0, obsidian_1.normalizePath)(this.settings.reportFolder || "归档/统计归档");
        return (0, obsidian_1.normalizePath)(`${folder}/周报 ${(0, stats_1.isoWeek)(weekStart)}.md`);
    }
    async exportLedger(notify = true, tag = "") {
        const months = await this.store.listLedgerMonths();
        if (months.length === 0) {
            if (notify)
                new obsidian_1.Notice((0, i18n_1.L)().noticeLedgerEmpty);
            return null;
        }
        const all = [];
        for (const ym of months)
            all.push(...(await this.store.readMonth(ym)));
        const path = this.backupPath(tag);
        try {
            await this.writeVaultFile(path, JSON.stringify({
                format: backup_1.BACKUP_FORMAT,
                version: backup_1.BACKUP_VERSION,
                exportedAt: new Date().toISOString(),
                exportedBy: deviceId(),
                vault: this.app.vault.getName(),
                months,
                count: all.length,
                entries: all,
            }));
            if (notify)
                new obsidian_1.Notice((0, i18n_1.L)().noticeBackup(path, all.length));
            return path;
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeBackupFail(err.message));
            return null;
        }
    }
    backupPath(tag = "") {
        const folder = (0, obsidian_1.normalizePath)(this.settings.backupFolder || "归档/统计归档/账本备份");
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        const suffix = tag ? `-${tag}-${time}` : "";
        return (0, obsidian_1.normalizePath)(`${folder}/账本备份 ${(0, store_1.dayKey)(now.getTime())}${suffix}.${deviceId()}.json`);
    }
    async listBackupCandidates() {
        const folder = (0, obsidian_1.normalizePath)(this.settings.backupFolder || "归档/统计归档/账本备份");
        let files = [];
        try {
            files = (await this.adapter.list(folder)).files;
        }
        catch (_a) {
            return [];
        }
        return files
            .map((f) => { var _a; return (_a = f.split("/").pop()) !== null && _a !== void 0 ? _a : ""; })
            .filter((name) => name.toLowerCase().endsWith(".json"))
            .map((name) => {
            const meta = (0, backup_1.backupNameMeta)(name);
            return {
                name,
                path: (0, obsidian_1.normalizePath)(`${folder}/${name}`),
                date: meta === null || meta === void 0 ? void 0 : meta.date,
                device: meta === null || meta === void 0 ? void 0 : meta.device,
            };
        })
            .sort((a, b) => b.name.localeCompare(a.name));
    }
    async restoreLedger() {
        const candidates = await this.listBackupCandidates();
        if (candidates.length === 0) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreEmpty);
            return;
        }
        new backupModal_1.BackupPickerModal(this.app, candidates, (candidate) => {
            void this.importBackup(candidate);
        }).open();
    }
    async importBackup(candidate) {
        let parsed;
        try {
            parsed = (0, backup_1.parseBackup)(await this.adapter.read(candidate.path));
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreInvalid(err.message), 10000);
            return;
        }
        if (parsed.entries.length === 0) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreNoEntries, 10000);
            return;
        }
        const months = await this.store.listLedgerMonths();
        const existing = await this.store.readMonths(months);
        const { fresh, duplicates } = (0, backup_1.filterNewEntries)(parsed.entries, existing);
        if (fresh.length === 0) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreNothing(parsed.entries.length + parsed.bad, duplicates, parsed.bad), 10000);
            return;
        }
        new backupModal_1.RestoreConfirmModal(this.app, {
            fileName: candidate.name,
            parsed,
            fresh: fresh.length,
            duplicates,
            currentDevice: deviceId(),
            currentVault: this.app.vault.getName(),
            onConfirm: () => {
                void this.applyRestore(fresh, parsed, duplicates, months.length > 0);
            },
        }).open();
    }
    async applyRestore(fresh, parsed, duplicates, hadLedger) {
        const safety = hadLedger ? await this.exportLedger(false, "pre-restore") : null;
        if (hadLedger && !safety) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreCancelled, 10000);
            return;
        }
        try {
            const res = await this.store.importEntries(fresh);
            this.invalidate();
            await this.refresh();
            void this.refreshHealth();
            if (this.store.size() === 0)
                await this.rebuild();
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreDone(res.added, duplicates, parsed.bad + res.badLines, safety), 12000);
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeRestoreFail(err.message), 10000);
        }
    }
    async autoBackupLedger() {
        var _a;
        const days = (_a = this.settings.backupIntervalDays) !== null && _a !== void 0 ? _a : 0;
        if (days <= 0)
            return;
        const folder = (0, obsidian_1.normalizePath)(this.settings.backupFolder || "归档/统计归档/账本备份");
        let names = [];
        try {
            names = (await this.adapter.list(folder)).files.map((f) => { var _a; return (_a = f.split("/").pop()) !== null && _a !== void 0 ? _a : ""; });
        }
        catch (_b) {
            names = [];
        }
        if (!(0, backup_1.shouldAutoBackup)(names, days, deviceId()))
            return;
        const path = await this.exportLedger(false);
        if (path)
            new obsidian_1.Notice((0, i18n_1.L)().noticeAutoBackup(path), 6000);
    }
    async ensureFolder(folder) {
        if (!folder || this.app.vault.getAbstractFileByPath(folder))
            return;
        try {
            await this.app.vault.createFolder(folder);
        }
        catch (_a) {
        }
    }
    async writeVaultFile(path, content) {
        const folder = path.split("/").slice(0, -1).join("/");
        await this.ensureFolder(folder);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof obsidian_1.TFile)
            await this.app.vault.modify(existing, content);
        else
            await this.app.vault.create(path, content);
    }
    async checkLedgerHealth() {
        if (this.store.repairs.length > 0) {
            const dropped = this.store.repairs.reduce((n, r) => n + r.dropped, 0);
            new obsidian_1.Notice((0, i18n_1.L)().noticeRepair(dropped), 8000);
            this.store.repairs.length = 0;
        }
        await this.refreshHealth();
    }
    setHealth(a) {
        this.health = {
            ok: a.problems.length === 0,
            problems: a.problems,
            months: a.months.length,
            entries: a.totalEntries,
            checkedAt: Date.now(),
        };
        this.scheduleRefresh(0);
    }
    async refreshHealth() {
        try {
            this.setHealth(await this.store.audit());
        }
        catch (_a) {
            this.health = null;
        }
    }
    async auditLedger() {
        const a = await this.store.audit();
        this.setHealth(a);
        if (a.problems.length === 0) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeAuditOk(a.months.length, a.totalEntries));
            return;
        }
        const lines = [
            `# 账本体检 ${(0, store_1.dayKey)(Date.now())}`,
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
        const path = (0, obsidian_1.normalizePath)(`${folder}/账本体检 ${(0, store_1.dayKey)(Date.now())}.md`);
        try {
            await this.writeVaultFile(path, lines.join("\n"));
            new obsidian_1.Notice((0, i18n_1.L)().noticeAuditBad(a.problems.length, path), 10000);
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.L)().noticeBackupFail(err.message));
        }
    }
    async activateView() {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(view_1.VIEW_TYPE_STATS);
        if (existing.length > 0) {
            await workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = workspace.getRightLeaf(false);
        if (!leaf)
            return;
        await leaf.setViewState({ type: view_1.VIEW_TYPE_STATS, active: true });
        await workspace.revealLeaf(leaf);
    }
    getView() {
        const leaves = this.app.workspace.getLeavesOfType(view_1.VIEW_TYPE_STATS);
        if (leaves.length === 0)
            return null;
        return leaves[0].view;
    }
    async loadSettings() {
        const raw = (await this.loadData());
        this.settings = Object.assign({}, types_1.DEFAULT_SETTINGS, raw !== null && raw !== void 0 ? raw : {});
        if (!Array.isArray(this.settings.excludeFolders)) {
            this.settings.excludeFolders = [...types_1.DEFAULT_SETTINGS.excludeFolders];
        }
        if (!Array.isArray(this.settings.projectRules)) {
            this.settings.projectRules = [];
        }
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    isExcluded(path) {
        return (0, stats_1.isExcludedPath)(path, this.settings);
    }
}
exports.default = AbacusPlugin;

};
__modules["report.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWeeklyReport = buildWeeklyReport;
exports.buildYearReport = buildYearReport;
exports.buildCsv = buildCsv;
const stats_1 = require("./stats");
const n = (v) => Math.round(v).toLocaleString("en-US");
function buildWeeklyReport(i) {
    const lines = [];
    lines.push("---");
    lines.push("tags:");
    lines.push("  - 统计");
    lines.push("  - 周报");
    lines.push(`week: ${i.week}`);
    lines.push("---");
    lines.push("");
    lines.push(`# 周报 ${i.week}`);
    lines.push("");
    lines.push(`${i.weekStartLabel} ~ ${i.weekEndLabel} · 由 Abacus 生成于 ${new Date(i.generatedAt).toLocaleString("zh-CN")}`);
    lines.push("");
    lines.push("## 总览");
    lines.push("");
    lines.push("| 指标 | 汉字 | 英文词 |");
    lines.push("| --- | ---: | ---: |");
    lines.push(`| 本周新增 | ${n(i.add.cjk)} | ${n(i.add.lat)} |`);
    lines.push(`| 本周删改 | −${n(i.del.cjk)} | −${n(i.del.lat)} |`);
    lines.push(`| 净增长 | ${n(i.add.cjk - i.del.cjk)} | ${n(i.add.lat - i.del.lat)} |`);
    lines.push(`| 活跃天数 | ${i.activeDays} / ${i.daily.length} | |`);
    if (i.dailyGoal > 0)
        lines.push(`| 达标天数（≥${n(i.dailyGoal)}字） | ${i.goalDays} / ${i.daily.length} | |`);
    lines.push(`| 连续写作 | ${i.streak} 天 | |`);
    lines.push(`| 全库存量 | ${n(i.total.cjk)} | ${n(i.total.lat)} |`);
    lines.push("");
    lines.push("## 每日");
    lines.push("");
    lines.push("| 日期 | 星期 | 汉字 | 英文词 |");
    lines.push("| --- | --- | ---: | ---: |");
    for (const d of i.daily) {
        const mark = d.vec.cjk + d.vec.lat === 0 ? "·" : n(d.vec.cjk);
        lines.push(`| ${d.date} | ${d.weekday} | ${mark} | ${d.vec.cjk + d.vec.lat === 0 ? "·" : n(d.vec.lat)} |`);
    }
    lines.push("");
    if (i.projects.length > 0) {
        lines.push("## 项目");
        lines.push("");
        lines.push("| 项目 | 汉字 | 英文词 |");
        lines.push("| --- | ---: | ---: |");
        for (const p of i.projects) {
            lines.push(`| ${p.name} | ${n(p.vec.cjk)} | ${n(p.vec.lat)} |`);
        }
        lines.push("");
    }
    if (i.topFiles.length > 0) {
        lines.push("## 本周改动最多的文件");
        lines.push("");
        lines.push("| 文件 | 汉字 | 英文词 |");
        lines.push("| --- | ---: | ---: |");
        for (const f of i.topFiles) {
            lines.push(`| ${linkFor(f.path)} | ${n(f.vec.cjk)} | ${n(f.vec.lat)} |`);
        }
        lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push(`> 账本口径：只计「新增」，删改单列。数据目录 \`.obsidian/plugins/abacus/stats/\`。`);
    lines.push("");
    return lines.join("\n");
}
function linkFor(path) {
    const clean = path.replace(/\.md$/i, "");
    return `[[${clean}]]`;
}
function heatmapHtml(daily, year) {
    const first = new Date(year, 0, 1);
    const shift = (first.getDay() + 6) % 7;
    const cursor = new Date(year, 0, 1 - shift);
    const end = new Date(year, 11, 31);
    const weeks = [];
    const cells = Array.from({ length: 7 }, () => []);
    while (cursor <= end) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const ts = cursor.getTime();
            const inYear = cursor.getFullYear() === year;
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
            const v = inYear ? daily[key] : undefined;
            const lv = v ? (0, stats_1.heatLevel)(v) : -1;
            if (lv < 0) {
                week.push('<div style="width:11px;height:11px"></div>');
            }
            else {
                const opacity = [0.08, 0.28, 0.5, 0.72, 1][lv];
                const tip = v ? `${key}　汉字 ${v.cjk}　英文词 ${v.lat}` : `${key}　无记录`;
                week.push(`<div title="${tip}" style="width:11px;height:11px;border-radius:2px;background:var(--interactive-accent);opacity:${opacity}"></div>`);
            }
            cursor.setDate(cursor.getDate() + 1);
        }
        weeks.push(`<div style="display:flex;flex-direction:column;gap:3px">${week.join("")}</div>`);
    }
    return [
        '<div style="display:flex;gap:3px;overflow-x:auto;padding:6px 0">',
        weeks.join(""),
        "</div>",
        '<div style="color:var(--text-faint);font-size:0.8em">单元格悬停看当天数字；颜色越深写得越多。</div>',
    ].join("\n");
}
function buildYearReport(i) {
    const lines = [];
    const perDay = i.activeDays > 0 ? Math.round(i.add.cjk / i.activeDays) : 0;
    lines.push("---");
    lines.push("tags:");
    lines.push("  - 统计");
    lines.push("  - 年度报告");
    lines.push(`year: ${i.year}`);
    lines.push("---");
    lines.push("");
    lines.push(`# ${i.year} 年度报告`);
    lines.push("");
    lines.push(`由 Abacus 生成于 ${new Date(i.generatedAt).toLocaleString("zh-CN")}`);
    lines.push("");
    lines.push("## 总览");
    lines.push("");
    lines.push("| 指标 | 汉字 | 英文词 |");
    lines.push("| --- | ---: | ---: |");
    lines.push(`| 全年新增 | ${n(i.add.cjk)} | ${n(i.add.lat)} |`);
    lines.push(`| 全年删改 | −${n(i.del.cjk)} | −${n(i.del.lat)} |`);
    lines.push(`| 净增长 | ${n(i.add.cjk - i.del.cjk)} | ${n(i.add.lat - i.del.lat)} |`);
    lines.push(`| 活跃天数 | ${i.activeDays} / 365 | |`);
    lines.push(`| 写作日均 | ${n(perDay)} 汉字 | |`);
    lines.push(`| 最长连续 | ${i.longestStreak} 天 | |`);
    if (i.bestDay) {
        lines.push(`| 最高产一天 | ${i.bestDay.date}（${n(i.bestDay.vec.cjk)} 汉字） | |`);
    }
    lines.push("");
    lines.push("## 热力图");
    lines.push("");
    lines.push(heatmapHtml(i.daily, i.year));
    lines.push("");
    lines.push("## 逐月");
    lines.push("");
    lines.push("| 月份 | 汉字 | 英文词 | 活跃天数 |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const m of i.months) {
        lines.push(`| ${m.month} 月 | ${n(m.vec.cjk)} | ${n(m.vec.lat)} | ${m.activeDays} |`);
    }
    lines.push("");
    if (i.projects.length > 0) {
        lines.push("## 项目");
        lines.push("");
        lines.push("| 项目 | 汉字 | 英文词 |");
        lines.push("| --- | ---: | ---: |");
        for (const p of i.projects)
            lines.push(`| ${p.name} | ${n(p.vec.cjk)} | ${n(p.vec.lat)} |`);
        lines.push("");
    }
    if (i.topFiles.length > 0) {
        lines.push("## 改动最多的文件");
        lines.push("");
        lines.push("| 文件 | 汉字 | 英文词 |");
        lines.push("| --- | ---: | ---: |");
        for (const f of i.topFiles)
            lines.push(`| ${linkFor(f.path)} | ${n(f.vec.cjk)} | ${n(f.vec.lat)} |`);
        lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push("> 只计「新增」，删改单列。账本是唯一数据源，这份报告可以随时重新生成。");
    lines.push("");
    return lines.join("\n");
}
function buildCsv(rows) {
    const out = ["日期,汉字新增,英文词新增,汉字删改,英文词删改,事件数"];
    for (const r of rows) {
        out.push(`${r.date},${r.add.cjk},${r.add.lat},${r.del.cjk},${r.del.lat},${r.entries}`);
    }
    return out.join("\n") + "\n";
}

};
__modules["scanner.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scanner = void 0;
const types_1 = require("./types");
const counter_1 = require("./counter");
const stats_1 = require("./stats");
const TEXT_CACHE_LIMIT = 32;
class Scanner {
    constructor(io, store, getSettings, cb = {}) {
        this.io = io;
        this.store = store;
        this.getSettings = getSettings;
        this.cb = cb;
        this.timers = new Map();
        this.textCache = new Map();
        this.scanning = false;
    }
    get isScanning() {
        return this.scanning;
    }
    isExcluded(path) {
        return (0, stats_1.isExcludedPath)(path, this.getSettings());
    }
    async fullScan(rebaseline = false) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (this.scanning)
            return { files: 0, changed: 0, baseline: false };
        this.scanning = true;
        const opts = this.getSettings();
        if (rebaseline)
            this.store.clear();
        const firstRun = this.store.size() === 0;
        const files = this.io.listFiles().filter((f) => !this.isExcluded(f.path));
        const seen = new Set();
        const entries = [];
        let changed = 0;
        let done = 0;
        try {
            for (const f of files) {
                seen.add(f.path);
                const rec = this.store.get(f.path);
                done++;
                if (rec && rec.size === f.size && rec.mtime === f.mtime) {
                    if (done % 200 === 0)
                        (_b = (_a = this.cb).onProgress) === null || _b === void 0 ? void 0 : _b.call(_a, done, files.length);
                    continue;
                }
                const text = await this.io.readFile(f.path);
                const v = (0, counter_1.countMarkdown)(text, opts);
                changed++;
                if (rec) {
                    const { add, del } = this.splitDelta(rec.vec, v);
                    if (!(0, types_1.isZeroVec)(add) || !(0, types_1.isZeroVec)(del)) {
                        entries.push({ t: Date.now(), p: f.path, add: toTuple(add), del: toTuple(del), src: "scan" });
                    }
                }
                else if (!firstRun) {
                    entries.push({
                        t: Date.now(),
                        p: f.path,
                        add: toTuple(v),
                        del: [0, 0],
                        src: "scan",
                    });
                }
                this.store.set(f.path, { size: f.size, mtime: f.mtime, vec: v });
                if (this.textCache.size < TEXT_CACHE_LIMIT)
                    this.textCache.set(f.path, text);
                if (done % 50 === 0) {
                    (_d = (_c = this.cb).onProgress) === null || _d === void 0 ? void 0 : _d.call(_c, done, files.length);
                    await yieldToUi();
                }
            }
            for (const [path, rec] of this.store.entries()) {
                if (seen.has(path))
                    continue;
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
            (_f = (_e = this.cb).onProgress) === null || _f === void 0 ? void 0 : _f.call(_e, files.length, files.length);
            return { files: files.length, changed, baseline: firstRun };
        }
        finally {
            this.scanning = false;
            (_h = (_g = this.cb).onChange) === null || _h === void 0 ? void 0 : _h.call(_g);
        }
    }
    scheduleEdit(path) {
        if (this.isExcluded(path))
            return;
        const old = this.timers.get(path);
        if (old !== undefined)
            window.clearTimeout(old);
        const settings = this.getSettings();
        const timer = window.setTimeout(() => {
            this.timers.delete(path);
            void this.processEdit(path);
        }, Math.max(100, settings.debounceMs));
        this.timers.set(path, timer);
    }
    handleRename(oldPath, newPath) {
        var _a, _b;
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
        (_b = (_a = this.cb).onChange) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    async handleDelete(path) {
        var _a, _b;
        const rec = this.store.remove(path);
        this.textCache.delete(path);
        if (!rec)
            return;
        await this.store.append([
            { t: Date.now(), p: path, add: [0, 0], del: toTuple(rec.vec), src: "delete" },
        ]);
        await this.store.saveSnapshot();
        (_b = (_a = this.cb).onChange) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    async flush() {
        for (const [, timer] of this.timers)
            window.clearTimeout(timer);
        this.timers.clear();
        await this.store.saveSnapshot();
    }
    async processEdit(path) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const opts = this.getSettings();
        let text;
        try {
            text = await this.io.readFile(path);
        }
        catch (_l) {
            return;
        }
        const v = (0, counter_1.countMarkdown)(text, opts);
        const rec = this.store.get(path);
        const prevText = this.textCache.get(path);
        let add;
        let del;
        if (prevText !== undefined) {
            const d = (0, counter_1.diffCounts)(prevText, text, opts);
            add = d.add;
            del = d.del;
        }
        else if (rec) {
            const d = this.splitDelta(rec.vec, v);
            add = d.add;
            del = d.del;
        }
        else {
            add = v;
            del = (0, types_1.vec)(0, 0);
        }
        this.textCache.set(path, text);
        if (this.textCache.size > TEXT_CACHE_LIMIT) {
            const first = this.textCache.keys().next().value;
            if (first !== undefined && first !== path)
                this.textCache.delete(first);
        }
        try {
            const stat = this.io.listFiles().find((f) => f.path === path);
            this.store.set(path, {
                size: (_b = (_a = stat === null || stat === void 0 ? void 0 : stat.size) !== null && _a !== void 0 ? _a : rec === null || rec === void 0 ? void 0 : rec.size) !== null && _b !== void 0 ? _b : 0,
                mtime: (_d = (_c = stat === null || stat === void 0 ? void 0 : stat.mtime) !== null && _c !== void 0 ? _c : rec === null || rec === void 0 ? void 0 : rec.mtime) !== null && _d !== void 0 ? _d : 0,
                vec: v,
            });
        }
        catch (_m) {
            this.store.set(path, { size: (_e = rec === null || rec === void 0 ? void 0 : rec.size) !== null && _e !== void 0 ? _e : 0, mtime: (_f = rec === null || rec === void 0 ? void 0 : rec.mtime) !== null && _f !== void 0 ? _f : 0, vec: v });
        }
        if (!(0, types_1.isZeroVec)(add) || !(0, types_1.isZeroVec)(del)) {
            await this.store.append([
                { t: Date.now(), p: path, add: toTuple(add), del: toTuple(del), src: "edit" },
            ]);
            (_h = (_g = this.cb).onCounted) === null || _h === void 0 ? void 0 : _h.call(_g, path, v);
        }
        this.store.scheduleSave();
        (_k = (_j = this.cb).onChange) === null || _k === void 0 ? void 0 : _k.call(_j);
    }
    splitDelta(prev, next) {
        const d = (0, types_1.subVec)(next, prev);
        return {
            add: (0, types_1.vec)(Math.max(0, d.cjk), Math.max(0, d.lat)),
            del: (0, types_1.vec)(Math.max(0, -d.cjk), Math.max(0, -d.lat)),
        };
    }
}
exports.Scanner = Scanner;
function toTuple(v) {
    return [v.cjk, v.lat];
}
function yieldToUi() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
}

};
__modules["settings.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsSettingTab = void 0;
const obsidian_1 = require("obsidian");
const stats_1 = require("./stats");
const i18n_1 = require("./i18n");
class StatsSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        const s = this.plugin.settings;
        const t = (0, i18n_1.L)();
        containerEl.createEl("h3", { text: t.sCounter });
        containerEl.createEl("p", { cls: "setting-item-description", text: t.sCounterDesc });
        new obsidian_1.Setting(containerEl)
            .setName(t.sFrontmatter)
            .setDesc(t.sFrontmatterDesc)
            .addToggle((c) => c.setValue(s.countFrontmatter).onChange(async (v) => {
            s.countFrontmatter = v;
            await this.plugin.applySettings(["counter"]);
        }));
        new obsidian_1.Setting(containerEl)
            .setName(t.sCode)
            .setDesc(t.sCodeDesc)
            .addToggle((c) => c.setValue(s.countCodeBlocks).onChange(async (v) => {
            s.countCodeBlocks = v;
            await this.plugin.applySettings(["counter"]);
        }));
        new obsidian_1.Setting(containerEl)
            .setName(t.sExclude)
            .setDesc(t.sExcludeDesc)
            .addTextArea((c) => {
            c.setValue(s.excludeFolders.join("\n"));
            c.inputEl.rows = 4;
            c.inputEl.addClass("scs-textarea");
            c.onChange(async (v) => {
                s.excludeFolders = v
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean);
                await this.plugin.applySettings(["scan"]);
            });
        });
        containerEl.createEl("h3", { text: t.sProps });
        containerEl.createEl("p", { cls: "setting-item-description", text: t.sPropsDesc });
        new obsidian_1.Setting(containerEl)
            .setName(t.sWriteProp)
            .setDesc(t.sWritePropDesc)
            .addToggle((c) => c.setValue(s.writeFrontmatter).onChange(async (v) => {
            s.writeFrontmatter = v;
            await this.plugin.applySettings(["display"]);
        }));
        new obsidian_1.Setting(containerEl)
            .setName(t.sPropKey)
            .setDesc(t.sPropKeyDesc)
            .addText((c) => c
            .setPlaceholder("words")
            .setValue(s.frontmatterKey)
            .onChange(async (v) => {
            s.frontmatterKey = v.trim() || "words";
            await this.plugin.applySettings(["display"]);
        }));
        containerEl.createEl("h3", { text: t.sDisplay });
        new obsidian_1.Setting(containerEl)
            .setName(t.sLatinPrimary)
            .setDesc(t.sLatinPrimaryDesc)
            .addToggle((c) => c.setValue(s.includeLatinInPrimary).onChange(async (v) => {
            s.includeLatinInPrimary = v;
            await this.plugin.applySettings(["display"]);
        }));
        containerEl.createEl("h3", { text: t.sGoals });
        containerEl.createEl("p", { cls: "setting-item-description", text: t.sGoalsDesc });
        new obsidian_1.Setting(containerEl).setName(t.sDailyGoal).addText((c) => {
            var _a;
            c.inputEl.type = "number";
            c.setPlaceholder("0")
                .setValue(String((_a = s.dailyGoal) !== null && _a !== void 0 ? _a : 0))
                .onChange(async (v) => {
                s.dailyGoal = Math.max(0, Math.floor(Number(v) || 0));
                await this.plugin.applySettings(["display"]);
            });
        });
        new obsidian_1.Setting(containerEl).setName(t.sWeeklyGoal).addText((c) => {
            var _a;
            c.inputEl.type = "number";
            c.setPlaceholder("0")
                .setValue(String((_a = s.weeklyGoal) !== null && _a !== void 0 ? _a : 0))
                .onChange(async (v) => {
                s.weeklyGoal = Math.max(0, Math.floor(Number(v) || 0));
                await this.plugin.applySettings(["display"]);
            });
        });
        containerEl.createEl("h3", { text: t.sProject });
        containerEl.createEl("p", { cls: "setting-item-description", text: t.sProjectDesc });
        new obsidian_1.Setting(containerEl).setName(t.sRules).addTextArea((c) => {
            c.setPlaceholder("小说1 = 创作/小说/1\n设定集 = 创作/设定集");
            c.setValue(s.projectRules.join("\n"));
            c.inputEl.rows = 5;
            c.inputEl.addClass("scs-textarea");
            c.onChange(async (v) => {
                s.projectRules = v
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean);
                await this.plugin.applySettings(["display"]);
            });
        });
        containerEl.createEl("h3", { text: t.sReport });
        new obsidian_1.Setting(containerEl)
            .setName(t.sYearReport)
            .setDesc(t.sYearReportDesc)
            .addButton((b) => b.setButtonText(t.sGenerate).onClick(() => void this.plugin.writeYearReport()));
        new obsidian_1.Setting(containerEl)
            .setName(t.sCsv)
            .setDesc(t.sCsvDesc)
            .addButton((b) => b.setButtonText(t.sExport).onClick(() => void this.plugin.exportCsv()));
        new obsidian_1.Setting(containerEl)
            .setName(t.sWeekly)
            .setDesc(t.sWeeklyDesc)
            .addButton((b) => b.setButtonText(t.sGenerate).onClick(() => void this.plugin.generateReport((0, stats_1.startOfWeek)(Date.now()), true)));
        new obsidian_1.Setting(containerEl)
            .setName(t.sAutoWeekly)
            .setDesc(t.sAutoWeeklyDesc)
            .addToggle((c) => c.setValue(s.autoWeeklyReport).onChange(async (v) => {
            s.autoWeeklyReport = v;
            await this.plugin.applySettings(["display"]);
        }));
        new obsidian_1.Setting(containerEl)
            .setName(t.sReportFolder)
            .setDesc(t.sReportFolderDesc)
            .addText((c) => c
            .setPlaceholder("归档/统计归档")
            .setValue(s.reportFolder)
            .onChange(async (v) => {
            s.reportFolder = v.trim() || "归档/统计归档";
            await this.plugin.applySettings(["scan"]);
        }));
        containerEl.createEl("h3", { text: t.sData });
        containerEl.createEl("p", { cls: "setting-item-description", text: t.sDataDesc });
        new obsidian_1.Setting(containerEl)
            .setName(t.sRebuild)
            .addButton((b) => b.setButtonText(t.sRebuildBtn).onClick(() => void this.plugin.rebuild()));
        new obsidian_1.Setting(containerEl)
            .setName(t.sBackup)
            .setDesc(t.sBackupDesc)
            .addButton((b) => b.setButtonText(t.sExport).onClick(() => void this.plugin.exportLedger()));
        new obsidian_1.Setting(containerEl)
            .setName(t.sRestore)
            .setDesc(t.sRestoreDesc)
            .addButton((b) => b.setButtonText(t.sRestoreBtn).onClick(() => void this.plugin.restoreLedger()));
        new obsidian_1.Setting(containerEl).setName(t.sBackupFolder).addText((c) => c
            .setPlaceholder("归档/统计归档/账本备份")
            .setValue(s.backupFolder)
            .onChange(async (v) => {
            s.backupFolder = v.trim() || "归档/统计归档/账本备份";
            await this.plugin.applySettings(["display"]);
        }));
        new obsidian_1.Setting(containerEl)
            .setName(t.sAutoBackup)
            .setDesc(t.sAutoBackupDesc)
            .addText((c) => {
            var _a;
            c.inputEl.type = "number";
            c.setPlaceholder("7")
                .setValue(String((_a = s.backupIntervalDays) !== null && _a !== void 0 ? _a : 0))
                .onChange(async (v) => {
                s.backupIntervalDays = Math.max(0, Math.floor(Number(v) || 0));
                await this.plugin.applySettings(["display"]);
            });
        });
    }
}
exports.StatsSettingTab = StatsSettingTab;

};
__modules["stats.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySum = emptySum;
exports.addToSum = addToSum;
exports.sumWriting = sumWriting;
exports.sumDeletions = sumDeletions;
exports.sumByMonth = sumByMonth;
exports.cumulativeByMonth = cumulativeByMonth;
exports.byDay = byDay;
exports.daysWithWriting = daysWithWriting;
exports.heatLevel = heatLevel;
exports.buildYearHeatmap = buildYearHeatmap;
exports.streakFrom = streakFrom;
exports.parseProjectRules = parseProjectRules;
exports.projectOf = projectOf;
exports.isExcludedPath = isExcludedPath;
exports.startOfDay = startOfDay;
exports.startOfWeek = startOfWeek;
exports.startOfMonth = startOfMonth;
exports.addDays = addDays;
exports.monthsBetween = monthsBetween;
exports.isWritingEntry = isWritingEntry;
exports.isoWeek = isoWeek;
exports.fmtDate = fmtDate;
exports.weekdayCN = weekdayCN;
const types_1 = require("./types");
const store_1 = require("./store");
const WRITE_SRC = new Set(["edit", "scan"]);
function emptySum() {
    return { add: (0, types_1.vec)(0, 0), del: (0, types_1.vec)(0, 0), n: 0 };
}
function addToSum(sum, e) {
    return {
        add: (0, types_1.addVec)(sum.add, (0, types_1.vec)(e.add[0], e.add[1])),
        del: (0, types_1.addVec)(sum.del, (0, types_1.vec)(e.del[0], e.del[1])),
        n: sum.n + 1,
    };
}
function sumWriting(entries, from, to) {
    let s = emptySum();
    for (const e of entries) {
        if (e.t < from || e.t >= to)
            continue;
        if (!WRITE_SRC.has(e.src))
            continue;
        s = addToSum(s, e);
    }
    return s;
}
function sumDeletions(entries, from, to) {
    let s = emptySum();
    for (const e of entries) {
        if (e.t < from || e.t >= to)
            continue;
        if (e.src !== "delete")
            continue;
        s = addToSum(s, e);
    }
    return s;
}
function sumByMonth(entries, year, now = Date.now()) {
    const out = [];
    for (let m = 0; m < 12; m++) {
        const from = new Date(year, m, 1).getTime();
        const to = new Date(year, m + 1, 1).getTime();
        out.push(sumWriting(entries, from, Math.min(to, now + 1)).add);
    }
    return out;
}
function cumulativeByMonth(entries, now = Date.now()) {
    var _a, _b;
    const byMonth = new Map();
    let first = Infinity;
    for (const e of entries) {
        if (e.t > now)
            continue;
        if (!WRITE_SRC.has(e.src))
            continue;
        const key = (0, store_1.monthKey)(e.t);
        byMonth.set(key, (0, types_1.addVec)((_a = byMonth.get(key)) !== null && _a !== void 0 ? _a : types_1.ZERO, (0, types_1.vec)(e.add[0], e.add[1])));
        if (e.t < first)
            first = e.t;
    }
    if (!Number.isFinite(first))
        return [];
    const start = new Date(first);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(1);
    end.setHours(0, 0, 0, 0);
    const out = [];
    let total = (0, types_1.vec)(0, 0);
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
        const key = (0, store_1.monthKey)(cursor.getTime());
        const add = (_b = byMonth.get(key)) !== null && _b !== void 0 ? _b : types_1.ZERO;
        total = (0, types_1.addVec)(total, add);
        out.push({ month: key, add, total });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
}
function byDay(entries) {
    var _a;
    const out = new Map();
    for (const e of entries) {
        if (!WRITE_SRC.has(e.src))
            continue;
        const k = (0, store_1.dayKey)(e.t);
        const cur = (_a = out.get(k)) !== null && _a !== void 0 ? _a : (0, types_1.vec)(0, 0);
        out.set(k, (0, types_1.addVec)(cur, (0, types_1.vec)(e.add[0], e.add[1])));
    }
    return out;
}
function daysWithWriting(entries) {
    const out = new Set();
    for (const e of entries) {
        if (!WRITE_SRC.has(e.src))
            continue;
        if ((0, types_1.isZeroVec)((0, types_1.vec)(e.add[0], e.add[1])))
            continue;
        out.add((0, store_1.dayKey)(e.t));
    }
    return out;
}
const HEAT_THRESHOLDS = [200, 500, 1000];
function heatLevel(v) {
    const total = v.cjk + v.lat;
    if (total <= 0)
        return 0;
    let lv = 1;
    for (let i = 0; i < HEAT_THRESHOLDS.length; i++) {
        if (total >= HEAT_THRESHOLDS[i])
            lv = i + 2;
    }
    return lv;
}
function buildYearHeatmap(year, daily, now = Date.now()) {
    var _a;
    const yearStart = new Date(year, 0, 1).getTime();
    const shift = (new Date(yearStart).getDay() + 6) % 7;
    const gridStart = addDays(yearStart, -shift);
    const lastDay = new Date(year, 11, 31).getTime();
    const spanDays = Math.round((lastDay - gridStart) / 86400000) + 1;
    const weeks = Math.ceil(spanDays / 7);
    const todayKey = (0, store_1.dayKey)(now);
    const days = [];
    const months = [];
    for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
            const ts = addDays(gridStart, w * 7 + d);
            const dt = new Date(ts);
            const inYear = dt.getFullYear() === year;
            const future = ts > now;
            const key = (0, store_1.dayKey)(ts);
            days.push({
                day: key,
                vec: inYear && !future ? (_a = daily.get(key)) !== null && _a !== void 0 ? _a : types_1.ZERO : types_1.ZERO,
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
function streakFrom(days, today = Date.now()) {
    let n = 0;
    const base = startOfDay(today);
    for (let i = 0; i < 3650; i++) {
        const key = (0, store_1.dayKey)(addDays(base, -i));
        if (days.has(key)) {
            n++;
        }
        else if (i === 0) {
            continue;
        }
        else {
            break;
        }
    }
    return n;
}
function parseProjectRules(lines) {
    var _a;
    const out = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const eq = line.indexOf("=");
        if (eq === -1) {
            const prefix = normalizePrefix(line);
            if (!prefix)
                continue;
            out.push({ name: (_a = prefix.split("/").pop()) !== null && _a !== void 0 ? _a : prefix, prefix });
        }
        else {
            const name = line.slice(0, eq).trim();
            const prefix = normalizePrefix(line.slice(eq + 1));
            if (!name || !prefix)
                continue;
            out.push({ name, prefix });
        }
    }
    return out.sort((a, b) => b.prefix.length - a.prefix.length);
}
function normalizePrefix(s) {
    return s
        .trim()
        .replace(/^\/+|\/+$/g, "")
        .replace(/\\/g, "/");
}
function projectOf(path, rules, depth = 2) {
    for (const r of rules) {
        if (path === r.prefix || path.startsWith(r.prefix + "/"))
            return r.name;
    }
    const parts = path.split("/");
    if (parts.length <= 1)
        return "（根目录）";
    return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}
function isExcludedPath(path, settings) {
    var _a;
    const prefixes = [...((_a = settings.excludeFolders) !== null && _a !== void 0 ? _a : [])];
    if (settings.reportFolder)
        prefixes.push(settings.reportFolder);
    for (const raw of prefixes) {
        const f = normalizePrefix(raw);
        if (!f)
            continue;
        if (path === f || path.startsWith(f + "/"))
            return true;
    }
    return false;
}
function startOfDay(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function startOfWeek(ts = Date.now()) {
    const d = new Date(startOfDay(ts));
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.getTime();
}
function startOfMonth(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d.getTime();
}
function addDays(ts, n) {
    const d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
}
function monthsBetween(from, to) {
    const out = [];
    const d = new Date(from);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() < to) {
        out.push((0, store_1.monthKey)(d.getTime()));
        d.setMonth(d.getMonth() + 1);
    }
    if (out.length === 0)
        out.push((0, store_1.monthKey)(to));
    return out;
}
function isWritingEntry(e) {
    return WRITE_SRC.has(e.src) && !(0, types_1.isZeroVec)((0, types_1.vec)(e.add[0], e.add[1]));
}
function isoWeek(ts = Date.now()) {
    const d = new Date(ts);
    const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
    return `${target.getUTCFullYear()}-W${`${week}`.padStart(2, "0")}`;
}
function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${`${d.getDate()}`.padStart(2, "0")}`;
}
function weekdayCN(ts) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(ts).getDay()];
}

};
__modules["store.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZERO = exports.StatsStore = void 0;
exports.parseLedgerReport = parseLedgerReport;
exports.parseLedger = parseLedger;
exports.dedupeEntries = dedupeEntries;
exports.repairTail = repairTail;
exports.monthKey = monthKey;
exports.dayKey = dayKey;
const types_1 = require("./types");
Object.defineProperty(exports, "ZERO", { enumerable: true, get: function () { return types_1.ZERO; } });
const SNAPSHOT_REL = "stats/snapshot.json";
const LEDGER_REL = "stats/ledger";
class StatsStore {
    constructor(baseDir, adapter, opts = {}) {
        this.baseDir = baseDir;
        this.adapter = adapter;
        this.opts = opts;
        this.records = new Map();
        this.loaded = false;
        this.saveTimer = null;
        this.lastSize = new Map();
        this.repairs = [];
    }
    get snapshotVersion() {
        var _a;
        return (_a = this.opts.version) !== null && _a !== void 0 ? _a : 1;
    }
    get deviceId() {
        return this.opts.deviceId || "local";
    }
    get isLoaded() {
        return this.loaded;
    }
    clear() {
        this.records.clear();
    }
    entries() {
        return [...this.records.entries()];
    }
    get(path) {
        return this.records.get(path);
    }
    size() {
        return this.records.size;
    }
    set(path, rec) {
        this.records.set(path, rec);
    }
    remove(path) {
        const r = this.records.get(path);
        this.records.delete(path);
        return r;
    }
    rename(oldPath, newPath) {
        const r = this.records.get(oldPath);
        if (!r)
            return;
        this.records.delete(oldPath);
        this.records.set(newPath, r);
    }
    total() {
        let cjk = 0;
        let lat = 0;
        for (const [, r] of this.records) {
            cjk += r.vec.cjk;
            lat += r.vec.lat;
        }
        return (0, types_1.vec)(cjk, lat);
    }
    async load() {
        var _a, _b;
        try {
            const raw = await this.adapter.read(this.path(SNAPSHOT_REL));
            const data = JSON.parse(raw);
            if (data === null || data === void 0 ? void 0 : data.files) {
                for (const [path, r] of Object.entries(data.files)) {
                    if (!r || !Array.isArray(r.c))
                        continue;
                    this.records.set(path, { size: (_a = r.s) !== null && _a !== void 0 ? _a : 0, mtime: (_b = r.m) !== null && _b !== void 0 ? _b : 0, vec: (0, types_1.vec)(r.c[0], r.c[1]) });
                }
            }
        }
        catch (_c) {
        }
        this.loaded = true;
    }
    async saveSnapshot() {
        const files = {};
        for (const [path, r] of this.records) {
            files[path] = { s: r.size, m: r.mtime, c: [r.vec.cjk, r.vec.lat] };
        }
        const payload = JSON.stringify({ version: this.snapshotVersion, updatedAt: Date.now(), files });
        await this.ensureDir("stats");
        await this.adapter.write(this.path(SNAPSHOT_REL), payload);
    }
    scheduleSave(delay = 30000) {
        if (this.saveTimer !== null)
            window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.saveSnapshot();
        }, delay);
    }
    async flushSave() {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.loaded)
            await this.saveSnapshot();
    }
    async append(entries) {
        if (entries.length === 0)
            return;
        const byMonth = new Map();
        for (const e of entries) {
            if ((0, types_1.isZeroVec)((0, types_1.vec)(e.add[0], e.add[1])) && (0, types_1.isZeroVec)((0, types_1.vec)(e.del[0], e.del[1])))
                continue;
            const ym = monthKey(e.t);
            const line = JSON.stringify(e);
            const arr = byMonth.get(ym);
            if (arr)
                arr.push(line);
            else
                byMonth.set(ym, [line]);
        }
        if (byMonth.size === 0)
            return;
        await this.ensureDir("stats");
        await this.ensureDir(LEDGER_REL);
        for (const [ym, lines] of byMonth) {
            const full = this.path(this.ledgerPath(ym));
            const payload = lines.join("\n") + "\n";
            if (await this.tryFastAppend(full, payload))
                continue;
            let prev = "";
            try {
                prev = await this.adapter.read(full);
            }
            catch (_a) {
                prev = "";
            }
            const { text, dropped } = repairTail(prev);
            if (dropped > 0)
                this.repairs.push({ ym, dropped });
            await this.adapter.write(full, text + payload);
            await this.rememberSize(full);
        }
    }
    async tryFastAppend(full, payload) {
        if (!this.adapter.append || !this.adapter.stat)
            return false;
        const expected = this.lastSize.get(full);
        if (expected === undefined)
            return false;
        const st = await this.adapter.stat(full);
        if (!st || st.size !== expected)
            return false;
        await this.adapter.append(full, payload);
        await this.rememberSize(full);
        return true;
    }
    async rememberSize(full) {
        if (!this.adapter.stat)
            return;
        const st = await this.adapter.stat(full);
        if (st)
            this.lastSize.set(full, st.size);
    }
    async readMonth(ym) {
        const files = await this.listMonthFiles(ym);
        if (files.length === 0)
            return [];
        const out = [];
        for (const name of files) {
            try {
                out.push(...parseLedger(await this.adapter.read(this.path(`${LEDGER_REL}/${name}`))));
            }
            catch (_a) {
            }
        }
        return dedupeEntries(out);
    }
    async readMonths(yms) {
        const out = [];
        for (const ym of yms)
            out.push(...(await this.readMonth(ym)));
        return out;
    }
    async importEntries(entries) {
        if (entries.length === 0)
            return { added: 0, months: [], badLines: 0 };
        const byMonth = new Map();
        for (const e of entries) {
            const ym = monthKey(e.t);
            const arr = byMonth.get(ym);
            if (arr)
                arr.push(e);
            else
                byMonth.set(ym, [e]);
        }
        await this.ensureDir("stats");
        await this.ensureDir(LEDGER_REL);
        let added = 0;
        let badLines = 0;
        const months = [];
        for (const [ym, incoming] of byMonth) {
            const full = this.path(`${LEDGER_REL}/${ym}.imported.${this.deviceId}.jsonl`);
            let prev = [];
            try {
                const parsed = parseLedgerReport(await this.adapter.read(full));
                prev = parsed.entries;
                badLines += parsed.bad;
            }
            catch (_a) {
                prev = [];
            }
            const existing = dedupeEntries(prev);
            const merged = dedupeEntries([...existing, ...incoming]);
            const fresh = merged.length - existing.length;
            if (fresh <= 0)
                continue;
            merged.sort((a, b) => a.t - b.t);
            await this.adapter.write(full, merged.map((e) => JSON.stringify(e)).join("\n") + "\n");
            added += fresh;
            months.push(ym);
        }
        return { added, months, badLines };
    }
    async listMonthFiles(ym) {
        const re = new RegExp(`^${ym}(\\..+)?\\.jsonl$`);
        return (await this.listLedgerFiles()).filter((f) => re.test(f));
    }
    async listLedgerFiles() {
        try {
            const res = await this.adapter.list(this.path(LEDGER_REL));
            return res.files
                .map((f) => { var _a; return (_a = f.split("/").pop()) !== null && _a !== void 0 ? _a : ""; })
                .filter((f) => /^\d{4}-\d{2}(\..+)?\.jsonl$/.test(f))
                .sort();
        }
        catch (_a) {
            return [];
        }
    }
    async listLedgerMonths() {
        const set = new Set();
        for (const f of await this.listLedgerFiles())
            set.add(f.slice(0, 7));
        return [...set].sort();
    }
    async audit(months) {
        const list = months !== null && months !== void 0 ? months : (await this.listLedgerMonths());
        const now = Date.now();
        const seen = new Set();
        const result = {
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
                }
                catch (_a) {
                    continue;
                }
                if (raw.length > 0 && !raw.endsWith("\n"))
                    result.truncated.push(name);
                const parsed = parseLedgerReport(raw);
                result.badLines += parsed.bad;
                result.totalEntries += parsed.entries.length;
                for (const e of parsed.entries) {
                    const key = (0, types_1.entryKey)(e);
                    if (seen.has(key))
                        result.duplicates++;
                    else
                        seen.add(key);
                    if (e.t > now + 3600000)
                        result.future++;
                    if (result.first === null || e.t < result.first)
                        result.first = e.t;
                    if (result.last === null || e.t > result.last)
                        result.last = e.t;
                }
            }
        }
        if (result.badLines > 0)
            result.problems.push(`${result.badLines} 行无法解析（同步冲突或写入被截断）`);
        if (result.truncated.length > 0) {
            result.problems.push(`末尾缺换行：${result.truncated.join("、")}（疑似被截断，下次追加会自动修复）`);
        }
        if (result.duplicates > 0)
            result.problems.push(`${result.duplicates} 条重复事件（统计时已按一条计算）`);
        if (result.future > 0)
            result.problems.push(`${result.future} 条时间戳在未来（时钟或时区不正确）`);
        return result;
    }
    path(rel) {
        const base = this.baseDir.replace(/\/+$/, "");
        return base ? `${base}/${rel}` : rel;
    }
    ledgerPath(ym) {
        return `${LEDGER_REL}/${ym}.${this.deviceId}.jsonl`;
    }
    async ensureDir(rel) {
        const p = this.path(rel);
        try {
            if (!(await this.adapter.exists(p)))
                await this.adapter.mkdir(p);
        }
        catch (_a) {
        }
    }
}
exports.StatsStore = StatsStore;
function parseLedgerReport(raw) {
    const entries = [];
    let bad = 0;
    if (!raw)
        return { entries, bad };
    for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s)
            continue;
        try {
            const e = JSON.parse(s);
            if (typeof e.t === "number" && typeof e.p === "string" && Array.isArray(e.add) && Array.isArray(e.del)) {
                entries.push(e);
            }
            else {
                bad++;
            }
        }
        catch (_a) {
            bad++;
        }
    }
    return { entries, bad };
}
function parseLedger(raw) {
    return parseLedgerReport(raw).entries;
}
function dedupeEntries(entries) {
    const seen = new Set();
    const out = [];
    for (const e of entries) {
        const key = (0, types_1.entryKey)(e);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}
function repairTail(prev) {
    if (!prev || prev.endsWith("\n"))
        return { text: prev, dropped: 0 };
    const idx = prev.lastIndexOf("\n");
    const tail = prev.slice(idx + 1);
    try {
        JSON.parse(tail);
        return { text: prev + "\n", dropped: 0 };
    }
    catch (_a) {
        return { text: idx >= 0 ? prev.slice(0, idx + 1) : "", dropped: tail.length };
    }
}
function monthKey(ts) {
    const d = new Date(ts);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}`;
}
function dayKey(ts) {
    const d = new Date(ts);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

};
__modules["types.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = exports.ZERO = void 0;
exports.vec = vec;
exports.addVec = addVec;
exports.subVec = subVec;
exports.clampVec = clampVec;
exports.isZeroVec = isZeroVec;
exports.primaryOf = primaryOf;
exports.entryKey = entryKey;
exports.entryAddVec = entryAddVec;
exports.entryDelVec = entryDelVec;
exports.ZERO = Object.freeze({ cjk: 0, lat: 0 });
function vec(cjk = 0, lat = 0) {
    return { cjk, lat };
}
function addVec(a, b) {
    return { cjk: a.cjk + b.cjk, lat: a.lat + b.lat };
}
function subVec(a, b) {
    return { cjk: a.cjk - b.cjk, lat: a.lat - b.lat };
}
function clampVec(a) {
    return { cjk: Math.max(0, a.cjk), lat: Math.max(0, a.lat) };
}
function isZeroVec(a) {
    return a.cjk === 0 && a.lat === 0;
}
function primaryOf(a, includeLatin) {
    return includeLatin ? a.cjk + a.lat : a.cjk;
}
exports.DEFAULT_SETTINGS = {
    countFrontmatter: false,
    countCodeBlocks: false,
    excludeFolders: [".trash"],
    includeLatinInPrimary: false,
    writeFrontmatter: false,
    frontmatterKey: "words",
    dailyGoal: 0,
    weeklyGoal: 0,
    panelRange: 7,
    debounceMs: 2500,
    projectRules: [],
    reportFolder: "归档/统计归档",
    autoWeeklyReport: true,
    backupFolder: "归档/统计归档/账本备份",
    backupIntervalDays: 7,
};
function entryKey(e) {
    return `${e.t}|${e.p}|${e.add[0]},${e.add[1]}|${e.del[0]},${e.del[1]}|${e.src}`;
}
function entryAddVec(e) {
    return vec(e.add[0], e.add[1]);
}
function entryDelVec(e) {
    return vec(e.del[0], e.del[1]);
}

};
__modules["view.ts"] = function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsView = exports.VIEW_TYPE_STATS = void 0;
const obsidian_1 = require("obsidian");
const i18n_1 = require("./i18n");
const stats_1 = require("./stats");
exports.VIEW_TYPE_STATS = "abacus-view";
const RANGES = [7, 30, 90, 365, 0];
const fmt = (n) => Math.round(n).toLocaleString("en-US");
class StatsView extends obsidian_1.ItemView {
    constructor(leaf, hooks) {
        super(leaf);
        this.hooks = hooks;
        this.data = null;
    }
    getViewType() {
        return exports.VIEW_TYPE_STATS;
    }
    getDisplayText() {
        return (0, i18n_1.L)().viewName;
    }
    getIcon() {
        return "calculator";
    }
    async onOpen() {
        this.render();
    }
    async onClose() {
        this.contentEl.empty();
    }
    setData(data) {
        this.data = data;
        this.render();
    }
    render() {
        var _a, _b, _c;
        const t = (0, i18n_1.L)();
        const root = this.contentEl;
        root.empty();
        root.addClass("scs-panel");
        const header = root.createDiv({ cls: "scs-header" });
        header.createDiv({ cls: "scs-title", text: t.today });
        const buttons = header.createDiv({ cls: "scs-header-actions" });
        for (const r of RANGES) {
            const b = buttons.createEl("button", {
                cls: "scs-range-btn" + (((_a = this.data) === null || _a === void 0 ? void 0 : _a.range) === r ? " is-active" : ""),
                text: r === 0 ? t.rangeCumulative : r === 365 ? t.rangeYear : t.rangeDays(r),
            });
            b.onclick = () => this.hooks.onRange(r);
        }
        const refresh = buttons.createEl("button", {
            cls: "scs-icon-btn",
            attr: { "aria-label": t.rescan },
        });
        (0, obsidian_1.setIcon)(refresh, "refresh-cw");
        refresh.onclick = () => this.hooks.onRescan();
        if (!this.data) {
            root.createDiv({ cls: "scs-empty", text: t.reading });
            return;
        }
        const d = this.data;
        if (d.scanning && d.progress) {
            root.createDiv({
                cls: "scs-progress",
                text: t.scanning(d.progress.done, d.progress.total),
            });
        }
        const hero = root.createDiv({ cls: "scs-hero" });
        hero.createDiv({ cls: "scs-hero-num", text: fmt(d.todayAdd.cjk) });
        hero.createDiv({ cls: "scs-hero-unit", text: t.cjk });
        const heroSub = root.createDiv({ cls: "scs-hero-sub" });
        heroSub.createSpan({ text: t.latinWords(fmt(d.todayAdd.lat)) });
        if (d.todayDel.cjk > 0 || d.todayDel.lat > 0) {
            heroSub.createSpan({
                cls: "scs-del",
                text: t.deleted(fmt(d.todayDel.cjk), fmt(d.todayDel.lat)),
            });
        }
        if (d.streak > 0) {
            heroSub.createSpan({ cls: "scs-streak", text: t.streak(d.streak) });
        }
        if (d.dailyGoal > 0) {
            const pct = Math.min(100, Math.round((d.todayAdd.cjk / d.dailyGoal) * 100));
            const goal = root.createDiv({ cls: "scs-goal" });
            if (d.todayAdd.cjk >= d.dailyGoal)
                goal.addClass("is-done");
            const track = goal.createDiv({ cls: "scs-goal-track" });
            track.createDiv({ cls: "scs-goal-fill", attr: { style: `width:${pct}%` } });
            goal.createDiv({
                cls: "scs-goal-text",
                text: t.goalText(fmt(d.todayAdd.cjk), fmt(d.dailyGoal), pct),
            });
        }
        const chartWrap = root.createDiv({ cls: "scs-chart-wrap" });
        const chart = chartWrap.createDiv({
            cls: "scs-chart" + (d.range === 90 || d.days.length > 24 ? " is-dense" : ""),
        });
        const max = Math.max(1, ...d.days.map((x) => x.vec.cjk + x.vec.lat));
        const labelEvery = d.range === 365 ? 1 : d.days.length > 10 ? Math.ceil(d.days.length / 6) : 1;
        d.days.forEach((bar, i) => {
            var _a;
            const value = bar.vec.cjk + bar.vec.lat;
            const col = chart.createDiv({ cls: "scs-bar-col" });
            if (bar.isToday)
                col.addClass("is-today");
            const track = col.createDiv({ cls: "scs-bar-track" });
            const h = value <= 0 ? 0 : Math.max(4, Math.round((value / max) * 100));
            track.createDiv({ cls: "scs-bar", attr: { style: `height:${h}%` } });
            const showLabel = d.days.length <= 7 || bar.isToday || (d.days.length - 1 - i) % labelEvery === 0;
            if (showLabel)
                col.createDiv({ cls: "scs-bar-label", text: bar.label });
            col.title = (_a = bar.tip) !== null && _a !== void 0 ? _a : t.chartTip(bar.day, fmt(bar.vec.cjk), fmt(bar.vec.lat));
        });
        if (d.range === 0) {
            chartWrap.createDiv({ cls: "scs-chart-note", text: t.cumulativeNote });
        }
        this.renderHeatmap(root, d.heat);
        const grid = root.createDiv({ cls: "scs-grid" });
        this.metric(grid, t.week, d.weekAdd);
        this.metric(grid, t.month, d.monthAdd);
        this.metric(grid, t.all, d.total);
        if (d.weeklyGoal > 0) {
            const pct = Math.min(100, Math.round((d.weekAdd.cjk / d.weeklyGoal) * 100));
            const line = root.createDiv({
                cls: "scs-goal-line" + (d.weekAdd.cjk >= d.weeklyGoal ? " is-done" : ""),
                text: t.weekGoalText(fmt(d.weekAdd.cjk), fmt(d.weeklyGoal), pct),
            });
            line.setAttr("title", t.weekGoalTitle(fmt(d.weeklyGoal)));
        }
        if (d.projects.length > 0) {
            const proj = root.createDiv({ cls: "scs-projects" });
            proj.createDiv({ cls: "scs-section-title", text: t.projects });
            const head = proj.createDiv({ cls: "scs-project-row is-head" });
            head.createDiv({ cls: "scs-project-name", text: "" });
            head.createDiv({ cls: "scs-project-num", text: t.month });
            head.createDiv({ cls: "scs-project-num", text: t.runningTotal });
            for (const p of d.projects) {
                const selected = d.selectedProject === p.name;
                const row = proj.createDiv({
                    cls: "scs-project-row is-clickable" + (selected ? " is-selected" : ""),
                });
                row.createDiv({ cls: "scs-project-name", text: p.name });
                row.createDiv({ cls: "scs-project-num", text: fmt(p.month.cjk) });
                row.createDiv({ cls: "scs-project-num is-dim", text: fmt(p.total.cjk) });
                row.title = t.projectTip(p.name, fmt(p.month.cjk), fmt(p.month.lat), fmt(p.total.cjk), fmt(p.total.lat));
                row.onclick = () => this.hooks.onProject(p.name);
            }
            if (d.selectedProject) {
                const files = proj.createDiv({ cls: "scs-files" });
                files.createDiv({ cls: "scs-files-title", text: d.selectedProject });
                if (d.projectFiles.length === 0) {
                    files.createDiv({ cls: "scs-files-empty", text: t.noChangesThisMonth });
                }
                for (const f of d.projectFiles) {
                    const item = files.createDiv({ cls: "scs-file-row" });
                    item.createDiv({ cls: "scs-file-name", text: (_b = f.path.split("/").pop()) !== null && _b !== void 0 ? _b : f.path });
                    item.createDiv({
                        cls: "scs-file-num",
                        text: f.month.cjk > 0 ? `+${fmt(f.month.cjk)}` : fmt(f.total.cjk),
                    });
                    item.title = t.fileTip(f.path, fmt(f.month.cjk), fmt(f.month.lat), fmt(f.total.cjk), fmt(f.total.lat));
                }
            }
        }
        if (d.current) {
            const cur = root.createDiv({ cls: "scs-current" });
            cur.createDiv({ cls: "scs-current-label", text: t.currentFile });
            cur.createDiv({
                cls: "scs-current-name",
                text: (_c = d.current.path.split("/").pop()) !== null && _c !== void 0 ? _c : d.current.path,
            });
            cur.createDiv({
                cls: "scs-current-num",
                text: t.currentNum(fmt(d.current.vec.cjk), fmt(d.current.vec.lat)),
            });
        }
        const healthEl = root.createDiv({ cls: "scs-health" });
        if (!d.health) {
            healthEl.setText(t.healthChecking);
        }
        else if (d.health.ok) {
            healthEl.setText(t.healthOk(d.health.months, fmt(d.health.entries)));
        }
        else {
            healthEl.addClass("is-bad");
            healthEl.setText(t.healthBad(d.health.problems.length));
            healthEl.title = d.health.problems.join("\n");
        }
        healthEl.onclick = () => this.hooks.onAudit();
        const time = new Date(d.updatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
        root.createDiv({ cls: "scs-foot", text: t.foot(fmt(d.fileCount), time) });
    }
    renderHeatmap(parent, heat) {
        const t = (0, i18n_1.L)();
        const opacities = [0, 0.28, 0.5, 0.72, 1];
        const wrap = parent.createDiv({ cls: "scs-heat" });
        wrap.createDiv({ cls: "scs-section-title", text: t.heatTitle(heat.year) });
        const scroll = wrap.createDiv({ cls: "scs-heat-scroll" });
        const body = scroll.createDiv({ cls: "scs-heat-body" });
        const top = body.createDiv({ cls: "scs-heat-top" });
        top.createDiv({ cls: "scs-heat-corner" });
        const months = top.createDiv({
            cls: "scs-heat-months",
            attr: { style: `width:${heat.weeks * 14}px` },
        });
        for (const m of heat.months) {
            months.createSpan({
                cls: "scs-heat-month",
                attr: { style: `left:${m.week * 14}px` },
                text: t.monthShort(m.month),
            });
        }
        const main = body.createDiv({ cls: "scs-heat-main" });
        const weekdays = main.createDiv({ cls: "scs-heat-weekdays" });
        for (let i = 0; i < 7; i++) {
            weekdays.createDiv({
                cls: "scs-heat-weekday",
                text: i < 6 && i % 2 === 0 ? t.heatWeekdays[i / 2] : "",
            });
        }
        const grid = main.createDiv({ cls: "scs-heat-grid" });
        for (let w = 0; w < heat.weeks; w++) {
            const col = grid.createDiv({ cls: "scs-heat-week" });
            for (let d = 0; d < 7; d++) {
                const day = heat.days[w * 7 + d];
                const cell = col.createDiv({ cls: "scs-heat-cell" });
                if (!day.inYear || day.future) {
                    cell.addClass("is-out");
                }
                else {
                    const lv = (0, stats_1.heatLevel)(day.vec);
                    if (lv > 0) {
                        cell.createDiv({
                            cls: "scs-heat-fill",
                            attr: { style: `opacity:${opacities[lv]}` },
                        });
                    }
                    cell.title = t.chartTip(day.day, fmt(day.vec.cjk), fmt(day.vec.lat));
                }
                if (day.isToday)
                    cell.addClass("is-today");
            }
        }
        const legend = wrap.createDiv({ cls: "scs-heat-legend" });
        legend.createSpan({ text: t.heatLess });
        for (let lv = 0; lv < 5; lv++) {
            const cell = legend.createDiv({ cls: "scs-heat-cell scs-heat-legend-cell" });
            if (lv > 0) {
                cell.createDiv({
                    cls: "scs-heat-fill",
                    attr: { style: `opacity:${opacities[lv]}` },
                });
            }
        }
        legend.createSpan({ text: t.heatMore });
    }
    metric(parent, label, v) {
        const box = parent.createDiv({ cls: "scs-metric" });
        box.createDiv({ cls: "scs-metric-label", text: label });
        box.createDiv({ cls: "scs-metric-main", text: fmt(v.cjk) });
        box.createDiv({ cls: "scs-metric-sub", text: (0, i18n_1.L)().wordsShort(fmt(v.lat)) });
    }
}
exports.StatsView = StatsView;

};
var __entry = __require("main.ts");
module.exports = __entry && __entry.default ? __entry.default : __entry;
