# DM Decision Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать карточки пакета решений DM как интерактивные формы в Obsidian Live Preview и сразу сохранять допустимые ответы в исходный Markdown.

**Architecture:** Один чистый разборщик читает карточки `dnd-packet` schema `v2`, а один чистый редактор создаёт минимальную замену текста для выбранной карточки. Существующий CodeMirror ViewPlugin добавляет блочный виджет для каждой корректной карточки; виджет применяет замену через транзакцию текущего редактора. Завершённые карточки используют тот же виджет с отключёнными полями.

**Tech Stack:** CommonJS JavaScript, Obsidian Plugin API, CodeMirror 6, CSS, Node.js `assert`.

**Spec:** `docs/superpowers/specs/2026-09-04-dm-decision-forms-design.md`

## Global Constraints

- Не добавлять зависимости и сборщик.
- Сохранить `minAppVersion: 1.5.0` и `isDesktopOnly: false`.
- Обрабатывать только заметки с `<!-- dnd-packet: schema: v2 -->`.
- Разрешать запись только для карточек с `<!-- dnd-packet: state: draft -->`.
- Показывать `processed`, `deferred` и `emergent` в той же форме только для чтения.
- Не менять формат пакета, идентификаторы, источники, рекомендации, состояния и fingerprints.
- Не менять существующее представление campaign knowledge.
- Публиковать GitHub только после автоматических проверок, установки в vault и проверки в Obsidian.

---

### Task 1: Разбор карточек `v2`

**Files:**
- Modify: `main.js:1-425`
- Create: `test.js`
- Modify: `package.json:6-8`

**Interfaces:**
- Consumes: полный Markdown как строку.
- Produces: `parseDecisionCards(markdown): DecisionCard[]`.
- Produces: `CampaignKnowledgeMarkupPlugin.__test.parseDecisionCards` для Node-проверок.
- `DecisionCard` содержит `id`, `from`, `to`, `raw`, `title`, `question`, `contextMarkdown`, `choices`, `answerLabel`, `answer`, `routes`, `state`, `readOnly`, `resultMarkdown`.

- [ ] **Step 1: Создать Node-проверку разбора**

В `test.js` перехватить только импорт `obsidian`, затем загрузить `main.js`:

```js
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {}
    };
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
```

- [ ] **Step 2: Запустить проверку и подтвердить ожидаемую ошибку**

Run: `node test.js`

Expected: FAIL, потому что `Plugin.__test` или `parseDecisionCards` ещё не существует.

- [ ] **Step 3: Добавить минимальный разборщик в `main.js`**

В строке текущего объявления заменить `module.exports = class` на именованный
класс, не меняя его методы:

```js
class CampaignKnowledgeMarkupPlugin extends obsidian.Plugin {
```

После закрывающей фигурной скобки класса добавить экспорт:

```js
module.exports = CampaignKnowledgeMarkupPlugin;
CampaignKnowledgeMarkupPlugin.__test = { parseDecisionCards };
```

Использовать точные маркеры и границы карточек:

```js
const PACKET_SCHEMA_MARKER = "<!-- dnd-packet: schema: v2 -->";
const CARD_HEADING_PATTERN = /^### (DC-\d{8}-\d{2}) — (.+)$/gmu;
const CARD_STATE_PATTERN = /<!-- dnd-packet: state: (draft|processed|deferred|emergent) -->/u;
const CHOICE_MARKER_PATTERN = /<!-- dnd-packet: choice: ([A-Z]|decide-later|emergent) -->\n- \[([ xX])\] \*\*(.+?)\*\*(?:\s*(.*))?$/gmu;

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
```

`parseDecisionCard` должен вернуть `null`, если нет состояния, нет 2–4 обычных вариантов, нет обоих route-маркеров или нет полного блока `answer:start` / `answer:end`. Сохранить абсолютные диапазоны каждой изменяемой строки. Удалять `**Вопрос:**` только из отображаемого значения. Для ответа удалить начальные `>` и один пробел из каждой quoted-строки. `recommended` определить по скрытому маркеру и по идентификатору варианта, а не по стрелке в видимом тексте.

- [ ] **Step 4: Добавить завершённую карточку и повреждённую карточку в проверку**

Добавить к `test.js`:

```js
const FINAL = DRAFT
  .replace("state: draft", "state: processed")
  .replace("<!-- dnd-packet: fingerprint: -->", "<!-- dnd-packet: fingerprint: sha256:abc -->");
assert.equal(parseDecisionCards(FINAL)[0].readOnly, true);

const BROKEN = DRAFT.replace("<!-- dnd-packet: answer:end -->", "");
assert.deepEqual(parseDecisionCards(BROKEN), []);
```

- [ ] **Step 5: Обновить команду проверки и запустить её**

В `package.json`:

```json
"scripts": {
  "check": "node --check main.js && node test.js"
}
```

Run: `npm run check`

Expected: `node --check` завершается без вывода, `test.js` завершается с кодом 0.

- [ ] **Step 6: Закоммитить разборщик**

```bash
git add main.js test.js package.json
git commit -m "Add DM decision packet parser"
```

---

### Task 2: Безопасные изменения карточки

**Files:**
- Modify: `main.js`
- Modify: `test.js`

**Interfaces:**
- Consumes: `applyDecisionAction(markdown, cardId, action)`.
- Produces: `{ from: number, to: number, insert: string } | null`.
- `action` имеет одну из форм:
  - `{ type: "toggle-choice", choiceId: "A" }`
  - `{ type: "set-answer", value: string }`
  - `{ type: "toggle-route", route: "decide-later" | "emergent" }`
  - `{ type: "set-route-detail", route: "decide-later" | "emergent", value: string }`

- [ ] **Step 1: Написать проверки всех допустимых изменений**

Добавить в `test.js` помощник и assertions:

```js
const { applyDecisionAction } = Plugin.__test;
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
```

Проверить второй route, автоматическое снятие route при вводе ответа, неизвестный ID и запрет изменения `FINAL`:

```js
changed = apply(DRAFT, { type: "toggle-route", route: "emergent" });
assert.match(changed, /choice: emergent -->\n- \[x\]/u);

changed = apply(changed, { type: "set-answer", value: "Ответ DM" });
assert.doesNotMatch(changed, /choice: emergent -->\n- \[x\]/u);
assert.match(changed, /> Ответ DM/u);

assert.equal(applyDecisionAction(DRAFT, "DC-20990101-99", { type: "set-answer", value: "x" }), null);
assert.equal(applyDecisionAction(FINAL, "DC-20260904-01", { type: "set-answer", value: "x" }), null);
```

- [ ] **Step 2: Запустить проверку и подтвердить ожидаемую ошибку**

Run: `node test.js`

Expected: FAIL, потому что `applyDecisionAction` ещё не существует.

- [ ] **Step 3: Реализовать замену только одной карточки**

Добавить в `main.js`:

```js
function applyDecisionAction(markdown, cardId, action) {
  const card = parseDecisionCards(markdown).find((item) => item.id === cardId);
  if (!card || card.readOnly) return null;

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
```

Все помощники должны делать замены от больших локальных смещений к меньшим. `setExclusiveChoice` снимает все обычные и route-флажки, затем включает выбранный обычный вариант, если он раньше не был выбран. `setExclusiveRoute` снимает все флажки, очищает quoted-строки ответа и затем включает выбранный route, если он раньше не был выбран. `setAnswer` форматирует каждую строку как `> text` и снимает route-флажки. `setRouteDetail` меняет только текст после закрывающего `**` в соответствующей строке.

Добавить функцию для безопасного применения локальных замен:

```js
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
```

Экспортировать `applyDecisionAction` через `CampaignKnowledgeMarkupPlugin.__test`.

- [ ] **Step 4: Запустить проверку**

Run: `npm run check`

Expected: все assertions завершаются с кодом 0.

- [ ] **Step 5: Закоммитить редактор**

```bash
git add main.js test.js
git commit -m "Add safe DM decision edits"
```

---

### Task 3: Интерактивный виджет Live Preview

**Files:**
- Modify: `main.js:167-264`
- Modify: `test.js`

**Interfaces:**
- Consumes: `parseDecisionCards`, `applyDecisionAction`, текущий `EditorView`.
- Produces: `DecisionCardWidget extends WidgetType`.
- Produces: `collectPreviewRanges(markdown, visibleRanges): PreviewRange[]` для проверки отсутствия пересечений.

- [ ] **Step 1: Написать проверку диапазона целой карточки**

Добавить в `test.js`:

```js
const { collectDecisionRanges } = Plugin.__test;
const ranges = collectDecisionRanges(DRAFT);
assert.equal(ranges.length, 1);
assert.equal(DRAFT.slice(ranges[0].from, ranges[0].to), ranges[0].card.raw);
assert.equal(ranges[0].block, true);
```

- [ ] **Step 2: Запустить проверку и подтвердить ожидаемую ошибку**

Run: `node test.js`

Expected: FAIL, потому что `collectDecisionRanges` ещё не существует.

- [ ] **Step 3: Добавить диапазоны карточек до текущих однострочных диапазонов**

Добавить чистый помощник:

```js
function collectDecisionRanges(markdown) {
  return parseDecisionCards(markdown).map((card) => ({
    from: card.from,
    to: card.to,
    block: true,
    card
  }));
}
```

