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
  collectVisibleLines,
  decisionCardViewModel,
  decisionChoicePresentation,
  decisionWidgetEqKey,
  decisionWidgetUpdateMode,
  parseDecisionCards,
  previewEnabled,
  shouldRebuildDecisionField
} = Plugin.__test;

const PACKET_SCHEMA_MARKER = "<!-- dnd-packet: schema: v2 -->";
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
assert.equal(shouldRebuildDecisionField({
  docChanged: false,
  sourceChanged: false,
  livePreviewChanged: false,
  refreshRequested: false
}), false);
assert.equal(shouldRebuildDecisionField({
  docChanged: false,
  sourceChanged: false,
  livePreviewChanged: false,
  refreshRequested: true
}), true);
assert.equal(card.id, "DC-20260904-01");
assert.equal(card.title, "Связь Эдрика и Марты");
assert.equal(card.question, "как распределены роли?");
assert.equal(card.contextMarkdown, "Нужно определить полномочия.");
assert.deepEqual(card.choices.map(({ id, checked }) => [id, checked]), [["A", false], ["B", true]]);
assert.equal(card.choices[1].recommended, true);
assert.deepEqual(decisionChoicePresentation({ recommended: true, text: "Описание B." }), {
  detail: "Описание B.",
  showRecommendation: true
});
assert.deepEqual(decisionChoicePresentation({ recommended: true, text: "Описание B. ← рекомендация" }), {
  detail: "Описание B.",
  showRecommendation: true
});
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

const DATED_DECISION = `<!-- dnd-packet: schema: v2 -->

### DC-20260830-01 — Возвращение Скита к жизни

<!-- dnd-packet: registry-questions: OQ-20260830-01, OQ-20260830-02, OQ-20260830-03 -->
<!-- dnd-packet: type: canonical-fact -->
<!-- dnd-packet: sources: [[04 Plot/Переливающаяся книга Скита]], [[03 Characters/Партия/Скит Норр]], [[02 World/Келемвор]], [[03 Characters/Вернхейм/Малрик Тихий]] -->
<!-- dnd-packet: affected: [[04 Plot/Переливающаяся книга Скита]], [[03 Characters/Партия/Скит Норр]], [[02 World/Старое кладбище Вернхейма]], [[03 Characters/Вернхейм/Малрик Тихий]] -->
<!-- dnd-packet: recommendation: A -->

Нужно определить источник права души вернуться, способ восстановления живого тела и момент безопасного разрыва связи с книгой. Все варианты ниже — предложения, не канон.

<!-- dnd-packet: choice: A -->
- [ ] **A. Келемворитский обряд.** Малрик проводит суд над состоянием Скита. Если возвращение не нарушает волю души и порядок смерти, обряд восстанавливает исходное тело вокруг сохранённого якоря; связь с книгой прекращается только после завершения. ← рекомендация
<!-- dnd-packet: choice: B -->
- [ ] **B. Утраченный текст возвращения.** Партия находит запись полного обряда, книга поглощает её и восстанавливает тело. Право вернуться подтверждает добровольный ответ души Скита; после возвращения книга теряет основание удерживать связь.
<!-- dnd-packet: choice: C -->
- [x] **C. Подготовленное живое тело.** Обряд переносит душу Скита в созданное или добровольно предоставленное тело. Керамический клинок закрепляет личность, а связь с книгой разрывается при переносе; цена и этические последствия остаются частью решения.

<!-- dnd-packet: answer:start -->
**Уточнение или свой ответ:**

>
<!-- dnd-packet: answer:end -->

<!-- dnd-packet: choice: decide-later -->
- [ ] **Решить позже:**
<!-- dnd-packet: choice: emergent -->
- [ ] **Не определять заранее:**

<!-- dnd-packet: state: processed -->
<!-- dnd-packet: fingerprint: sha256:a723c6bec270360f3d2d30ea274a1a21c65fc7bec1433ff64953a8cf67f7e283 -->

**Результат обработки:**

- **Дата:** 2026-09-04
- **Состояние:** Обработано
- **Изменено:** [[04 Plot/Переливающаяся книга Скита]], [[03 Characters/Партия/Скит Норр]]
- **Вопросы:** OQ-20260830-01, OQ-20260830-02, OQ-20260830-03
- **Отпечаток решения:** sha256:a723c6bec270360f3d2d30ea274a1a21c65fc7bec1433ff64953a8cf67f7e283`;

