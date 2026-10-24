# SwadharmaPath — Low-Level Design (LLD)

| Field | Value |
|---|---|
| Document | LLD |
| Version | 1.0 |
| Last updated | 2026-10-24 |
| Code baseline | `supabase/migrations/001_init.sql` on `feat/start-here` @ `6177c0a`. Sections marked *planned* describe the spec until that code is merged. |
| Related | [BRD](../brd/BRD.md) · [HLD](HLD.md) |

> This document must change in the same pull request as any change to tables, columns, constraints, policies, functions, triggers, views, RPCs, engine formulas, report templates, jobs or environment variables.

---

## 1. Repository layout

| Path | Contents | Status |
|---|---|---|
| `src/` | React app (Vite). `src/lib/supabase.ts` client | scaffold |
| `supabase/migrations/001_init.sql` | Schema, constraints, helpers, RLS, triggers, views, RPCs, storage, generated seed | implemented |
| `supabase/seed/` | `build_seed.py`, `instruments.py`, `library.py` — regenerate the seed block of the migration | implemented |
| `supabase/tests/` | `run.sh`, stub, fixtures, `rls_test.sql`, `owner_test.sql` | implemented |
| `supabase/functions/score_instrument/` | Edge Function | planned |
| `supabase/functions/generate_signed_report_url/` | Edge Function | planned |
| `worker/` | `scoring.py`, `match.py`, `streams.py`, `swadharma.py`, `reports.py`, `scheduler.py`, `karakatwa.json` | planned |
| `docs/` | This documentation set | implemented |

## 2. Configuration

| Variable / secret | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Web (Vercel) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Web (Vercel) | Public anon key (RLS applies) |
| Vault `project_url` | Supabase Vault | Base URL used by `private.invoke_edge_function` |
| Vault `service_role_key` | Supabase Vault | Bearer for Edge Function calls from triggers |
| Service-role key | Worker, Edge Functions | Full access; never in the browser |

If the Vault secrets are missing, `invoke_edge_function` logs a warning and returns without failing the user's action (scoring will then not start; see [troubleshooting](../troubleshooting/troubleshooting.md#t-6-assessment-completed-but-no-results)).

## 3. Data model

All tables are in `public`, have `id uuid default gen_random_uuid()` unless keyed by `candidate_id`, and have RLS enabled. 🔒 = counsellor/admin only.

