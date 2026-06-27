/* Presentation Launcher for Obsidian */
"use strict";

const {
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath
} = require("obsidian");

const VIEW_TYPE_PRESENTATION_LAUNCHER = "presentation-launcher-view";
const DEFAULT_SETTINGS = {
  slidesFolderPath: "Regions/Limgrave/Slides",
  contentFilter: "none",
  advancedSlidesCommandId: ""
};
const COMMAND_SEARCH_TERMS = ["advanced-slides", "slides", "open", "browser"];
const PREFERRED_ADVANCED_SLIDES_BROWSER_COMMAND_IDS = [
  "obsidian-advanced-slides:open-in-browser",
  "obsidian-advanced-slides:open-browser",
  "obsidian-advanced-slides:open-presentation-in-browser",
  "obsidian-advanced-slides:open-current-presentation-in-browser",
  "obsidian-advanced-slides:open-slides-in-browser",
  "obsidian-advanced-slides:show-in-browser"
];
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

class PresentationLauncherPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.view = null;

    this.registerView(
      VIEW_TYPE_PRESENTATION_LAUNCHER,
      (leaf) => new PresentationLauncherView(leaf, this)
    );

    this.addRibbonIcon("presentation", "Presentation Launcher", () => {
      void this.openLauncher();
    });

    this.addCommand({
      id: "open-presentation-launcher",
      name: "Open Presentation Launcher",
      callback: () => {
        void this.openLauncher();
      }
    });

    this.addCommand({
      id: "open-current-slide-file-in-browser",
      name: "Open current slide file in browser",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          return false;
        }

        if (!checking) {
          void this.openPresentationInBrowser(file);
        }
        return true;
      }
    });

    this.addCommand({
      id: "refresh-presentation-list",
      name: "Refresh presentation list",
      callback: () => {
        void this.refreshPresentationList();
      }
    });

    this.addSettingTab(new PresentationLauncherSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PRESENTATION_LAUNCHER);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.refreshPresentationList();
  }

  async openLauncher() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PRESENTATION_LAUNCHER)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_PRESENTATION_LAUNCHER,
        active: true
      });
    }

    this.app.workspace.revealLeaf(leaf);
    await this.refreshPresentationList();
  }

  async refreshPresentationList() {
    if (this.view) {
      await this.view.refreshList();
    }
  }

  async getPresentationFiles() {
    const folderPath = normalizePath(this.settings.slidesFolderPath.trim()).replace(/\/$/, "");
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isInConfiguredFolder(file, folderPath))
      .sort((a, b) => a.path.localeCompare(b.path, "de"));

    if (this.settings.contentFilter === "none") {
      return files;
    }

    const filtered = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      if (content.includes("---") || /slide/i.test(content)) {
        filtered.push(file);
      }
    }

    return filtered;
  }

  async openPresentationInBrowser(file) {
    await this.openFile(file);
    await sleep(350);

    const result = await this.executeAdvancedSlidesBrowserCommand();
    if (!result) {
      new Notice(
        "Kein passender Advanced-Slides-Befehl gefunden. Trage die Command-ID in den Presentation-Launcher-Einstellungen ein."
      );
    }
  }

  getKnownAdvancedSlidesCommands() {
    const commands = this.getCommandRegistry();
    return Object.values(commands)
      .map((command) => ({ id: command.id, name: command.name }))
      .filter((command) => this.commandLooksRelevant(command))
      .sort((a, b) => this.scoreCommand(b) - this.scoreCommand(a));
  }

  async openFile(file) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    const markdownLeaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) => {
      const view = candidate.view;
      return view instanceof MarkdownView && view.file?.path === file.path;
    });

    if (markdownLeaf) {
      this.app.workspace.setActiveLeaf(markdownLeaf, { focus: true });
    }
  }

  async executeAdvancedSlidesBrowserCommand() {
    const override = this.settings.advancedSlidesCommandId.trim();
    if (override) {
      if (this.executeCommandById(override)) {
        return true;
      }

      new Notice(`Advanced-Slides-Command-ID nicht gefunden: ${override}`);
      return false;
    }

    const candidates = this.getBrowserCommandCandidates();
    for (const command of candidates) {
      if (this.executeCommandById(command.id)) {
        new Notice(`Presentation im Browser geöffnet: ${command.name}`);
        return true;
      }
    }

    return false;
  }

  executeCommandById(commandId) {
    const commandsApi = this.getCommandsApi();
    if (!commandsApi?.commands?.[commandId]) {
      return false;
    }

    try {
      commandsApi.executeCommandById(commandId);
      return true;
    } catch (error) {
      console.error(`Presentation Launcher failed to run command ${commandId}`, error);
      return false;
    }
  }

  getCommandRegistry() {
    return this.getCommandsApi()?.commands ?? {};
  }

  getBrowserCommandCandidates() {
    const commands = this.getCommandRegistry();
    const preferredCommands = PREFERRED_ADVANCED_SLIDES_BROWSER_COMMAND_IDS
      .map((id) => commands[id])
      .filter((command) => Boolean(command));

    const discoveredCommands = Object.values(commands)
      .filter((command) => this.commandLooksBrowserRelevant(command))
      .sort((a, b) => this.scoreCommand(b) - this.scoreCommand(a));

    const seen = new Set();
    return [...preferredCommands, ...discoveredCommands].filter((command) => {
      if (seen.has(command.id)) {
        return false;
      }
      seen.add(command.id);
      return true;
    });
  }

  getCommandsApi() {
    return this.app.commands ?? null;
  }

  isInConfiguredFolder(file, folderPath) {
    if (!folderPath || folderPath === "." || folderPath === "/") {
      return true;
    }

    return file.path === folderPath || file.path.startsWith(`${folderPath}/`);
  }

  commandLooksRelevant(command) {
    if (command.id.startsWith(`${this.manifest.id}:`)) {
      return false;
    }

    const haystack = `${command.id} ${command.name}`.toLowerCase();
    return COMMAND_SEARCH_TERMS.some((term) => haystack.includes(term)) && this.scoreCommand(command) > 0;
  }

  commandLooksBrowserRelevant(command) {
    if (!this.commandLooksRelevant(command)) {
      return false;
    }

    const haystack = `${command.id} ${command.name}`.toLowerCase();
    return haystack.includes("browser") && (haystack.includes("advanced-slides") || haystack.includes("slides"));
  }

  scoreCommand(command) {
    const haystack = `${command.id} ${command.name}`.toLowerCase();
    let score = 0;

    if (haystack.includes("advanced-slides")) score += 100;
    if (haystack.includes("browser")) score += 40;
    if (haystack.includes("open")) score += 20;
    if (haystack.includes("slides")) score += 10;
    if (haystack.includes("preview")) score -= 15;
    if (haystack.includes("export")) score -= 20;
    if (haystack.includes("launcher")) score -= 100;

    return score;
  }
}

