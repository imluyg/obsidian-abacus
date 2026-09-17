import { App, PluginSettingTab, Setting } from "obsidian";
import type SixColorStats from "./main";
import type { StatsSettings } from "./types";
import { startOfWeek } from "./stats";

export type SettingsDirtyKind = "counter" | "scan" | "display";

export class StatsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SixColorStats) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    /* ------------------------------ 口径 ------------------------------ */

    containerEl.createEl("h3", { text: "统计口径" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "改动这里会重建快照（不产生写作记录），已记录的账本不受影响。",
    });

    new Setting(containerEl)
      .setName("计入 YAML frontmatter")
      .setDesc("默认不计入：属性区是元数据，不是正文。")
      .addToggle((t) =>
        t.setValue(s.countFrontmatter).onChange(async (v) => {
          s.countFrontmatter = v;
          await this.plugin.applySettings(["counter"]);
        })
      );

    new Setting(containerEl)
      .setName("计入代码块与行内代码")
      .setDesc("默认不计入。")
      .addToggle((t) =>
        t.setValue(s.countCodeBlocks).onChange(async (v) => {
          s.countCodeBlocks = v;
          await this.plugin.applySettings(["counter"]);
        })
      );

    new Setting(containerEl)
      .setName("排除的文件夹")
      .setDesc("每行一个，相对库根目录；这些目录不扫描、不统计。")
      .addTextArea((t) => {
        t.setValue(s.excludeFolders.join("\n"));
        t.inputEl.rows = 4;
        t.inputEl.addClass("scs-textarea");
        t.onChange(async (v) => {
          s.excludeFolders = v
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
          await this.plugin.applySettings(["scan"]);
        });
      });

    /* ------------------------------ 显示 ------------------------------ */

    containerEl.createEl("h3", { text: "显示" });

    new Setting(containerEl)
      .setName("主指标包含英文词")
      .setDesc("关闭时状态栏只看汉字；两个分量在面板里始终分开显示。")
      .addToggle((t) =>
        t.setValue(s.includeLatinInPrimary).onChange(async (v) => {
          s.includeLatinInPrimary = v;
          await this.plugin.applySettings(["display"]);
        })
      );

    /* ------------------------------ 项目 ------------------------------ */

    containerEl.createEl("h3", { text: "项目分组" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "默认按路径前两段分组（创作/小说、归档/日记……）。需要更细的粒度就写规则，每行一条：`名称 = 路径前缀`，或只写路径前缀（名称取末段）。规则按前缀最长优先。",
    });

    new Setting(containerEl)
      .setName("分组规则")
      .addTextArea((t) => {
        t.setPlaceholder("小说1 = 创作/小说/1\n殷浩天 = 创作/殷浩天");
        t.setValue(s.projectRules.join("\n"));
        t.inputEl.rows = 5;
        t.inputEl.addClass("scs-textarea");
        t.onChange(async (v) => {
          s.projectRules = v
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
          await this.plugin.applySettings(["display"]);
        });
      });

    /* ------------------------------ 周报 ------------------------------ */

    containerEl.createEl("h3", { text: "周报" });

    new Setting(containerEl)
      .setName("周报目录")
      .setDesc("生成的周报会写到这里。该目录自动排除在统计之外，否则周报会被算成“今天写的字”。")
      .addText((t) =>
        t
          .setPlaceholder("归档/统计归档")
          .setValue(s.reportFolder)
          .onChange(async (v) => {
            s.reportFolder = v.trim() || "归档/统计归档";
            await this.plugin.applySettings(["scan"]);
          })
      );

    new Setting(containerEl)
      .setName("生成本周周报")
      .setDesc("写入 `周报 YYYY-Www.md`，同名会覆盖。")
      .addButton((b) =>
        b.setButtonText("生成").onClick(() => void this.plugin.generateReport(startOfWeek(Date.now()), true))
      );

    new Setting(containerEl)
      .setName("自动补生成上周周报")
      .setDesc("每次启动检查一次：上周有写作、但还没有周报文件时自动生成。")
      .addToggle((t) =>
        t.setValue(s.autoWeeklyReport).onChange(async (v) => {
          s.autoWeeklyReport = v;
          await this.plugin.applySettings(["display"]);
        })
      );

    /* ------------------------------ 数据 ------------------------------ */

    containerEl.createEl("h3", { text: "数据" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "数据目录：.obsidian/plugins/sixcolor-stats/stats/。snapshot.json 是存量（可删，会自动重建），ledger/*.jsonl 是按月追加的事件账本——后者删掉就永久丢失。",
    });

    new Setting(containerEl).setName("立即重建快照").addButton((b) =>
      b.setButtonText("重建").onClick(() => void this.plugin.rebuild())
    );

    new Setting(containerEl)
      .setName("导出账本备份")
      .setDesc("把账本合并成一个 JSON 写入下面这个目录。账本本体在 .obsidian 里不一定被同步，这份才是异地备份。")
      .addButton((b) => b.setButtonText("导出").onClick(() => void this.plugin.exportLedger()));

    new Setting(containerEl)
      .setName("账本备份目录")
      .addText((t) =>
        t
          .setPlaceholder("归档/统计归档/账本备份")
          .setValue(s.backupFolder)
          .onChange(async (v) => {
            s.backupFolder = v.trim() || "归档/统计归档/账本备份";
            await this.plugin.applySettings(["display"]);
          })
      );
  }
}