| Table | Key columns and constraints |
|---|---|
| `users` | `id` = `auth.users.id`; `role` ∈ candidate, parent, counsellor, admin; `full_name` not null; `phone`, `email`, `photo_url`, `language_pref` default `en` |
| `leads` | `source` ∈ web, whatsapp, referral, school, walk_in; `track` ∈ early_explorer, student, professional; `stage` default `new` ∈ new, contacted, discovery, paid, active, completed, lost; `assigned_counsellor` → users; `next_followup` date; `converted_candidate` → candidates |
| `candidates` | `user_id`, `lead_id`, `parent_user_id`, `counsellor_id`; `track`; `board`, `dob`, `gender`, `city`, `school_or_employer`, `class_or_years_exp`, `stream_or_function`; `academics`, `constraints` jsonb; `status` default `onboarding`; `swadharma_opted_in` bool; `disclaimer_accepted_at`, `guardian_consent_at` |
| `birth_details` 🔒 | PK `candidate_id`; `birth_date`, `birth_time`, `time_certainty` ∈ exact, approx_15m, approx_1h, unknown; `birth_place`, `lat`, `lng`, `tz`; `consent_given_by`, `consent_at`, `consent_text_version` |
| `instruments` | `code` ∈ interest, aptitude, workstyle, bigfive, values, learning, school_values, subject_enjoyment; `version`; `track_variant` ∈ junior, standard; `items`, `scoring_spec`, `norms` jsonb (hidden from API roles); `time_limit_min`; `is_active` |
| `assessment_sessions` | `candidate_id`, `instrument_id`; `started_at`, `completed_at`; `responses` jsonb (`{item_id: {a, rt}, _meta: {section_started: {code: ts}}}`); `status` ∈ in_progress, completed, invalidated; `device`, `duration_sec` |
| `assessment_results` | `raw`, `percentiles`, `derived`, `validity_flags` jsonb; `scored_at`, `scoring_version` |
| `profile_summary` | PK `candidate_id`; `interest_vector`, `aptitude_vector`, `workstyle_vector`, `values_vector` numeric[]; `narrative` jsonb; `approved_by`, `approved_at`, `updated_at` (trigger) |
| `subject_enjoyment` | PK (`candidate_id`, `subject`); `enjoyment` 1–5; `marks_pct`; `teacher_feedback` |
| `careers` | `name`, `family`, `riasec_code`, `interest_weights` numeric[6], `aptitude_min`, `workstyle_fit`, `values_fit` jsonb; `description`, `day_in_life`; `typical_entry_paths`, `india_salary_band`, `sources` jsonb; `outlook` ∈ growing, stable, transforming, declining; `automation_exposure` ∈ low, medium, high; `adjacent_emerging` text[]; `last_reviewed` |
| `education_pathways` | `career_id`; `level` ∈ class11_12, ug, pg, diploma, certification, global; `stream_required`, `exams` jsonb, `degrees` text[], `institutions` jsonb, `duration`, `alternative_routes`, `notes` |
| `stream_options` | `name`, `board`, `subjects` text[], `keeps_open_families`, `closes_families` text[], `notes` |
| `career_matches` | `candidate_id`, `career_id`, `fit_score`, `breakdown` jsonb, `rank`; `counsellor_action` ∈ pinned, hidden, added; `visible_to_candidate` default false; `match_version` |
| `stream_matches` | as above with `stream_option_id` |
| `swadharma_charts` 🔒 | PK `candidate_id`; `ayanamsa`, `d1`, `d9`, `d10`, `kp_cusps`, `ashtakavarga`, `dashas` jsonb; `computed_at`, `engine_version` |
| `swadharma_scores` 🔒 | `career_family`, `points`, `max_points` default 100, `components`, `favourable_windows` jsonb; `confidence` ∈ high, medium, low; `counsellor_notes` |
| `swadharma_releases` (append-only) | `candidate_id`, `released_by`, `released_to` ∈ candidate, parent, both; `reason` not null; `report_id`; `released_at` |
| `sessions` | `candidate_id`, `counsellor_id`, `scheduled_at`, `duration_min` default 60, `mode` ∈ video, in_person, phone; `meeting_url`; `iccc_stage` ∈ know_self, know_world, decide, plan, act, review; `notes_private`, `summary_for_candidate`, `action_items` jsonb; `attended` |
| `roadmaps` | `template` ∈ class8_10_exposure, class11_12, ug, pg_prep, transition, custom; `goal_career_id`, `goal_stream_id`; `start_date`, `end_date`; `status` default draft ∈ draft, published, completed, paused; `published_at` |
| `roadmap_items` | `kind` ∈ milestone, task, exam, skill, checkin; `owner` ∈ candidate, counsellor, parent; `status` default todo ∈ todo, in_progress, done, missed; `due_date`, `evidence_url`, `completed_at` |
| `reports` | `kind` ∈ candidate, candidate_junior, parent, stream_choice, case_file, swadharma; `version` (trigger); `generated_by`; `pdf_path`; `content` jsonb; `visible_to` ∈ counsellor, candidate, parent, all |
| `outcomes` | `checkpoint` ∈ 6m, 12m, 24m; `status`, `career_id`, `matched_top5`, `satisfaction` 1–5, `notes` |
| `audit_log` (append-only) | `actor`, `action`, `entity`, `entity_id`, `detail` jsonb, `at` |
| `notifications` (additive) | `user_id`, `candidate_id`, `kind`, `title`, `body`, `entity`, `entity_id`, `read_at`, `sent_at`; unique (`user_id`, `kind`, `entity_id`) so a nudge is created once |

Indexes: leads(stage), leads(assigned_counsellor), candidates(counsellor_id / user_id / parent_user_id), per-candidate indexes on child tables, sessions(counsellor_id, scheduled_at), reports(candidate_id, kind), swadharma_releases(report_id), notifications(user_id).