module.exports = PresentationLauncherPlugin;
module.exports.default = PresentationLauncherPlugin;

class PresentationLauncherView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.files = [];
    this.searchTerm = "";
  }

  getViewType() {
    return VIEW_TYPE_PRESENTATION_LAUNCHER;
  }

  getDisplayText() {
    return "Presentation Launcher";
  }

  getIcon() {
    return "presentation";
  }

  async onOpen() {
    this.plugin.view = this;
    await this.refreshList();
  }

  async onClose() {
    if (this.plugin.view === this) {
      this.plugin.view = null;
    }
  }

  async refreshList() {
    this.files = await this.plugin.getPresentationFiles();
    this.render();
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();

    const root = container.createDiv({ cls: "presentation-launcher" });
    const toolbar = root.createDiv({ cls: "presentation-launcher__toolbar" });

    const search = toolbar.createEl("input", {
      cls: "presentation-launcher__search",
      attr: {
        type: "search",
        placeholder: "Präsentationen suchen"
      }
    });
    search.value = this.searchTerm;
    search.addEventListener("input", () => {
      this.searchTerm = search.value;
      this.render();
      const refreshedSearch = this.containerEl.querySelector(".presentation-launcher__search");
      refreshedSearch?.focus();
    });

    const refreshButton = toolbar.createEl("button", { text: "Refresh" });
    refreshButton.addEventListener("click", () => {
      void this.refreshList();
    });

    const shownFiles = this.getShownFiles();
    root.createDiv({
      cls: "presentation-launcher__meta",
      text: `${shownFiles.length} von ${this.files.length} Präsentationen`
    });

    const list = root.createDiv({ cls: "presentation-launcher__list" });
    if (shownFiles.length === 0) {
      list.createDiv({
        cls: "presentation-launcher__empty",
        text: "Keine passenden Markdown-Präsentationen gefunden."
      });
      return;
    }

    for (const file of shownFiles) {
      const item = list.createEl("button", { cls: "presentation-launcher__item" });
      item.createDiv({ cls: "presentation-launcher__title", text: file.basename });
      item.createDiv({ cls: "presentation-launcher__path", text: file.path });
      item.addEventListener("click", () => {
        void this.plugin.openPresentationInBrowser(file);
      });
    }
  }

  getShownFiles() {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.files;
    }

    return this.files.filter((file) => file.path.toLowerCase().includes(term));
  }
}

class PresentationLauncherSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Presentation Launcher" });

    new Setting(containerEl)
      .setName("Slides-Ordnerpfad")
      .setDesc("Vault-relativer Ordner, der rekursiv nach Markdown-Präsentationen durchsucht wird.")
      .addText((text) => {
        text
          .setPlaceholder("Regions/Limgrave/Slides")
          .setValue(this.plugin.settings.slidesFolderPath)
          .onChange(async (value) => {
            this.plugin.settings.slidesFolderPath = normalizePath(value.trim());
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Inhaltsfilter")
      .setDesc("Optional nur Dateien anzeigen, die nach Slides aussehen.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("none", "Alle Markdown-Dateien anzeigen")
          .addOption("frontmatter-or-slide", "Nur Dateien mit --- oder slide im Inhalt")
          .setValue(this.plugin.settings.contentFilter)
          .onChange(async (value) => {
            this.plugin.settings.contentFilter = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Advanced-Slides-Command-ID Override")
      .setDesc("Optional. Wenn gesetzt, wird genau diese Command-ID ausgeführt.")
      .addText((text) => {
        text
          .setPlaceholder("obsidian-advanced-slides:...")
          .setValue(this.plugin.settings.advancedSlidesCommandId)
          .onChange(async (value) => {
            this.plugin.settings.advancedSlidesCommandId = value.trim();
            await this.plugin.saveSettings();
          });
      });

    const commands = this.plugin.getKnownAdvancedSlidesCommands();
    const commandSection = containerEl.createDiv();
    commandSection.createEl("h3", { text: "Gefundene passende Commands" });

    if (commands.length === 0) {
      commandSection.createEl("p", {
        text: "Aktuell wurden keine passenden Commands in der Obsidian Command Registry gefunden."
      });
      return;
    }

    const list = commandSection.createEl("ul");
    for (const command of commands.slice(0, 20)) {
      const item = list.createEl("li");
      item.createEl("code", { text: command.id });
      item.appendText(` - ${command.name}`);
    }
  }
}
