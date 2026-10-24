# SwadharmaPath — Low-Level Design (LLD)

| Field | Value |
|---|---|
| Document | LLD |
| Version | 1.1 |
| Last updated | 2026-10-24 |
| Code baseline | `feat/start-here`: migration, Edge Functions, web app and worker (Start Here scope). |
| Related | [BRD](../brd/BRD.md) · [HLD](HLD.md) |

> This document must change in the same pull request as any change to tables, columns, constraints, policies, functions, triggers, views, RPCs, engine formulas, report templates, jobs or environment variables.

---

## 1. Repository layout

| Path | Contents | Status |
|---|---|---|
| `src/` | React app (Vite + TS, Tailwind v4, shadcn-style components in `src/components/ui`, Recharts). `src/lib/supabase.ts` client; `src/lib/api/` data layer | implemented (Start Here routes) |
| `supabase/migrations/001_init.sql` | Schema, constraints, helpers, RLS, triggers, views, RPCs, storage, generated seed | implemented |
| `supabase/seed/` | `build_seed.py`, `instruments.py`, `library.py` — regenerate the seed block of the migration | implemented |
| `supabase/tests/` | `run.sh`, stub, fixtures, `rls_test.sql`, `owner_test.sql` | implemented |
| `supabase/functions/_shared/` | `scoring.ts` (TS scorer), `scoring_fixtures.json` (shared with the worker), `workstyle_templates.json`, `cors.ts` | implemented |
| `supabase/functions/score_instrument/` | Edge Function | implemented |
| `supabase/functions/generate_signed_report_url/` | Edge Function | implemented |
| `worker/` | `scoring.py`, `match.py`, `streams.py`, `swadharma.py`, `reports.py` + `templates/`, `scheduler.py`, `db.py`, `families.py`, `karakatwa.json`, `data/workstyle_templates.json`, `Dockerfile`, `railway.json`, `tests/` | implemented |
| `docs/` | This documentation set | implemented |

## 2. Configuration

| Variable / secret | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Web (Vercel) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Web (Vercel) | Public anon key (RLS applies) |
| `VITE_DEMO_MODE` | Web | `true` runs the UI on in-memory demo data (also automatic when the two variables above are missing). Never set in production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Worker (Railway) | Service-role client in `worker/db.py` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Provided by the Supabase runtime |
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
| `swadharma_charts` 🔒 | PK `candidate_id`; `ayanamsa`, `d1`, `d9`, `d10`, `kp_cusps`, `ashtakavarga`, `dashas` jsonb; `computed_at`, `engine_version`; `insights` jsonb (additive: personality lens, agreement matrix, component detail) |
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
| `next_item(session_id, position?)` | uuid, int | `{done, position, total, section{code,name,time_limit_sec,started_at,server_now,index,count}, item{id,type,prompt,options[{value,label}]}, answer}` | Caller must own the session and it must be in progress. Null position = first unanswered. Timed section: clock starts on first served item (stored server-side in `responses._meta.section_started`); once `now() >= started + limit` it skips to the next section (no grace); going back before the furthest answered item raises 22023 |
| `save_responses(session_id, responses)` | uuid, `{item_id: {a, rt}}` | int (saved count) | Drops unknown items and answers in timed sections whose clock is not started or ended more than 30 s ago |
| `complete_assessment(session_id, device?)` | uuid, text | void | Sets completed, `completed_at`, `duration_sec`; fires scoring trigger |
| `accept_disclaimer()` | — | timestamptz | Sets `disclaimer_accepted_at` on caller's candidate row; audit `disclaimer_accepted` |
| `give_guardian_consent(candidate_id)` | uuid | timestamptz | Caller must be the linked parent; audit `guardian_consent` |
| `submit_birth_details(candidate_id, birth_date, birth_time, time_certainty, birth_place, lat, lng, tz, consent_text_version)` | … | void | Caller must be family; consent version required; upsert; sets `swadharma_opted_in`; audit `swadharma_consent`; never returns the row |

Error codes surfaced to the UI: `42501` not permitted, `22023` invalid input/state, `P0429` rate limited.

## 8. Storage

