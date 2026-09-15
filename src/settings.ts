import { App, PluginSettingTab, Setting } from "obsidian";
import type SixColorStats from "./main";
import type { StatsSettings } from "./types";

export class StatsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SixColorStats) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    containerEl.createEl("h3", { text: "统计口径" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "改动这里会让插件重建快照（不产生写作记录），历史账本不受影响。",
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

    containerEl.createEl("h3", { text: "显示" });

    new Setting(containerEl)
      .setName("主指标包含英文词")
      .setDesc("关闭时状态栏与排序只看汉字；两个分量在面板里始终分开显示。")
      .addToggle((t) =>
        t.setValue(s.includeLatinInPrimary).onChange(async (v) => {
          s.includeLatinInPrimary = v;
          await this.plugin.applySettings(["display"]);
        })
      );

    new Setting(containerEl)
      .setName("柱状图天数")
      .addSlider((sl) =>
        sl
          .setLimits(7, 30, 1)
          .setValue(s.chartDays)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.chartDays = v;
            await this.plugin.applySettings(["display"]);
          })
      );

    containerEl.createEl("h3", { text: "数据" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "数据目录：.obsidian/plugins/sixcolor-stats/stats/。snapshot.json 是存量，ledger/*.jsonl 是按月追加的事件账本——后者删掉就永久丢失。",
    });

    new Setting(containerEl).setName("立即重建快照").addButton((b) =>
      b.setButtonText("重建").onClick(() => void this.plugin.rebuild())
    );
  }
}

export type SettingsDirtyKind = "counter" | "scan" | "display";

export function applyToSettings(target: StatsSettings, patch: Partial<StatsSettings>): StatsSettings {
  return Object.assign({}, target, patch);
}
