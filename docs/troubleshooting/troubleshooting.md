# Self-help troubleshooting

Find your problem, try the fix, and contact your counsellor (families) or the technical owner (staff) if it persists.

> Last updated 2026-10-24. Add an entry here whenever a fix changes user-visible behaviour or error messages.

## For candidates and parents

### T-1 I cannot log in
- **Email login:** check spelling; use "Forgot password" to reset.
- **Phone OTP:** enter the number with country code (+91). Codes expire after a few minutes; request a new one. Check SMS is not blocked.
- **No account yet:** accounts are created by the agency after enquiry. Contact them.

### T-2 "Guardian consent is required before an under-18 candidate can start an assessment"
Your parent or guardian must open **/family** and press **Give consent**. If your date of birth is missing, add it in onboarding; until then you are treated as under 18. If no parent is linked, ask your counsellor to link one.

### T-3 I cannot see my results / profile
Results show only after your counsellor approves your profile. This usually happens after your assessments are reviewed. Check with your counsellor.

### T-4 I cannot see options or streams
Your counsellor publishes them after review. Until then the page is empty.

### T-5 My test reset, skipped ahead or will not let me go back
- Answers save every 30 seconds; if you closed the browser, press **Resume** to continue at your first unanswered question.
- In **timed** sections the clock keeps running when you leave, and you cannot go back ("back navigation is not allowed in a timed section"). If time ran out, you are moved to the next section. This is by design.
- An answer given more than 30 seconds after a timed section ended is not saved.

### T-6 Assessment completed but no results
Scoring runs automatically but your counsellor still has to review it. If several days pass, ask your counsellor. (Staff: see T-21.)

### T-7 "Assessment is not in progress"
The test was already completed or your counsellor invalidated it. Reload **/me/assess**; if a new attempt is needed your counsellor will re-administer it.

### T-8 Report download link does not work
Links expire after 15 minutes. Go back to **/me/reports** (or **/family**) and press Download again.

### T-9 I don't see a report my counsellor mentioned
Only released reports appear. Ask your counsellor to check it was released to you (candidate) or to you as parent.

### T-10 I submitted birth details but cannot see them
This is intentional. Birth details are visible only to your counsellor and the admin. To correct them, submit again; the latest submission replaces the earlier one.

### T-11 I cannot mark a roadmap item as Missed or change its title
You can change only the status (to do, in progress, done) and add evidence. Missed is set automatically overnight. Ask your counsellor to change dates or titles.

### T-12 The enquiry form says "too many enquiries" or "busy"
The same phone or email can submit 3 times an hour, and the form accepts 30 enquiries a minute in total. Wait and try later, or contact the agency directly.

### T-13 "Invalid enquiry"
Name must be 1–120 characters, notes up to 2000 characters, and you must give a phone number or an email.

## For counsellors

### T-20 A candidate is missing from my caseload
You see only candidates where you are the assigned counsellor. Ask an admin to check the assignment.

### T-29 "This case is archived; ask your counsellor to restore it"
The candidate was archived for inactivity, so new assessments are blocked and the case is hidden from your caseload. Ask an admin to restore it from **Archive** (`/admin/archive`); it reappears straight away.

### T-21a Matches or a requested report take a while to appear
The worker runs every 15 minutes, so new matches and PDFs can take up to about 20 minutes. Scoring itself is instant.

### T-21 Results did not appear after a candidate completed a test
1. Check **Assessments**: status should be completed.
2. If completed but not scored for more than 15 minutes, report it to the technical owner with the candidate name and instrument. (Technical: check `score_instrument` logs and the Vault secrets `project_url` and `edge_trigger_secret`; a missing secret logs a warning and skips the call. If `net._http_response` shows 403 `forbidden`, check that Vault `edge_trigger_secret` exists (migration 004) and that the deployed `score_instrument` is the version that checks it. The worker still scores these within 15 minutes.)

### T-21b A candidate's earlier results are not in the Assessments list, or a professional sees different tests
The assessments were replaced by battery v0.2 on 2026-10-25, and professionals now take their own adult version. Sessions on the earlier version stay, and their results still show on the **Profile** tab, but the **Assessments** list shows only the current tests. A candidate who started before the change sees the new tests as "Not started". Ask them to take the new ones; the profile and matches use the latest result of each kind.

### T-21c An aptitude area shows no score
Only the areas in the candidate's version are scored: mechanical and speed and accuracy are in the Class 8–12 versions, logical reasoning in Class 11–12 and professional. Stream suggestions skip an area the candidate did not take.

### T-22 "Only counsellor_notes can be edited"
Swadharma points come from the engine; you can only edit the notes field.

### T-23 "A release must reference this candidate's swadharma report"
Generate a **swadharma** kind report for this candidate first, then release that report.

### T-24 "Candidate has not consented to the Swadharma analysis"
The candidate (or guardian) has not opted in with birth details and consent. You cannot release without it.

### T-25 "Reports are immutable; generate a new version instead"
Reports cannot be edited. Generate again to create a new version.

### T-26 Family cannot see a case file
Case files are counsellor-only by design. Generate a candidate, candidate_junior, parent or stream_choice report for families.

### T-27a Streams from another board, or every board, are suggested
Streams follow the **Board** on the case. A blank board, or one the library does not recognise (for example a misspelling), ranks every board's streams. Correct the board (ICSE/ISC, CBSE, a state board name, NIOS, IB, Cambridge) and the list narrows at the next matching run.

