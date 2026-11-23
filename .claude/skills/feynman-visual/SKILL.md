---
name: feynman-visual
description: Turn any hard robotics/math idea into a picture a five-year-old understands, using the Feynman technique and Crucible's fixed visual language. Use whenever explaining a concept, writing atlas atoms (feynman/visual fields), or designing scene beats.
---

# Feynman → Visual

The Feynman technique, adapted so the "explanation" is a **picture you can poke**, not words.

## The four steps

1. **Study.** State the idea precisely, in your own words. That statement is the atom's `idea`.
   - Name every symbol in it.
   - Say what is *given*, what is *computed*, and what *stays the same*.
2. **Teach a child.** Find an everyday object or action that *behaves* the same way. That is the atom's `feynman`.
   - Good: a spinning top, a door hinge, a screw, a rubber band, a seesaw, water flowing downhill, a crowd of ants, folding paper, two hands carrying a box, a shopping cart that can't slide sideways.
   - Bad: an analogy that only *sounds* similar. The toy must obey the same rule.
3. **Find the gap.** Ask where the toy breaks.
   - The break is usually the *deep* part of the idea: non-commuting rotations, singularities, nonholonomy, the half-angle in quaternions, and so on.
   - That break becomes its own beat.
4. **Simplify into a picture.** Design what you SEE and DO. That is the atom's `visual`.
   - Something draggable or a slider.
   - Something that *moves* as a consequence.
   - A readout or meter that makes the invariant visible: a number that stays fixed, a bar that never changes height, an ellipse that collapses.

## Visual language (never change these meanings)

| color | meaning |
|---|---|
| orange | joints, inputs, the knob you turn |
| pink | hand / end-effector / output |
| gold | goals, targets, the answer (drawn in cardinal red) |
| teal | data, measurements, contact points |
| blue | model / estimate / the body |
| purple | uncertainty, noise, constraint forces |
| lime | truth / correct / allowed |
| coral | error, forbidden, pushback |
| slate | obstacles, ground, fixed world (silver gray) |
| red · green · blue | x · y · z axes and turning about them |

- **No words on the canvas.** Only emoji, arrows, colors, motion, numbers and single math symbols.
- **Emoji are thin black-and-white line glyphs.** Their meaning comes from shape. Color meaning comes from the palette, never from the emoji itself.
- **The grown-up formula** goes in the scene's `eq`. Each token is colored to match its picture.

## Pattern library (reach for these first)

| idea type | picture |
|---|---|
| linear map / matrix | a grid being squished; î ĵ k̂ arrows as columns |
| exponential / flow | "keep doing a tiny step": n small steps converging to a smooth curve |
| Lie bracket / non-commuting | go A, go B, undo A, undo B → you don't come home; the leftover gap is the bracket |
| constraint (Pfaffian, contact) | allowed directions in lime, forbidden in coral; a cart that can't slide sideways |
| duality (twist ↔ wrench, velocity ↔ force) | the same ellipse in two colors; stretching one squashes the other |
| stability (Lyapunov) | a ball in a bowl; the energy bar only ever goes down |
| singularity | an ellipse flattening to a line, with a 🚫 flash |
| existence / uniqueness | ghosts: zero, one, or many solutions shown at once |
| proof | a staircase: each step is a picture, and the last picture is obviously true |
| invariance / coordinate change | the same object in two frames; the numbers change, the thing doesn't |
| optimization | a ball rolling downhill; level sets; a gradient arrow |
| grasp / force-closure | arrows pushing from fingers; the "cone" of allowed pushes covers every direction or doesn't |

## Checks before you finish

- [ ] Would a 5-year-old *see* what happens without anyone talking?
- [ ] Is the math real (computed by `src/core`), not a hand-drawn cartoon?
- [ ] Does the deepest/subtlest part of the idea get its own beat?
- [ ] Are colors used with their fixed meanings?
- [ ] Is every word your own? (Never copy textbook sentences.)
