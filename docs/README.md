# SwadharmaPath documentation

Single source of truth for what SwadharmaPath does, how it is built and how it is operated.

| Area | Document | Audience |
|---|---|---|
| Business | [BRD — Business Requirements](brd/BRD.md) | Owner, counsellors, developers |
| Design | [HLD — High-Level Design](design/HLD.md) | Developers, technical owner |
| Design | [LLD — Low-Level Design](design/LLD.md) | Developers |
| User guide | [Candidate](user-guides/candidate.md) | Students and professionals |
| User guide | [Parent / guardian](user-guides/parent.md) | Parents |
| User guide | [Counsellor](user-guides/counsellor.md) | Counsellors |
| User guide | [Admin](user-guides/admin.md) | Admins |
| SOP | [Operations SOPs](sops/operations-sops.md) | Counsellors, admins |
| SOP | [Technical SOPs](sops/technical-sops.md) | Developers |
| Support | [Self-help troubleshooting](troubleshooting/troubleshooting.md) | Everyone |

## Docs are mandatory

Every code or spec change must update the matching docs **in the same branch and pull request**. This is enforced by:

- the PR template checklist (`.github/pull_request_template.md`),
- the CI workflow **Docs check** (`.github/workflows/docs-check.yml` → `scripts/check_docs.py`),
- the rules in [CONTRIBUTING.md](../CONTRIBUTING.md) and [CLAUDE.md](../CLAUDE.md) (so AI-assisted changes follow it automatically).

## Which doc to update

The CI check reads the machine-readable map in [`docs-map.txt`](docs-map.txt). In plain words:

| You changed | Update |
|---|---|
| `supabase/migrations/`, `supabase/seed/` | LLD (data model, access, triggers, RPCs); HLD if security model or components change |
| `supabase/functions/` | LLD; HLD component table |
| `worker/` | LLD engine rules and jobs; HLD if a new component |
| `src/` pages, routes, copy | The user guide for that role; troubleshooting if errors or behaviour change |
| Scope, rules, consent, disclaimer, report kinds | BRD, plus every guide that quotes them |
| Deployment, env vars, CI | HLD deployment view; LLD configuration; Technical SOPs |

When a change alters behaviour, add a row to the document's **Change history**.
