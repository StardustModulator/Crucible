# 📕 The Book in 7 Days

**Goal:** turn every line of every page of *A Mathematical Introduction to Robotic Manipulation* (Murray, Li, Sastry, 1994) into pictures you can poke. The method is the Feynman technique: if it can't be shown simply, it isn't understood yet.

**Size:** 474 PDF pages · 18,554 lines · 9 chapters · 2 appendices · front and back matter.

## How it fits together

```
 📄 PDF page ──► 〰️ lines ──► 🧩 atoms ──► 🎬 scene beats ──► 🧠 you, explaining it back
               (pdftotext)   (atlas JSON)    (src/scenes/mls-*)   (#/book page view)
```

| layer | where | checked by |
|---|---|---|
| **Lines**: the exact text lines of each page | `book/lines.json` (counts only) | `pdftotext -layout`, which is deterministic |
| **Atoms**: one idea each, tiling the lines | `book/atlas/*.json` | `node scripts/book-check.mjs`: gap- and overlap-free tiling |
| **Scenes**: one per subsection, with beats | `src/scenes/mls-*.js` | `node scripts/smoke.mjs`: runs, and shows every atlas beat |
| **Understanding**: the Feynman self-test | `#/book/p/<pdf>` in the app | you, using the `book-audit` skill |

**What each atom carries:**
- `idea`: the precise statement, paraphrased.
- `feynman`: an everyday analogy that obeys the same rule.
- `visual`: the exact picture to build.
- `scene` and `beat`: where that picture lives.

**The atlas format** is specified in [`SCHEMA.md`](SCHEMA.md).

> **Copyright.** The book is © CRC Press, "for personal use only". Everything in this repo is original:
> our explanations, visuals, and structural references (page, section and equation numbers).
> The PDF stays in `book/source/` (gitignored), and no book text is ever committed.

## The atlas: complete ✅

All **474 / 474 pages** and **18,554 / 18,554 lines** are broken into **2,877 atoms** across **135 scenes**. `npm test` enforces this.

| part | pages | atoms | scenes |
|---|---|---|---|
| Front matter | 18 | 58 | 3 |
| 1 Introduction | 18 | 119 | 4 |
| 2 Rigid Body Motion | 62 | 394 | 17 |
| 3 Manipulator Kinematics | 74 | 459 | 21 |
| 4 Robot Dynamics and Control | 56 | 355 | 15 |
| 5 Multifingered Hand Kinematics | 54 | 338 | 15 |
| 6 Hand Dynamics and Control | 52 | 314 | 16 |
| 7 Nonholonomic Behavior | 38 | 236 | 13 |
| 8 Nonholonomic Motion Planning | 40 | 240 | 11 |
| 9 Future Prospects | 8 | 44 | 4 |
| A Lie Groups and Robot Kinematics | 32 | 214 | 12 |
| B Screw-Calculus Package | 6 | 35 | 2 |
| Bibliography · Index | 16 | 71 | 2 |

- **What each atom holds:** every proof is a staircase of pictures; every exercise is a challenge mode; every figure is a live scene.
- **Originality:** `node scripts/book-originality.mjs` proves that no atlas text copies an 8-word run from the book.
- **Per-day roster:** every scene, its beats and the engine additions it needs, day by day, are in **[ROSTER.md](ROSTER.md)**.

## The week

| day | PDF | book pages | chapters | theme | lines |
|---|---|---|---|---|---|
| 🔄 **1** | 1–68 | front, 1–50 | Front · Ch 1 · Ch 2 §1–3 | where we're going · rotations, exponential coordinates, rigid motions, twists & screws | 2,369 |
| 🔩 **2** | 69–132 | 51–114 | Ch 2 §4–8 · Ch 3 §1–3 | rigid-body velocity, adjoint, wrenches, reciprocal screws · product of exponentials, workspace, Paden–Kahan inverse kinematics | 2,673 |
| 🕹️ **3** | 133–196 | 115–178 | Ch 3 §4–8 · Ch 4 §1–3 | spatial/body Jacobians, forces, singularities, manipulability, redundant & parallel robots, Stewart platform · Lagrange's equations, inertia, Newton–Euler, open-chain dynamics | 2,621 |
| 🤲 **4** | 197–259 | 179–241 | Ch 4 §4–9 · Ch 5 §1–5 | Lyapunov stability, LaSalle, computed torque, PD, workspace & constrained control · grasp statics, contact models, grasp map, force-closure, grasp planning, finger kinematics | 2,486 |
| 🖐️ **5** | 260–317 | 242–299 | Ch 5 §6–9 · Ch 6 §1–4 | surface models, rolling contact kinematics · Pfaffian constraints, Lagrange multipliers, Lagrange–d'Alembert, hand dynamics, internal forces, redundancy, tendons | 2,322 |
| 🚗 **6** | 318–383 | 300–365 | Ch 6 §5–8 · Ch 7 · Ch 8 §1–2 | hierarchical hand control · vector fields, flows, Lie brackets, Frobenius, controllability, nonholonomic examples, Philip Hall basis · steering with sinusoids, chained form | 2,435 |
| 🌐 **7** | 384–474 | 366–456 | Ch 8 §3–7 · Ch 9 · App A · App B · Bib · Index | Fourier steering, optimal steering, piecewise-constant inputs, finger repositioning, geometric phase · future prospects · manifolds, tangent spaces, forms, Lie groups, exp map, SE(3) metrics · screw-calculus toolbox · the whole map | 3,648 |

