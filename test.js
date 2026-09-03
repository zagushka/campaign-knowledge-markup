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
const { parseDecisionCards } = Plugin.__test;

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
