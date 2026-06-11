# Campaign Knowledge Markup

Local Obsidian plugin for rendering united DC check markup used in this vault.

## Installation

Manual install:

1. Download or clone this repository.
2. Copy the repository folder into your vault under:

   ```text
   .obsidian/plugins/campaign-knowledge-markup/
   ```

3. Reload Obsidian.
4. Enable `Campaign Knowledge Markup` in `Settings` -> `Community plugins`.

The plugin is distributed as a ready-to-load Obsidian addon. The required runtime files are at the repository root:

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## Purpose

This plugin turns entries like:

```md
[Воин, Следопыт]{Проницательность(13), Атлетика(10)}{Вывод} ++ Понимает боевой стиль и старую травму плеча. | + Видит привычку к ближнему бою. | - Считает его усталым стражником. | -- Ошибочно принимает его за неопытного.
```

into a compact preview:

```text
[Воин, Следопыт] Вывод
- +: Видит привычку к ближнему бою.
- -: Считает его усталым стражником.
- ++: Понимает боевой стиль и старую травму плеча.
- --: Ошибочно принимает его за неопытного.
```

The raw markdown remains the source of truth. The plugin only changes presentation.

## Supported Syntax

The plugin matches full lines in this shape:

```md
[Доступы]{Проверки}{Тип?} outcomes
```

Minimal form:

```md
[Все]{Внимательность(5)} На рукаве заметен древесный сок.
```

Full form:

```md
[Архив храма, Нивен при доверии]{Анализ(15), История(16)}{Тайна} ++ Находит исходный термин "печать". | + Находит позднюю замену термина. | - Видит только позднюю копию.
```

The first `{...}` block must contain one or more structural check entries shaped as `Name(number)`. The plugin does not validate Russian skill names or information types; any text in `[...]`, check names, and optional `{Тип}` is accepted when the structure matches.

## Outcomes

Supported outcome markers:

- `+` success
- `-` failure
- `++` critical success
- `--` critical failure

An unmarked outcome is treated as `+`.

The `|` character splits outcomes only when followed by one of the supported markers:

```md
[Архив]{Анализ(15)}{Реальность} В записи есть пометка "корень | сосуд", но она зачёркнута. | + Игрок понимает, что термин менялся.
```

Outcome markers can appear in any source order. The rendered preview uses a stable order: success, failure, critical success, critical failure. Missing outcome kinds are omitted.

## Behavior

### Reading mode

- Detects matching paragraphs and list items.
- Replaces each matching line with the formatted preview when preview mode is enabled.
- Leaves structurally invalid lines untouched.

### Live Preview

- Replaces the whole inactive matching line with the formatted preview.
- Shows raw text when the cursor or selection touches the line.
- Leaves matching lines as raw text when preview mode is disabled.

### Display mode

The command `Toggle campaign knowledge preview` switches between:

- preview mode: checks are hidden and outcomes are shown as a formatted preview;
- plain text mode: the original raw line is shown exactly, including checks.

## Settings

- `Render in Reading mode`
- `Render in Live Preview`
- `Preview mode`

## Notes and Limitations

- The plugin is tailored to this vault's Russian campaign schema.
- It is display-only: no authoring helpers, autocomplete, or validation UI.
- It expects the campaign check markup to start at the beginning of a rendered line.
- Matching is structural and type-agnostic: old lines like `[Тип]{Носитель(0)} text` may render as previews if they match `[]{} text`.

## Files

- `main.js` - plugin logic
- `styles.css` - preview styling
- `manifest.json` - Obsidian plugin manifest
- `versions.json` - minimum app version map