const datedCards = parseDecisionCards(DATED_DECISION);
assert.equal(datedCards.length, 1, "canonical context-only v2 card parses");
assert.equal(datedCards[0].question, "");
assert.match(datedCards[0].contextMarkdown, /^Нужно определить источник права души вернуться/u);
assert.equal(datedCards[0].readOnly, true);
assert.match(datedCards[0].resultMarkdown, /^\*\*Результат обработки:\*\*/u);
assert.match(datedCards[0].resultMarkdown, /\*\*Отпечаток решения:\*\*/u);
assert.equal(decisionCardViewModel(datedCards[0]).question, null);

const draftViewModel = decisionCardViewModel(card);
assert.deepEqual(
  { id: draftViewModel.id, title: draftViewModel.title },
  { id: "DC-20260904-01", title: "Связь Эдрика и Марты" },
  "the stable card ID is part of the displayed heading model"
);
assert.equal(draftViewModel.answer.id, "dm-decision-answer-DC-20260904-01");
assert.deepEqual(
  draftViewModel.routes.map(({ id, detailId, detailAriaLabel }) => [id, detailId, detailAriaLabel]),
  [
    ["decide-later", "dm-decision-route-detail-DC-20260904-01-decide-later", "Решить позже"],
    ["emergent", "dm-decision-route-detail-DC-20260904-01-emergent", "Не определять заранее"]
  ]
);

const BROKEN = DRAFT.replace("<!-- dnd-packet: answer:end -->", "");
assert.deepEqual(parseDecisionCards(BROKEN), []);

const MARKER_LIKE_ANSWER = DRAFT.replace(
  "> Текущий ответ.",
  "> <!-- dnd-packet: state: processed -->\n" +
  "> <!-- dnd-packet: answer:end -->\n" +
  "> <!-- dnd-packet: recommendation: A -->\n" +
  "> Текущий ответ."
);
const [markerTextCard] = parseDecisionCards(MARKER_LIKE_ANSWER);
assert.equal(markerTextCard.state, "draft", "quoted state marker stays answer text");
assert.equal(
  markerTextCard.answer,
  "<!-- dnd-packet: state: processed -->\n" +
  "<!-- dnd-packet: answer:end -->\n" +
  "<!-- dnd-packet: recommendation: A -->\n" +
  "Текущий ответ."
);
assert.equal(markerTextCard.choices[0].recommended, false);
assert.equal(markerTextCard.choices[1].recommended, true);

const ROUTE_DETAIL_MARKER = DRAFT.replace(
  "**Решить позже:**",
  "**Решить позже:** <!-- dnd-packet: state: processed -->"
);
const [routeMarkerCard] = parseDecisionCards(ROUTE_DETAIL_MARKER);
assert.equal(routeMarkerCard.state, "draft", "route detail is not a state marker");
assert.equal(routeMarkerCard.routes[0].detail, "<!-- dnd-packet: state: processed -->");

assert.deepEqual(
  parseDecisionCards(DRAFT.replace(PACKET_SCHEMA_MARKER, `Префикс ${PACKET_SCHEMA_MARKER}`)),
  [],
  "schema marker must occupy a complete line"
);
assert.deepEqual(
  parseDecisionCards(DRAFT.replace(
    "<!-- dnd-packet: state: draft -->",
    "Префикс <!-- dnd-packet: state: draft -->"
  )),
  [],
  "state marker must occupy a complete line"
);
assert.deepEqual(
  parseDecisionCards(DRAFT.replace(
    "<!-- dnd-packet: answer:start -->",
    "Префикс <!-- dnd-packet: answer:start -->"
  )),
  [],
  "answer marker must occupy a complete line"
);
assert.deepEqual(
  parseDecisionCards(DRAFT.replace(
    "<!-- dnd-packet: choice: A -->",
    "Префикс <!-- dnd-packet: choice: A -->"
  )),
  [],
  "choice marker must occupy a complete line"
);
const [embeddedRecommendationCard] = parseDecisionCards(DRAFT.replace(
  "<!-- dnd-packet: recommendation: B -->",
  "Префикс <!-- dnd-packet: recommendation: A -->"
));
assert.ok(embeddedRecommendationCard);
assert.ok(embeddedRecommendationCard.choices.every(({ recommended }) => !recommended));
assert.deepEqual(
  parseDecisionCards(FINAL.replace(
    "<!-- dnd-packet: fingerprint: sha256:abc -->",
    "Префикс <!-- dnd-packet: fingerprint: sha256:abc -->"
  )),
  [],
  "fingerprint marker must occupy a complete line"
);

