---
name: book-audit
description: Audit that every line of a day's (or chapter's) textbook pages is covered by atlas atoms AND visibly taught by a built, working scene beat. Use after building a day's scenes, before committing, or when asked "is everything covered?".
---

# Coverage audit

There are three layers, and each must be ✅.

1. **Lines → atoms (mechanical).**
   - Run `node scripts/book-check.mjs` (0 errors), which proves the atoms tile every canonical line.
   - For the final day add `--all`, which proves all 474 PDF pages are covered.
2. **Atoms → scenes (mechanical).**
   - Run `node scripts/book-day.mjs <N>`. Every scene the day needs must show 🧱 built.
   - Run `node scripts/smoke.mjs $(node scripts/book-day.mjs <N> --ids) --shots <dir>` with 0 errors. The smoke test also checks that each `mls-*` scene shows as many beats as its atlas card.
3. **Scenes → understanding (judgement). For each page of the day:**
   - Read the atoms (`node scripts/book-day.mjs --page <book>`).
   - For each atom, open the scene beat (`#/s/<scene>?beat=<k>`) or its screenshot and check the atom's `visual` is actually there, computed rather than faked.
   - Mark the page ✅, or ❌ with the missing atom ids.

**Output:** a page-by-page table (`page · atoms · ✅/❌ · missing`) and the list of fixes made.
**Never mark a page ✅** if any atom's visual is missing.