Day 7 looks long, but 757 of its lines are bibliography and index entries. Those become one citation-timeline scene and one index-explorer scene.

`book/days.json` is the machine-readable version. `node scripts/book-day.mjs` shows live progress, and `#/book` in the app shows the same thing as tiles.

## The daily ritual

The `book-day` skill runs this whole loop when you say **"do day N"**.

| step | what | done when |
|---|---|---|
| **0 · Orient** | `node scripts/book-day.mjs N` lists the day's pages and the scenes to create (🆕) or extend (✚) | you know today's roster |
| **1 · Atlas check** | `node scripts/book-check.mjs` | 0 errors; every line of today's pages is in an atom |
| **2 · Build** | the `book-scene` skill for each scene. Run them in parallel builders when there are more than ~4. Each beat teaches its atoms; exercises become challenge modes | every scene file exists |
| **3 · Verify** | `node scripts/smoke.mjs $(node scripts/book-day.mjs N --ids) --shots …` in landscape and `--portrait` | 0 errors, beat counts match the atlas |
| **4 · Audit** | the `book-audit` skill, page by page | every page of the day ✅ |
| **5 · Feynman self-test** | open `#/book/day/N`; for each page, explain it back using only the pictures | anything that doesn't click gets a better `feynman`/`visual` and beat |
| **6 · Ship** | `npm test`, commit "Book day N: …", push | CI green |

**Definition of done for a day:**
- every PDF page in the day's range is green ✅ in `#/book`;
- `book-check` and the smoke test pass;
- the audit table has no ❌.

## Skills (in `.claude/skills/`)

| skill | use it to |
|---|---|
| `feynman-visual` | turn any idea into a five-year-old-proof picture: the 4 Feynman steps, the color language, a pattern library |
| `book-breakdown` | create or repair atlas atoms for a page range, with exact line tiling |
| `book-scene` | build one `mls-*` scene from its atlas card so every atom is visibly taught |
| `book-day` | run a whole day: orient → build → verify → audit → ship |
| `book-audit` | prove coverage at three layers: lines → atoms → scenes → understanding |

## Commands

```bash
node scripts/book-day.mjs                 # week progress
node scripts/book-day.mjs 3               # day 3 roster (🆕 create, ✚ extend, 🧱 built)
node scripts/book-day.mjs --scene mls-x   # full build spec for one scene (atoms grouped by beat)
node scripts/book-day.mjs --page 27       # the atoms of book page 27
node scripts/book-text.mjs 27 30          # numbered canonical lines (needs the local PDF)
node scripts/book-check.mjs [--all]       # validate the atlas (--all: every page must exist)
node scripts/book-originality.mjs         # prove no atlas text copies the book (needs the local PDF)
node scripts/book-merge.mjs <part>        # assemble book/atlas/<part>.json from per-page work files
node scripts/book-manifest.mjs            # refresh book/atlas.json (part list + which scenes are built)
```

## In the app

| route | what you see |
|---|---|
| `#/book` | 7 day cards with progress, and every page as a tile (⬜ not broken down · 🧩 atoms · 🧱 partly built · ✅ done) |
| `#/book/day/N` | the day's scenes and one card per page with its summary |
| `#/book/p/<pdf>` | a line silhouette of the page, each atom's Feynman line, idea and 🎨 visual, and a button to its scene beat |
| `#/s/mls-…?beat=k` | the scene, opened at beat *k*, with 📕 chips back to its pages |

## Expect the engine to grow

The book needs math that `src/core` doesn't have yet. Each piece lands **with tests** on the day it is first needed (atoms flag these as `engine: "NEW: …"`):

- **Day 2:** the Paden–Kahan subproblems (rotation about one axis, two axes, to a distance) and a general reciprocal-screw test.
- **Day 3:** spatial and body Jacobians of arbitrary chains via the adjoint, closed-chain (four-bar, Stewart platform) solvers, and generic Christoffel symbols from M(q).
- **Day 4:** contact models with friction cones, the grasp map G, a force-closure test (convex hull contains the origin), and constrained dynamics with multipliers.
- **Day 5:** surface charts, metric and curvature forms (Montana contact equations), and Pfaffian constraint projection.
- **Day 6:** flows of vector fields, numerical Lie brackets, a controllability-rank test, and Philip Hall basis generation.
- **Day 7:** sinusoidal and Fourier steering, chained-form conversion, an optimal-steering ODE, and a left-invariant metric on SE(3).
