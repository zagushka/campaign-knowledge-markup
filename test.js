const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require("./main.js");
const {
  applyDecisionAction,
  collectDecisionRanges,
  collectPreviewRanges,
  decisionWidgetEqKey,
  parseDecisionCards,
  previewEnabled
} = Plugin.__test;

const DRAFT = `<!-- dnd-packet: schema: v2 -->

### DC-20260904-01 — Связь Эдрика и Марты

<!-- dnd-packet: recommendation: B -->

**Вопрос:** как распределены роли?

Нужно определить полномочия.

<!-- dnd-packet: choice: A -->
- [ ] **A. Первый вариант.** Описание A.
<!-- dnd-packet: choice: B -->
- [x] **B. Второй вариант.** Описание B. ← рекомендация

<!-- dnd-packet: answer:start -->
**Уточнение или свой ответ:**

> Текущий ответ.
<!-- dnd-packet: answer:end -->

<!-- dnd-packet: choice: decide-later -->
- [ ] **Решить позже:**
<!-- dnd-packet: choice: emergent -->
- [ ] **Не определять заранее:**

<!-- dnd-packet: state: draft -->
<!-- dnd-packet: fingerprint: -->`;

const [card] = parseDecisionCards(DRAFT);
assert.equal(previewEnabled({ enableLivePreview: true, previewMode: true }), true);
assert.equal(previewEnabled({ enableLivePreview: false, previewMode: true }), false);
assert.equal(previewEnabled({ enableLivePreview: true, previewMode: false }), false);
assert.equal(card.id, "DC-20260904-01");
assert.equal(card.title, "Связь Эдрика и Марты");
assert.equal(card.question, "как распределены роли?");
assert.equal(card.contextMarkdown, "Нужно определить полномочия.");
assert.deepEqual(card.choices.map(({ id, checked }) => [id, checked]), [["A", false], ["B", true]]);
assert.equal(card.choices[1].recommended, true);
assert.equal(card.answer, "Текущий ответ.");
assert.equal(card.state, "draft");
assert.equal(card.readOnly, false);
assert.deepEqual(parseDecisionCards("### DC-20260904-01 — Без схемы"), []);

const MISSING_ROUTE = DRAFT.replace("<!-- dnd-packet: choice: emergent -->", "<!-- dnd-packet: choice: decide-later -->");
assert.deepEqual(parseDecisionCards(MISSING_ROUTE), []);

const WHITESPACE = DRAFT.replace("> Текущий ответ.", ">  Текущий ответ.  ");
assert.equal(parseDecisionCards(WHITESPACE)[0].answer, " Текущий ответ.  ");

const FINAL = DRAFT
  .replace("state: draft", "state: processed")
  .replace("<!-- dnd-packet: fingerprint: -->", "<!-- dnd-packet: fingerprint: sha256:abc -->");
assert.equal(parseDecisionCards(FINAL)[0].readOnly, true);

const BROKEN = DRAFT.replace("<!-- dnd-packet: answer:end -->", "");
assert.deepEqual(parseDecisionCards(BROKEN), []);

const ranges = collectDecisionRanges(DRAFT);
assert.equal(ranges.length, 1);
assert.equal(DRAFT.slice(ranges[0].from, ranges[0].to), ranges[0].card.raw);
assert.equal(ranges[0].block, true);

const PREVIEW_DOCUMENT = `[Слух]{Проверка(12)} + Известно.

${DRAFT.replace("Нужно определить полномочия.", "Нужно определить полномочия.\n[Факт]{Проверка(10)} - Неизвестно.")}`;
const previewRanges = collectPreviewRanges(PREVIEW_DOCUMENT, [
  { from: 0, to: PREVIEW_DOCUMENT.length },
  { from: DRAFT.indexOf("###"), to: PREVIEW_DOCUMENT.length }
]);
assert.deepEqual(previewRanges.map((range) => range.block), [false, true]);
assert.ok(previewRanges.every((range, index) => index === 0 || previewRanges[index - 1].to <= range.from));
assert.equal(previewRanges[1].card.raw, PREVIEW_DOCUMENT.slice(previewRanges[1].from));

const answerOnlyCard = parseDecisionCards(DRAFT.replace("Текущий ответ.", "Новый ответ."))[0];
const changedTitleCard = parseDecisionCards(DRAFT.replace("Связь Эдрика и Марты", "Новая связь"))[0];
assert.equal(decisionWidgetEqKey(card, "split-a.md"), decisionWidgetEqKey(answerOnlyCard, "split-a.md"));
assert.notEqual(decisionWidgetEqKey(card, "split-a.md"), decisionWidgetEqKey(changedTitleCard, "split-a.md"));
assert.notEqual(decisionWidgetEqKey(card, "split-a.md"), decisionWidgetEqKey(card, "split-b.md"));

const apply = (markdown, action) => {
  const change = applyDecisionAction(markdown, "DC-20260904-01", action);
  assert.ok(change);
  return markdown.slice(0, change.from) + change.insert + markdown.slice(change.to);
};

let changed = apply(DRAFT, { type: "toggle-choice", choiceId: "A" });
assert.match(changed, /choice: A -->\n- \[x\]/u);
assert.match(changed, /choice: B -->\n- \[ \]/u);

changed = apply(changed, { type: "toggle-choice", choiceId: "A" });
assert.doesNotMatch(changed, /- \[x\]/u);

changed = apply(DRAFT, { type: "set-answer", value: "Первая строка.\nВторая строка." });
assert.match(changed, /> Первая строка\.\n> Вторая строка\./u);

changed = apply(DRAFT, { type: "toggle-route", route: "decide-later" });
assert.match(changed, /choice: decide-later -->\n- \[x\]/u);
assert.doesNotMatch(changed, /choice: B -->\n- \[x\]/u);
assert.doesNotMatch(changed, /> Текущий ответ\./u);

changed = apply(changed, {
  type: "set-route-detail",
  route: "decide-later",
  value: "После разговора с Мартой"
});
assert.match(changed, /\*\*Решить позже:\*\* После разговора с Мартой/u);

changed = apply(DRAFT, { type: "toggle-route", route: "emergent" });
assert.match(changed, /choice: emergent -->\n- \[x\]/u);

changed = apply(changed, { type: "set-answer", value: "Ответ DM" });
assert.doesNotMatch(changed, /choice: emergent -->\n- \[x\]/u);
assert.match(changed, /> Ответ DM/u);

assert.equal(applyDecisionAction(DRAFT, "DC-20990101-99", { type: "set-answer", value: "x" }), null);
assert.equal(applyDecisionAction(FINAL, "DC-20260904-01", { type: "set-answer", value: "x" }), null);

const ANSWER_CONTENT = DRAFT.replace(
  "> Текущий ответ.",
  "> Текущий ответ.\n<!-- сохраняется -->\n\nСвободная заметка.",
);
changed = apply(ANSWER_CONTENT, { type: "toggle-route", route: "decide-later" });
assert.match(changed, /\*\*Уточнение или свой ответ:\*\*\n\n>\n<!-- сохраняется -->\n\nСвободная заметка\./u);

changed = apply(DRAFT, {
  type: "set-route-detail",
  route: "decide-later",
  value: "Первая строка\r\n### Не новый заголовок"
});
assert.match(changed, /\*\*Решить позже:\*\* Первая строка ### Не новый заголовок/u);
assert.doesNotMatch(changed, /\n### Не новый заголовок/u);
