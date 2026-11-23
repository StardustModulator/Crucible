# Writing a Crucible scene

A **scene** is one concept turned into a picture you can touch. The rule of the
project: **a five-year-old should get the idea by looking and poking — no reading,
no listening.** The grown-up math is there too, but hidden behind the `∑` button,
color-coded to match the picture.

## 1. The contract

One file per concept: `src/scenes/<id>.js`, where `<id>` matches `src/graph/concepts.js`.
The app loads it with `import()`, so there is no registry to edit.

```js
import { C, alpha } from '../viz/palette.js';
import { fmt } from '../viz/ui.js';
// …plus whatever you need from ../core/*.js and ../viz/*.js

export default {
  // Grown-up layer: array of LINES; line = array of tokens; token = 'text' | ['text', colorKey]
  // Color keys MUST match the colors used for the same thing in the picture.
  eq: [
    [['ẋ', 'pink'], ' = ', ['J(q)', 'blue'], ' ', ['q̇', 'orange']],
  ],
  setup({ stage, ui }) {
    const g = stage.g.setBounds([-3, -2, 3, 2]);     // world box that must stay visible (y is UP)
    const s = { /* all scene state */ };
    stage.handle({ get: () => s.p, set: (p) => (s.p = p), color: 'gold' }); // draggable dot
    ui.beats(['🌱', '🌿', '🌳'], (i) => { s.beat = i; });                   // story chapters
    ui.slider({ icon: '🎚️', color: 'orange', min: 0, max: 1, value: 0.5, onInput: (v) => (s.k = v) });
    return {
      update(dt, t) { /* physics / algorithm steps; NOT called while paused */ },
      draw() { /* render everything, every frame */ },
      dispose() { /* optional: remove listeners you added with stage.on */ },
    };
  },
};
```

The shell already provides ⏸/▶, ⏭ (single step), ↺ (restart = re-run `setup`),
and 🐢🚶🐇 speed. Keyboard: space, r, ← →, Esc.

## 2. Visual language (non-negotiable)

**No words on the canvas.** Use pictures, emoji, arrows, colors, motion, numbers and
single math symbols (`θ`, `J`, `σ₁`, `λ`, `+`, `=`) only. No sentences, no labels like
"velocity". Controls are icon-only (`title` is for screen readers/tooltips).

Colors always mean the same thing (`src/viz/palette.js`):

| color  | meaning |
|--------|---------|
| `red` `green` `blue` | x / y / z axes and turning about them |
| `orange` | joints, inputs, the knob you turn |
| `pink`   | the hand / end-effector / output |
| `gold`   | goals, targets, the "answer" highlight — rendered in **cardinal red** |
| `teal`   | data, measurements, samples |
| `blue`   | the model / estimate / belief |
| `purple` | uncertainty, noise, probability |
| `lime`   | truth / correct |
| `coral`  | error, gradient, pushback, danger |
| `slate`  | obstacles, walls — **silver gray** |

Kid-level metaphors are the point: gradients are **balls rolling downhill**, covariance
is a **fuzzy blob**, a Kalman update is **two blobs merging into a sharper one**,
convolution is a **sliding stamp**, attention is **lines whose thickness is how much
you listen**, a Jacobian column is **the arrow the hand moves along when one joint
wiggles**. Make the hard thing *move*.

Every scene should have:
1. Something draggable or a slider within the first second of looking (handles pulse).
2. 3–5 **beats** (story chapters) that go from "toy" to "the deep idea", each a
   different picture. Beat 1 must be graspable by a 5-year-old.
3. The real algorithm running underneath — **use `src/core/*` math, never fake it**.
   The picture must be computed, not drawn by hand.
4. An `eq` with color tokens matching the picture.
5. Live feedback: readouts (`ui.readout`), meters, plots of error/energy/loss over time.

### Typography & emoji

