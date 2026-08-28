# Grill: gones-audit-fixes

## Round 1 — Plan shape

| # | Question | Answer | Precision |
| --- | -------- | ------ | --------- |
| 1 | Which findings does this plan cover? | All 39 findings in one plan | — |
| 2 | One master plan, or per-finding plans via the audit loop? | Master plan = queue orchestration only (order, batching, gates); per-finding plans still made just-in-time by the audit loop | — |
| 3 | Ticket granularity? | 1 finding = 1 ticket by default; split only where the F1 precedent showed a finding needs 2 commits; merge only same-file trivial pairs | — |
| 4 | Ticket order? | Severity desc, then category: security → bug → ops → perf → test/refactor; F-id order within a group | — |
| 5 | Publish policy for implementation commits? | Keep audit precedent: additive commits directly on main, push after each ticket's gates pass (typecheck, lint, full vitest, backend:test) | — |
| 6 | Which make-plan-v2 outputs to produce? | Markdown only: index + ticket files. No HTML plan, no ADRs, no architecture docs | — |
| 7 | GitHub issue lifecycle per implemented finding? | (none selected) | ignore github part, just make normal implementation plan |
| 8 | Include the F1 bootstrap-generation-race residual? | Open a new GitHub issue for it and add it as a ticket in this plan (auth area, alongside F36 logout-hang) | — |

### Open contradictions → round 2

- Q2 ("orchestration only, per-finding plans just-in-time") vs Q7 precision ("just make normal implementation plan") — ticket depth unresolved.
- Q7 ("ignore github part") vs Q8 ("open a new GitHub issue for residual") — GitHub surface unresolved.

## Round 2 — Contradictions + gated findings

| # | Question | Answer | Precision |
| --- | -------- | ------ | --------- |
| 1 | Ticket depth? | A: Normal make-plan-v2 — 40 self-contained level-5 ticket files written now, red-team + coherence review across whole set, then implementation ticket by ticket | — |
| 2 | GitHub surface? | Zero GitHub: no issue creation, comments, or closing anywhere; F1 residual = plan ticket only (no new issue) | — |
| 3 | F19 direction? | Retire: delete the Pages workflow; F20 becomes removal of the dead redirect + build check | — |
| 4 | Human-gated validation? | Implement + static verification; one human e2e run at the very end covers all such tickets | — |

## Facts (scout)

- 39 open findings: 22 medium (F2–F19, F21–F23, F34), 17 low (F20, F24–F33, F35–F40) — source: `.tmp/MAKE_AUDIT_2026_08_26_gones_50e4a007ec0f/index.json`
- Only dependency edge: F20 depends on F19 — source: same index.json
- F40 proposed fix disproved in validation (capping the read → silently wrong standings) — fix direction open — source: handoff + PROGRESS.md log
- `npm run e2e:ci` teardown destroys DB volumes → human-only gate — source: `scripts/full-stack-ci.mjs:126` per handoff
- F16 fork: codify Live-only match-wins tiebreak (spec default) vs drop it — source: `.tmp/.../F16_*.md` fix scope
- F22 fork: "Pick one naming" — documented names → compose, or docs → stack names — source: `.tmp/.../F22_*.md` fix scope
- F23 fork: doc-only vs also rebuild counts repair path (left open by validation) — source: `.tmp/.../F23_*.md` validation notes
- F33 fork: post-MAC restore policy for legacy archives undefined — source: `.tmp/.../F33_*.md` fix scope
- F18/F21/F28 have exactly one validated safe fix direction (docs follow code) — sources: respective spec files, fix-scope sections

## Round 3 — Per-finding forks