| Bucket | Public | Path | Access |
|---|---|---|---|
| `reports` | no | `<candidate_id>/<kind>-v<version>-<report id first 8>.pdf` | No client policy; read only via 15-minute signed URL from `generate_signed_report_url` |
| `documents` | no | `<candidate_id>/<file>` | Read: family, assigned counsellor, admin. Insert: the candidate or a manager. Used for roadmap evidence and case documents |

## 9. Engine rules (worker)

Shared constants live in `worker/families.py` (15 families, a RIASEC profile per family, aptitude band ranks).

### 9.1 Scoring (`worker/scoring.py`, mirrored in `supabase/functions/_shared/scoring.ts`)

Both scorers are checked against the same 27 cases in `supabase/functions/_shared/scoring_fixtures.json` (`npx vitest run supabase/functions`, `pytest worker/tests/test_scoring.py`). Rounding is JavaScript-compatible in both. `SCORING_VERSION = scoring-0.1`.

Responses are `{item_id: {a, rt}}`; `_meta` is ignored. Age bands 13–15, 16–18, 19–22, 23+ (unknown DOB → 16–18). Percentile = normal CDF from the instrument's `norms[band][scale] = {mean, sd}`, clamped 1–99.

| Method (`scoring_spec.method`) | Instruments | Rule |
|---|---|---|
| `riasec` | interest | Sum per scale → percentile → order by percentile, raw, R-I-A-S-E-C → `code` (top 3), `vector` = (raw − n)/(4n) per scale |
| `aptitude` | aptitude | Correct answers per section → percentile → band Low < 25 ≤ Average < 75 ≤ High < 90 ≤ Very High |
| `workstyle` | workstyle | Forced choice most/least over factors R (Results), A (Affiliative), P (Paced), D (Detail). With N valid items: others = (most − N/4)/(3N/4)·19, stress = (N/4 − least)/(3N/4)·19, self = (most − least)/N·19, each clamped ±19. Junior keeps others and self only. Primary/secondary = highest positive self values. Style table from `workstyle_templates.json` |
| `bigfive` | bigfive | Mean per domain (reverse-keyed 6 − a) → percentiles; `SD` scale gives social desirability |
| `values` | values, school_values | Pair wins per value → ranking, `top5` (`scoring_spec.top`), vector = wins/appearances |
| `likert_scales` | learning, subject_enjoyment | Mean per scale (sum when `per_item`) → order and top |

Work-style patterns: span wide ≥ 20 / crunched ≤ 8; reversal (primary of others ≠ primary of self); undershift (all self ≤ 2); overshift (≥ 3 positive); mercurial (A − max(R, P, D) ≥ 8); flick_up / flick_down (P, D < 0 and D > P / D < P). Standard only, stress: P moves ≥ 3 self→stress = personal, self→others = performance; A moving ≥ 3 the same way = relationship.

Validity flags: `fast_responses` (median rt < 1.5 s), `straight_lining` (≥ 10 identical consecutive Likert answers), `incomplete` (< 80 % answered), `social_desirability` (Big Five SD > 80th percentile), `divergence` (|others − self| ≥ 12 on any work-style factor).

`score_pending` scores completed sessions that have no result since `completed_at` (fallback when the Edge Function call fails). `build_profile` upserts the four `profile_summary` vectors and `updated_at`; it never touches the narrative or approval.

### 9.2 Career matching (`worker/match.py`, `match-0.1`) — student, professional

```
fit = 35·cosine(interest_vector, career.interest_weights)
    + 25·aptitude_fit + 15·workstyle_fit + 10·values_fit
    + outlook points (growing 10, transforming 7, stable 6, declining 2)
    + 5·constraints_feasible
aptitude_fit  = share of career.aptitude_min bands met + 0.1 per band level exceeded, max 1
workstyle_fit = 1 − (dp + ds): dp 0 if primary is the career's first style, 0.25 if listed, 0.5 otherwise;
                ds 0 if secondary is listed, 0.25 if none, 0.5 otherwise; 0.5 when either side is missing
values_fit    = |top-5 ∩ career.values_fit| / min(5, |career.values_fit|)
constraints   = 0 when the career's family is in candidates.constraints.exclude_families
```

The interest vector comes from `profile_summary` (falls back to the latest interest result). Top 15 by fit are upserted into `career_matches` with `rank`, `match_version`, and `breakdown {interest, aptitude, workstyle, values, outlook, constraints, explanation{…}, swadharma?}`. Re-runs keep `counsellor_action` and `visible_to_candidate`; rows that drop out of the top 15 are deleted only when the counsellor has not acted on them and they are unpublished.