## 4. Authorisation

### 4.1 Helper functions (`private` schema, `SECURITY DEFINER`, `search_path = ''`)

| Function | Returns true when |
|---|---|
| `my_role()` | returns caller's `users.role` |
| `is_admin()` / `is_staff()` | caller is admin / counsellor or admin |
| `is_service()` | JWT role is `service_role`, or session user is `postgres` / `supabase_admin` |
| `is_assigned_counsellor(c)` | `candidates.counsellor_id = auth.uid()` |
| `can_manage(c)` | admin or assigned counsellor |
| `is_own_candidate(c)` / `is_parent_of(c)` / `is_family(c)` | caller is the candidate / linked parent / either |
| `can_read_candidate(c)` | family or can_manage |
| `is_released(report)` | a `swadharma_releases` row exists for the report |
| `profile_approved(c)` | `profile_summary.approved_at` is set |
| `needs_guardian_consent(c)` | (dob null **or** dob within 18 years) **and** `guardian_consent_at` null; missing candidate → true |
| `write_audit(action, entity, id, detail)` | inserts an audit row as the caller |

### 4.2 Access matrix (RLS policies)

C = candidate (own), P = parent (linked), Co = assigned counsellor, A = admin, S = service role (bypasses RLS).

| Table / view | C | P | Co | A |
|---|---|---|---|---|
| users | own row + their counsellor/parent | own + linked people | read all names | all |
| leads | insert only (anon too) | insert only | read all; update assigned | all |
| candidates | read own | read linked | read/update assigned; insert with self as counsellor | all |
| birth_details 🔒 | **none** (write via RPC) | **none** (write via RPC) | read | read |
| swadharma_charts / scores 🔒 | **none** | **none** | read; update `counsellor_notes` only | same |
| instruments | metadata of active only | same | metadata | all incl. items |
| assessment_sessions | read; insert own (gated) | read | all | all |
| assessment_results | read after profile approval | same | all | all |
| profile_summary | read when approved | same | all | all |
| subject_enjoyment | read; insert own | read | all | all |
| careers / education_pathways / stream_options | read | read | read | all |
| career_matches / stream_matches | **via `v_candidate_*` only** | same | all | all |
| sessions | **via `v_candidate_sessions` only** | same | all | all |
| roadmaps | read when published/completed/paused | same | all | all |
| roadmap_items | read when roadmap published; update own status/evidence | read | all | all |
| reports | read if `visible_to` ∈ candidate/all and (not swadharma or released) | read if `visible_to` ∈ parent/all and same rule | read; insert (generated_by = self) | same |
| swadharma_releases | none | none | read; insert (released_by = self) | same |
| outcomes | read | read | all | all |
| audit_log | insert own | insert own | insert own | insert own; read |
| notifications | own | own | own | own |

### 4.3 Column and privilege grants

- `instruments`: API roles may select only `id, code, name, version, track_variant, time_limit_min, is_active`.
- `swadharma_releases`, `audit_log`: UPDATE, DELETE, TRUNCATE revoked from anon, authenticated and service_role.
- `reports`: DELETE, TRUNCATE revoked from anon and authenticated.
- `anon`: all table privileges revoked except INSERT on `leads`.

## 5. Triggers