const SECOND_CARD = DRAFT
  .slice(DRAFT.indexOf("###"))
  .replace("DC-20260904-01", "DC-20260904-02")
  .replace("Связь Эдрика и Марты", "Второе решение");
const FIRST_CARD = DRAFT.replace(
  "<!-- dnd-packet: recommendation: B -->",
  "<!-- dnd-packet: sources: [[02 World/Источник]] -->\n" +
  "<!-- dnd-packet: affected: [[03 Characters/Цель]] -->\n" +
  "<!-- dnd-packet: recommendation: B -->"
);
const BETWEEN_CARDS = "\n\nТекст между карточками сохраняется.\n\n";
const TRAILING_MARKDOWN = "\n\nТекст после карточек сохраняется.\n";
const TWO_CARDS = `${FIRST_CARD}${BETWEEN_CARDS}${SECOND_CARD}${TRAILING_MARKDOWN}`;
const twoCards = parseDecisionCards(TWO_CARDS);
assert.deepEqual(twoCards.map(({ id }) => id), ["DC-20260904-01", "DC-20260904-02"]);
const secondViewModel = decisionCardViewModel(twoCards[1]);
assert.notEqual(draftViewModel.answer.id, secondViewModel.answer.id);
assert.notEqual(draftViewModel.routes[0].detailId, secondViewModel.routes[0].detailId);

const ADJACENT_CARDS = `${FIRST_CARD}\n\n${SECOND_CARD}`;
const adjacentRanges = collectDecisionRanges(ADJACENT_CARDS);
assert.equal(adjacentRanges.length, 2);
assert.equal(
  ADJACENT_CARDS.slice(adjacentRanges[0].to, adjacentRanges[1].from),
  "\n\n",
  "block widgets leave the Markdown separator between adjacent decision cards"
);

const DUPLICATE_CARD_IDS = TWO_CARDS.replace("DC-20260904-02", "DC-20260904-01");
assert.deepEqual(parseDecisionCards(DUPLICATE_CARD_IDS), [], "duplicate card IDs are all rejected");
assert.equal(
  applyDecisionAction(DUPLICATE_CARD_IDS, "DC-20260904-01", { type: "toggle-choice", choiceId: "A" }),
  null
);

const DUPLICATE_CHOICE_IDS = DRAFT.replace("choice: B", "choice: A");
assert.deepEqual(parseDecisionCards(DUPLICATE_CHOICE_IDS), [], "duplicate ordinary choice IDs are rejected");

const secondChange = applyDecisionAction(TWO_CARDS, "DC-20260904-02", {
  type: "toggle-choice",
  choiceId: "A"
});
assert.ok(secondChange);
const changedTwoCards = TWO_CARDS.slice(0, secondChange.from) + secondChange.insert + TWO_CARDS.slice(secondChange.to);
const expectedSecondCard = SECOND_CARD
  .replace("- [ ] **A.", "- [x] **A.")
  .replace("- [x] **B.", "- [ ] **B.");
assert.equal(
  changedTwoCards,
  `${FIRST_CARD}${BETWEEN_CARDS}${expectedSecondCard}${TRAILING_MARKDOWN}`,
  "editing the second card preserves every adjacent byte"
);

const ranges = collectDecisionRanges(DRAFT);
assert.equal(ranges.length, 1);
assert.equal(DRAFT.slice(ranges[0].from, ranges[0].to), ranges[0].card.raw);
assert.equal(ranges[0].block, true);