### T-27 Swadharma tab is empty
The candidate did not opt in, or the engine has not run yet (the worker checks every minute once consent and birth place coordinates exist). If birth time is unknown, expect only Moon-sign and strength components and confidence "low".

### T-28 A report has no Download button
The worker has not rendered it yet; it polls every minute. If it is still missing after 10 minutes, report it to the technical owner (check the worker logs for `job_render_reports`).

## For admins

### T-30 "Only an admin can change a role"
Role changes require an admin account. Self-signed-up users are always candidate or parent until an admin changes them.

### T-30a "Invalid login credentials" for a new staff member
The account does not exist yet or the password is wrong. The site has no sign-up screen: create the account in Supabase (**Authentication → Users → Add user → Create new user**, tick **Auto Confirm User**), then set its role. The very first admin is promoted from the SQL editor ([SOP-T1](../sops/technical-sops.md#first-go-live-checklist) step 4).

### T-31 Dashboard numbers look wrong
Funnel counts depend on lead stages being kept current; turnaround counts from the last completed assessment to the first candidate-facing report. Check stages and report kinds before raising a bug.

### T-32 Instrument not showing for candidates
Only active instruments matching the track variant are shown (early explorer → junior; others → standard). Check **is active** and the variant.

### T-33 "A library refresh is already in progress; finish or cancel it first"
Only one refresh can be open. Open it from the banner on the Library page and apply or cancel it. If it has said "Checking sources…" for over an hour, the worker probably restarted: click **Cancel refresh** and start again ([SOP-T4](../sops/technical-sops.md#sop-t4-worker-operations)).

### T-34 Refresh failed: "ANTHROPIC_API_KEY is not set on the worker"
AI refresh is not set up. The technical owner adds the key as a GitHub repo secret ([SOP-T1](../sops/technical-sops.md#first-go-live-checklist)). Meanwhile use **Download CSV → Upload edited CSV**.

### T-35 Refresh stays on "Queued" or "Checking sources…"
The worker picks up a run at its next 15-minute run and a full AI refresh takes 15 to 30 minutes. If it stays queued for over half an hour, the worker is not running (check **Actions → Worker** on GitHub; scheduled runs stop after 60 days without commits until re-enabled). If a run is stuck, cancel it and start again.

### T-36 CSV upload: "Could not tell whether this is the careers or the streams file" or "The first row must be the column headings"
Start from **Careers CSV** or **Streams CSV** and keep the heading row as downloaded. Save as CSV (UTF-8), not .xlsx. Files over 2 MB are refused; upload careers and streams separately.

### T-37 Some CSV rows were skipped
They are listed under "Notes from the check" on the review page with the reason: unknown family name (use one of the 15 families exactly), outlook not one of growing / stable / transforming / declining, interest weights not six numbers between 0 and 1, an id that is not in the library (clear it to add a new entry), a new career missing name, family, RIASEC code or outlook, invalid JSON in salary band, aptitude or pathways. Fix those rows and upload again.

### T-38 "No changes suggested" after a refresh
Everything checked matched the library. Click **Mark reviewed** to stamp the entries as reviewed today.

### T-39 "The candidate cutoff must be at least 30 days ago" / someone is missing from the archive preview
Cutoffs must be at least 30 days in the past. Candidates with a session booked, and leads that are paid or active, are never archived; any activity after the cutoff (a session, assessment, roadmap update, report or outcome) also keeps a case active.

## For developers

### T-40 SQL tests fail to start
`run.sh` needs a local Postgres 15+ and the `authenticator` role created by `supabase_stub.sql`. Run with `PGHOST=localhost PGUSER=postgres`.

### T-41 `pg_net` / `pg_cron` not available notice
Expected on plain Postgres; the migration skips them. On Supabase, enable both extensions.

### T-43a A demo login says "Invalid login credentials" or the account is banned
Demo accounts exist only after the demo SQL has been run ([SOP-T9](../sops/technical-sops.md#sop-t9-demo-cases)), all with the password chosen then. After removal, any demo account that could not be deleted is disabled on purpose.

### T-43b A demo case shows scores but no matches or streams
Scores come from the Edge Function at once; profiles and matches wait for the next Worker run (every 15 minutes). Run **Actions → Worker → polling** to do it now.

### T-43 The app shows demo people (Ananya, Meera) instead of real data
The web build has no `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, or `VITE_DEMO_MODE=true`. Set the variables in Vercel and redeploy.

### T-44 Worker tests or PDF rendering fail with a Pango / `OSError` message
WeasyPrint needs Pango. Install `libpango-1.0-0 libpangoft2-1.0-0` (the Dockerfile already does).

### T-45 New SQL test file not running
`run.sh` applies every migration in `supabase/migrations/` in name order, but test files are listed explicitly at the end of `run.sh`. Add new test files there.

### T-42 CI "docs check" failed
Your PR changes code without changing `/docs`, or changes a mapped area without its mapped doc. Update the docs listed in the failure message. See [SOP-T8](../sops/technical-sops.md#sop-t8-documentation-maintenance).

## Error code reference

| Code | Meaning | Typical cause |
|---|---|---|
| 42501 | Not permitted | Role or ownership rule, missing consent, immutable record |
| 22023 | Invalid input or state | Bad form data, test not in progress, back navigation in timed section, archive cutoff too recent, empty CSV |
| 55000 | Wrong state for this action | A library refresh already open, or the refresh is no longer awaiting review |
| P0002 | Not found | Restoring something that is not archived |
| P0429 | Rate limited | Too many enquiries |