| Trigger | Table / event | Behaviour | Error code |
|---|---|---|---|
| `on_auth_user_created` | auth.users AFTER INSERT | Creates `public.users`; role from metadata limited to candidate/parent; `full_name` from metadata or email/phone prefix | — |
| `guard_users` | users BEFORE UPDATE | Only admin/service can change `role` | 42501 |
| `leads_rate_limit` | leads BEFORE INSERT | Non-staff: name 1–120 chars, notes ≤ 2000, phone or email required; max 3 per contact per hour; max 30 overall per minute; forces `stage = new`, default `source = web` | 22023, P0429 |
| `assessment_gate` | assessment_sessions BEFORE INSERT | Rejects if `needs_guardian_consent`; defaults `started_at`, `responses` | 42501 |
| `assessment_completed` | assessment_sessions AFTER UPDATE OF status → completed | `pg_net` POST to Edge Function `score_instrument` with `{session_id, candidate_id, instrument_id}`; never blocks | — |
| `profile_touch` | profile_summary BEFORE INSERT/UPDATE | Sets `updated_at` | — |
| `guard_swadharma_scores` | swadharma_scores BEFORE UPDATE | Non-service may change only `counsellor_notes` | 42501 |
| `guard_roadmap_item` | roadmap_items BEFORE UPDATE | Non-managers may change only `status`, `evidence_url`, `completed_at`; cannot set `missed`; `completed_at` set when done, cleared otherwise | 42501 |
| `roadmap_published` | roadmaps BEFORE UPDATE | Sets `published_at` on first publish | — |
| `reports_before_insert` | reports BEFORE INSERT | `version` = max+1 per (candidate, kind); default `visible_to = counsellor`; `case_file` and `swadharma` forced to `counsellor` | — |
| `reports_guard_update` | reports BEFORE UPDATE | Allows only (1) service filling `pdf_path` once (and `content`), (2) release trigger widening `visible_to`; else rejects | 42501 |
| `reports_no_delete` | reports BEFORE DELETE | Deny | 42501 |
| `releases_append_only`, `audit_append_only` (+ `*_no_truncate`) | BEFORE UPDATE/DELETE/TRUNCATE | Deny | 42501 |
| `swadharma_release_before` | swadharma_releases BEFORE INSERT | Report must be this candidate's `swadharma` kind; candidate must be opted in with `birth_details.consent_at`; sets `released_at`, defaults `released_by` | 22023, 42501 |
| `swadharma_release_after` | swadharma_releases AFTER INSERT | Widens `reports.visible_to` (both → all; candidate + parent over time → all); writes `audit_log` `swadharma_release` with before/after | — |

### 5.1 Scheduled SQL

`private.mark_missed_roadmap_items()` via `pg_cron` job `swadharmapath-missed-items` at `30 20 * * *` UTC (02:00 IST): published roadmaps' items with `due_date < today` and status todo/in_progress → `missed`; inserts one `roadmap_missed` notification per owner (candidate or parent) and the counsellor. Returns the count.

## 6. Views

| View | Rights | Definition |
|---|---|---|
| `v_candidate_matches` | owner (filters by caller) | `career_matches` + career name/family/outlook/RIASEC; `breakdown - 'swadharma'`; only `visible_to_candidate` and not hidden; caller is family or can_manage |
| `v_candidate_stream_matches` | owner | same for streams with board, subjects, keeps_open/closes |
| `v_candidate_sessions` | owner | `sessions` without `notes_private` |
| `v_funnel` | invoker | leads by stage and track, total and last 30 days |
| `v_counsellor_utilisation` | invoker | per counsellor: active candidates, sessions and attended minutes in last 30 days |
| `v_tat` | invoker | last completed assessment → first candidate/candidate_junior/stream_choice report, `tat_days`, `pending` |
| `v_outcomes` | invoker | per checkpoint: count, % matched top 5, average satisfaction |
| `v_caseload` | invoker | per candidate: ICCC stage (latest past session, default know_self), next session, assessments done, validity issues, missed items, consent pending, profile approval, `report_due_at` = assessed_at + 7 days |

## 7. RPC contracts (candidate-facing, `SECURITY DEFINER`, granted to `authenticated`)