### 9.3 Stream recommendation (`worker/streams.py`, `streams-0.1`) — early_explorer

```
stream_fit = 35·cosine(interest_vector, mean RIASEC profile of the families the stream keeps open)
           + 30·mean aptitude percentile of the stream's sub-tests / 100
               (PCMB numerical+abstract+verbal; PCM numerical+abstract; PCB verbal+abstract;
                Commerce numerical+verbal; Humanities verbal+abstract; Design/Vocational spatial+abstract)
           + 20·mean over key subjects of (marks % and (enjoyment − 1)/4)
           + 10·keeps_open count / widest count
           + 5·board match
```

Enjoyment comes from `subject_enjoyment` rows, filled in from the "Subjects I enjoy" instrument where the counsellor has not entered a value. Missing data scores 0.5 for that part. Top 5 plus the widest stream if it is not already there (5–6 rows). Breakdown carries `keeps_open`, `closes`, up to 3 `sample_careers` per open family, `widest`, and the counsellor-only `swadharma` roll-up (sum of family points over `keeps_open`).

### 9.4 Swadharma (`worker/swadharma.py`, `swadharma-0.1`)

Runs only when `candidates.swadharma_opted_in` and `birth_details.consent_at` are set (and lat/lng exist). Swiss Ephemeris (Moshier, no data files), Lahiri sidereal; whole-sign houses for Parashari work, Placidus cusps for KP. Local birth time is converted with the IANA `tz` (default Asia/Kolkata).

Chart (`compute_chart`): nine grahas (mean node; Ketu = Rahu + 180°), sign, whole-sign house, D9 = `floor(lon·9/30) mod 12`, D10 (3° parts; odd signs from the sign, even signs from the 9th), dignity (exalted 1.0, own 0.85, friend 0.65, neutral 0.5, enemy 0.35, debilitated 0.15; nodes borrow Saturn/Mars relationships), retrograde, combustion (standard orbs), nakshatra, pada, star-lord, KP sub-lord (Vimshottari proportions inside the star), KP house.

Ashtakavarga: classical BAV tables for the seven planets (totals 48, 49, 39, 54, 56, 52, 39); SAV always sums to 337 (tested). Strength: a Shadbala *proxy* (0.4 dignity, 0.25 directional, 0.15 natural, 0.2 motional/paksha), labelled as such in the output.

Components per family, each a 0–1 score × weight. `K[p][f]` is the karakatwa weight from `worker/karakatwa.json` (editable; read at run time).

| Component | Weight | Score |
|---|---|---|
| D10 | 25 | Weighted mean of K × D10 dignity over the D10 lagna lord (1.0), D10 10th lord (1.0) and planets in the D10 lagna and 10th (0.8 each) |
| KP 10th sub-lord | 20 | Sub-lord SL, its star-lord STL; significations = houses occupied/owned by STL and SL (nodes add their sign lord). strength = share of {2, 6, 10, 11} signified. Score = (0.5 + 0.5·strength)·(½K[SL] + ½K[STL]) + 0.15 service bias (6th signified: Public Service, Law, Education, Medicine) + 0.15 business bias (7th: Business, Sales & Media, Hospitality). Also records `study_location_lean` (9th/12th vs 4th) |
| Ashtakavarga | 20 | 0.4·mean SAV factor of houses 10, 2, 6, 11 (≥ 28 → 1, 25–27 → 0.6, < 25 → 0.3) + 0.4·K-weighted BAV of planets in the 10th sign / 8 + 0.2·10th lord's BAV / 8 (halved when the 10th lord does not signify the family) |
| Planetary strength | 15 | Proxy rank score (7 − rank)/7, +0.15 exalted/own, −0.15 combust or uncancelled debility; K-weighted; +0.1·K of Atmakaraka and of Amatyakaraka |
| Yogas | 10 | Σ yoga strength × mean K of the planets involved: Budhaditya 0.5, Gaja-Kesari 0.5, Neecha-bhanga 0.4, Saraswati 0.6, Dharma-Karmadhipati 0.7, Raja/Dhana with the 10th lord 0.5, Parivartana with the 10th lord 0.6 |
| Dasha timing | 10 | Antardashas over the next 10 years, time-weighted: ½·K of each lord that signifies a career house (KP significations when cusps exist) ×1.5, capped at 1 |

