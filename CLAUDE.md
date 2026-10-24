# SwadharmaPath — instructions for AI-assisted changes

## Mandatory: update docs with every change

For every code or spec change, update the matching documents under `docs/` in the same branch and pull request, without being asked:

- `docs/brd/BRD.md` — scope, business rules, consent, disclaimer, report kinds
- `docs/design/HLD.md` — components, flows, security model, deployment
- `docs/design/LLD.md` — tables, policies, triggers, views, RPCs, engine rules, config
- `docs/user-guides/*.md` — screens and steps per role
- `docs/sops/*.md` — operational and technical procedures
- `docs/troubleshooting/troubleshooting.md` — new or changed errors and behaviour

Use `docs/docs-map.txt` to see which docs a path maps to, add a Change history row when behaviour changes, and run `python3 scripts/check_docs.py origin/main` before pushing.

## Non-negotiables

- Swadharma data (`birth_details`, `swadharma_charts`, `swadharma_scores`) never gets a candidate or parent policy; candidate views strip `breakdown.swadharma`.
- `swadharma_releases` and `audit_log` are append-only; reports are write-once and versioned.
- Under-18 (or unknown DOB) candidates cannot start assessments without guardian consent.
- Scoring runs in `/worker`; the frontend only displays results.
- The disclaimer text in `docs/brd/BRD.md` §12 is verbatim and must not be reworded.
