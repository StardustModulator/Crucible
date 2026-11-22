# Crucible

Visual math engine for robotics & ML. Read `docs/SCENE_GUIDE.md` before touching scenes.

- **No words on the canvas.** Use emoji, arrows, colors, motion, numbers and single symbols. The palette meanings are fixed (see the guide).
- **All math is real.** It comes from `src/core` (tested in `tests/`), never faked.
- **Never mention** any university, school or course in the project.
- **Verify** with `npm test` and `node scripts/smoke.mjs <ids> --shots <dir>`, then look at the screenshots.

## The textbook project (`book/`)

A 7-day plan turns every line of *A Mathematical Introduction to Robotic Manipulation* into scenes. See `book/PLAN.md`.

- **The PDF** must be at `book/source/mls.pdf`. It is gitignored and copyrighted. Never commit it, and never copy book sentences into the repo.
- **The daily driver** is the `book-day` skill ("do day N"). It uses `book-scene`, `book-audit`, `book-breakdown` and `feynman-visual`.
- **Progress:** `node scripts/book-day.mjs`. **Validation:** `node scripts/book-check.mjs`.
- **After adding or removing an `mls-*` scene** run `node scripts/book-manifest.mjs`. That keeps the app's built list current.
