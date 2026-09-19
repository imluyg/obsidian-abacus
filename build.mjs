/**
 * 打包脚本（零原生依赖）。
 *
 * 为什么不用 esbuild：esbuild 要 spawn 一个子进程并通过管道通信，
 * 在受限环境里会直接 EPERM。这里改成「用 TypeScript 自己的
 * transpileModule 逐个编译，再用 40 行模块表拼成单文件」，
 * 全程在当前进程内完成，任何机器都能跑。
 *
 *   node build.mjs           → 类型检查 + 打包出 main.js
 *   node build.mjs --test    → 类型检查 + 编译到 .tmp/build + 跑测试
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "src");
const isTest = process.argv.includes("--test");
const vaultArg = process.argv.find((a) => a.startsWith("--vault="))?.slice(8);

/* ------------------------------- 配置 ------------------------------- */

const configPath = path.join(root, "tsconfig.json");
const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
if (readResult.error) {
  console.error("读不到 tsconfig.json");
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, root);

/* ----------------------------- BOM 自检 ----------------------------- */

// manifest.json 开头若有 UTF-8 BOM，Obsidian 的 JSON.parse 会失败，
// 而失败是静默的：插件看着装着，却永远不会加载。踩过一次，这里拦住。
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const manifestBuf = fs.readFileSync(path.join(root, "manifest.json"));
if (manifestBuf.length >= 3 && manifestBuf.subarray(0, 3).equals(BOM)) {
  console.error("manifest.json 带 UTF-8 BOM，Obsidian 会静默拒绝加载。");
  console.error("请用无 BOM 的 UTF-8 重写（Windows PowerShell 5.1 的 -Encoding utf8 会加 BOM）。");
  process.exit(1);
}

/* ----------------------------- 类型检查 ----------------------------- */

function typeCheck() {
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diags = ts.getPreEmitDiagnostics(program).filter(
    (d) => !d.file || !d.file.fileName.includes("node_modules")
  );
  if (diags.length === 0) return true;
  for (const d of diags) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const rel = path.relative(root, d.file.fileName);
      console.error(`${rel}:${line + 1}:${character + 1}  ${msg}`);
    } else {
      console.error(msg);
    }
  }
  return false;
}

if (!typeCheck()) {
  console.error("\n类型检查未通过，已停止。");
  process.exit(1);
}

/* ------------------------------- 测试 ------------------------------- */

if (isTest) {
  const outDir = path.join(root, ".tmp", "build");
  fs.rmSync(outDir, { recursive: true, force: true });
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2018,
    outDir,
    rootDir: root,
    sourceMap: false,
    declaration: false,
    noEmit: false,
  });
  const emit = program.emit();
  if (emit.emitSkipped) {
    console.error("编译失败");
    process.exit(1);
  }
  const boot = path.join(root, ".tmp", "boot.cjs");
  fs.writeFileSync(
    boot,
    `globalThis.window = globalThis;\nrequire(${JSON.stringify(path.join(outDir, "tests", "entry.js"))});\n`,
    "utf8"
  );
  const vault = vaultArg ?? root.replace(/\\\.abacus$/, "");
  const res = spawnSync(process.execPath, [boot, vault], { stdio: "inherit" });
  process.exit(res.status ?? 1);
}

/* ------------------------------ 打包 ------------------------------ */

const files = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith(".ts"))
  .sort();

const chunks = [];
for (const f of files) {
  const code = fs.readFileSync(path.join(srcDir, f), "utf8");
  const out = ts.transpileModule(code, {
    fileName: f,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2018,
      esModuleInterop: true,
      importHelpers: false,
      inlineSourceMap: false,
      removeComments: true,
    },
  }).outputText;
  chunks.push(`__modules[${JSON.stringify(f)}] = function (module, exports, require) {\n${out}\n};`);
}

const prelude = `/*
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
`;

const epilogue = `
var __entry = __require(${JSON.stringify("main.ts")});
module.exports = __entry && __entry.default ? __entry.default : __entry;
`;

fs.writeFileSync(path.join(root, "main.js"), prelude + chunks.join("\n") + epilogue, "utf8");

const kb = (fs.statSync(path.join(root, "main.js")).size / 1024).toFixed(1);
console.log(`已生成 main.js（${kb} KB，${files.length} 个模块）`);
