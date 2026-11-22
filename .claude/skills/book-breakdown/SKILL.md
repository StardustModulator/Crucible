---
name: book-breakdown
description: Break textbook pages into line-level atoms (Feynman explanation + visual design + target scene) in book/atlas/*.json, validated so every line of every page is covered. Use when creating or repairing the page-by-page atlas for a page range or chapter.
---

# Book breakdown (pages → atoms → scenes)

**Input:** a part id and its PDF page range (see the table in `book/SCHEMA.md`).
**Output:** `book/atlas/<id>.json`, passing `node scripts/book-check.mjs <id>` with 0 errors.

## Steps

1. **Read the contract.** Read `book/SCHEMA.md` and `.claude/skills/feynman-visual/SKILL.md`. Skim `src/graph/concepts.js`; those are the valid `math`/`uses`/`exists` ids.
2. **See the page and number its lines.** For each page:
   - **Look at it:** Read tool on `book/source/mls.pdf` with `pages: "<pdf>"`, up to 20 per call, to see figures and equations.
   - **Get numbered lines:** `node scripts/book-text.mjs <bookPage>`. For front matter use `--pdf <n>`.
3. **Plan scenes for the section first:**
   - usually one scene per subsection, with 3–6 beats going from toy to deep idea;
   - id `mls-<kebab>`, a ≤3-word title, an emoji icon;
   - point `exists` at a current Crucible scene when it already shows part of the idea.
4. **Cut each page into atoms.**
   - **Tiling:** the atoms tile the numbered lines exactly (1..N, no gaps or overlaps).
   - **Size:** one idea per atom. A paragraph, an equation block, a figure (with its caption), a definition, a theorem, a proof step-group, an example, or an exercise.
   - **Small kinds:** stray figure-label lines and the page number become their own small atoms (`caption`, `page-number`).
   - **Fields:** fill `idea` (your own words), `feynman`, `visual`, `scene`, `beat` (one of the scene's beats), `math`, `engine`, `difficulty`.
5. **Validate often.** Run `node scripts/book-check.mjs <id>` and fix every ❌. A ⚠️ about length means: tighten it.
6. **Copyright.** Never paste book sentences. Paraphrase everything. Equations may be restated in your own notation; cite numbers like `Eq (2.14)`.

## Quality bar

- **`feynman`:** a real everyday analogy that obeys the same rule. Not "this is like math".
- **`visual`:** buildable tomorrow by someone who has not read the book. Name the objects, colors, drag targets, what animates, and what readout proves the point.
- **Hard parts:** proofs and long derivations get a *staircase* of visuals (one beat per key step). Never "see proof".
- **Exercises:** each gets an atom whose visual is a *challenge mode* of a scene: the learner must make the picture do the thing.
- **Light pages:** history and outlook pages still get visuals, such as a timeline, a robot family tree, or a map of chapters.