Unknown birth time (`time_certainty = unknown`): chart cast for 12:00 local; only "moon_sign" (10th from the Moon, its lord and occupants, by D1 dignity; weight 25) and strength (weight 15, no directional part) run, rescaled so the maximum is still 100. Confidence: exact → high, approx_15m → medium, approx_1h and unknown → low.

Favourable windows: antardasha periods in the next 10 years where both lords signify a career house; purpose from the antardasha lord's houses (exams 4/5/6/9/11, job change 6/10/11, launch 7/10/11). early_explorer: windows are clipped to the Class 10 board season (15 Jan – 31 Mar), Class 11 entry (Apr – Jun) and the Class 12 board season, derived from the current class (or DOB + 16), with no career wording.

Personality lens: lagna (time known), Moon sign, Sun sign and lagna lord → tendencies, strengths and watch-outs from an original 12-sign table, written after "You may" or, for early_explorer, "Your child may". A test rejects health, marriage, longevity, wealth and prohibition words (`BANNED_TERMS`).

Agreement matrix: families ranked by Swadharma points vs psychometric rank (best career fit per family, then interest alignment). Agree = both top 5; Partial = top 5 on one side and top 8 on the other; Conflict = top 5 on one side and rank ≥ 11 on the other; otherwise "—".

Writes: `swadharma_charts` (upsert; `insights` = lens, agreement, component detail, yogas, confidence, weights), `swadharma_scores` (one row per family, updated in place so `counsellor_notes` survive), and the `swadharma` key of `career_matches.breakdown` / `stream_matches.breakdown`. Nothing else.

### 9.5 Reports (`worker/reports.py`, `worker/templates/`)

| Kind | Template | Content |
|---|---|---|
| candidate | `candidate.html` | Interests, aptitude, work style and style table, values, counsellor summary, published career options (top 10) with explanations, roadmap, shared session summaries |
| candidate_junior | `candidate_junior.html` | Eight pages written to the student in "leanings" language (no Holland code), streams, next steps |
| parent | `parent.html` | Two pages: summary tiles, values, options (top 5 careers or 3 streams), key dates, how to help, counsellor contact |
| stream_choice | `stream_choice.html` | Stream cards with keeps-open / harder-later families and examples, basis, roadmap |
| case_file | `case_file.html` | Everything: all matches incl. unpublished with breakdown and Swadharma column, private notes, roadmap, full Swadharma section with components and counsellor notes |
| swadharma | `swadharma.html` | Page 1 = full disclaimer and framing; then family points, lens, agreement, windows (no counsellor notes, no dasha names) |

Every page carries the verbatim disclaimer in the footer. `assemble()` strips `breakdown.swadharma`, unpublished and hidden matches, draft roadmaps and `notes_private` from every kind except case_file, whatever data is passed in (tested). Flow: the counsellor inserts a `reports` row (`content.status = requested`) → `render_pending` builds the context, renders with WeasyPrint, uploads to the `reports` bucket and sets `pdf_path` with `content = {status: rendered, rendered_at, renderer, snapshot}` exactly once.

### 9.6 Jobs (`worker/scheduler.py`)

| Schedule (Asia/Kolkata) | Job | Behaviour |
|---|---|---|
| every minute | `job_score_pending` | `scoring.score_pending` |
| every minute | `job_refresh_candidates` | When a result is newer than `profile_summary.updated_at`: build profile, then `match.run` or `streams.run`. When opted in and `consent_at` is newer than the chart: `swadharma.run` |
| every minute | `job_render_reports` | `reports.render_pending` |
| every minute | `job_deliver` | Marks unsent notifications as sent and logs them (email/SMS hook point) |
| 02:15 daily | `job_report_sla` | `v_caseload` rows past `report_due_at` with no report → `report_sla` notification to the counsellor and admins |
| 02:15 daily | `job_outcome_reminders` | 6 / 12 / 24 months (182 / 365 / 730 days) after `roadmaps.published_at`, with no outcome at that checkpoint → `outcome_<cp>` notification to the counsellor |
| 1 Jan / Apr / Jul / Oct 09:00 | `job_outlook_refresh` | Careers with `last_reviewed` null or older than 90 days → admin notification |

