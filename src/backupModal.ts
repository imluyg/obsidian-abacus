import { App, Modal, Setting, SuggestModal } from "obsidian";
import type { BackupCandidate, ParsedBackup } from "./backup";
import { L } from "./i18n";

export class BackupPickerModal extends SuggestModal<BackupCandidate> {
  constructor(
    app: App,
    private candidates: BackupCandidate[],
    private onChoose: (candidate: BackupCandidate) => void
  ) {
    super(app);
    this.setPlaceholder(L().restorePickPlaceholder);
  }

  getSuggestions(query: string): BackupCandidate[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.candidates;
    return this.candidates.filter((c) => c.name.toLowerCase().includes(q));
  }

  renderSuggestion(item: BackupCandidate, el: HTMLElement): void {
    el.createDiv({ text: item.name });
    const meta = [item.date, item.device ? `${L().restoreDevice} ${item.device}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (meta) el.createDiv({ cls: "setting-item-description", text: meta });
  }

  onChooseSuggestion(item: BackupCandidate): void {
    this.onChoose(item);
  }
}

export interface RestoreConfirmOptions {
  fileName: string;
  parsed: ParsedBackup;
  fresh: number;
  duplicates: number;
  currentDevice: string;
  currentVault: string;
  onConfirm: () => void;
}

export class RestoreConfirmModal extends Modal {
  constructor(app: App, private opts: RestoreConfirmOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const { parsed } = this.opts;
    const total = parsed.entries.length + parsed.bad;

    contentEl.createEl("h2", { text: L().restoreTitle });
    contentEl.createEl("p", {
      text: L().restoreSummary(total, this.opts.fresh, this.opts.duplicates, parsed.bad),
    });
    contentEl.createEl("p", { text: `${L().restoreSource}: ${this.opts.fileName}` });

    if (parsed.vault) {
      contentEl.createEl("p", { text: `${L().restoreVault}: ${parsed.vault}` });
    }
    if (parsed.exportedBy) {
      contentEl.createEl("p", { text: `${L().restoreDevice}: ${parsed.exportedBy}` });
    }
    if (parsed.exportedBy && parsed.exportedBy !== this.opts.currentDevice) {
      contentEl.createEl("p", { cls: "setting-item-description", text: L().restoreOtherDevice });
    }
    if (parsed.vault && parsed.vault !== this.opts.currentVault) {
      contentEl.createEl("p", { cls: "setting-item-description", text: L().restoreOtherVault });
    }
    if (parsed.newerVersion !== undefined) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: L().restoreNewerVersion(parsed.newerVersion),
      });
    }

    contentEl.createEl("p", { cls: "setting-item-description", text: L().restoreSafety });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(L().cancel).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(L().restoreConfirm)
          .setCta()
          .onClick(() => {
            this.close();
            this.opts.onConfirm();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
