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
const PACKET_SCHEMA_MARKER = "<!-- dnd-packet: schema: v2 -->";
const CARD_HEADING_PATTERN = /^### (DC-\d{8}-\d{2}) — (.+)$/gmu;
const CARD_STATE_PATTERN = /<!-- dnd-packet: state: (draft|processed|deferred|emergent) -->/u;
const CHOICE_MARKER_PATTERN = /<!-- dnd-packet: choice: ([A-Z]|decide-later|emergent) -->\n- \[([ xX])\] \*\*(.+?)\*\*(?:[ \t]*(.*))?$/gmu;

class CampaignKnowledgeMarkupPlugin extends obsidian.Plugin {
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

module.exports = CampaignKnowledgeMarkupPlugin;
CampaignKnowledgeMarkupPlugin.__test = { applyDecisionAction, parseDecisionCards };

function parseDecisionCards(markdown) {
  if (!markdown.includes(PACKET_SCHEMA_MARKER)) return [];

  const headings = Array.from(markdown.matchAll(CARD_HEADING_PATTERN));
  return headings.flatMap((heading, index) => {
    const from = heading.index;
    const to = index + 1 < headings.length ? headings[index + 1].index : markdown.length;
    const card = parseDecisionCard(markdown.slice(from, to), from, to, heading);
    return card ? [card] : [];
  });
}

function parseDecisionCard(raw, from, to, heading) {
  const stateMatch = raw.match(CARD_STATE_PATTERN);
  if (!stateMatch) return null;

  const answerStart = raw.indexOf("<!-- dnd-packet: answer:start -->");
  const answerEnd = raw.indexOf("<!-- dnd-packet: answer:end -->");
  if (answerStart < 0 || answerEnd < answerStart) return null;

  const matches = Array.from(raw.matchAll(CHOICE_MARKER_PATTERN));
  const ordinary = matches.filter((match) => /^[A-Z]$/u.test(match[1]));
  const routes = matches.filter((match) => match[1] === "decide-later" || match[1] === "emergent");
  if (
    ordinary.length < 2 || ordinary.length > 4 ||
    routes.length !== 2 ||
    new Set(routes.map((match) => match[1])).size !== 2
  ) return null;

  const recommendation = raw.match(/<!-- dnd-packet: recommendation: ([A-Z]) -->/u);
  const firstChoiceAt = matches[0]?.index ?? raw.length;
  const questionMatch = raw.match(/^\*\*Вопрос:\*\*\s*(.+)$/mu);
  if (!questionMatch) return null;

  const contextStart = questionMatch.index + questionMatch[0].length;
  const contextMarkdown = raw.slice(contextStart, firstChoiceAt).trim();
  const lineRange = (match) => {
    const markerFrom = from + match.index;
    const lineEnd = raw.indexOf("\n", match.index + match[0].length);
    return { from: markerFrom, to: from + (lineEnd < 0 ? raw.length : lineEnd) };
  };
  const parseChoice = (match) => {
    const bold = match[3].trim();
    const labelMatch = bold.match(/^([A-Z])\.\s*(.*?)(?:\.)?$/u);
    const id = match[1];
    const label = labelMatch && labelMatch[1] === id ? labelMatch[2] : bold;
    return {
      id,
      label,
      text: (match[4] || "").trim(),
      checked: match[2].toLowerCase() === "x",
      recommended: Boolean(recommendation && recommendation[1] === id),
      ...lineRange(match)
    };
  };
  const parseRoute = (match) => {
    const bold = match[3].trim();
    const detail = (match[4] || "").trim();
    return {
      id: match[1],
      label: bold.replace(/:$/u, ""),
      detail,
      checked: match[2].toLowerCase() === "x",
      ...lineRange(match)
    };
  };

  const answerLines = raw.slice(answerStart + "<!-- dnd-packet: answer:start -->".length, answerEnd)
    .split("\n")
    .filter((line, index) => !(index === 1 && /^\*\*.+\*\*\s*$/u.test(line.trim())))
    .map((line) => line.replace(/^> ?/u, ""));
  while (answerLines[0] === "") answerLines.shift();
  while (answerLines.at(-1) === "") answerLines.pop();
  const answerLabelMatch = raw.slice(answerStart, answerEnd).match(/^\*\*(.+?)\*\*\s*$/mu);
  const resultStart = raw.indexOf("<!-- dnd-packet: result:start -->");
  const resultEnd = raw.indexOf("<!-- dnd-packet: result:end -->");

  return {
    id: heading[1],
    from,
    to,
    raw,
    title: heading[2].trim(),
    question: questionMatch[1].trim(),
    contextMarkdown,
    choices: ordinary.map(parseChoice),
    answerLabel: answerLabelMatch ? answerLabelMatch[1].trim() : "Уточнение или свой ответ",
    answer: answerLines.join("\n"),
    answerFrom: from + answerStart,
    answerTo: from + answerEnd + "<!-- dnd-packet: answer:end -->".length,
    routes: routes.map(parseRoute),
    state: stateMatch[1],
    readOnly: stateMatch[1] !== "draft",
    resultMarkdown: resultStart >= 0 && resultEnd > resultStart
      ? raw.slice(resultStart + "<!-- dnd-packet: result:start -->".length, resultEnd).trim()
      : ""
  };
}

function replaceRanges(text, replacements) {
  return replacements
    .slice()
    .sort((left, right) => right.from - left.from)
    .reduce(
      (result, replacement) =>
        result.slice(0, replacement.from) + replacement.insert + result.slice(replacement.to),
      text
    );
}

function checkboxReplacement(raw, card, item, checked) {
  const start = item.from - card.from;
  const bracket = raw.indexOf("[", start);
  return { from: bracket + 1, to: bracket + 2, insert: checked ? "x" : " " };
}

function answerBodyReplacement(raw, card, value) {
  const marker = "<!-- dnd-packet: answer:start -->";
  const start = card.answerFrom - card.from + marker.length;
  const end = card.answerTo - card.from - "<!-- dnd-packet: answer:end -->".length;
  const lines = value ? value.split("\n").map((line) => `> ${line}`).join("\n") : "";
  return {
    from: start,
    to: end,
    insert: `\n**${card.answerLabel}:**\n\n${lines}${lines ? "\n" : ""}`
  };
}

function setExclusiveChoice(raw, card, choiceId) {
  const choice = card.choices.find((item) => item.id === choiceId);
  if (!choice) return raw;
  const replacements = [...card.choices, ...card.routes]
    .map((item) => checkboxReplacement(raw, card, item, false));
  if (!choice.checked) replacements.push(checkboxReplacement(raw, card, choice, true));
  return replaceRanges(raw, replacements);
}

function setExclusiveRoute(raw, card, routeId) {
  const route = card.routes.find((item) => item.id === routeId);
  if (!route) return raw;
  const replacements = [...card.choices, ...card.routes]
    .map((item) => checkboxReplacement(raw, card, item, false));
  if (!route.checked) replacements.push(checkboxReplacement(raw, card, route, true));
  replacements.push(answerBodyReplacement(raw, card, ""));
  return replaceRanges(raw, replacements);
}

function setAnswer(raw, card, value) {
  if (typeof value !== "string") return raw;
  const replacements = card.routes.map((item) => checkboxReplacement(raw, card, item, false));
  replacements.push(answerBodyReplacement(raw, card, value));
  return replaceRanges(raw, replacements);
}

function setRouteDetail(raw, card, routeId, value) {
  if (typeof value !== "string") return raw;
  const route = card.routes.find((item) => item.id === routeId);
  if (!route) return raw;
  const start = route.from - card.from;
  const end = route.to - card.from;
  const line = raw.slice(start, end);
  const bold = line.match(/(\*\*[^*\n]+\*\*)[ \t]*(.*)$/u);
  if (!bold) return raw;
  const detailFrom = start + bold.index + bold[1].length;
  return replaceRanges(raw, [{ from: detailFrom, to: end, insert: value ? ` ${value}` : "" }]);
}

function applyDecisionAction(markdown, cardId, action) {
  const card = parseDecisionCards(markdown).find((item) => item.id === cardId);
  if (!card || card.readOnly || !action) return null;

  let raw = card.raw;
  if (action.type === "toggle-choice") {
    raw = setExclusiveChoice(raw, card, action.choiceId);
  } else if (action.type === "set-answer") {
    raw = setAnswer(raw, card, action.value);
  } else if (action.type === "toggle-route") {
    raw = setExclusiveRoute(raw, card, action.route);
  } else if (action.type === "set-route-detail") {
    raw = setRouteDetail(raw, card, action.route, action.value);
  } else {
    return null;
  }

  return raw === card.raw ? null : { from: card.from, to: card.to, insert: raw };
}

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
