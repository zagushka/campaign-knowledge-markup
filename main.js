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
    this.refreshDecisionCardDecorations?.();
    this.app.workspace.trigger("layout-change");
  }
};

module.exports = CampaignKnowledgeMarkupPlugin;
CampaignKnowledgeMarkupPlugin.__test = {
  applyDecisionAction,
  collectDecisionRanges,
  collectPreviewRanges,
  decisionWidgetEqKey,
  parseDecisionCards,
  previewEnabled,
  shouldRebuildDecisionField
};

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

function previewEnabled(settings) {
  return Boolean(settings.enableLivePreview && settings.previewMode);
}

function shouldRebuildDecisionField({ docChanged, sourceChanged, livePreviewChanged, refreshRequested }) {
  return docChanged || sourceChanged || livePreviewChanged || refreshRequested;
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

function collectDecisionRanges(markdown) {
  return parseDecisionCards(markdown).map((card) => ({
    from: card.from,
    to: card.to,
    block: true,
    card
  }));
}

function rangesOverlap(left, right) {
  return left.from < right.to && right.from < left.to;
}

function collectPreviewRanges(markdown, visibleRanges) {
  const decisionRanges = collectDecisionRanges(markdown);
  const previewRanges = decisionRanges.slice();
  let from = 0;

  while (from <= markdown.length) {
    const newline = markdown.indexOf("\n", from);
    const to = newline < 0 ? markdown.length : newline;
    const line = { from, to, text: markdown.slice(from, to) };
    const visible = visibleRanges.some((range) => line.from <= range.to && range.from <= line.to);

    if (
      visible &&
      !decisionRanges.some((range) => rangesOverlap(line, range))
    ) {
      const parsed = parseCampaignLine(line.text);
      if (parsed) previewRanges.push({ ...line, block: false, parsed });
    }

    if (newline < 0) break;
    from = newline + 1;
  }

  return previewRanges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function decisionWidgetEqKey(card, sourcePath) {
  return JSON.stringify([
    sourcePath,
    card.id,
    card.state,
    card.title,
    card.question,
    card.contextMarkdown,
    card.answerLabel,
    card.choices.map(({ id, label, text, recommended }) => [id, label, text, recommended]),
    card.routes.map(({ id, label }) => [id, label]),
    card.resultMarkdown
  ]);
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
  const existing = raw.slice(start, end);
  const label = existing.match(/^\n([^\n]*)/u)?.[1] || `**${card.answerLabel}**`;
  const lines = value ? value.split("\n").map((line) => `> ${line}`).join("\n") : "";
  return {
    from: start,
    to: end,
    insert: `\n${label}\n\n${lines}${lines ? "\n" : ""}`
  };
}

function clearQuotedAnswer(raw, card) {
  const marker = "<!-- dnd-packet: answer:start -->";
  const start = card.answerFrom - card.from + marker.length;
  const end = card.answerTo - card.from - "<!-- dnd-packet: answer:end -->".length;
  return {
    from: start,
    to: end,
    insert: raw.slice(start, end).replace(/^> ?.*$/gmu, ">")
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
  replacements.push(clearQuotedAnswer(raw, card));
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
  const detail = value.replace(/[\r\n]+/gu, " ");
  return replaceRanges(raw, [{ from: detailFrom, to: end, insert: detail ? ` ${detail}` : "" }]);
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

function dispatchDecisionAction(view, cardId, action) {
  const change = applyDecisionAction(view.state.doc.toString(), cardId, action);
  if (!change) {
    new obsidian.Notice("Карточка изменилась или доступна только для чтения.");
    return false;
  }

  view.dispatch({ changes: change });
  return true;
}

function syncDecisionCardDom(container, view, cardId, syncAnswer = true) {
  const card = parseDecisionCards(view.state.doc.toString()).find((item) => item.id === cardId);
  if (!card) return;

  for (const input of container.querySelectorAll("input[data-dm-choice]")) {
    input.checked = card.choices.find((choice) => choice.id === input.dataset.dmChoice)?.checked || false;
  }

  for (const input of container.querySelectorAll("input[data-dm-route]")) {
    input.checked = card.routes.find((route) => route.id === input.dataset.dmRoute)?.checked || false;
  }

  const answer = container.querySelector("textarea[data-dm-answer]");
  if (syncAnswer && answer) answer.value = card.answer;

  for (const input of container.querySelectorAll("input[data-dm-route-detail]")) {
    input.value = card.routes.find((route) => route.id === input.dataset.dmRouteDetail)?.detail || "";
  }
}

function renderDecisionMarkdown(markdown, container, sourcePath, renderChild, view) {
  if (markdown) {
    void obsidian.MarkdownRenderer
      .renderMarkdown(markdown, container, sourcePath, renderChild)
      .then(() => view.requestMeasure());
  }
}

function renderDecisionCardDom(card, view, sourcePath, renderChild, container = document.createElement("div")) {
  container.className = "dm-decision-card";
  if (card.readOnly) container.classList.add("dm-decision-card-read-only");

  const fieldset = document.createElement("fieldset");
  fieldset.disabled = card.readOnly;
  container.append(fieldset);

  const legend = document.createElement("legend");
  legend.textContent = card.title;
  fieldset.append(legend);

  const question = document.createElement("p");
  question.className = "dm-decision-question";
  question.textContent = card.question;
  fieldset.append(question);

  const context = document.createElement("div");
  context.className = "dm-decision-context";
  fieldset.append(context);
  renderDecisionMarkdown(card.contextMarkdown, context, sourcePath, renderChild, view);

  const choices = document.createElement("div");
  choices.className = "dm-decision-choices";
  fieldset.append(choices);
  for (const choice of card.choices) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = choice.checked;
    input.dataset.dmChoice = choice.id;
    label.append(input, ` ${choice.id}. ${choice.label}`);
    choices.append(label);

    const detail = document.createElement("div");
    detail.className = "dm-decision-choice-detail";
    choices.append(detail);
    renderDecisionMarkdown(choice.text, detail, sourcePath, renderChild, view);

    if (!card.readOnly) {
      input.addEventListener("change", () => {
        if (dispatchDecisionAction(view, card.id, { type: "toggle-choice", choiceId: choice.id })) {
          syncDecisionCardDom(container, view, card.id);
        }
      });
    }
  }

  const answerLabel = document.createElement("label");
  const answerId = `dm-decision-answer-${card.id}`;
  answerLabel.htmlFor = answerId;
  answerLabel.textContent = card.answerLabel;
  fieldset.append(answerLabel);

  const answer = document.createElement("textarea");
  answer.id = answerId;
  answer.dataset.dmAnswer = "true";
  answer.value = card.answer;
  fieldset.append(answer);
  if (!card.readOnly) {
    answer.addEventListener("input", () => {
      if (dispatchDecisionAction(view, card.id, { type: "set-answer", value: answer.value })) {
        syncDecisionCardDom(container, view, card.id, false);
      }
    });
  }

  const routes = document.createElement("div");
  routes.className = "dm-decision-routes";
  fieldset.append(routes);
  for (const route of card.routes) {
    const routeBlock = document.createElement("div");
    routeBlock.className = "dm-decision-route";
    routes.append(routeBlock);

    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = route.checked;
    input.dataset.dmRoute = route.id;
    label.append(input, ` ${route.label}`);
    routeBlock.append(label);

    const detail = document.createElement("input");
    detail.type = "text";
    detail.value = route.detail;
    detail.dataset.dmRouteDetail = route.id;
    routeBlock.append(detail);

    if (!card.readOnly) {
      input.addEventListener("change", () => {
        if (dispatchDecisionAction(view, card.id, { type: "toggle-route", route: route.id })) {
          syncDecisionCardDom(container, view, card.id);
        }
      });
      detail.addEventListener("input", () => {
        dispatchDecisionAction(view, card.id, {
          type: "set-route-detail",
          route: route.id,
          value: detail.value
        });
      });
    }
  }

  if (card.resultMarkdown) {
    const result = document.createElement("div");
    result.className = "dm-decision-result";
    container.append(result);
    renderDecisionMarkdown(card.resultMarkdown, result, sourcePath, renderChild, view);
  }

  return container;
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
      .setDesc("Render campaign checks and DM decision cards in Live Preview.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableLivePreview).onChange(async (value) => {
          this.plugin.settings.enableLivePreview = value;
          await this.plugin.saveSettings();
        });
      });

    new obsidian.Setting(containerEl)
      .setName("Preview mode")
      .setDesc("Show campaign previews and DM decision forms. Disable to edit their raw Markdown.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.previewMode).onChange(async (value) => {
          this.plugin.settings.previewMode = value;
          await this.plugin.saveSettings();
        });
      });
  }
}