const HIDDEN_CAMPAIGN_LINE = "[Скрыто]{Проверка(14)} + Не в области видимости.";
const VISIBLE_CAMPAIGN_LINE = "[Слух]{Проверка(12)} + Известно.";
const CARD_CAMPAIGN_LINE = "[Факт]{Проверка(10)} - Неизвестно.";
const PREVIEW_DOCUMENT = `${HIDDEN_CAMPAIGN_LINE}\n${VISIBLE_CAMPAIGN_LINE}\n\n${DRAFT.replace(
  "Нужно определить полномочия.",
  `Нужно определить полномочия.\n${CARD_CAMPAIGN_LINE}`
)}`;
const visibleCampaignFrom = PREVIEW_DOCUMENT.indexOf(VISIBLE_CAMPAIGN_LINE);
const cardCampaignFrom = PREVIEW_DOCUMENT.indexOf(CARD_CAMPAIGN_LINE);
const previewVisibleRanges = [
  { from: visibleCampaignFrom, to: visibleCampaignFrom + VISIBLE_CAMPAIGN_LINE.length },
  { from: cardCampaignFrom, to: cardCampaignFrom + CARD_CAMPAIGN_LINE.length }
];
assert.deepEqual(
  collectVisibleLines(PREVIEW_DOCUMENT, previewVisibleRanges).map(({ text }) => text),
  [VISIBLE_CAMPAIGN_LINE, CARD_CAMPAIGN_LINE],
  "inline discovery inspects only visible lines"
);
const VIEWPORT_BOUNDARY = `${VISIBLE_CAMPAIGN_LINE}\n${HIDDEN_CAMPAIGN_LINE}`;
assert.deepEqual(
  collectVisibleLines(VIEWPORT_BOUNDARY, [{
    from: 0,
    to: VIEWPORT_BOUNDARY.indexOf(HIDDEN_CAMPAIGN_LINE)
  }]).map(({ text }) => text),
  [VISIBLE_CAMPAIGN_LINE],
  "an exclusive viewport end does not inspect the next line"
);
const previewRanges = collectPreviewRanges(PREVIEW_DOCUMENT, previewVisibleRanges);
assert.deepEqual(previewRanges.map((range) => range.block), [false, true]);
assert.ok(previewRanges.every((range, index) => index === 0 || previewRanges[index - 1].to <= range.from));
assert.equal(previewRanges[0].text, VISIBLE_CAMPAIGN_LINE);
assert.equal(previewRanges.some((range) => !range.block && range.text === CARD_CAMPAIGN_LINE), false);

const answerOnlyCard = parseDecisionCards(DRAFT.replace("Текущий ответ.", "Новый ответ."))[0];
const choiceOnlyCard = parseDecisionCards(DRAFT
  .replace("- [ ] **A.", "- [x] **A.")
  .replace("- [x] **B.", "- [ ] **B."))[0];
const routeOnlyCard = parseDecisionCards(DRAFT
  .replace("- [ ] **Решить позже:**", "- [x] **Решить позже:** После разговора"))[0];
const routeDetailOnlyCard = parseDecisionCards(DRAFT
  .replace("**Решить позже:**", "**Решить позже:** После разговора"))[0];
const changedTitleCard = parseDecisionCards(DRAFT.replace("Связь Эдрика и Марты", "Новая связь"))[0];
const changedContextCard = parseDecisionCards(DRAFT.replace("Нужно определить полномочия.", "Другой контекст."))[0];
assert.equal(decisionWidgetEqKey(card, "split-a.md"), decisionWidgetEqKey(answerOnlyCard, "split-a.md"));
assert.notEqual(decisionWidgetEqKey(card, "split-a.md"), decisionWidgetEqKey(changedTitleCard, "split-a.md"));
assert.notEqual(decisionWidgetEqKey(card, "split-a.md"), decisionWidgetEqKey(card, "split-b.md"));
assert.equal(decisionWidgetUpdateMode(card, card, "split-a.md", "split-a.md"), "equal");
assert.equal(
  decisionWidgetUpdateMode(card, answerOnlyCard, "split-a.md", "split-a.md"),
  "update",
  "answer changes update the reused widget"
);
assert.equal(
  decisionWidgetUpdateMode(card, choiceOnlyCard, "split-a.md", "split-a.md"),
  "update",
  "checkbox changes update the reused widget"
);
assert.equal(
  decisionWidgetUpdateMode(card, routeOnlyCard, "split-a.md", "split-a.md"),
  "update",
  "route selection updates the reused widget"
);
assert.equal(
  decisionWidgetUpdateMode(card, routeDetailOnlyCard, "split-a.md", "split-a.md"),
  "update",
  "route details update the reused widget"
);
assert.equal(decisionWidgetUpdateMode(card, changedTitleCard, "split-a.md", "split-a.md"), "replace");
assert.equal(decisionWidgetUpdateMode(card, changedContextCard, "split-a.md", "split-a.md"), "replace");
assert.equal(decisionWidgetUpdateMode(card, card, "split-a.md", "split-b.md"), "replace");

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