| RPC | Input | Output | Rules |
|---|---|---|---|
| `my_instruments()` | — | rows: instrument_id, code, name, track_variant, time_limit_min, item_count, est_minutes, session_id, status, answered | Active instruments for caller's track variant (early_explorer → junior); latest non-invalidated session; est = time limit or 12 s per item |
| `next_item(session_id, position?)` | uuid, int | `{done, position, total, section{code,name,time_limit_sec,started_at,server_now,index,count}, item{id,type,prompt,options[{value,label}]}, answer}` | Caller must own the session and it must be in progress. Null position = first unanswered. Timed section: clock starts on first served item; after limit + 5 s, skips to next section; going back before the furthest answered item raises 22023 |
| `save_responses(session_id, responses)` | uuid, `{item_id: {a, rt}}` | int (saved count) | Drops unknown items and answers in timed sections whose clock is not started or ended more than 30 s ago |
| `complete_assessment(session_id, device?)` | uuid, text | void | Sets completed, `completed_at`, `duration_sec`; fires scoring trigger |
| `accept_disclaimer()` | — | timestamptz | Sets `disclaimer_accepted_at` on caller's candidate row; audit `disclaimer_accepted` |
| `give_guardian_consent(candidate_id)` | uuid | timestamptz | Caller must be the linked parent; audit `guardian_consent` |
| `submit_birth_details(candidate_id, birth_date, birth_time, time_certainty, birth_place, lat, lng, tz, consent_text_version)` | … | void | Caller must be family; consent version required; upsert; sets `swadharma_opted_in`; audit `swadharma_consent`; never returns the row |

Error codes surfaced to the UI: `42501` not permitted, `22023` invalid input/state, `P0429` rate limited.

## 8. Storage

| Bucket | Public | Path | Access |
|---|---|---|---|
| `reports` | no | `reports/<candidate_id>/<kind>-v<version>.pdf` (*convention, confirm with worker*) | No client policy; read only via 15-minute signed URL from `generate_signed_report_url` |
| `documents` | no | `<candidate_id>/<file>` | Read: family, assigned counsellor, admin. Insert: the candidate or a manager. Used for roadmap evidence and case documents |

## 9. Engine rules (worker; *planned* — source of truth until code lands)

### 9.1 Scoring (`worker/scoring.py`, mirrored in `score_instrument`)

| Instrument | Rule |
|---|---|
| Interest | Sum per RIASEC scale → percentile by age band → 3-letter code (top 3) + normalised 6-vector |
| Aptitude | Raw per sub-test → percentile by age band (13–15, 16–18, 19–22, 23+) → Low < 25, Average 25–74, High 75–89, Very High ≥ 90 |
| Work-style (R-A-P-D) | Forced choice most/least; 3 graphs standard (others, stress, self), 2 junior; each factor −19…+19; primary = highest above midline, secondary = next |
| Big Five | Standard only; BFI-2-S → 5 percentiles |
| Values | Pairwise choice → top 5 + vector; junior uses 12-item school-values |

Work-style pattern flags: span (max−min ≥ 20 wide, ≤ 8 crunched); reversal (primary differs graph 1 vs 3); undershift (all ≤ 2); overshift (≥ 3 above midline); mercurial (A ≥ 8 above others); flick_up (P, D < 0 and D > P); flick_down (P, D < 0 and D < P). Stress: P moves ≥ 3 graph3→graph2 = personal; graph3→graph1 = performance; A moving with it = relationship. Strengths/limitations table per primary style across leadership, goal-setting, creativity, delegation, communication, decision-making from original template text.

Validity flags: median response time < 1.5 s; straight-lining ≥ 10 consecutive; social desirability > 80th percentile; self-vs-others divergence ≥ 12 on any factor.

### 9.2 Career matching (`worker/match.py`) — student, professional

```
fit = 35·cosine(interest_vector, career.interest_weights)
    + 25·aptitude_fit + 15·workstyle_fit + 10·values_fit
    + 10·outlook_score + 5·constraints_feasible
outlook_score: growing 1.0, transforming 0.7, stable 0.6, declining 0.2   (i.e. 10/7/6/2 points)
aptitude_fit  = share of career.aptitude_min bands met, +0.1 per band exceeded, max 1.0
workstyle_fit = 1 − normalised distance of candidate primary/secondary to career.workstyle_fit
values_fit    = overlap of candidate top-5 values with career.values_fit
```

Top 15 → `career_matches` with `breakdown {interest, aptitude, workstyle, values, outlook, constraints, swadharma}` and templated explanation per dimension; `visible_to_candidate = false`.

### 9.3 Stream recommendation (`worker/streams.py`) — early_explorer

```
stream_fit = 35·interest alignment (RIASEC vector vs families the stream keeps open)
           + 30·aptitude fit   (PCM numerical+abstract; PCB verbal+abstract;
                                Commerce numerical+verbal; Humanities verbal+abstract;
                                Design/vocational spatial+abstract)
           + 20·academics and subject enjoyment (maths, science, languages, social science, art)
           + 10·breadth (keeps_open count / max)
           + 5·board availability
```

