# SixColor Stats

Obsidian 字数统计插件。核心原则：**只存事实，不存结论**。

## 为什么不用现成的

`better-word-count` 的口径是「总量重算取差」。你库里 828 天的历史数据可以验证它有多不可靠：

- 自称总共 278 万字，实际约 63.6 万汉字 + 5.7 万英文词
- 单日最高记录 1,413,934 字（那是批量导入）
- 出现过 −119 万、−192 万两次断崖

原因很简单：把「库的总字数」当成状态，任何导入、删除、移动都会污染当天的写作量。

## 本插件的模型

两个东西分开存：

```
stats/snapshot.json        存量：每个文件现在多少字（可全量重建）
stats/ledger/YYYY-MM.jsonl 流量：逐次追加的事件（永不改写）
```

事件长这样：

```json
{"t":1763200000000,"p":"创作/小说/1/第一章.md","add":[820,12],"del":[35,0],"src":"edit"}
```

`add` / `del` 都是**向量** `[汉字, 英文词]`，从不合并成一个「总字数」。
周、月、年、项目维度全部是这份账本的视图，加新图表不用改数据结构。

### src 的含义

| src | 含义 | 算不算写作 |
|---|---|---|
| `baseline` | 首次建库 | ❌ 不写账本 |
| `edit` | 本机正常编辑 | ✅ |
| `scan` | 启动时发现的差异（离线 / 同步） | ✅ |
| `delete` | 删文件 | ❌ 只记删减 |

首次建库**不写账本**，否则 63 万字会全部砸在当天。

## 计数口径

- 汉字按字计，英文/数字按词计，两者分开
- 默认不计 YAML frontmatter、代码块、行内代码
- 去掉 Markdown 符号、URL、图片；双链取显示名
- 编辑时用「公共前后缀裁剪」只数改动段，所以「删一段再写一段」能拿到真实的增删

## 开发

```bash
npm install          # 只需要 typescript + obsidian 类型
node build.mjs       # 类型检查 + 打包 main.js
node build.mjs --test --vault="E:/path/to/vault"   # 跑测试（含真实库全量扫描）
node deploy.mjs      # 安装到 .obsidian/plugins/sixcolor-stats
```

项目放在 `<库根>/.sixcolor-stats/`，Obsidian 不索引点开头的目录，
所以 `node_modules` 不会污染关系图和搜索。

打包没用 esbuild：它要 spawn 子进程走管道，在受限环境里会 EPERM。
`build.mjs` 用 TypeScript 自己的 `transpileModule` 逐文件编译，
再用四十行模块表拼成单文件，全程在当前进程内完成。

## 数据丢失风险

`stats/ledger/*.jsonl` 删掉就没了 —— 它是唯一无法重建的东西。
`snapshot.json` 随时可以删，下次启动会重扫。
