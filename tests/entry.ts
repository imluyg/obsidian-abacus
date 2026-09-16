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
import { DEFAULT_SETTINGS } from "../src/types";
import { countMarkdown, diffCounts } from "../src/counter";
import { StatsStore, parseLedger } from "../src/store";
import { Scanner } from "../src/scanner";
import {
  byDay,
  isoWeek,
  isExcludedPath,
  parseProjectRules,
  projectOf,
  startOfDay,
  streakFrom,
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
  scanner.scheduleEdit("笔记/a.md");
  await sleep(260);
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

  // 删除
  await scanner.handleDelete("笔记/b.md");
  const afterDelete = await store.readMonth(monthNow());
  check("删除产生记录", afterDelete.some((e) => e.src === "delete"), true);
  check("删除不计入写作", sumWriting(afterDelete, startOfDay(), Date.now() + 1).add.cjk, 6);

  // 重启：快照从盘上读回来
  const store2 = new StatsStore("", new FsAdapter(data));
  await store2.load();
  check("重启后快照条数", store2.size(), 1);
  check("重启后总计", store2.total().cjk, 14);
  const raw = fs.readFileSync(path.join(data, "stats", "ledger", `${monthNow()}.jsonl`), "utf8");
  check("账本是合法 JSONL", parseLedger(raw).length, afterDelete.length);

  fs.rmSync(root, { recursive: true, force: true });
}

async function testRealVault(vaultRoot: string): Promise<void> {
  console.log(`\n[4] 真实库扫描：${vaultRoot}`);
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
  check("二次扫描无变更", again.changed, 0);

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
}

async function main(): Promise<void> {
  await testCounter();
  await testStatsHelpers();
  await testLedgerFlow();
  const vault = process.argv[2];
  if (vault && fs.existsSync(vault)) await testRealVault(vault);
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