The app uses one type system (`src/viz/type.js`):
- **Inter:** labels and numbers.
- **Inter Tight:** headlines.
- **IBM Plex Mono:** metadata.
- **"Crucible Emoji":** Noto Emoji pinned to its thin 300 weight, so every emoji renders as a slim **black-and-white line glyph** in the current fill colour.

On canvas, any font string you set is rewritten to this system automatically, and the colour-emoji selector U+FE0F is stripped. So:
- **Font strings:** just write `ctx.font = '16px sans-serif'` or use `pen.text`/`pen.emoji`.
- **Colour:** an emoji takes its colour from `fillStyle`. Set it deliberately (usually `C.ink` or `C.muted`), or a glyph drawn right after a fill inherits that fill's colour.
- **Avoid colour-emoji fonts:** never reference them, and never rely on an emoji's colour to carry meaning. Meaning lives in palette colours.

## 3. Drawing API

`stage.g` — default pen covering the whole canvas. A **Pen** maps a world box
(y up) onto a rectangle. Coordinates are world units; widths/sizes are pixels.

- Layout: `stage.g.setBounds([x0,y0,x1,y1])`; multiple panels:
  `const [L, R] = stage.split([[...boundsL], [...boundsR]], [1, 1])` (side-by-side on
  wide screens, stacked on phones). `stage.hud` = raw pixel pen (y down, for overlays).
  `pen.area` = its pixel rectangle `{x,y,w,h}`; `pen.view` = visible world box.
- Shapes: `line(a,b,o)`, `path(pts,o)`, `poly(pts,o)`, `arrow(a,b,o)`, `vec(origin,v,o)`,
  `circle(c,r,o)` (world r; `fill` for filled), `dot(c,px,o)`, `ellipse(c,rx,ry,ang,o)`,
  `cov(mu,S,k,o)` (covariance ellipse), `blob(c,sigma,o)` (fuzzy glow), `rect(x,y,w,h,o)`,
  `rrect(...)`, `arc(c,r,a0,a1,o)`, `wedge(c,r,a0,a1,o)`, `bar(x,y,w,h,o)`.
- Robotics: `arm(points,o)` (pretty planar arm: `{width, color, colors[], jointColor, hand, base}`),
  `frame(origin, angle, len)` (2D RGB frame), `spring(a,b,o)`, `damper(a,b,o)`.
- Fields & data: `grid({step})`, `warpedGrid(f,{range,step,color})`, `heat(f,{cacheKey,cmap,res,min,max,alpha})`
  (**always pass a `cacheKey` that changes only when the field changes**; use `slot` for several maps on one pen),
  `cells(M, topLeft, size, o)` (matrices / images / attention maps), `plot(f | pts, o)`,
  `band(xs, lo, hi, o)`, `meter(icon, value, max, {slot,color})`.
- Text: `text(str, p, {size,color})`, `emoji(ch, p, size)` — symbols & numbers only.
- Options `o`: `{ color, width, alpha, dash:[a,b], fill }` — colors are palette keys
  (`'blue'`) or CSS strings (`alpha('blue', .3)`).
- `pen.clip(() => {...})` clips to the panel. `pen.toScreen(p)`, `pen.toWorld(s)`, `pen.px(len)`.

**3D**: `const v = new View3D(pen, { yaw, pitch, dist, target })` — drag empty space
to orbit, wheel to zoom. Each frame: `v.begin()` … queue primitives … `v.flush()`
(depth-sorted). Primitives: `line`, `path`, `arrow`, `point`, `sphere`, `poly`, `box(R,p,half)`,
`cylinder(a,b,r)`, `frame(R,p,len)`, `frameT(T4x4,len)`, `floor(size,step)`,
`circle(center,normal,r)`, `text`. z is up.

**Handles**: `stage.handle({ pen, get, set, color, r, kind:'dot'|'ring'|'square', icon, visible })`.
**Pointer**: `stage.on('down'|'move'|'up'|'wheel', (e) => …)` with `e.p` (world point in
`e.pen`), `e.pen`, `e.sx/e.sy` pixels. Handles take priority over 'down'.

