import { App, PluginSettingTab, Setting } from "obsidian";
import type AbacusPlugin from "./main";
import type { StatsSettings } from "./types";
import { startOfWeek } from "./stats";
import { L } from "./i18n";

export type SettingsDirtyKind = "counter" | "scan" | "display";

export class StatsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AbacusPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const t = L();

    /* ------------------------------ 口径 ------------------------------ */

    containerEl.createEl("h3", { text: t.sCounter });
    containerEl.createEl("p", { cls: "setting-item-description", text: t.sCounterDesc });

    new Setting(containerEl)
      .setName(t.sFrontmatter)
      .setDesc(t.sFrontmatterDesc)
      .addToggle((c) =>
        c.setValue(s.countFrontmatter).onChange(async (v) => {
          s.countFrontmatter = v;
          await this.plugin.applySettings(["counter"]);
        })
      );

    new Setting(containerEl)
      .setName(t.sCode)
      .setDesc(t.sCodeDesc)
      .addToggle((c) =>
        c.setValue(s.countCodeBlocks).onChange(async (v) => {
          s.countCodeBlocks = v;
          await this.plugin.applySettings(["counter"]);
        })
      );

    new Setting(containerEl)
      .setName(t.sExclude)
      .setDesc(t.sExcludeDesc)
      .addTextArea((c) => {
        c.setValue(s.excludeFolders.join("\n"));
        c.inputEl.rows = 4;
        c.inputEl.addClass("scs-textarea");
        c.onChange(async (v) => {
          s.excludeFolders = v
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
          await this.plugin.applySettings(["scan"]);
        });
      });

    /* ------------------------------ 属性 ------------------------------ */

    containerEl.createEl("h3", { text: t.sProps });
    containerEl.createEl("p", { cls: "setting-item-description", text: t.sPropsDesc });

    new Setting(containerEl)
      .setName(t.sWriteProp)
      .setDesc(t.sWritePropDesc)
      .addToggle((c) =>
        c.setValue(s.writeFrontmatter).onChange(async (v) => {
          s.writeFrontmatter = v;
          await this.plugin.applySettings(["display"]);
        })
      );

    new Setting(containerEl)
      .setName(t.sPropKey)
      .setDesc(t.sPropKeyDesc)
      .addText((c) =>
        c
          .setPlaceholder("words")
          .setValue(s.frontmatterKey)
          .onChange(async (v) => {
            s.frontmatterKey = v.trim() || "words";
            await this.plugin.applySettings(["display"]);
          })
      );

    /* ------------------------------ 显示 ------------------------------ */

    containerEl.createEl("h3", { text: t.sDisplay });

    new Setting(containerEl)
      .setName(t.sStatusBar)
      .setDesc(t.sStatusBarDesc)
      .addDropdown((c) =>
        c
          .addOption("full", t.sStatusFull)
          .addOption("primary", t.sStatusPrimary)
          .addOption("off", t.sStatusOff)
          .setValue(s.statusBarMode)
          .onChange(async (v) => {
            s.statusBarMode = v as StatsSettings["statusBarMode"];
            await this.plugin.applySettings(["display"]);
          })
      );

    new Setting(containerEl)
      .setName(t.sLatinPrimary)
      .setDesc(t.sLatinPrimaryDesc)
      .addToggle((c) =>
        c.setValue(s.includeLatinInPrimary).onChange(async (v) => {
          s.includeLatinInPrimary = v;
          await this.plugin.applySettings(["display"]);
        })
      );

    /* ------------------------------ 目标 ------------------------------ */

    containerEl.createEl("h3", { text: t.sGoals });
    containerEl.createEl("p", { cls: "setting-item-description", text: t.sGoalsDesc });

    new Setting(containerEl).setName(t.sDailyGoal).addText((c) => {
      c.inputEl.type = "number";
      c.setPlaceholder("0")
        .setValue(String(s.dailyGoal ?? 0))
        .onChange(async (v) => {
          s.dailyGoal = Math.max(0, Math.floor(Number(v) || 0));
          await this.plugin.applySettings(["display"]);
        });
    });

    new Setting(containerEl).setName(t.sWeeklyGoal).addText((c) => {
      c.inputEl.type = "number";
      c.setPlaceholder("0")
        .setValue(String(s.weeklyGoal ?? 0))
        .onChange(async (v) => {
          s.weeklyGoal = Math.max(0, Math.floor(Number(v) || 0));
          await this.plugin.applySettings(["display"]);
        });
    });

    /* ------------------------------ 项目 ------------------------------ */

    containerEl.createEl("h3", { text: t.sProject });
    containerEl.createEl("p", { cls: "setting-item-description", text: t.sProjectDesc });

    new Setting(containerEl).setName(t.sRules).addTextArea((c) => {
      c.setPlaceholder("小说1 = 创作/小说/1\n设定集 = 创作/设定集");
      c.setValue(s.projectRules.join("\n"));
      c.inputEl.rows = 5;
      c.inputEl.addClass("scs-textarea");
      c.onChange(async (v) => {
        s.projectRules = v
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        await this.plugin.applySettings(["display"]);
      });
    });

    /* ------------------------------ 报告 ------------------------------ */

    containerEl.createEl("h3", { text: t.sReport });

    new Setting(containerEl)
      .setName(t.sYearReport)
      .setDesc(t.sYearReportDesc)
      .addButton((b) => b.setButtonText(t.sGenerate).onClick(() => void this.plugin.writeYearReport()));

    new Setting(containerEl)
      .setName(t.sCsv)
      .setDesc(t.sCsvDesc)
      .addButton((b) => b.setButtonText(t.sExport).onClick(() => void this.plugin.exportCsv()));

    new Setting(containerEl)
      .setName(t.sWeekly)
      .setDesc(t.sWeeklyDesc)
      .addButton((b) =>
        b.setButtonText(t.sGenerate).onClick(() => void this.plugin.generateReport(startOfWeek(Date.now()), true))
      );

    new Setting(containerEl)
      .setName(t.sAutoWeekly)
      .setDesc(t.sAutoWeeklyDesc)
      .addToggle((c) =>
        c.setValue(s.autoWeeklyReport).onChange(async (v) => {
          s.autoWeeklyReport = v;
          await this.plugin.applySettings(["display"]);
        })
      );

    new Setting(containerEl)
      .setName(t.sReportFolder)
      .setDesc(t.sReportFolderDesc)
      .addText((c) =>
        c
          .setPlaceholder("归档/统计归档")
          .setValue(s.reportFolder)
          .onChange(async (v) => {
            s.reportFolder = v.trim() || "归档/统计归档";
            await this.plugin.applySettings(["scan"]);
          })
      );

    /* ------------------------------ 数据 ------------------------------ */

    containerEl.createEl("h3", { text: t.sData });
    containerEl.createEl("p", { cls: "setting-item-description", text: t.sDataDesc });

    new Setting(containerEl)
      .setName(t.sRebuild)
      .addButton((b) => b.setButtonText(t.sRebuildBtn).onClick(() => void this.plugin.rebuild()));

    new Setting(containerEl)
      .setName(t.sBackup)
      .setDesc(t.sBackupDesc)
      .addButton((b) => b.setButtonText(t.sExport).onClick(() => void this.plugin.exportLedger()));

    new Setting(containerEl)
      .setName(t.sRestore)
      .setDesc(t.sRestoreDesc)
      .addButton((b) =>
        b.setButtonText(t.sRestoreBtn).onClick(() => void this.plugin.restoreLedger())
      );

    new Setting(containerEl).setName(t.sBackupFolder).addText((c) =>
      c
        .setPlaceholder("归档/统计归档/账本备份")
        .setValue(s.backupFolder)
        .onChange(async (v) => {
          s.backupFolder = v.trim() || "归档/统计归档/账本备份";
          await this.plugin.applySettings(["display"]);
        })
    );

    new Setting(containerEl)
      .setName(t.sAutoBackup)
      .setDesc(t.sAutoBackupDesc)
      .addText((c) => {
        c.inputEl.type = "number";
        c.setPlaceholder("7")
          .setValue(String(s.backupIntervalDays ?? 0))
          .onChange(async (v) => {
            s.backupIntervalDays = Math.max(0, Math.floor(Number(v) || 0));
            await this.plugin.applySettings(["display"]);
          });
      });
  }
}
