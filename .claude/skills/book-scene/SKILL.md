---
name: book-scene
description: Build one textbook scene (src/scenes/mls-*.js) from its atlas spec so that every atom pointing at it is visibly taught by one of its beats. Use when implementing or upgrading an mls-* scene.
---

# Build a book scene

**Input:** a scene id `mls-…` declared in `book/atlas/*.json`.
**Output:** `src/scenes/<id>.js` that passes the smoke test and teaches *every atom* that points at it.

## Steps

1. **Load the spec.** `node scripts/book-day.mjs --scene <id>` prints:
   - the scene card: title, icon, uses, exists, beats, brief;
   - every atom with this `scene`, grouped by `beat`, with `idea`, `feynman` and `visual`.
2. **Read the house rules.**
   - Read `docs/SCENE_GUIDE.md` (contract, API, palette) and `.claude/skills/feynman-visual/SKILL.md`.
   - If the spec has `exists: <concept>`, read `src/scenes/<concept>.js`. Reuse its ideas and helpers, but go deeper: the book version must cover every atom.
3. **Check the original pages when the visual depends on details.** `node scripts/book-text.mjs <page>` and the Read tool on `book/source/mls.pdf` show the figures and equations. They are for understanding only: never copy text into the scene.
4. **Implement.**
   - `ui.beats([...])` uses the atlas beats **in the same order**, with the emoji from each beat string.
   - Each beat's picture shows every atom assigned to that beat. If a beat holds many atoms, step through them inside the beat (sub-steps on a timer or ⏭), or split the beat and update the atlas.
   - Exercises become challenge modes: a goal (gold), a success check, 🎉 when done.
   - All math comes from `src/core`. If the atom lists `engine: "NEW: …"`, add the function to the right `src/core/*.js` module **with a test in `tests/`**.
   - The `eq` holds the key equations of the beats (our own notation, colored tokens).
5. **Verify.**
   - `node scripts/smoke.mjs <id> --shots <dir>` and `--portrait`: 0 errors.
   - Look at every beat's screenshot (light and dark): no words on canvas, nothing clipped, colors keep their meanings.
   - `node scripts/book-check.mjs --built`: the scene shows as built.
6. **Commit** only when the user or the `book-day` run asks. One scene per commit is fine.