**UI** (`ui`): `slider`, `button`, `toggle`, `choice({options:[{icon,value,title}]})`,
`beats(icons, onChange)` (returns `{index, set(i), next()}`), `readout(fn, {icon,color})`.
Per-beat controls: create them inside `const grp = ui.group()` (pass `into: grp`) and toggle
`grp.style.display`. Pens scale x and y equally — draw non-square plots in normalized
coordinates or in pixels inside `pen.area`. Declare every `const` used by `draw()` *before*
the `return { … }` in `setup`.

## 4. The math engine (`src/core`)

- `linalg.js` — vectors, matrices, `inv`, `det`, `solve`, `cholesky`, `symEig`, `eig2`, `svd`, `pinv`, `dampedPinv`, `lstsq`, `covEllipse`, `mean`, `covariance`, `rot2`.
- `lie.js` — `hat`, `vee`, `expSO3`, `logSO3`, `rotX/Y/Z`, `eulerZYX`, quaternions (`qmul`, `qFromAxisAngle`, `qToMat`, `qFromMat`, `slerp`, `qRotate`), `homog`, `invSE3`, `expSE3`, `logSE3`, `adjoint`, `screwAxis`.
- `kinematics.js` — `planarFK`, `planarJacobian`, `planarIK(Step)`, `twoLinkIK`, `manipulability`, `poeFK`, `poeFrames`, `spaceJacobian`, `dhTransform`, `dhChain`.
- `dynamics.js` — `rk4`, `pendulumDeriv`, `pendulumEnergy`, two-link `M/C/G`, `twoLinkAccel`, `twoLinkTau`, `twoLinkEnergy`, `twoLinkDeriv`, `cartPoleDeriv`, `cartPoleLinear`, `numJacobian`.
- `control.js` — `PID`, `discretize`, `dlqr`, `lqr`, `cubic`, `quintic`, `trapezoid`, `secondOrderPoles`, `vectorField`.
- `estimation.js` — `gauss1`, `gaussN`, `fuse1`, `KalmanFilter`, `EKF`, `systematicResample`, `effectiveSampleSize`, `kabsch`, `icpStep`, `fitLineTLS`, `fitLineOLS`, `ransacLine`, `ransacIterations`, `logit/unlogit`, `rayCells`, `project`.
- `planning.js` — `astar`, `RRT`, `prm`, `graphShortestPath`, `potentialField`, `minkowski`, `convexHull`, `pointInPolygon`, `segHitsCircle`.
- `learning.js` — `act`, `softmax`, `MLP` (+`backward`), `Optimizer` (sgd/momentum/adam), `trainBatch`, `conv2d`, `maxPool`, `conv1d`, `attention`, `positionalEncoding`, grid-world RL (`gridStep`, `valueIterationSweep`, `qLearningEpisode`), `gpPosterior`, `gmmInit/gmmStep`, `kmeansStep`, `pca`, `DMP`, diffusion (`linearBetaSchedule`, `forwardNoise`, `mixtureScore`), `flowTarget`, `cemStep`.
- `random.js` — seeded `rng(seed)` with `.normal() .uniform() .int() .pick() .shuffle()`; `clamp`, `lerp`, `smoothstep`, `wrapAngle`. **Use seeded randomness** so scenes look the same every time.

Scene-specific math that is not reusable may live in the scene file. If it is
reusable, it belongs in `src/core` with a test in `tests/`.

## 5. Quality bar & testing

- Smooth at 60 fps: cache heat maps, keep per-frame work small, cap simulation substeps.
- Works at phone width (≈400 px): use `stage.split` for multi-panel layouts, keep HUD overlays compact.
- Works in both themes: only palette colors (no hard-coded hex).
- Run `node scripts/smoke.mjs <id> [<id>…] --shots <dir>` — it opens each scene, drags handles,
  clicks every beat/button, and fails on any runtime error. **Look at the screenshots.**
  Add `--portrait` to check phone layout.