В `buildDecorations(view)` собрать карточки из `view.state.doc.toString()`. Затем собрать текущие однострочные campaign knowledge диапазоны, пропуская строки, которые пересекают карточку. Объединить диапазоны, отсортировать по `from` и только после этого добавить их в `RangeSetBuilder`.

- [ ] **Step 4: Реализовать `DecisionCardWidget`**

Внутри `createLivePreviewExtension` добавить класс:

```js
class DecisionCardWidget extends WidgetType {
  constructor(card, sourcePath) {
    super();
    this.card = card;
    this.sourcePath = sourcePath;
  }

  eq(other) {
    return other.card.id === this.card.id &&
      other.card.state === this.card.state &&
      other.sourcePath === this.sourcePath;
  }

  toDOM(view) {
    return renderDecisionCardDom(this.card, view, plugin);
  }

  ignoreEvent() {
    return true;
  }
}
```

Создать decoration с `block: true`:

```js
Decoration.replace({
  widget: new DecisionCardWidget(item.card, sourcePath),
  block: true,
  inclusive: false
})
```

- [ ] **Step 5: Реализовать DOM формы и немедленную запись**

`renderDecisionCardDom(card, view, plugin)` создаёт `div.dm-decision-card`, `fieldset`, заголовок, контекст, checkbox для каждого варианта, textarea ответа и два route-блока. Видимые Markdown-фрагменты рендерить через существующий `obsidian.MarkdownRenderer.renderMarkdown`.

Для каждого события повторно читать текущее состояние и применять одну транзакцию:

```js
function dispatchDecisionAction(view, cardId, action) {
  const change = applyDecisionAction(view.state.doc.toString(), cardId, action);
  if (!change) {
    new obsidian.Notice("Карточка изменилась или доступна только для чтения.");
    return false;
  }

  view.dispatch({ changes: change });
  return true;
}
```

На `change` checkbox вызвать `toggle-choice` или `toggle-route`. На каждый `input` textarea вызвать `set-answer`. На каждый `input` route-поля вызвать `set-route-detail`. После успешного checkbox-действия сразу синхронизировать `checked` у остальных контролов и очистить несовместимые поля в DOM, чтобы `eq()` мог сохранить существующий DOM и фокус textarea.

Если `card.readOnly`, установить `fieldset.disabled = true`, добавить класс `dm-decision-card-read-only` и не регистрировать обработчики записи. Если `resultMarkdown` не пуст, отрендерить его в конце формы.

- [ ] **Step 6: Обновить подписи существующих настроек**

В `CampaignKnowledgeSettingTab` заменить описание Live Preview на:

```js
.setDesc("Render campaign checks and DM decision cards in Live Preview.")
```

Описание Preview mode должно явно сказать, что режим управляет обоими представлениями:

```js
.setDesc("Show campaign previews and DM decision forms. Disable to edit their raw Markdown.")
```

- [ ] **Step 7: Запустить автоматическую проверку**

Run: `npm run check`

Expected: синтаксис корректен, все assertions завершаются с кодом 0.

- [ ] **Step 8: Закоммитить Live Preview форму**

```bash
git add main.js test.js
git commit -m "Render DM decisions as Live Preview forms"
```

---

### Task 4: Стили, документация и версия `0.3.0`

**Files:**
- Modify: `styles.css:1-86`
- Modify: `README.md:1-126`
- Modify: `manifest.json:1-9`
- Modify: `package.json:1-19`
- Modify: `versions.json:1-3`

**Interfaces:**
- Consumes: классы `dm-decision-*` из Task 3.
- Produces: готовые runtime-файлы версии `0.3.0`.

- [ ] **Step 1: Добавить стили формы**

Добавить правила для `dm-decision-card`, заголовка, контекста, вариантов, рекомендации, textarea, route-полей и состояния только для чтения. Использовать только переменные Obsidian:

```css
.dm-decision-card {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0.75rem 0;
  padding: 1rem 1.1rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background: var(--background-secondary);
  color: var(--text-normal);
}

.dm-decision-card fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.dm-decision-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  margin: 0.85rem 0;
}

.dm-decision-answer,
.dm-decision-route-detail {
  box-sizing: border-box;
  width: 100%;
}

.dm-decision-card-read-only {
  opacity: 0.9;
}
```

Добавить `:focus-visible`, `var(--interactive-accent)` для выбранного варианта и `var(--text-muted)` для служебных подписей. Не задавать фиксированные цвета.

- [ ] **Step 2: Обновить README**

Добавить раздел `DM Decision Cards` с маркером schema `v2`, состояниями, правилами выбора, автосохранением и способом открыть raw Markdown через Preview mode. Удалить фразу `It is display-only`, потому что она больше не верна. Добавить `test.js` в список файлов; runtime-список не менять.

- [ ] **Step 3: Поднять версию**

Установить `0.3.0` в `manifest.json` и `package.json`. В `versions.json` добавить:

