import type { CounterSettings, Vec } from "./types";

/**
 * 计数引擎：把一篇 Markdown 变成 { 汉字, 英文词 } 两个分量。
 *
 * 设计原则：**宁可少算，不可乱算**。计数口径写死在这里，
 * 每次改动都要能在 tests 里复现，否则历史曲线会突然断层。
 */

const CJK_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_G = /[A-Za-z0-9]+/g;

/**
 * 剥离 Markdown 结构，只留“可读的文字”。
 * 顺序有讲究：先去注释和代码，再去链接，最后去掉符号。
 */
export function stripMarkdown(src: string, opts: CounterSettings): string {
  let t = src.replace(/\r\n?/g, "\n");

  // YAML frontmatter
  if (!opts.countFrontmatter) {
    t = t.replace(/^\uFEFF?---\n[\s\S]*?\n---[ \t]*(\n|$)/, "");
  }

  // 代码块与行内代码
  if (!opts.countCodeBlocks) {
    t = t.replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, " ");
    t = t.replace(/`[^`\n]*`/g, " ");
  }

  // 注释：HTML 与 Obsidian 的 %%
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/%%[\s\S]*?%%/g, " ");

  // 嵌入与图片（避免转述内容被重复计数）
  t = t.replace(/!\[\[[^\]]*\]\]/g, " ");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");

  // 双链：保留显示名；裸链接保留目标名
  t = t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, (_m, _alias: string | undefined, label: string) => label ?? "");

  // 普通链接：保留文字，丢掉 URL
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");

  // 标题、引用、列表、任务标记
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  t = t.replace(/^[ \t]{0,3}[-*+][ \t]+\[[ xX]\][ \t]+/gm, "");
  t = t.replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, "");

  // 表格：分隔行整行去掉，竖线换成空格
  t = t.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|[ \t:|-]*$/gm, "");
  t = t.replace(/\|/g, " ");

  // 强调与高亮符号
  t = t.replace(/\*\*|__|~~|==|\*/g, "");

  // 块引用 ID 行
  t = t.replace(/^[ \t]*\^[A-Za-z0-9-]+[ \t]*$/gm, "");

  // Templater 与数学块
  t = t.replace(/<%[\s\S]*?%>/g, " ");
  t = t.replace(/\$\$[\s\S]*?\$\$/g, " ");

  return t;
}

/** 数一段已经剥离过的文本 */
export function countPlain(text: string): Vec {
  const cjk = text.match(CJK_G)?.length ?? 0;
  const lat = text.match(LATIN_G)?.length ?? 0;
  return { cjk, lat };
}

/** 数一篇 Markdown 原文 */
export function countMarkdown(src: string, opts: CounterSettings): Vec {
  return countPlain(stripMarkdown(src, opts));
}

/**
 * 只数“改动的那一段”：裁掉公共前后缀，分别数新增和删除。
 *
 * 为什么不用整篇差：删掉一段再写一段同样长的话，
 * 整篇差会得到 0，看起来像没写；这里能拿到真实的增删。
 */
export function diffCounts(
  prev: string,
  next: string,
  opts: CounterSettings
): { add: Vec; del: Vec } {
  if (prev === next) return { add: { cjk: 0, lat: 0 }, del: { cjk: 0, lat: 0 } };

  const maxStart = Math.min(prev.length, next.length);
  let start = 0;
  while (start < maxStart && prev.charCodeAt(start) === next.charCodeAt(start)) start++;

  const maxEnd = Math.min(prev.length, next.length) - start;
  let end = 0;
  while (
    end < maxEnd &&
    prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
  ) {
    end++;
  }

  const addedPart = next.slice(start, next.length - end);
  const removedPart = prev.slice(start, prev.length - end);
  return {
    add: countMarkdown(addedPart, opts),
    del: countMarkdown(removedPart, opts),
  };
}
