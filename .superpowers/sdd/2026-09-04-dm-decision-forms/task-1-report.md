# Task 1 report

## Implementation summary

Added a dependency-free parser for `dnd-packet` schema `v2` decision cards. It
validates card state, answer block, ordinary choices, and both route choices;
extracts display values, recommendations, answers, routes, read-only state,
result Markdown, and absolute source ranges. The parser is exposed through
`CampaignKnowledgeMarkupPlugin.__test` for Node checks.

## Files changed

- `main.js` — named plugin class, parser, card extraction, and test export.
- `test.js` — Node assertions for draft, processed, and malformed cards.
- `package.json` — `npm run check` now runs syntax check and parser tests.

## RED check

Command:

```text
node test.js
```

Output:

```text
/private/tmp/campaign-knowledge-markup-codex/test.js:13
const { parseDecisionCards } = Plugin.__test;
        ^

TypeError: Cannot destructure property 'parseDecisionCards' of 'Plugin.__test' as it is undefined.
```

The failure was expected because the parser and `__test` export did not exist
before implementation.

## GREEN check

Command:

```text
npm run check
```

Output:

```text
> campaign-knowledge-markup@0.2.0 check
> node --check main.js && node test.js
```

Exit code: `0`.

## Self-review

The parser is isolated from existing campaign-line rendering code, uses no new
dependencies, and ignores notes without the exact schema marker. Invalid card
structure is skipped. Visible recommendation arrows do not affect the
recommendation flag.

## Concerns

The parser intentionally follows the card markers and shape defined in Task 1;
future editing/rendering tasks may consume the included absolute ranges.

## Fix Round 1

### Covering tests

Added a malformed-card test with two `decide-later` markers and no `emergent`
marker. Added an answer test that verifies `>  ` becomes one remaining leading
space and preserves trailing spaces.

### RED

Command: `node test.js`

Relevant failure:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected
+ [ { id: 'DC-20260904-01', ... routes: [decide-later, decide-later] } ]
- []
```

The failure showed duplicate route IDs were accepted. The whitespace assertion
was not reached until the route validation failure was fixed.

### GREEN

Command: `npm run check`

Output:

```text
> campaign-knowledge-markup@0.2.0 check
> node --check main.js && node test.js
```

Exit code: `0`.

### Files and self-review

Updated `main.js`, `test.js`, and this report. Validation now requires one each
of `decide-later` and `emergent`. Answer parsing removes only `>` plus one
optional following space from quoted lines, while removing only structural
blank lines around the answer body. No editable marker ranges were added.
