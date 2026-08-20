---
name: audit-fork-customizations
description: Audit and preserve every so2liu/paseo fork feature and bug fix across upstream pulls, release-tag merges, and sync PRs. Use after pulling or merging upstream, while reviewing an upstream-sync branch, when investigating a suspected lost customization, and whenever adding, changing, replacing, or intentionally removing fork-specific behavior so the customization catalog stays current.
---

# Audit fork customizations

Treat `references/customizations.md` as the detailed behavior contract for this fork. Read it
completely before auditing a sync or changing cataloged behavior.

## After an upstream pull or sync

1. Read `CLAUDE.md`, `docs/upstream-sync.md`, and `references/customizations.md`.
2. Identify four refs:
   - previous upstream release tag;
   - fork `main` immediately before the sync;
   - new upstream release tag;
   - merged result under review.
3. Run:

   ```bash
   .agents/skills/audit-fork-customizations/scripts/audit-customizations.sh \
     <previous-upstream-tag> <pre-sync-fork-ref> <new-upstream-tag> <merged-ref>
   ```

4. Review every intersecting fork commit and every candidate missing file or symbol printed by the
   script. Do not treat source presence as proof of working behavior: trace each catalog entry from
   user action through the current implementation. The composer history regression is the canonical
   example—its functions survived, but the upstream DOM-owned input contract made the old setter a
   no-op for the visible input.
5. Verify every catalog row against its listed anchors and focused validation. Exercise compact and
   wide render branches independently where both exist.
6. Classify each row as `preserved`, `upstream replacement`, `regressed`, `intentionally retired`, or
   `unable to verify`. An upstream replacement is acceptable only after comparing user-visible
   behavior. `regressed` and `unable to verify` block approval.
7. Report the refs, counts, focused tests, manual surfaces, environment blocks, and final `GO` or
   `NO-GO`. Do not hide unrelated test failures or call a focused run a full regression.

## When adding or fixing fork behavior

Update `references/customizations.md` in the same change. Add or revise one row with:

- a stable ID and exact user-visible invariant;
- the introducing PR or commit when known;
- current production anchors;
- the smallest validation that can catch a future semantic regression;
- replacement or retirement notes when ownership moves upstream.

Also update the summary inventory in `CLAUDE.md` when the change creates a new area or materially
changes an existing invariant. Do not add low-value tests merely to fill the validation column;
static inspection or a manual surface is valid when a test cannot catch the regression. If the
behavior depends on an interface boundary, prefer one integration assertion over separate unit tests
on each side.

## Guardrails

- Audit from release tags, never `upstream/main`.
- Preserve merge ancestry and follow `docs/upstream-sync.md` conflict rules.
- Never approve solely from typecheck, lint, exported symbols, or file existence.
- Do not restore obsolete fork machinery when upstream now owns equivalent behavior.
- Do not silently delete a catalog row. Mark it replaced or retired and explain why.
- Keep this Skill and `CLAUDE.md` updated in the same PR as new fork behavior.