```json
{
  "0.2.0": "1.5.0",
  "0.3.0": "1.5.0"
}
```

Обновить описание манифеста так, чтобы оно упоминало campaign checks и DM decision forms.

- [ ] **Step 4: Проверить документацию и метаданные**

Run: `npm run check`

Expected: код 0.

Run: `node -e 'const fs=require("node:fs"); const a=JSON.parse(fs.readFileSync("manifest.json")); const b=JSON.parse(fs.readFileSync("package.json")); const c=JSON.parse(fs.readFileSync("versions.json")); if(a.version!=="0.3.0"||b.version!==a.version||c[a.version]!==a.minAppVersion) process.exit(1)'`

Expected: код 0 без вывода.

Run: `git diff --check`

Expected: код 0 без вывода.

- [ ] **Step 5: Закоммитить стили и выпускные файлы**

```bash
git add styles.css README.md manifest.json package.json versions.json
git commit -m "Prepare DM decision forms release"
```

---

### Task 5: Установка, проверка Obsidian и публикация

**Files:**
- Copy after checks: `main.js` -> `/Users/zagushka/projects/dnd/.obsidian/plugins/campaign-knowledge-markup/main.js`
- Copy after checks: `styles.css` -> `/Users/zagushka/projects/dnd/.obsidian/plugins/campaign-knowledge-markup/styles.css`
- Copy after checks: `manifest.json` -> `/Users/zagushka/projects/dnd/.obsidian/plugins/campaign-knowledge-markup/manifest.json`
- Copy after checks: `versions.json` -> `/Users/zagushka/projects/dnd/.obsidian/plugins/campaign-knowledge-markup/versions.json`
- Copy after checks: `README.md` -> `/Users/zagushka/projects/dnd/.obsidian/plugins/campaign-knowledge-markup/README.md`

**Interfaces:**
- Consumes: проверенный релиз `0.3.0` из Tasks 1–4.
- Produces: установленный плагин и опубликованная ветка `main`.

- [ ] **Step 1: Выполнить полную проверку репозитория**

Run: `npm run check`

Expected: код 0.

Run: `git diff --check`

Expected: код 0 без вывода.

Run: `git status --short --branch`

Expected: ветка `main` опережает `origin/main`, незакоммиченных файлов нет.

- [ ] **Step 2: Обновить установленную копию после успешных проверок**

Скопировать только пять перечисленных файлов из корня репозитория в каталог установленного плагина. Не копировать `test.js`, `package.json` или `docs/`.

- [ ] **Step 3: Проверить установленную копию и пакет решений**

Run: `node --check /Users/zagushka/projects/dnd/.obsidian/plugins/campaign-knowledge-markup/main.js`

Expected: код 0 без вывода.

Run:

```bash
python3 /Users/zagushka/projects/dnd/.agents/skills/dnd-open-questions/scripts/validate_decision_packet.py \
  '/Users/zagushka/projects/dnd/07 Queries/Открытые вопросы/Очередь решений DM.md'
```

Expected: валидатор сообщает об успешной проверке активного пакета.

Run: `git -C /Users/zagushka/projects/dnd diff --check`

Expected: код 0 без вывода.

- [ ] **Step 4: Проверить форму в Obsidian без изменения решения DM**

Перезагрузить Campaign Knowledge Markup в Obsidian. Открыть `07 Queries/Открытые вопросы/Очередь решений DM.md` в Live Preview и подтвердить:

- одна карточка показана единым блоком;
- вариант B отмечен и имеет пометку рекомендации;
- textarea показывает текущий пустой ответ;
- оба варианта отсрочки видны;
- Preview mode показывает и скрывает форму;
- консоль Obsidian не содержит новой ошибки плагина.

Не менять выбор в реальной очереди во время этой проверки.

- [ ] **Step 5: Проверить установленный diff**

Run:

```bash
git -C /Users/zagushka/projects/dnd diff -- \
  .obsidian/plugins/campaign-knowledge-markup/main.js \
  .obsidian/plugins/campaign-knowledge-markup/styles.css \
  .obsidian/plugins/campaign-knowledge-markup/manifest.json \
  .obsidian/plugins/campaign-knowledge-markup/versions.json \
  .obsidian/plugins/campaign-knowledge-markup/README.md
```

Expected: diff содержит только релиз `0.3.0` и новую форму решений.

- [ ] **Step 6: Отправить проверенные коммиты в GitHub**

Run: `git push origin main`

Expected: GitHub принимает локальные коммиты, включая спецификацию, план и реализацию.

- [ ] **Step 7: Подтвердить опубликованную версию**

Run: `gh api repos/zagushka/campaign-knowledge-markup/contents/manifest.json --jq .content | base64 --decode`

Expected: `"version": "0.3.0"`.