function createLivePreviewExtension(plugin) {
  const { RangeSetBuilder, StateEffect, StateField } = require("@codemirror/state");
  const { Decoration, EditorView, ViewPlugin, WidgetType } = require("@codemirror/view");
  const renderChildren = new WeakMap();
  const liveViews = plugin.livePreviewViews = new Set();
  const refreshDecisionDecorations = StateEffect.define();

  plugin.refreshDecisionCardDecorations = () => {
    for (const view of liveViews) {
      if (view.destroyed) {
        liveViews.delete(view);
      } else {
        view.dispatch({ effects: refreshDecisionDecorations.of(null) });
      }
    }
  };

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

  class DecisionCardWidget extends WidgetType {
    constructor(card, sourcePath) {
      super();
      this.card = card;
      this.sourcePath = sourcePath;
    }

    eq(other) {
      return decisionWidgetEqKey(other.card, other.sourcePath) === decisionWidgetEqKey(this.card, this.sourcePath);
    }

    toDOM(view) {
      const container = document.createElement("div");
      const renderChild = new obsidian.MarkdownRenderChild(container);
      renderChild.load();
      renderChildren.set(container, renderChild);
      return renderDecisionCardDom(this.card, view, this.sourcePath, renderChild, container);
    }

    destroy(dom) {
      const renderChild = renderChildren.get(dom);
      if (renderChild) renderChild.unload();
      renderChildren.delete(dom);
    }

    ignoreEvent() {
      return true;
    }
  }

  function isLivePreview(state) {
    return !obsidian.editorLivePreviewField || state.field(obsidian.editorLivePreviewField, false);
  }

  function buildDecisionDecorations(state) {
    if (!previewEnabled(plugin.settings)) {
      return Decoration.none;
    }

    if (!isLivePreview(state)) {
      return Decoration.none;
    }

    const builder = new RangeSetBuilder();
    const sourcePath = getEditorSourcePath(state);

    for (const item of collectDecisionRanges(state.doc.toString())) {
      builder.add(
        item.from,
        item.to,
        Decoration.replace({
          widget: new DecisionCardWidget(item.card, sourcePath),
          block: true,
          inclusive: false
        })
      );
    }

    return builder.finish();
  }

  const decisionDecorations = StateField.define({
    create(state) {
      return buildDecisionDecorations(state);
    },
    update(decorations, transaction) {
      if (shouldRebuildDecisionField({
        docChanged: transaction.docChanged,
        sourceChanged: getEditorSourcePath(transaction.startState) !== getEditorSourcePath(transaction.state),
        livePreviewChanged: isLivePreview(transaction.startState) !== isLivePreview(transaction.state),
        refreshRequested: transaction.effects.some((effect) => effect.is(refreshDecisionDecorations))
      })) {
        return buildDecisionDecorations(transaction.state);
      }
      return decorations;
    },
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field))
    ]
  });

  function buildInlineDecorations(view) {
    if (!previewEnabled(plugin.settings) || !isLivePreview(view.state)) {
      return Decoration.none;
    }

    const builder = new RangeSetBuilder();
    const sourcePath = getEditorSourcePath(view.state);
    for (const item of collectPreviewRanges(view.state.doc.toString(), view.visibleRanges)) {
      if (!item.block && !selectionTouchesLine(view, item)) {
        builder.add(
          item.from,
          item.to,
          Decoration.replace({
            widget: new CampaignKnowledgeWidget(item.parsed, sourcePath),
            inclusive: false
          })
        );
      }
    }

    return builder.finish();
  }

  return [decisionDecorations, ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        liveViews.add(view);
        this.decorations = buildInlineDecorations(view);
      }

      update(update) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshDecisionDecorations))
          )
        ) {
          this.decorations = buildInlineDecorations(update.view);
        }
      }

      destroy() {
        liveViews.delete(this.view);
      }
    },
    {
      decorations: (value) => value.decorations,
      provide: (pluginClass) => EditorView.atomicRanges.of((view) => {
        const instance = view.plugin(pluginClass);
        return instance ? instance.decorations : Decoration.none;
      })
    }
  )];
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

function getEditorSourcePath(state) {
  if (!obsidian.editorInfoField) return "";
  return state.field(obsidian.editorInfoField, false)?.file?.path || "";
}
