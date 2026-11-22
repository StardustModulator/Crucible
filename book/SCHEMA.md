# The Atlas — page-by-page breakdown format

The atlas is the complete, line-level map of the textbook:

- **Source:** *A Mathematical Introduction to Robotic Manipulation* (Murray, Li, Sastry, 1994).
- **Pages:** 474 PDF pages, 18,554 lines.
- **Per page:** every page is cut into **atoms**. An atom is a run of consecutive lines that carries one idea.
- **Per atom:** each atom gets a grown-up paraphrase, a Feynman explanation, and the exact visual that will teach it.

The atoms are grouped into **scenes**. A scene is an interactive picture in Crucible, usually one per subsection.

> **Copyright rule.** The book is © CRC Press, and its notice forbids reproduction.
> The atlas holds **only original writing**: paraphrases, our own explanations, visual designs,
> and structural references (section, equation, figure and page numbers).
> **Never copy sentences from the book.** Restating an equation in our own notation is fine;
> transcribing paragraphs, proofs or exercises is not. The PDF lives in `book/source/` (gitignored).

## Lines: the coverage contract

A **line** is a non-empty line of `pdftotext -layout` for one page.

- **Counts:** `book/lines.json` stores the count for every PDF page. It holds numbers only and is committed.
- **Reading a page:** `node scripts/book-text.mjs <bookPage> [<to>]` prints a page's numbered lines. You need the local PDF for this.
- **The test:** the atoms of a page must **tile lines 1..N exactly**, with no gaps and no overlaps.
- **Enforcement:** `node scripts/book-check.mjs` enforces this, so "every line of every page" is a test, not a promise.

**Page numbers:** book page *p* is PDF page *p + 18*. PDF pages 1–18 are front matter, and their `book` field is `null`.

## Files

`book/atlas/<id>.json`, one per part:

| id | part | PDF pages | book pages |
|---|---|---|---|
| `front` | title, contents, preface, acknowledgements | 1–18 | — |
| `ch01` | 1 Introduction | 19–36 | 1–18 |
| `ch02` | 2 Rigid Body Motion | 37–98 | 19–80 |
| `ch03a` | 3 Manipulator Kinematics §1–3 (FK, IK) | 99–132 | 81–114 |
| `ch03b` | 3 Manipulator Kinematics §4–8 (Jacobian, redundant & parallel) | 133–172 | 115–154 |
| `ch04` | 4 Robot Dynamics and Control | 173–228 | 155–210 |
| `ch05` | 5 Multifingered Hand Kinematics | 229–282 | 211–264 |
| `ch06` | 6 Hand Dynamics and Control | 283–334 | 265–316 |
| `ch07` | 7 Nonholonomic Behavior in Robotic Systems | 335–372 | 317–354 |
| `ch08` | 8 Nonholonomic Motion Planning | 373–412 | 355–394 |
| `ch09` | 9 Future Prospects | 413–420 | 395–402 |
| `appA` | A Lie Groups and Robot Kinematics | 421–452 | 403–434 |
| `appB` | B A Mathematica Package for Screw Calculus | 453–458 | 435–440 |
| `bib` | Bibliography | 459–466 | 441–448 |
| `index` | Index | 467–474 | 449–456 |

Work page-by-page in `book/atlas/_work/<id>/` (`meta.json` + `p<pdf>.json`), then run
`node scripts/book-merge.mjs <id>` to assemble the file (the `_work` folder is gitignored).

## Shape

```jsonc
{
  "id": "ch02",
  "title": "Rigid Body Motion",
  "pdfPages": [37, 98],
  "sections": [ { "id": "2.2", "title": "Rotational Motion in R³", "book": 22 } ],
  "scenes": [
    {
      "id": "mls-rodrigues",                 // mls-<kebab-name>, unique across the atlas
      "title": "Spin = exp",                 // ≤ 3 words
      "icon": "🌀",
      "section": "2.2.2",
      "pages": [27, 31],                     // book pages it covers
      "uses": ["rotation", "screw-exp", "ode"],  // Crucible concept ids (src/graph/concepts.js)
      "exists": "screw-exp",                 // optional: an existing Crucible scene that already covers part of it
      "beats": ["🌀 spin a stick", "♾️ add up tiny turns", "🧮 the closed formula", "↩️ log: read the turn back"],
      "brief": "Visual design of the whole scene: what is on screen, what you drag, what moves, which palette colors mean what."
    }
  ],
  "pages": [
    {
      "pdf": 45, "book": 27, "lines": 36, "section": "2.2",
      "summary": "Rotation about a fixed axis is the solution of q̇ = ω×q, so a rotation is a matrix exponential.",
      "atoms": [
        {
          "id": "2-27-a",                    // <chapter>-<book page>-<letter>  (front matter: f-<pdf>-<letter>)
          "lines": [1, 4],
          "kind": "figure",                  // see KINDS in scripts/book-check.mjs
          "label": "Fig 2.2",                // optional: Prop 2.3, Eq (2.8), Def 2.1, Ex 3.4 …
          "idea": "A point on a body spinning about axis ω traces a circle around that axis.",
          "feynman": "Stick a sticker on a spinning top: it draws a circle around the top's stick.",
          "visual": "3D: an orange axis arrow ω; a pink dot on a blue body leaves a pink circular trail as the body spins; drag ω's tip.",
          "scene": "mls-rodrigues",
          "beat": "🌀 spin a stick",
          "math": ["rotation"],              // Crucible concept ids
          "engine": ["lie.expSO3"],          // src/core functions the scene will use; "NEW: name" if missing
          "difficulty": 1                    // 1 = toddler … 5 = research-level
        }
      ]
    }
  ]
}
```

**Kinds:** `heading prose definition proposition lemma theorem corollary proof equation example figure table remark algorithm exercise summary references index front caption footnote page-number`.

**Trivial kinds:** `page-number`, `references`, `index`, `front` and `heading` need only `idea`. Every other kind needs `feynman`, `visual`, `scene`, `beat` and `difficulty`.

**Blank pages:** `lines: 0`, `atoms: []`, and no summary required.

## Rules of thumb

- **Atom size:**
  - One atom per idea: typically a paragraph, an equation block, a figure, a definition, a proof step-group, or an exercise.
  - Proofs are split into steps.
  - Exercises get their own atoms, one per exercise. Paraphrase what the exercise asks; do not copy it.
- **What each atom field means:**
  - `idea`: the precise statement in grown-up terms, in your own words.
  - `feynman`: an explanation a five-year-old gets from an everyday object or action. This is step 2 of the Feynman technique.
  - `visual`: a concrete, buildable design in Crucible's visual language. Name the objects, the colors (from the palette meanings), the interaction and the motion. No words on screen.
- **Scenes:**
  - Every non-trivial atom points at a scene and at one of that scene's beats.
  - A scene usually covers one subsection, has 3–6 beats, and is ≤ ~40 atoms.
  - Reuse an existing Crucible scene through `exists` when it already shows part of the idea. The new scene then goes deeper.
