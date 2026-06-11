const obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
  enableReadingMode: true,
  enableLivePreview: true,
  previewMode: true
};

const OUTCOME_CONFIG = {
  "+": {
    order: 0,
    label: "Success",
    className: "success",
    icon: "+"
  },
  "-": {
    order: 1,
    label: "Failure",
    className: "failure",
    icon: "-"
  },
  "++": {
    order: 2,
    label: "Critical Success",
    className: "critical-success",
    icon: "++"
  },
  "--": {
    order: 3,
    label: "Critical Failure",
    className: "critical-failure",
    icon: "--"
  }
};

const FULL_LINE_PATTERN = /^\[(?<access>[^\]]+)\]\{(?<checks>[^}]+)\}(?:\{(?<type>[^}]+)\})?\s+(?<outcomes>.+?)\s*$/u;

module.exports = class CampaignKnowledgeMarkupPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "toggle-entity-badges",
      name: "Toggle campaign knowledge preview",
      callback: async () => {
        this.settings.previewMode = !this.settings.previewMode;
        await this.saveSettings();
        new obsidian.Notice(
          this.settings.previewMode
            ? "Campaign knowledge preview enabled"
            : "Campaign knowledge plain text enabled"
        );
      }
    });

    this.registerReadingModeProcessor();
    this.registerLivePreviewExtension();
    this.addSettingTab(new CampaignKnowledgeSettingTab(this.app, this));
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    if (loaded && typeof loaded.previewMode !== "boolean" && typeof loaded.showEntityBadges === "boolean") {
      this.settings.previewMode = loaded.showEntityBadges;
    }

    delete this.settings.showEntityBadges;
    delete this.settings.showDifficultyLabels;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshViews();
  }

  registerReadingModeProcessor() {
    this.registerMarkdownPostProcessor(async (root, context) => {
      if (!this.settings.enableReadingMode || !this.settings.previewMode) {
        return;
      }

      const blocks = root.querySelectorAll("p, li");
      for (const block of blocks) {
        if (!(block instanceof HTMLElement)) {
          continue;
        }

        if (block.querySelector(".campaign-knowledge-entry")) {
          continue;
        }

        const parsed = parseCampaignLine(block.textContent || "");
        if (!parsed) {
          continue;
        }

        const replacement = document.createElement(block.tagName.toLowerCase());
        copyBlockAttributes(block, replacement);
        await renderPreviewDom(parsed, replacement, context.sourcePath, this);
        block.replaceWith(replacement);
      }
    }, 1000);
  }

  registerLivePreviewExtension() {
    let extension = [];

    try {
      extension = createLivePreviewExtension(this);
    } catch (error) {
      console.error("campaign-knowledge-markup: failed to initialize live preview extension", error);
      new obsidian.Notice("Campaign Knowledge Markup: Live Preview extension failed to load.");
    }

    this.registerEditorExtension(extension);
  }

  refreshViews() {
    this.app.workspace.trigger("layout-change");
  }
};

class CampaignKnowledgeSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName("Render in Reading mode")
      .setDesc("Transform united DC check lines in rendered markdown notes.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableReadingMode).onChange(async (value) => {
          this.plugin.settings.enableReadingMode = value;
          await this.plugin.saveSettings();
        });
      });

    new obsidian.Setting(containerEl)
      .setName("Render in Live Preview")
      .setDesc("Replace inactive united DC check lines while editing in Live Preview.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableLivePreview).onChange(async (value) => {
          this.plugin.settings.enableLivePreview = value;
          await this.plugin.saveSettings();
        });
      });

    new obsidian.Setting(containerEl)
      .setName("Preview mode")
      .setDesc("Show formatted previews. When disabled, matching lines stay as plain raw text with checks visible.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.previewMode).onChange(async (value) => {
          this.plugin.settings.previewMode = value;
          await this.plugin.saveSettings();
        });
      });
  }
}

function createLivePreviewExtension(plugin) {
  const { RangeSetBuilder } = require("@codemirror/state");
  const { Decoration, EditorView, ViewPlugin, WidgetType } = require("@codemirror/view");

  class CampaignKnowledgeWidget extends WidgetType {
    constructor(parsed, sourcePath) {
      super();
      this.parsed = parsed;
      this.sourcePath = sourcePath;
    }

    eq(other) {
      return other.parsed.raw === this.parsed.raw && other.sourcePath === this.sourcePath;
    }

    toDOM() {
      const wrapper = document.createElement("span");
      void renderPreviewDom(this.parsed, wrapper, this.sourcePath, plugin);
      return wrapper;
    }

    ignoreEvent() {
      return false;
    }
  }

  function buildDecorations(view) {
    if (!plugin.settings.enableLivePreview || !plugin.settings.previewMode) {
      return Decoration.none;
    }

    if (obsidian.editorLivePreviewField && !view.state.field(obsidian.editorLivePreviewField)) {
      return Decoration.none;
    }

    const builder = new RangeSetBuilder();
    const sourcePath = getActiveSourcePath(plugin);

    for (const { from, to } of view.visibleRanges) {
      let position = from;
      while (position <= to) {
        const line = view.state.doc.lineAt(position);
        const parsed = parseCampaignLine(line.text);

        if (!parsed || selectionTouchesLine(view, line)) {
          if (line.to >= to) {
            break;
          }

          position = line.to + 1;
          continue;
        }

        builder.add(
          line.from,
          line.to,
          Decoration.replace({
            widget: new CampaignKnowledgeWidget(parsed, sourcePath),
            inclusive: false
          })
        );

        if (line.to >= to) {
          break;
        }

        position = line.to + 1;
      }
    }

    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }

      update(update) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged
        ) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
      provide: (pluginClass) => EditorView.atomicRanges.of((view) => {
        const instance = view.plugin(pluginClass);
        return instance ? instance.decorations : Decoration.none;
      })
    }
  );
}