Always include the widest "keep options open" combination; output keeps_open/closes and 3 sample careers per open family; never a single career.

### 9.4 Swadharma (`worker/swadharma.py`)

Runs only if `swadharma_opted_in` and `birth_details.consent_at`. Swiss Ephemeris, Lahiri; Placidus cusps for KP; whole-sign for Parashari. `time_certainty = unknown` → Moon-sign and dignity components only, confidence low.

Points per family (max 100): D10 (25) · KP 10th cusp sub-lord (20) · Ashtakavarga (20; SAV ≥ 28 full, 25–27 × 0.6, < 25 × 0.3) · planetary strength (15) · yogas (10) · dasha timing over next 10 years (10, plus `favourable_windows`). Planet → family map in `worker/karakatwa.json`.

15 families: Engineering & Technology · Medicine & Health · Pure Sciences & Research · Mathematics, Finance & Analytics · Law & Governance · Public Service & Defence · Business, Management & Entrepreneurship · Sales, Marketing & Media · Arts, Design & Performance · Writing, Communication & Languages · Education & Counselling · Social Work & Spirituality · Agriculture, Environment & Earth · Hospitality, Travel & Service · Skilled Trades & Crafts.

early_explorer: roll up per stream over `keeps_open_families`; lens phrased for parents of a 13–15-year-old; windows limited to board-exam years and Class 11 entry.

Outputs personality lens (never health, marriage, longevity, wealth; never prohibitions) and agreement matrix (Agree / Partial / Conflict) vs psychometric top 5. Writes only `swadharma_charts`, `swadharma_scores` and `career_matches.breakdown.swadharma`.

### 9.5 Reports (`worker/reports.py`)

| Kind | Audience | Notes |
|---|---|---|
| candidate | Candidate (student/professional) | Full interpreted profile and options |
| candidate_junior | Early explorer | Visual, ~8 pages, written to the student, "leanings" not "types" |
| parent | Parent | 2 pages |
| stream_choice | Early explorer family | Stream cards, keeps-open/closes |
| case_file | Counsellor only | Everything incl. Swadharma; `visible_to` forced to counsellor |
| swadharma | Counsellor until released | Full disclaimer on page 1 |

Flow: counsellor inserts `reports` row → worker renders with WeasyPrint → uploads to `reports/` → sets `pdf_path` once. Every PDF carries the disclaimer.

### 9.6 Jobs (`worker/scheduler.py`)

Nightly: missed-item nudges (complements the SQL job), report SLA check, outcome reminders at 6/12/24 months. Quarterly: outlook refresh reminder to admin.

## 10. Frontend design (*planned*)

| Concern | Design |
|---|---|
| Routing | React Router; role guard reads `users.role` and redirects to role home |
| Data | supabase-js with RLS; candidates use `v_candidate_*` views and RPCs |
| Test runner | Calls `my_instruments` → insert session → `next_item` loop; local buffer flushed to `save_responses` every 30 s and on navigation; timer from `section.started_at` and `server_now` (server clock wins); no back button inside timed sections |
| Track switch | `early_explorer` → larger type scale, illustrations, friendlier copy, stepper Onboard → Discover → Talk → Streams → Explore Plan |
| Theme | Deep teal + warm sand, large readable type |
| Errors | Map 42501 → "You don't have access to this", 22023 → specific validation copy, P0429 → "Please try again in a while" |

## 11. Testing

```bash
PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh
```

Creates `swadharmapath_test`, loads a Supabase stub (auth/storage/vault shims), applies the migration, loads fixtures, runs `rls_test.sql` as the `authenticator` role and `owner_test.sql` as owner. Any change to policies, triggers or RPCs needs a matching test.

Regenerating seed data:

```bash
python3 supabase/seed/build_seed.py   # rewrites everything after "-- BEGIN GENERATED SEED"
```

## 12. Change history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-24 | Baseline from `001_init.sql` and the engine-rule spec |
