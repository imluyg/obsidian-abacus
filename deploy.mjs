/**
 * 把构建产物装进 Obsidian 插件目录。
 *
 *   node deploy.mjs
 *
 * 项目固定放在 <库根>/.sixcolor-stats（点开头，Obsidian 不会索引，
 * 也不会出现在关系图和搜索结果里）；插件本体装在
 * <库根>/.obsidian/plugins/sixcolor-stats。
 *
 * 注意：部署时会去掉 UTF-8 BOM。Obsidian 用 JSON.parse 读 manifest.json，
 * 开头三个字节的 BOM 会让它解析失败，而失败是**静默**的——插件看起来
 * 装着、却永远不会加载。这个坑踩过一次，所以在这里堵死。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(project, "..");
const target = path.join(vault, ".obsidian", "plugins", "sixcolor-stats");

if (!fs.existsSync(path.join(vault, ".obsidian"))) {
  console.error(`没找到 Obsidian 配置目录：${path.join(vault, ".obsidian")}`);
  console.error("请把本项目放在库根目录下的 .sixcolor-stats 里。");
  process.exit(1);
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function stripBom(buf) {
  return buf.length >= 3 && buf.subarray(0, 3).equals(BOM) ? buf.subarray(3) : buf;
}

fs.mkdirSync(target, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
const warnings = [];

for (const f of files) {
  const from = path.join(project, f);
  if (!fs.existsSync(from)) {
    console.error(`缺少 ${f}，先跑 node build.mjs`);
    process.exit(1);
  }
  const raw = fs.readFileSync(from);
  const data = stripBom(raw);
  if (data.length !== raw.length) warnings.push(`${f} 带 UTF-8 BOM，已去掉`);
  fs.writeFileSync(path.join(target, f), data);
}

// 清单自检：能解析、字段齐全，否则 Obsidian 加载不了
let manifest;
try {
  manifest = JSON.parse(stripBom(fs.readFileSync(path.join(target, "manifest.json"))).toString("utf8"));
} catch (err) {
  console.error(`manifest.json 解析失败：${err.message}`);
  process.exit(1);
}
for (const key of ["id", "name", "version", "minAppVersion"]) {
  if (!manifest[key]) {
    console.error(`manifest.json 缺少字段 ${key}`);
    process.exit(1);
  }
}
if (manifest.id !== path.basename(target)) {
  warnings.push(`manifest.id(${manifest.id}) 与目录名(${path.basename(target)}) 不一致`);
}

console.log(`已安装 ${manifest.name} ${manifest.version} → ${target}`);
for (const f of files) console.log(`  ${f}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
