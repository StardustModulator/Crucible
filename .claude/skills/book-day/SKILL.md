---
name: book-day
description: Run one day of the 7-day textbook plan (book/PLAN.md) end to end — load the day's pages and scenes, build every scene, audit line coverage, commit and push. Use when the user says "do day N", "continue the book", "next day", or asks to work through the textbook plan.
---

# Run a book day

The plan is in `book/PLAN.md` and `book/days.json`. Each day covers a fixed range of PDF pages.

## 0. Orient (2 minutes)

```bash
node scripts/book-day.mjs            # progress across all 7 days
node scripts/book-day.mjs <N>        # day N: pages, scenes to create / extend, build status
```

**Which day:** if the user didn't name one, pick the first day that isn't complete.
**Gaps:** if the day's atlas pages are missing or invalid, repair them first with the `book-breakdown` skill (`node scripts/book-check.mjs`).

## 1. Build the scenes

- **Which scenes:** every scene the day lists under 🆕 (create) and ✚ (extend with this day's atoms).
- **How:** use the `book-scene` skill for each one.
- **More than ~4 scenes:** hand independent scenes to parallel builders.
  - Each builder gets the scene ids, the `book-scene` skill path and the scratchpad folder for screenshots.
  - Rule for builders: only create or edit their own `src/scenes/mls-*.js` files.

## 2. Audit coverage

Use the `book-audit` skill for day N. It ends with a table where every page of the day shows ✅. Every ❌ is fixed before moving on.

## 3. Feynman self-test (the human part)

- **Read the day:** open `#/book/day/<N>` in the app.
- **Explain each page back:** for every page, explain it from the pictures alone.
- **Fix what doesn't stick:** if a page doesn't "click", improve that atom's `feynman`/`visual` and its scene beat.

## 4. Ship

```bash
npm test && node scripts/book-check.mjs --all && node scripts/book-originality.mjs && node scripts/book-manifest.mjs && node scripts/smoke.mjs $(node scripts/book-day.mjs <N> --ids)
git add -A && git commit -m "Book day <N>: <theme>" && git push
```

Finish with a short report:
- pages and lines covered;
- scenes built or extended;
- anything deferred, with the reason.
