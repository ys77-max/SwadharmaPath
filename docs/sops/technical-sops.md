# Technical SOPs

Procedures for developers and the technical owner.

> Last updated 2026-10-24. Worker moved to GitHub Actions (free timer) instead of Railway (SOP-T1, T4, T5, T7). First admin is created in Supabase Auth, not by signing up (SOP-T1 step 4).

| ID | SOP |
|---|---|
| T1 | [Release and deployment](#sop-t1-release-and-deployment) |
| T2 | [Database migration](#sop-t2-database-migration) |
| T3 | [Regenerating seed data](#sop-t3-regenerating-seed-data) |
| T4 | [Worker operations](#sop-t4-worker-operations) |
| T5 | [Secret rotation](#sop-t5-secret-rotation) |
| T6 | [Backup and restore](#sop-t6-backup-and-restore) |
| T7 | [Incident response](#sop-t7-incident-response) |
| T8 | [Documentation maintenance](#sop-t8-documentation-maintenance) |

---

## SOP-T1 Release and deployment

1. Every change goes through a pull request to `main`.
2. CI must be green, including the **docs check** (code changes need matching `/docs` changes).
3. Database changes: run `supabase/tests/run.sh` locally; apply to staging first ([SOP-T2](#sop-t2-database-migration)).
4. Merge. Vercel deploys the web app from `main`. The worker workflow runs the code on `main` at its next scheduled run.
5. Smoke test production: login as each role with test accounts, open /me, /family, /cases, /admin; submit a test enquiry.
6. Note the release in the change history of any doc you changed.

**Rollback:** web — redeploy the previous Vercel deployment; worker — revert the commit on `main` (the next scheduled run uses it) or disable the Worker workflow; database — write a forward-fixing migration (never edit an applied migration).

### Production environment

| Piece | Where | Notes |
|---|---|---|
| Database, Auth, Storage, Edge Functions | Supabase project `swadharmapath` (ref `fskmeqrjtwdswaoqwjkh`, region ap-south-1) | `001_init.sql` applied (schema, then seed in parts); `002_library_refresh_archive.sql` to apply with the library refresh and archive release; Edge Functions `score_instrument` (`verify_jwt` off, it checks the caller itself) and `generate_signed_report_url` (`verify_jwt` on) |
| Web | Vercel project `swadharmapath`, production branch `main` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` set for production, preview and development |
| Worker | GitHub Actions workflow **Worker** (`.github/workflows/worker.yml`): every 15 minutes, nightly 02:15 IST, quarterly 09:00 IST | Repo secrets `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (optional) |

### First go-live checklist

1. Vault: `project_url` is set. Add `service_role_key` once, in the Supabase SQL editor (never in the repo or chat):
   ```sql
   select vault.create_secret('<service_role key from Project Settings → API keys>', 'service_role_key');
   ```
   Without it, completed assessments are scored only by the worker's minute poll, not instantly.
2. Auth → URL configuration: Site URL = the Vercel production URL; add `<production URL>/**` to Redirect URLs.
3. Worker: GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**: add `SUPABASE_SERVICE_ROLE_KEY` (the Legacy service_role key). Then **Actions → Worker → Run workflow** once and check it goes green. Until the secret exists, runs skip with a notice. (Alternative for minute-level freshness: any Docker host such as Render, root directory `worker`, same variables plus `WORKER_PUBLIC_LOGS` unset; then disable the Worker workflow so jobs don't run twice.)
   Add a second secret `ANTHROPIC_API_KEY` (from the Anthropic Console, a key used only for this worker) to turn on **Refresh now with AI** and the quarterly AI refresh. Without it, CSV refresh and archiving still work and the quarterly job only sends a reminder. A full refresh of the seeded library costs roughly ₹500; set a monthly spend limit in the Console.
4. First admin: the web app has no sign-up screen, so create the account in Supabase: **Authentication → Users → Add user → Create new user**, enter the email and a password, tick **Auto Confirm User**. Then in the SQL editor run `update public.users set role = 'admin' where email = '<email>';`. Create counsellor accounts from /admin.
5. Smoke test as in step 5 above.

## SOP-T2 Database migration

1. Add a new file `supabase/migrations/NNN_description.sql`. Do not edit an applied migration.
2. Every new table: enable RLS and add policies. Sensitive tables get **no** candidate/parent policy.
3. Add tests in `supabase/tests/` (`rls_test.sql`, `owner_test.sql`, or a new file added to `run.sh`). `run.sh` applies every file in `supabase/migrations/` in name order.
4. Run locally:
   ```bash
   PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh
   ```
5. Apply to staging (`supabase db push` against the staging project), run smoke tests, then production.
6. Update the [LLD](../design/LLD.md) data model, access matrix, triggers and RPCs sections.

## SOP-T3 Regenerating seed data

1. Edit `supabase/seed/library.py` (careers, streams) or `supabase/seed/instruments.py`.
2. Run `python3 supabase/seed/build_seed.py`. It rewrites everything after `-- BEGIN GENERATED SEED` in the migration.
3. Run the SQL tests. Commit the generated SQL with the source change.

## SOP-T4 Worker operations

1. The worker runs as the GitHub Actions workflow **Worker** (Python 3.12, service-role key from repo secrets). Run it by hand from **Actions → Worker → Run workflow** and pick polling, nightly or quarterly.
2. Logs are public (public repo), so the workflow sets `WORKER_PUBLIC_LOGS=true`: no names or tracebacks. To debug a failure with full detail, run `python scheduler.py --run polling` locally with the secrets in your shell.
3. GitHub disables scheduled workflows after 60 days without commits; re-enable from the Actions tab (it emails the owner first).
4. If scoring or reports stop: check the Worker runs in the Actions tab, then Supabase logs for `score_instrument`, then the Vault secrets used by `invoke_edge_function`.
5. Re-run scoring for a session by re-triggering the worker job for that session (command to be documented when the worker lands).
6. **Library refresh.** The worker processes one queued run at a time (`job_library_refresh`, each polling run) and, after an admin applies a run, recalculates matches (`job_library_rematch`). Logs show `queued scheduled library refresh …`, `library refresh … failed` and per-job counts.
7. **Stuck refresh.** If a worker run was cut off (timeout or GitHub outage), the run stays `running` and blocks new refreshes. Ask an admin to click **Cancel refresh** on the review page (or run `select public.cancel_library_refresh('<run id>')` as an admin), then start a new one.
8. **AI refresh failing.** Check that the `ANTHROPIC_API_KEY` repo secret is set, the key is active and the Console spend limit is not reached. The run's error shows the reason; individual entries that failed or were declined are listed under "Notes from the check" and the rest of the run still goes to review.
9. **Auto-archive** runs in the database (`pg_cron` job `swadharmapath-auto-archive`, 02:30 IST), not in the worker. Check `cron.job_run_details` if `archive_settings.last_auto_run_at` stops moving while auto-archive is on.

## SOP-T5 Secret rotation

1. Rotate the service-role key in Supabase.
2. Update it in the GitHub repo secret `SUPABASE_SERVICE_ROLE_KEY` (worker), Edge Function secrets and Vault `service_role_key`.
3. Rotate `ANTHROPIC_API_KEY` in the Anthropic Console if exposed or when staff with access leave; update the GitHub repo secret.
4. Rotate the anon key only if exposed; update `VITE_SUPABASE_ANON_KEY` in Vercel and redeploy.
5. Verify scoring (complete a test assessment) and report download.

Never put the service-role key in a `VITE_*` variable or in the repo.

## SOP-T6 Backup and restore

1. Supabase daily backups (and point-in-time recovery if enabled on the plan).
2. Storage buckets `reports` and `documents`: periodic export.
3. Test a restore to a scratch project quarterly.

## SOP-T7 Incident response

| Severity | Example | Response |
|---|---|---|
| S1 | Swadharma or private notes visible to a family; data leak | Immediately: disable affected route or policy, notify owner, follow [SOP-O14](operations-sops.md#sop-o14-privacy-requests-and-data-incidents) |
| S2 | Logins, test runner or scoring down | Within 1 hour: diagnose via Vercel, Supabase and GitHub Actions (Worker) logs; roll back if a recent deploy caused it |
| S3 | A dashboard number wrong, a report layout issue | Next working day |

After any S1/S2: short post-incident note, a test that would have caught it, and doc updates.

## SOP-T8 Documentation maintenance

**Rule:** every code or spec change updates the matching docs in the same branch and pull request.

1. Check [the doc map](../README.md#which-doc-to-update) to find which docs your change touches.
2. Update them, and add a line to the doc's change history when behaviour changes.
3. Tick the docs box in the PR template.
4. CI runs `scripts/check_docs.py`. It fails when code changes have no `/docs` change, or when a mapped area (for example `supabase/migrations/`) changes without its mapped doc.
5. For a change with genuinely no doc impact (formatting, dependency bump), add the label `docs-not-required` and say why in the PR description. Reviewers must agree.