Notifications are upserted on (`user_id`, `kind`, `entity_id`) with ignore-duplicates, so repeats are no-ops. Missed roadmap items themselves are marked by the pg_cron job (§5.1). `python scheduler.py --once` runs every job once.

### 9.7 Edge Functions

| Function | Auth | Behaviour |
|---|---|---|
| `score_instrument` | Service-role bearer (from the trigger) or the session owner's JWT | Loads session + instrument with the service key, scores with `_shared/scoring.ts`, inserts `assessment_results`; idempotent (skips when a result exists since `completed_at`) |
| `generate_signed_report_url` | User JWT | Reads the report row with the caller's JWT so RLS decides access; 404 when not visible or no PDF yet; returns a 15-minute signed URL and writes `audit_log` `report_download` |

## 10. Frontend design

| Concern | Design |
|---|---|
| Routing | React Router (`src/App.tsx`). `/cases`, `/cases/:id?tab=…` (counsellor, admin), `/me`, `/me/assess`, `/me/assess/:instrument` (candidate). Other routes render a placeholder until built. `RequireRole` redirects to the role home (`HOME_FOR_ROLE`) |
| Data layer | `src/lib/api/api.ts` interface with `supabaseApi.ts` (RLS, views, RPCs) and `demoApi.ts` (in-memory). `main.tsx` picks one by `DEMO_MODE` before rendering; demo personas sign in from the login page |
| Case tabs | Overview · Assessments (re-administer) · Profile (charts, narrative, approve) · Swadharma 🔒 (counsellor/admin only; points, components, notes, lens, agreement, windows, Release dialog with reason and irreversibility checkbox) · Options (pin/hide/add, publish switch, counsellor-only Swadharma column) · Sessions (ICCC templates, private notes, summary, actions, attendance) · Roadmap (template, items, publish/pause/complete) · Reports (request, versions, signed download) · Documents |
| Test runner | `my_instruments` → session → `next_item` loop; one item per screen; answers buffered and flushed to `save_responses` every 30 s, after each timed answer, on tab hide/pagehide and on exit; countdown from `started_at` and `server_now` (server wins); Back only in untimed sections; keyboard 1–5 / Enter; forced choice picks most and least |
| Track switch | `TrackProvider` sets `html[data-track]`; Tailwind `junior:` variant; `COPY` dictionary per track. early_explorer: base type 19.5 px (17 px otherwise), friendlier copy, illustrations, stepper. Staff (and demo) can preview either track |
| Theme | Tokens in `src/index.css`: pine (deep teal), sand, saffron |
| Errors | `ErrorBox` maps 42501 → no access, 22023 → validation message, P0429 → try again later |

## 11. Testing

| Suite | Command | Covers |
|---|---|---|
| SQL | `PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash supabase/tests/run.sh` | RLS per role, triggers, RPCs, under-18 gate, append-only and write-once rules (`rls_test.sql` as `authenticator`, `owner_test.sql` as owner) |
| Web + TS scorer | `npx vitest run` | Runner buffer/timer helpers, TS scorer against the shared fixtures |
| Types / build | `npx tsc -b && npx vite build` | Web app |
| Edge Functions | `deno check supabase/functions/*/index.ts` | Type check |
| Worker | `cd worker && pytest` | Scorer parity, matcher, streams, Swadharma (SAV 337, D9/D10, sub-lords, dashas, unknown time, banned words, junior windows), reports (disclaimer, no Swadharma or private notes outside case_file, 8-page junior, PDF render), scheduler, and an end-to-end pipeline on an in-memory database |

Any change to policies, triggers or RPCs needs a matching SQL test. Regenerate seed data with `python3 supabase/seed/build_seed.py` (rewrites everything after `-- BEGIN GENERATED SEED`); regenerate scorer fixtures with `python3 supabase/seed/build_scoring_fixtures.py` then `UPDATE_FIXTURES=1 npx vitest run supabase/functions`.

## 12. Change history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-24 | Baseline from `001_init.sql` and the engine-rule spec |
| 1.1 | 2026-10-24 | Start Here code landed: Edge Functions, web app, worker. Engine sections now describe the implemented formulas; `next_item` has no expiry grace; report storage path; worker and demo-mode configuration; test suites |
