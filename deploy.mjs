/**
 * 把构建产物装进 Obsidian 插件目录。
 *
 *   node deploy.mjs
 *
 * 项目固定放在 <库根>/.sixcolor-stats（点开头，Obsidian 不会索引，
 * 也不会出现在关系图和搜索结果里）；插件本体装在
 * <库根>/.obsidian/plugins/sixcolor-stats。
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

fs.mkdirSync(target, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) {
  const from = path.join(project, f);
  if (!fs.existsSync(from)) {
    console.error(`缺少 ${f}，先跑 node build.mjs`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(target, f));
}

console.log(`已安装到 ${target}`);
console.log(files.map((f) => `  ${f}`).join("\n"));
console.log("\n在 Obsidian 里：设置 → 第三方插件 → 重新载入，然后启用 SixColor Stats。");
