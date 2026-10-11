/**
 * 端到端校验：在 Node 里跑真实的计数 / 扫描 / 记账逻辑。
 *
 * 1) 口径单测（frontmatter、代码块、双链、URL、diff）
 * 2) 合成分支：建库 → 编辑 → 重命名 → 删除，检查账本
 * 3) 真实库全量扫描：用 1181 篇笔记验证性能与数字
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LedgerEntry, StatsAdapter, StatsSettings, VaultIO, Vec } from "../src/types";
import { DEFAULT_SETTINGS, entryKey, primaryOf } from "../src/types";
import { countMarkdown, diffCounts } from "../src/counter";
import {
  StatsStore,
  MonthEntryCache,
  dedupeEntries,
  parseLedger,
  parseLedgerReport,
  repairTail,
} from "../src/store";
import { filterNewEntries, parseBackup, shouldAutoBackup } from "../src/backup";
import { Scanner } from "../src/scanner";
import {
  buildYearHeatmap,
  byDay,
  cumulativeByMonth,
  heatLevel,
  isoWeek,
  isExcludedPath,
  parseProjectRules,
  projectOf,
  startOfDay,
  streakFrom,
  sumByMonth,
  sumWriting,
} from "../src/stats";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       期望 ${e}\n       实际 ${a}`);
  }
}

const OPTS = { countFrontmatter: false, countCodeBlocks: false };

class FsAdapter implements StatsAdapter {
  constructor(private root: string) {}
  private p(rel: string): string {
    return path.join(this.root, rel);
  }
  async read(rel: string): Promise<string> {
    return fs.promises.readFile(this.p(rel), "utf8");
  }
  async write(rel: string, data: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.p(rel)), { recursive: true });
    await fs.promises.writeFile(this.p(rel), data, "utf8");
  }
  async exists(rel: string): Promise<boolean> {
    try {
      await fs.promises.access(this.p(rel));
      return true;
    } catch {
      return false;
    }
  }
  async mkdir(rel: string): Promise<void> {
    await fs.promises.mkdir(this.p(rel), { recursive: true });
  }
  async append(rel: string, data: string): Promise<void> {
    await fs.promises.appendFile(this.p(rel), data, "utf8");
  }
  async stat(rel: string): Promise<{ size: number } | null> {
    try {
      const s = await fs.promises.stat(this.p(rel));
      return { size: s.size };
    } catch {
      return null;
    }
  }
  async list(rel: string): Promise<{ files: string[]; folders: string[] }> {
    const out = { files: [] as string[], folders: [] as string[] };
    try {
      for (const d of await fs.promises.readdir(this.p(rel), { withFileTypes: true })) {
        if (d.isDirectory()) out.folders.push(d.name);
        else out.files.push(d.name);
      }
    } catch {
      /* 目录不存在 */
    }
    return out;
  }
}

