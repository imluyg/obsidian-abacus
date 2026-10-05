# Abacus

**Treat your writing output as a ledger.** An Obsidian plugin that counts CJK characters and English words separately, and tracks them per file, per day, per project.

> 中文说明见 [README.md](./README.md).

Fully local: no network requests, no telemetry.

---

## Why not the existing word-count plugins

Most word counters take a shortcut: total characters today minus total characters yesterday. That model has a fatal flaw — **any bulk import, deletion, or file move becomes fake writing output**.

Abacus stores two things separately:

```
snapshot (stock)   how many characters each file has right now; fully rebuildable
ledger   (flow)    append-only events, never rewritten
```

Every statistic — day, week, month, project, streak — is a view over the ledger. So:

- Importing 50 articles doesn't become "wrote 140k characters today"
- Renaming a file doesn't produce a negative day
- Losing the snapshot doesn't lose history; only the ledger is irreplaceable

## Features

- **Separate components**: CJK characters and English/number words are counted independently — never merged into one "total"
- **Daily accounting**: today, this week, this month, whole vault; 7 / 30 day bar chart
- **Streaks**: today not yet written doesn't break the streak; yesterday without writing does
- **Goals**: optional daily/weekly target with a progress bar
- **Projects**: grouped by path, click to drill into files; rules can narrow down to a single book
- **Weekly / yearly reports**: written into your vault; the yearly one includes an HTML heatmap
- **CSV export**: daily totals for Excel or scripting
- **Ledger self-check**: bad lines, truncation, duplicates, future timestamps — shown persistently
- **Restorable ledger**: merge a backup JSON back into the ledger, deduplicating events; the current ledger is backed up first
- **Auto-backup**: export a full ledger on startup when the interval has elapsed
- **Multi-device safe**: the ledger is split per device, so sync conflicts don't overwrite each other
- **Optional frontmatter write-back**: expose the count to Bases / Dataview

## Install

Not in the community store yet. Either:

**Manual** — copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/abacus/`, then enable it under Settings → Community plugins.

**BRAT** — install the BRAT plugin and add this repository.

## Commands

| Command | What it does |
| --- | --- |
| Open stats panel | Sidebar panel |
| Rebuild vault snapshot | Re-count after changing rules (records no writing) |
| Generate this week's / last week's report | Written into the report folder |
| Generate yearly report | Heatmap, per-month, projects, top files |
| Export ledger backup | Merged JSON into a normal vault folder |
| Restore ledger from backup | Pick a JSON backup and merge it back (duplicates skipped) |
| Export ledger as CSV | Daily totals |
| Write word count to current note | One-off frontmatter write |
| Check ledger integrity | Audit report |

## Data & privacy

**The plugin never goes online.** There is no `fetch`, `requestUrl`, WebSocket or telemetry call anywhere in the code, and no external URLs.

Everything is written locally:

```
.obsidian/plugins/abacus/
├── data.json              settings
└── stats/
    ├── snapshot.json      stock snapshot (deletable, rebuilt automatically)
    └── ledger/
        ├── 2026-11.<device-id>.jsonl           monthly append-only event log
        └── 2026-11.imported.<device-id>.jsonl  events restored from a backup
```

Each ledger line contains a **note path** and counts — never note content:

```json
{"t":1763200000000,"p":"novel/chapter-1.md","add":[820,12],"del":[35,0],"src":"edit"}
```

The device id is random and lives in `localStorage` (not `data.json`, which would sync and defeat the purpose).

A backup is a merged JSON written to `backupFolder` (default `归档/统计归档/账本备份`). Backup filenames carry the device id; the safety backup taken before an import also carries a timestamp, so it never overwrites the file you are restoring.

## Design notes

**Append-only ledger.** Each event carries a `src`: `baseline` (first scan, not counted as writing), `edit` (local edit), `scan` (changes found at startup), `delete` (file deleted, not counted as writing).

**The first scan writes no ledger entries** — otherwise the whole vault would land on the day you installed the plugin.

**Torn tail repair.** If a sync conflict left a half line at the end of the ledger, it is dropped before appending — otherwise the new line would fuse with the broken one permanently.

**Low write amplification.** When the file size still matches what we last wrote, we append directly; time is independent of file size. Only a size mismatch falls back to read → repair → rewrite.

**Imports live in their own file.** Restored events go to `*.imported.<device>.jsonl`; the native append-only files stay untouched. Reads deduplicate by event, so importing the same backup twice does not double the counts. The audit still reports raw duplicates for inspection.

## Development

```bash
npm install
node build.mjs        # type-check + bundle main.js
node build.mjs --test --vault=/path/to/vault   # tests, including a full scan of a real vault
node deploy.mjs       # install into .obsidian/plugins/abacus
```

The build does not use esbuild: it spawns a child process over pipes, which fails with EPERM in restricted environments. `build.mjs` uses TypeScript's own `transpileModule` per file and joins the modules with a small registry, entirely in-process.

## Known limitations

- Markdown only. Notes that render through Dataview, with data living in YAML properties, contribute almost nothing.
- Counting rules are fixed (CJK per character, English per word, frontmatter and code blocks excluded by default); no custom regex yet.
- When importing a backup from another device, only exactly identical events (timestamp, path, add/del, source) are deduplicated. The same writing recorded separately on two devices may still double-count; run a ledger check after importing.
- Generated reports are Chinese-only for now.
- Desktop and mobile both work in theory; mobile is untested.

## License

MIT
