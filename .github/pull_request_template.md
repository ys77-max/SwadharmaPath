## Summary

<!-- What changed and why. Reference BRD requirement IDs (e.g. FR-A3, BR-3) where relevant. -->

## Docs (mandatory)

Every code or spec change updates the matching docs in this PR. See [docs/README.md](../docs/README.md#which-doc-to-update).

- [ ] BRD updated (scope, rules, consent, disclaimer, report kinds) — or not affected
- [ ] HLD updated (components, flows, security model, deployment) — or not affected
- [ ] LLD updated (tables, policies, triggers, RPCs, engine rules, config) — or not affected
- [ ] User guides updated for each affected role — or not affected
- [ ] SOPs updated — or not affected
- [ ] Troubleshooting updated for new or changed errors/behaviour — or not affected
- [ ] Change history row added in each doc whose behaviour description changed

If none of the docs are affected, add the `docs-not-required` label and explain why here:

## Testing

- [ ] `supabase/tests/run.sh` passes (database changes)
- [ ] App/worker tests pass