function fsVaultIO(root: string, dataRoot: string): VaultIO {
  const walk = (dir: string): { path: string; size: number; mtime: number }[] => {
    const out: { path: string; size: number; mtime: number }[] = [];
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const it of items) {
      if (it.name.startsWith(".")) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) out.push(...walk(full));
      else if (it.name.endsWith(".md")) {
        const st = fs.statSync(full);
        out.push({ path: path.relative(root, full).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
      }
    }
    return out;
  };
  return {
    listFiles: () => walk(root),
    statFile: (rel: string) => {
      try {
        const st = fs.statSync(path.join(root, rel));
        return { path: rel, size: st.size, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    },
    readFile: async (rel: string) => fs.promises.readFile(path.join(root, rel), "utf8"),
    adapter: new FsAdapter(dataRoot),
  };
}

function fmtVec(v: Vec): string {
  return `${v.cjk.toLocaleString("en-US")} 汉字 / ${v.lat.toLocaleString("en-US")} 词`;
}

async function testCounter(): Promise<void> {
  console.log("\n[1] 计数口径");
  check("纯中文", countMarkdown("今天天气很好", OPTS).cjk, 6);
  check("frontmatter 不计入", countMarkdown("---\ntitle: 测试标题\n---\n正文", OPTS).cjk, 2);
  check("frontmatter 计入", countMarkdown("---\ntitle: 测试标题\n---\n正文", { ...OPTS, countFrontmatter: true }).cjk, 6);
  check("代码块不计入", countMarkdown("前面\n```js\nconst a = 1\n```\n后面", OPTS).cjk, 4);
  check("行内代码不计入", countMarkdown("用 `useState` 管理状态", OPTS).cjk, 5);
  check("英文词", countMarkdown("hello world 你好", OPTS), { cjk: 2, lat: 2 });
  check("双链取显示名", countMarkdown("看 [[笔记|这个]]", OPTS).cjk, 3);
  check("图片不计入", countMarkdown("![截图](a.png)", OPTS).cjk, 0);
  check("URL 不计入", countMarkdown("见 https://example.com/a 说明", OPTS).lat, 0);
  check("标题符号不计入", countMarkdown("## 二级标题", OPTS).cjk, 4);

  const d = diffCounts("今天写了三百字", "今天写了三百五十字", OPTS);
  check("diff 新增", d.add.cjk, 2);
  check("diff 删除", d.del.cjk, 0);

  const d2 = diffCounts("第一段。第二段要删掉。第三段。", "第一段。第三段。", OPTS);
  check("diff 删掉 6 字", d2.del.cjk, 6);
}

async function testLedgerFlow(): Promise<void> {
  console.log("\n[3] 记账流程");
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-vault-"));
  const data = path.join(root, ".data");
  await fs.promises.mkdir(path.join(root, "笔记"), { recursive: true });
  await fs.promises.writeFile(path.join(root, "笔记", "a.md"), "刚开始写第一句话。", "utf8");
  await fs.promises.writeFile(path.join(root, "笔记", "b.md"), "第二篇内容。", "utf8");

  const settings: StatsSettings = { ...DEFAULT_SETTINGS, debounceMs: 10, excludeFolders: [".trash"] };
  const store = new StatsStore("", new FsAdapter(data));
  await store.load();
  const io = fsVaultIO(root, data);
  const scanner = new Scanner(io, store, () => settings);

  const first = await scanner.fullScan(false);
  check("首扫识别文件数", first.files, 2);
  check("首扫为 baseline", first.baseline, true);
  check("baseline 不写账本", (await store.readMonth(monthNow())).length, 0);

  // 编辑：追加 5 个汉字
  await fs.promises.writeFile(path.join(root, "笔记", "a.md"), "刚开始写第一句话。又写了五个字", "utf8");
  // 热路径不得遍历全库；这里故意让 listFiles 抛错来证明 processEdit 不再依赖它
  const origListFiles = io.listFiles;
  io.listFiles = () => {
    throw new Error("processEdit should not list the whole vault");
  };
  scanner.scheduleEdit("笔记/a.md");
  await sleep(260);
  io.listFiles = origListFiles;
  const afterEdit = await store.readMonth(monthNow());
  check("编辑产生 1 条账本", afterEdit.length, 1);
  check("编辑记录新增汉字", afterEdit[0]?.add[0], 6);
  check("编辑来源", afterEdit[0]?.src, "edit");
  check("账本按天汇总", sumWriting(afterEdit, startOfDay(), Date.now() + 1).add.cjk, 6);

  // 重命名：不该产生写作量
  scanner.handleRename("笔记/a.md", "笔记/c.md");
  await sleep(20);
  check("重命名后账本条数不变", (await store.readMonth(monthNow())).length, 1);
  check("重命名后快照路径", store.get("笔记/c.md") !== undefined, true);

  // 删除：账本立即写，快照合并后由 flush 落盘
  await scanner.handleDelete("笔记/b.md");
  const afterDelete = await store.readMonth(monthNow());
  check("删除产生记录", afterDelete.some((e) => e.src === "delete"), true);
  check("删除不计入写作", sumWriting(afterDelete, startOfDay(), Date.now() + 1).add.cjk, 6);
  await scanner.flush();

  // 重启：快照从盘上读回来
  const store2 = new StatsStore("", new FsAdapter(data));
  await store2.load();
  check("重启后快照条数", store2.size(), 1);
  check("重启后总计", store2.total().cjk, 14);
  const raw = fs.readFileSync(path.join(data, "stats", "ledger", `${monthNow()}.local.jsonl`), "utf8");
  check("账本是合法 JSONL", parseLedger(raw).length, afterDelete.length);
  check("账本月份可枚举", await store2.listLedgerMonths(), [monthNow()]);

  fs.rmSync(root, { recursive: true, force: true });
}

async function testLedgerIntegrity(): Promise<void> {
  console.log("\n[4] 账本完整性");

  check("空文件不修", repairTail(""), { text: "", dropped: 0 });
  check("正常结尾不动", repairTail('{"a":1}\n'), { text: '{"a":1}\n', dropped: 0 });
  check("完整行缺换行只补换行", repairTail('{"a":1}'), { text: '{"a":1}\n', dropped: 0 });
  check("半行被截掉", repairTail('{"a":1}\n{"b":'), { text: '{"a":1}\n', dropped: 5 });
  check("整个文件都是半行", repairTail('{"b":').text, "");

  const good = JSON.stringify({ t: 1000, p: "a.md", add: [1, 0], del: [0, 0], src: "edit" });
  const report = parseLedgerReport(`${good}\n坏行\n${good}\n`);
  check("解析：好行数", report.entries.length, 2);
  check("解析：坏行数", report.bad, 1);

  // 模拟一次同步冲突：同一行写了两遍，外加一行写坏
  const raw = `${good}\n${good}\n坏行\n`;
  const adapter = {
    read: async () => raw,
    write: async () => void 0,
    exists: async () => true,
    mkdir: async () => void 0,
    list: async () => ({ files: ["stats/ledger/2026-11.jsonl"], folders: [] }),
  };
  const store = new StatsStore("", adapter as never);
  const audit = await store.audit();
  check("审计：事件数", audit.totalEntries, 2);
  check("审计：坏行", audit.badLines, 1);
  check("审计：重复", audit.duplicates, 1);
  check("审计：给出问题", audit.problems.length > 0, true);

  // 追加时自动截掉坏尾，坏行不会永久留在账本里
  const broken = `${good}\n{"t":2,"p":"y`;
  let written = "";
  const adapter2 = {
    read: async () => broken,
    write: async (_p: string, d: string) => {
      written = d;
    },
    exists: async () => true,
    mkdir: async () => void 0,
    list: async () => ({ files: [], folders: [] }),
  };
  const store2 = new StatsStore("", adapter2 as never);
  await store2.append([{ t: 3, p: "z.md", add: [5, 0], del: [0, 0], src: "edit" }]);
  check("追加后坏尾消失", written.includes('"p":"y'), false);
  check("追加后新行完整", written.trimEnd().endsWith('{"t":3,"p":"z.md","add":[5,0],"del":[0,0],"src":"edit"}'), true);
  check("修复被记录", store2.repairs.length, 1);

  // 快路径：第一次整写，第二次（大小未变）直接追加
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-fast-"));
  const base = new FsAdapter(dir);
  let appends = 0;
  let writes = 0;
  const counting: StatsAdapter = {
    read: (p) => base.read(p),
    write: async (p, d) => {
      writes++;
      return base.write(p, d);
    },
    exists: (p) => base.exists(p),
    mkdir: (p) => base.mkdir(p),
    list: (p) => base.list(p),
    append: async (p, d) => {
      appends++;
      return base.append(p, d);
    },
    stat: (p) => base.stat(p),
  };
  const nowTs = Date.now();
  const ev = (n: number, name: string): LedgerEntry => ({
    t: nowTs + n,
    p: name,
    add: [1, 0],
    del: [0, 0],
    src: "edit",
  });
  const st3 = new StatsStore("", counting);
  await st3.append([ev(0, "a.md")]);
  await st3.append([ev(1, "b.md")]);
  check("第一次整写", writes, 1);
  check("第二次走追加", appends, 1);
  check("追加后两条都在", (await st3.readMonth(monthNow())).length, 2);

  // 外部把末尾写坏：大小对不上，必须退回安全路径
  await fs.promises.appendFile(path.join(dir, "stats", "ledger", `${monthNow()}.local.jsonl`), '{"t":9,"p":"bad', "utf8");
  await st3.append([ev(2, "c.md")]);
  check("外部改动后不再追加", appends, 1);
  check("外部改动后整写", writes, 2);
  check("坏尾被修掉", st3.repairs.length, 1);
  check("修复后三条有效", (await st3.readMonth(monthNow())).length, 3);
  fs.rmSync(dir, { recursive: true, force: true });

  // 两台设备写同一个月：各写各的文件，读取时合并
  const dir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-multi-"));
  const ad2 = new FsAdapter(dir2);
  const devA = new StatsStore("", ad2, { deviceId: "devA" });
  const devB = new StatsStore("", ad2, { deviceId: "devB" });
  await devA.append([ev(10, "a1.md")]);
  await devB.append([ev(11, "b1.md")]);
  const names = (await fs.promises.readdir(path.join(dir2, "stats", "ledger"))).sort();
  check("两台设备各自成文件", names.length, 2);
  check("文件名带设备标识", names.every((n) => n.includes(".devA.") || n.includes(".devB.")), true);
  check("读取时合并两个文件", (await devA.readMonth(monthNow())).length, 2);
  check("另一端也能读到合并结果", (await devB.readMonth(monthNow())).length, 2);

  // 老版本的无后缀文件必须继续可读（不迁移、不丢失）
  await fs.promises.writeFile(
    path.join(dir2, "stats", "ledger", `${monthNow()}.jsonl`),
    JSON.stringify({ t: nowTs + 12, p: "legacy.md", add: [3, 0], del: [0, 0], src: "edit" }) + "\n",
    "utf8"
  );
  check("兼容老的无后缀文件", (await devA.readMonth(monthNow())).length, 3);
  fs.rmSync(dir2, { recursive: true, force: true });
}

async function testBackup(): Promise<void> {
  console.log("\n[5] 备份恢复");
  const at = (
    t: number,
    p: string,
    add: [number, number],
    src: LedgerEntry["src"] = "edit"
  ): LedgerEntry => ({ t, p, add, del: [0, 0], src });

  const raw = JSON.stringify({
    format: "abacus-ledger-backup",
    version: 1,
    exportedAt: "2026-11-15T00:00:00.000Z",
    exportedBy: "devA",
    vault: "测试库",
    entries: [
      at(1000, "a.md", [10, 0]),
      at(2000, "b.md", [5, 2]),
      { t: "bad", p: "x.md", add: [1, 0], del: [0, 0], src: "edit" },
      { t: 3000, p: "c.md", add: [-1, 0], del: [0, 0], src: "edit" },
      { t: 4000, p: "d.md", add: [1, 0], del: [0, 0], src: "unknown" },
    ],
  });
  const parsed = parseBackup(raw);
  check("备份好条目", parsed.entries.length, 2);
  check("备份坏条目", parsed.bad, 3);
  check("备份来源设备", parsed.exportedBy, "devA");
  check("备份来源库", parsed.vault, "测试库");

  const legacy = parseBackup(JSON.stringify({ entries: [at(5000, "e.md", [1, 0])] }));
  check("旧备份无 format 可读", legacy.entries.length, 1);

  let rejected = false;
  try {
    parseBackup(JSON.stringify({ format: "other", entries: [] }));
  } catch {
    rejected = true;
  }
  check("未知 format 拒绝", rejected, true);

  const existing = [at(1000, "a.md", [10, 0])];
  const { fresh, duplicates } = filterNewEntries(parsed.entries, existing);
  check("跨账本去重", duplicates, 1);
  check("只留新条目", fresh.length, 1);

  check("entryKey 同事件相同", entryKey(at(1, "a.md", [1, 0])), entryKey(at(1, "a.md", [1, 0])));
  check(
    "dedupeEntries 去重",
    dedupeEntries([at(1, "a.md", [1, 0]), at(1, "a.md", [1, 0]), at(2, "b.md", [2, 0])]).length,
    2
  );

  // 用当月时间戳，确保落进 monthNow()
  const now = new Date();
  const monthBase = new Date(now.getFullYear(), now.getMonth(), 10, 10, 0, 0).getTime();
  const storeExisting = at(monthBase, "a.md", [10, 0]);
  const storeFresh = at(monthBase + 1000, "b.md", [5, 2]);

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-backup-"));
  const adapter = new FsAdapter(root);
  const store = new StatsStore("", adapter, { deviceId: "devA" });
  await store.load();
  await store.append([storeExisting]);

  const first = await store.importEntries([storeFresh]);
  check("首次导入新增", first.added, 1);
  check("导入后月账本", (await store.readMonth(monthNow())).length, 2);
  check(
    "生成 imported 文件",
    (await adapter.list("stats/ledger")).files.includes(`${monthNow()}.imported.devA.jsonl`),
    true
  );

  const again = await store.importEntries([storeFresh]);
  check("重复导入幂等", again.added, 0);
  check("重复导入后月账本", (await store.readMonth(monthNow())).length, 2);

  // 另一台设备的文件里再写一遍同一事件，读时应当只算一条
  await adapter.write(
    `stats/ledger/${monthNow()}.devB.jsonl`,
    JSON.stringify(storeExisting) + "\n"
  );
  check("跨文件读时去重", (await store.readMonth(monthNow())).length, 2);

  const today = new Date(2026, 10, 15).getTime();
  check("无备份要备份", shouldAutoBackup([], 7, "devA", today), true);
  check(
    "本机今天已备份",
    shouldAutoBackup(["账本备份 2026-11-15.devA.json"], 7, "devA", today),
    false
  );
  check(
    "别机今天备份不算",
    shouldAutoBackup(["账本备份 2026-11-15.devB.json"], 7, "devA", today),
    true
  );
  check(
    "7 天前要备份",
    shouldAutoBackup(["账本备份 2026-11-08.devA.json"], 7, "devA", today),
    true
  );
  check(
    "6 天前不备份",
    shouldAutoBackup(["账本备份 2026-11-09.devA.json"], 7, "devA", today),
    false
  );
  check("间隔 0 关闭", shouldAutoBackup([], 0, "devA", today), false);
  check(
    "旧格式今天算本机",
    shouldAutoBackup(["账本备份 2026-11-15.json"], 7, "devA", today),
    false
  );

  check("主指标不含英文", primaryOf({ cjk: 10, lat: 3 }, false), 10);
  check("主指标含英文", primaryOf({ cjk: 10, lat: 3 }, true), 13);

  fs.rmSync(root, { recursive: true, force: true });
}

async function testHeatmap(): Promise<void> {
  console.log("\n[6] 全年热力图");
  const now = new Date(2026, 10, 15, 12, 0, 0).getTime();
  const daily = new Map<string, Vec>([
    ["2026-01-01", { cjk: 100, lat: 0 }],
    ["2026-11-14", { cjk: 600, lat: 20 }],
    ["2026-11-15", { cjk: 250, lat: 0 }],
  ]);
  const heat = buildYearHeatmap(2026, daily, now);

  check("2026 有 53 周", heat.weeks, 53);
  check("格子数 = 周数 × 7", heat.days.length, 53 * 7);
  check("首格是上一年 12-29", heat.days[0].day, "2025-12-29");
  check("首格不在本年", heat.days[0].inYear, false);
  check("1 月 1 日在第 4 格", heat.days[3].day, "2026-01-01");
  check("1 月 1 日在本年", heat.days[3].inYear, true);
  check("1 月 1 日计数", heat.days[3].vec, { cjk: 100, lat: 0 });

  check("11-14 计数", heat.days.find((d) => d.day === "2026-11-14")?.vec, { cjk: 600, lat: 20 });
  check("今天标记", heat.days.find((d) => d.day === "2026-11-15")?.isToday, true);
  check("未来格", heat.days.find((d) => d.day === "2026-12-31")?.future, true);
  check("未来格计数为 0", heat.days.find((d) => d.day === "2026-12-31")?.vec, { cjk: 0, lat: 0 });

  check("12 个月份标签", heat.months.length, 12);
  check("1 月在首周", heat.months[0], { week: 0, month: 1 });
  check("月份按顺序", heat.months.map((m) => m.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  check("零值等级", heatLevel({ cjk: 0, lat: 0 }), 0);
  check("1-199 等级", heatLevel({ cjk: 100, lat: 0 }), 1);
  check("200-499 等级", heatLevel({ cjk: 250, lat: 0 }), 2);
  check("500-999 等级", heatLevel({ cjk: 600, lat: 20 }), 3);
  check("1000+ 等级", heatLevel({ cjk: 1200, lat: 0 }), 4);

  const leap = buildYearHeatmap(2012, new Map(), now);
  check("闰年从周日开始有 54 周", leap.weeks, 54);
}

async function testRealVault(vaultRoot: string): Promise<void> {
  console.log(`\n[7] 真实库扫描：${vaultRoot}`);
  const dataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-data-"));
  const settings: StatsSettings = { ...DEFAULT_SETTINGS };
  const store = new StatsStore("", new FsAdapter(dataRoot));
  await store.load();
  const io = fsVaultIO(vaultRoot, dataRoot);
  const scanner = new Scanner(io, store, () => settings);

  const t0 = Date.now();
  const res = await scanner.fullScan(false);
  const cost = Date.now() - t0;

  const total = store.total();
  console.log(`  文件 ${res.files} 个，耗时 ${cost} ms`);
  console.log(`  合计 ${fmtVec(total)}`);

  const byFolder = new Map<string, Vec>();
  for (const [p, r] of store.entries()) {
    const top = p.split("/")[0] ?? "(根)";
    const cur = byFolder.get(top) ?? { cjk: 0, lat: 0 };
    byFolder.set(top, { cjk: cur.cjk + r.vec.cjk, lat: cur.lat + r.vec.lat });
  }
  console.log("  按顶层目录：");
  for (const [k, v] of [...byFolder.entries()].sort((a, b) => b[1].cjk - a[1].cjk)) {
    console.log(`    ${k.padEnd(6, "　")} ${fmtVec(v)}`);
  }

  const top = [...store.entries()].sort((a, b) => b[1].vec.cjk - a[1].vec.cjk).slice(0, 5);
  console.log("  最大 5 篇：");
  for (const [p, r] of top) console.log(`    ${fmtVec(r.vec)}  ${p}`);

  check("扫描出文件数 > 1000", res.files > 1000, true);
  check("全库汉字量级合理（0.5M~1M）", total.cjk > 500_000 && total.cjk < 1_000_000, true);
  check("全量扫描耗时 < 60s", cost < 60_000, true);
  check("首扫不写账本", (await store.readMonth(monthNow())).length, 0);

  // 第二次扫描应当全部命中缓存
  const t1 = Date.now();
  const again = await scanner.fullScan(false);
  console.log(`  二次扫描耗时 ${Date.now() - t1} ms，变更 ${again.changed} 个`);
  // 库是活的：你可能正在旁边写字，允许极少数文件在两次扫描之间变动
  check("二次扫描命中缓存（变更 ≤ 2）", again.changed <= 2, true);

  fs.rmSync(dataRoot, { recursive: true, force: true });
}

function monthNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function testStatsHelpers(): Promise<void> {
  console.log("\n[2] 趋势 / 连续 / 项目");
  const at = (s: string) => new Date(`${s}T10:00:00`).getTime();

  check("连续 3 天（含今天）", streakFrom(new Set(["2026-11-15", "2026-11-14", "2026-11-13"]), at("2026-11-15")), 3);
  check("今天还没写不断", streakFrom(new Set(["2026-11-14", "2026-11-13"]), at("2026-11-15")), 2);
  check("中间断一天就停", streakFrom(new Set(["2026-11-15", "2026-11-13"]), at("2026-11-15")), 1);
  check("完全没有记录", streakFrom(new Set(), at("2026-11-15")), 0);

  check("默认按前两段分组", projectOf("创作/小说/1/第一章.md", [], 2), "创作/小说");
  check("顶层文件归根目录", projectOf("随手记.md", [], 2), "（根目录）");
  const rules = parseProjectRules(["小说1 = 创作/小说/1", "创作/设定集"]);
  check("规则优先生效", projectOf("创作/小说/1/第一章.md", rules, 2), "小说1");
  check("裸规则取末段作名称", projectOf("创作/设定集/本命卡牌/第五卷.md", rules, 2), "设定集");
  check("规则外落回默认", projectOf("归档/日记/2026/11/2026-11-15.md", rules, 2), "归档/日记");

  check("ISO 周号", isoWeek(at("2026-11-15")), "2026-W46");
  check("ISO 周号·年初", isoWeek(at("2026-01-01")), "2026-W01");

  const s = { ...DEFAULT_SETTINGS, reportFolder: "归档/统计归档" };
  check("报告目录被排除", isExcludedPath("归档/统计归档/周报 2026-W46.md", s), true);
  check("普通笔记不排除", isExcludedPath("归档/日记/2026-11-15.md", s), false);

  const monthEntries: LedgerEntry[] = [
    { t: at("2026-01-15"), p: "a.md", add: [100, 0], del: [0, 0], src: "edit" },
    { t: at("2026-11-14"), p: "a.md", add: [50, 5], del: [0, 0], src: "edit" },
  ];
  const months = sumByMonth(monthEntries, 2026, at("2026-11-15"));
  check("按月共 12 项", months.length, 12);
  check("1 月汇总", months[0], { cjk: 100, lat: 0 });
  check("11 月汇总", months[10], { cjk: 50, lat: 5 });
  check("未来月份为 0", months[11], { cjk: 0, lat: 0 });

  const cumEntries: LedgerEntry[] = [
    { t: at("2026-01-15"), p: "a.md", add: [100, 0], del: [0, 0], src: "edit" },
    { t: at("2026-03-02"), p: "a.md", add: [50, 5], del: [0, 0], src: "edit" },
    { t: at("2026-03-20"), p: "a.md", add: [25, 0], del: [0, 0], src: "edit" },
    { t: at("2026-04-01"), p: "a.md", add: [999, 0], del: [0, 0], src: "edit" },
    { t: at("2026-03-21"), p: "a.md", add: [0, 0], del: [10, 0], src: "delete" },
  ];
  const cum = cumulativeByMonth(cumEntries, at("2026-03-31"));
  check("累计起始月", cum[0]?.month, "2026-01");
  check("累计月数", cum.length, 3);
  check("2 月无新增", cum[1]?.add, { cjk: 0, lat: 0 });
  check("2 月累计延续", cum[1]?.total, { cjk: 100, lat: 0 });
  check("3 月新增", cum[2]?.add, { cjk: 75, lat: 5 });
  check("3 月累计", cum[2]?.total, { cjk: 175, lat: 5 });
}

async function testCaches(): Promise<void> {
  console.log("\n[9] 账本缓存与追加通知");
  const baseT = new Date(2026, 10, 15, 10, 0, 0).getTime();
  const ev = (t: number, p: string): LedgerEntry => ({ t, p, add: [1, 0], del: [0, 0], src: "edit" });

  let clock = 1_000;
  let loads = 0;
  const cache = new MonthEntryCache(
    async () => {
      loads++;
      return [ev(baseT, "a.md")];
    },
    1000,
    () => clock
  );
  check("缓存首次读取", (await cache.get("2026-11")).length, 1);
  check("缓存首次 load 次数", loads, 1);
  await cache.get("2026-11");
  check("缓存命中不重读", loads, 1);
  cache.add([ev(baseT + 1000, "b.md")]);
  const afterAdd = await cache.get("2026-11");
  check("追加进缓存不重读", loads, 1);
  check("追加后条数", afterAdd.length, 2);
  clock += 1001;
  await cache.get("2026-11");
  check("TTL 过期重读", loads, 2);
  cache.clear();
  await cache.get("2026-11");
  check("clear 后重读", loads, 3);

  let concurrentLoads = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const slow = new MonthEntryCache(
    async () => {
      concurrentLoads++;
      await gate;
      return [];
    },
    1000,
    () => clock
  );
  const p1 = slow.get("2026-12");
  const p2 = slow.get("2026-12");
  check("并发 get 只读一次", concurrentLoads, 1);
  release();
  await Promise.all([p1, p2]);

  let raceLoads = 0;
  let releaseRace!: () => void;
  const raceGate = new Promise<void>((r) => {
    releaseRace = r;
  });
  const racing = new MonthEntryCache(
    async () => {
      raceLoads++;
      await raceGate;
      return [ev(baseT, "a.md")];
    },
    1000,
    () => clock
  );
  const loading = racing.get("2026-11");
  racing.add([ev(baseT + 1, "b.md")]);
  releaseRace();
  const merged = await loading;
  check("加载中追加不丢", merged.length, 2);
  check("加载中追加命中缓存", (await racing.get("2026-11")).length, 2);
  check("加载中追加不重复读", raceLoads, 1);

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-cache-"));
  const adapter = new FsAdapter(root);
  const store = new StatsStore("", adapter);
  await store.load();
  const seen: LedgerEntry[] = [];
  store.onAppend((entries) => seen.push(...entries));
  const zero: LedgerEntry = { t: baseT, p: "zero.md", add: [0, 0], del: [0, 0], src: "edit" };
  await store.append([zero, ev(baseT, "good.md")]);
  check("onAppend 只通知有效事件", seen.length, 1);
  check("onAppend 条目正确", seen[0]?.p, "good.md");
  await store.append([]);
  check("空批次不通知", seen.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
}

async function main(): Promise<void> {
  await testCounter();
  await testStatsHelpers();
  await testLedgerFlow();
  await testLedgerIntegrity();
  await testBackup();
  await testHeatmap();
  await testCaches();
  const vault = process.argv[2];
  if (vault && fs.existsSync(vault)) await testRealVault(vault);
  await testPerformance();
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
async function testPerformance(): Promise<void> {
  console.log("\n[8] 性能实测（只做参考，不设阈值）");
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scs-bench-"));
  const adapter = new FsAdapter(root);
  const store = new StatsStore("", adapter);
  await store.load();

  const ledgerRel = "stats/ledger/2026-11.jsonl";
  const entry = { t: Date.now(), p: "笔记/新.md", add: [12, 1], del: [0, 0], src: "edit" } as LedgerEntry;
  const lineOf = (i: number) =>
    JSON.stringify({ t: 1763000000000 + i, p: `笔记/${i}.md`, add: [10, 1], del: [0, 0], src: "edit" });

  for (const n of [500, 1500, 5000, 20000]) {
    await adapter.write(ledgerRel, Array.from({ length: n }, (_, i) => lineOf(i)).join("\n") + "\n");
    const kb = fs.statSync(path.join(root, ledgerRel)).size / 1024;
    await store.append([entry]); // 预热
    const t0 = performance.now();
    const rounds = 10;
    for (let k = 0; k < rounds; k++) await store.append([entry]);
    const ms = (performance.now() - t0) / rounds;

    const r0 = performance.now();
    for (let k = 0; k < rounds; k++) await store.readMonth("2026-11");
    const readMs = (performance.now() - r0) / rounds;
    console.log(
      `  账本 ${String(n).padStart(5)} 行 / ${kb.toFixed(0).padStart(4)} KB：追加 ${ms.toFixed(2)} ms，读取解析 ${readMs.toFixed(2)} ms`
    );
  }

  for (const n of [1181, 5000]) {
    store.clear();
    for (let i = 0; i < n; i++) store.set(`笔记/${i}.md`, { size: 900, mtime: 1, vec: { cjk: 300, lat: 20 } });
    await store.saveSnapshot();
    const kb = fs.statSync(path.join(root, "stats/snapshot.json")).size / 1024;
    const t0 = performance.now();
    const rounds = 5;
    for (let k = 0; k < rounds; k++) await store.saveSnapshot();
    const ms = (performance.now() - t0) / rounds;
    console.log(`  快照 ${String(n).padStart(5)} 条 / ${kb.toFixed(0).padStart(4)} KB：写盘 ${ms.toFixed(2)} ms`);
  }

  fs.rmSync(root, { recursive: true, force: true });
}