async function renderPreviewDom(parsed, container, sourcePath, component) {
  container.classList.add("campaign-knowledge-entry");
  container.replaceChildren();

  const headerEl = container.createSpan({ cls: "campaign-knowledge-header" });
  headerEl.createSpan({ cls: "campaign-knowledge-access", text: `[${parsed.accessText}]` });

  if (parsed.infoType) {
    headerEl.createSpan({ cls: "campaign-knowledge-type", text: parsed.infoType });
  }

  const listEl = container.createSpan({ cls: "campaign-knowledge-outcomes" });
  for (const outcome of sortOutcomes(parsed.outcomes)) {
    const config = OUTCOME_CONFIG[outcome.marker];
    const itemEl = listEl.createSpan({
      cls: `campaign-knowledge-outcome campaign-knowledge-outcome-${config.className}`
    });

    itemEl.createSpan({
      cls: "campaign-knowledge-outcome-icon",
      attr: { "aria-label": config.label, title: config.label },
      text: config.icon
    });

    const bodyEl = itemEl.createSpan({ cls: "campaign-knowledge-outcome-body" });
    await obsidian.MarkdownRenderer.renderMarkdown(outcome.text, bodyEl, sourcePath, component);
    bodyEl.replaceChildren(...unwrapInlineParagraph(bodyEl));
  }
}

function parseCampaignLine(text) {
  const match = text.match(FULL_LINE_PATTERN);
  if (!match || !match.groups) {
    return null;
  }

  const accessText = match.groups.access.trim();
  const checkText = match.groups.checks.trim();
  const infoType = (match.groups.type || "").trim();
  const outcomesText = match.groups.outcomes.trim();

  const accessList = splitCommaList(accessText);
  const checkList = parseChecks(checkText);
  const outcomes = parseOutcomes(outcomesText);

  if (!accessList.length || !checkList || !checkList.length || !outcomes.length) {
    return null;
  }

  return {
    raw: text,
    accessText,
    accessList,
    checkText,
    checkList,
    infoType,
    outcomes
  };
}

function parseChecks(checkText) {
  const chunks = splitCommaList(checkText);
  if (!chunks.length) {
    return null;
  }

  const checks = [];
  for (const chunk of chunks) {
    const match = chunk.match(/^(?<name>.+?)\((?<dc>\d{1,2})\)$/u);
    if (!match || !match.groups) {
      return null;
    }

    const name = match.groups.name.trim();
    if (!name) {
      return null;
    }

    checks.push({
      name,
      dc: Number(match.groups.dc)
    });
  }

  return checks;
}

function parseOutcomes(outcomesText) {
  const parts = outcomesText.split(/\s*\|\s+(?=(?:\+\+|\+|--|-)\s+)/u);
  return parts
    .map((part, index) => parseOutcomePart(part.trim(), index))
    .filter(Boolean);
}

function parseOutcomePart(part, index) {
  if (!part) {
    return null;
  }

  const match = part.match(/^(?<marker>\+\+|\+|--|-)\s+(?<text>.+)$/u);
  if (match && match.groups) {
    return {
      marker: match.groups.marker,
      text: match.groups.text.trim(),
      sourceIndex: index
    };
  }

  return {
    marker: "+",
    text: part,
    sourceIndex: index
  };
}

function sortOutcomes(outcomes) {
  return outcomes.slice().sort((left, right) => {
    const orderDifference = OUTCOME_CONFIG[left.marker].order - OUTCOME_CONFIG[right.marker].order;
    return orderDifference || left.sourceIndex - right.sourceIndex;
  });
}

function selectionTouchesLine(view, line) {
  return view.state.selection.ranges.some((range) => {
    const from = range.from;
    const to = range.to;
    return from <= line.to && to >= line.from;
  });
}

function splitCommaList(text) {
  return text
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function unwrapInlineParagraph(container) {
  if (
    container.childNodes.length === 1 &&
    container.firstChild instanceof HTMLElement &&
    container.firstChild.tagName === "P"
  ) {
    return Array.from(container.firstChild.childNodes);
  }

  return Array.from(container.childNodes);
}

function copyBlockAttributes(source, target) {
  for (const attribute of source.attributes) {
    target.setAttribute(attribute.name, attribute.value);
  }
}

function getActiveSourcePath(plugin) {
  const activeFile = plugin.app.workspace.getActiveFile();
  return activeFile ? activeFile.path : "";
}