| # | Question | Answer | Precision |
| --- | -------- | ------ | --------- |
| 1 | F16 tiebreak | Codify: document Live-only match-wins tiebreak next to ranking contract (docs/CONTEXT.md) + cross-surface test pinning both chains as-is | — |
| 2 | F22 naming | Documented names win: compose stacks (compose.yaml + release-test + release-candidate) pass documented .env.example names through to frontend service | — |
| 3 | F23 repair | Doc-only: remove dead key from .env.example, restate write-time repair in docs, mark ADR 0042 superseded | — |
| 4 | F33 legacy backups | Strict: restore refuses any archive without valid MAC; human follow-up = take one fresh backup right after fix lands | — |

## Shared understanding

- Spec level: 5 — target reached. Direction decisions all settled; verbatim boundary shapes (sigs, schemas, exact names) get frozen per ticket at plan-write time from the validated finding specs at `.tmp/MAKE_AUDIT_2026_08_26_gones_50e4a007ec0f/F{n}_{slug}.md` — no fork remains where two implementers would pick different directions.
- Goal: one make-plan-v2 implementation plan fixing all 39 remaining validated audit findings (F2–F40) plus the F1 bootstrap-generation-race residual — 40 findings, ~40 tickets, each a commit-sized slice, app green after every commit.
- Settled:
  - Scope: all 39 findings + F1 residual (residual = plan ticket only, no new GitHub issue).
  - Depth: full make-plan-v2 — 40 self-contained level-5 ticket files written upfront, red-team (step 4.5) + coherence review (step 6) across the whole set, then implementation runs ticket by ticket.
  - Granularity: 1 finding = 1 ticket; split only if a finding truly needs 2 commits; merge only same-file trivial pairs (identified at decomposition).
  - Order: severity desc, then category security → bug → ops → perf → test/refactor; F-id order within group; F20 after F19; residual ticket adjacent to F36 (auth area).
  - Publish: additive commits directly on `main`, push after each ticket's gates pass. Gates: `npm run typecheck` · `npm run lint` · `npm run test` (full vitest) · `npm run backend:test`.
  - Outputs: markdown only — index + ticket files. No HTML plan, no ADRs, no architecture docs.
  - GitHub: zero interaction anywhere in the plan (no issue creation/comments/closing).
  - F19: retire — delete the Pages workflow; F20 = remove dead legacy redirect + its build check.
  - F37 (and any e2e-only proof): implement + static verification; one human `npm run e2e:ci` run at the very end covers all such tickets. Never auto-run (teardown destroys DB volumes).
  - F16: codify — document Live-only match-wins tiebreak in ranking contract + cross-surface pin test; zero behavior change.
  - F22: documented names win — wire documented .env.example var names through all compose stacks.
  - F23: doc-only — remove dead key, restate write-time repair, mark ADR 0042 superseded. (Marking ADR superseded = editing existing tracked doc, allowed despite no-new-ADR rule.)
  - F33: strict MAC — HMAC from passphrase-derived second key over ciphertext, verified before decrypt; restore refuses un-MACed archives; human follow-up: one fresh backup after fix lands.
  - Remaining 32 findings: fix direction exactly as stated in each validated spec's fix-scope section.
- Contracts: source of truth per finding = `.tmp/MAKE_AUDIT_2026_08_26_gones_50e4a007ec0f/F{n}_{slug}.md` (evidence lines, fix scope, validation cmds). Cross-ticket contracts frozen verbatim by orchestrator at ticket-write time per make-plan-v2 step 5.
- Assumptions:
  - Implementation is serial, one writer on `main` (G4); clean-tree gate before each ticket.
  - F40 fix approach (capped-read disproved) is a technical decision — orchestrator/ticket-writer decides at plan time, logged in ticket.
  - `rebuild` for the patched audit skill stays a user action (K1) — irrelevant to this plan since vehicle is make-plan-v2, not make-audit-aron.
- Out of scope: GitHub issue lifecycle · Pages repair (retired instead) · new counts-repair path (F23 doc-only) · legacy-backup grace path (strict) · auto-running `npm run e2e:ci` or `rebuild` · HTML plan/ADR/architecture outputs.
