# Contributing to SwadharmaPath

## Docs are part of every change (mandatory)

Any change to code or specs must update the matching documentation in [`/docs`](docs/README.md) **in the same branch and pull request**: BRD, HLD, LLD, user guides, SOPs and troubleshooting as applicable.

- Use [the doc map](docs/README.md#which-doc-to-update) to find what to update.
- Add a row to a document's **Change history** when the behaviour it describes changes.
- Fill in the docs checklist in the pull request template.
- CI (**Docs check**, `scripts/check_docs.py`) fails a PR that changes code without changing `/docs`, or changes a mapped area without its mapped doc. Run it locally:
  ```bash
  python3 scripts/check_docs.py origin/main
  ```
- Only for changes with genuinely no doc impact (formatting, dependency bumps), add the `docs-not-required` label and explain why in the PR description.

## Database changes

- Add a new migration; never edit one that has been applied.
- Every table has RLS. Swadharma tables never get a candidate or parent policy.
- Add tests in `supabase/tests/` and run `PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh`.

## Pull requests

- One topic per PR, with requirement IDs from the [BRD](docs/brd/BRD.md) where relevant.
- CI must be green before merge.
