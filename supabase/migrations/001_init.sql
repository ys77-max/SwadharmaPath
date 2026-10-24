-- =============================================================================
-- SwadharmaPath — 001_init.sql
-- Full schema, CHECK constraints, RLS, views, triggers, RPCs and seed data.
--
-- Security model in one paragraph:
--   * Every table has RLS on. Policies call small SECURITY DEFINER helpers in
--     the `private` schema (not exposed by PostgREST) so they never recurse.
--   * birth_details, swadharma_charts and swadharma_scores have NO candidate or
--     parent policy at all. Candidates write birth details only through the
--     submit_birth_details() RPC, which never returns the row.
--   * career_matches / stream_matches have no candidate policy; candidates read
--     them through v_candidate_matches / v_candidate_stream_matches, which strip
--     breakdown->'swadharma'.
--   * instruments.items / scoring_spec / norms are not selectable by API roles
--     (column privileges). The runner gets one item at a time from next_item().
--   * swadharma_releases, audit_log are append-only for every role. reports are
--     write-once: the only permitted updates are the worker filling pdf_path
--     once, and the release trigger widening visible_to.
-- =============================================================================

create extension if not exists pgcrypto;

-- pg_net (Edge Function calls) and pg_cron (nightly job) are optional so the
-- migration also runs on a plain Postgres used for tests.
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net not available: %', sqlerrm;
end $$;
do $$ begin
  create extension if not exists pg_cron;
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('candidate','parent','counsellor','admin')),
  full_name     text not null,
  phone         text,
  email         text,
  photo_url     text,
  language_pref text default 'en',
  created_at    timestamptz default now()
);

create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  source              text check (source in ('web','whatsapp','referral','school','walk_in')),
  name                text,
  phone               text,
  email               text,
  track               text check (track in ('early_explorer','student','professional')),
  class_or_role       text,
  city                text,
  notes               text,
  stage               text default 'new' check (stage in ('new','contacted','discovery','paid','active','completed','lost')),
  assigned_counsellor uuid references public.users(id),
  next_followup       date,
  converted_candidate uuid,
  created_at          timestamptz default now()
);

create table public.candidates (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references public.users(id),
  lead_id                uuid references public.leads(id),
  track                  text check (track in ('early_explorer','student','professional')),
  board                  text,
  dob                    date,
  gender                 text,
  city                   text,
  school_or_employer     text,
  class_or_years_exp     text,
  stream_or_function     text,
  academics              jsonb default '{}',
  constraints            jsonb default '{}',
  parent_user_id         uuid references public.users(id),
  counsellor_id          uuid references public.users(id),
  status                 text default 'onboarding',
  swadharma_opted_in     boolean default false,
  disclaimer_accepted_at timestamptz,
  guardian_consent_at    timestamptz,
  created_at             timestamptz default now()
);
alter table public.leads
  add constraint leads_converted_candidate_fkey
  foreign key (converted_candidate) references public.candidates(id);

-- counsellor/admin only
create table public.birth_details (
  candidate_id         uuid primary key references public.candidates(id) on delete cascade,
  birth_date           date,
  birth_time           time,
  time_certainty       text check (time_certainty in ('exact','approx_15m','approx_1h','unknown')),
  birth_place          text,
  lat                  double precision,
  lng                  double precision,
  tz                   text,
  consent_given_by     uuid references public.users(id),
  consent_at           timestamptz,
  consent_text_version text
);

create table public.instruments (
  id             uuid primary key default gen_random_uuid(),
  code           text check (code in ('interest','aptitude','workstyle','bigfive','values','learning','school_values','subject_enjoyment')),
  name           text,
  version        text,
  track_variant  text check (track_variant in ('junior','standard')),
  items          jsonb,
  scoring_spec   jsonb,
  norms          jsonb,
  time_limit_min int,
  is_active      boolean default true
);

create table public.assessment_sessions (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid references public.candidates(id) on delete cascade,
  instrument_id uuid references public.instruments(id),
  started_at    timestamptz,
  completed_at  timestamptz,
  responses     jsonb default '{}',
  status        text default 'in_progress' check (status in ('in_progress','completed','invalidated')),
  device        text,
  duration_sec  int
);

create table public.assessment_results (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid references public.candidates(id) on delete cascade,
  instrument_id   uuid references public.instruments(id),
  raw             jsonb,
  percentiles     jsonb,
  derived         jsonb,
  validity_flags  jsonb,
  scored_at       timestamptz default now(),
  scoring_version text
);

create table public.profile_summary (
  candidate_id     uuid primary key references public.candidates(id) on delete cascade,
  interest_vector  numeric[],
  aptitude_vector  numeric[],
  workstyle_vector numeric[],
  values_vector    numeric[],
  narrative        jsonb,
  approved_by      uuid references public.users(id),
  approved_at      timestamptz,
  updated_at       timestamptz
);

create table public.subject_enjoyment (
  candidate_id     uuid references public.candidates(id) on delete cascade,
  subject          text,
  enjoyment        int check (enjoyment between 1 and 5),
  marks_pct        numeric,
  teacher_feedback text,
  primary key (candidate_id, subject)
);

create table public.careers (
  id                  uuid primary key default gen_random_uuid(),
  name                text,
  family              text,
  riasec_code         text,
  interest_weights    numeric[],
  aptitude_min        jsonb,
  workstyle_fit       jsonb,
  values_fit          jsonb,
  description         text,
  day_in_life         text,
  typical_entry_paths jsonb,
  india_salary_band   jsonb,
  outlook             text check (outlook in ('growing','stable','transforming','declining')),
  automation_exposure text check (automation_exposure in ('low','medium','high')),
  adjacent_emerging   text[],
  sources             jsonb,
  last_reviewed       date
);

create table public.education_pathways (
  id                 uuid primary key default gen_random_uuid(),
  career_id          uuid references public.careers(id) on delete cascade,
  level              text check (level in ('class11_12','ug','pg','diploma','certification','global')),
  stream_required    text,
  exams              jsonb,
  degrees            text[],
  institutions       jsonb,
  duration           text,
  alternative_routes text,
  notes              text
);

create table public.stream_options (
  id                  uuid primary key default gen_random_uuid(),
  name                text,
  board               text,
  subjects            text[],
  keeps_open_families text[],
  closes_families     text[],
  notes               text
);

create table public.career_matches (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid references public.candidates(id) on delete cascade,
  career_id            uuid references public.careers(id),
  fit_score            numeric,
  breakdown            jsonb,
  rank                 int,
  counsellor_action    text check (counsellor_action in ('pinned','hidden','added')),
  visible_to_candidate boolean default false,
  match_version        text,
  created_at           timestamptz default now()
);

create table public.stream_matches (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid references public.candidates(id) on delete cascade,
  stream_option_id     uuid references public.stream_options(id),
  fit_score            numeric,
  breakdown            jsonb,
  rank                 int,
  counsellor_action    text,
  visible_to_candidate boolean default false,
  created_at           timestamptz default now()
);

-- counsellor/admin only
create table public.swadharma_charts (
  candidate_id   uuid primary key references public.candidates(id) on delete cascade,
  ayanamsa       text,
  d1             jsonb,
  d9             jsonb,
  d10            jsonb,
  kp_cusps       jsonb,
  ashtakavarga   jsonb,
  dashas         jsonb,
  computed_at    timestamptz,
  engine_version text,
  -- Additive: the worker's personality lens and psychometric agreement matrix
  -- ({personality_lens: {...}, agreement: [...]}) have no column in the spec.
  insights       jsonb default '{}'
);

-- counsellor/admin only
create table public.swadharma_scores (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid references public.candidates(id) on delete cascade,
  career_family      text,
  points             numeric,
  max_points         numeric default 100,
  components         jsonb,
  favourable_windows jsonb,
  confidence         text check (confidence in ('high','medium','low')),
  counsellor_notes   text,
  computed_at        timestamptz default now(),
  engine_version     text
);

create table public.sessions (
  id                    uuid primary key default gen_random_uuid(),
  candidate_id          uuid references public.candidates(id) on delete cascade,
  counsellor_id         uuid references public.users(id),
  scheduled_at          timestamptz,
  duration_min          int default 60,
  mode                  text check (mode in ('video','in_person','phone')),
  meeting_url           text,
  iccc_stage            text check (iccc_stage in ('know_self','know_world','decide','plan','act','review')),
  notes_private         text,
  summary_for_candidate text,
  action_items          jsonb default '[]',
  attended              boolean,
  created_at            timestamptz default now()
);

create table public.roadmaps (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid references public.candidates(id) on delete cascade,
  template       text check (template in ('class8_10_exposure','class11_12','ug','pg_prep','transition','custom')),
  goal_career_id uuid references public.careers(id),
  goal_stream_id uuid references public.stream_options(id),
  start_date     date,
  end_date       date,
  status         text default 'draft' check (status in ('draft','published','completed','paused')),
  published_at   timestamptz
);

create table public.roadmap_items (
  id           uuid primary key default gen_random_uuid(),
  roadmap_id   uuid references public.roadmaps(id) on delete cascade,
  kind         text check (kind in ('milestone','task','exam','skill','checkin')),
  title        text,
  description  text,
  due_date     date,
  owner        text check (owner in ('candidate','counsellor','parent')),
  status       text default 'todo' check (status in ('todo','in_progress','done','missed')),
  evidence_url text,
  completed_at timestamptz
);

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete cascade,
  kind         text check (kind in ('candidate','candidate_junior','parent','stream_choice','case_file','swadharma')),
  version      int,
  generated_by uuid references public.users(id),
  pdf_path     text,
  content      jsonb,
  visible_to   text check (visible_to in ('counsellor','candidate','parent','all')),
  created_at   timestamptz default now()
);

-- append-only
create table public.swadharma_releases (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete cascade,
  released_by  uuid references public.users(id),
  released_to  text check (released_to in ('candidate','parent','both')),
  reason       text not null check (length(trim(reason)) > 0),
  report_id    uuid references public.reports(id),
  released_at  timestamptz default now()
);

create table public.outcomes (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid references public.candidates(id) on delete cascade,
  checkpoint    text check (checkpoint in ('6m','12m','24m')),
  status        text,
  career_id     uuid references public.careers(id),
  matched_top5  boolean,
  satisfaction  int check (satisfaction between 1 and 5),
  notes         text,
  recorded_at   timestamptz default now()
);

-- append-only
create table public.audit_log (
  id        uuid primary key default gen_random_uuid(),
  actor     uuid references public.users(id),
  action    text,
  entity    text,
  entity_id uuid,
  detail    jsonb,
  at        timestamptz default now()
);

-- Additive: the spec's nightly job writes "notification rows" but names no table.
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  entity       text,
  entity_id    uuid,
  created_at   timestamptz default now(),
  read_at      timestamptz,
  sent_at      timestamptz
);

create index on public.leads (stage);
create index on public.leads (assigned_counsellor);
create index on public.candidates (counsellor_id);
create index on public.candidates (user_id);
create index on public.candidates (parent_user_id);
create index on public.assessment_sessions (candidate_id);
create index on public.assessment_results (candidate_id);
create index on public.career_matches (candidate_id);
create index on public.stream_matches (candidate_id);
create index on public.swadharma_scores (candidate_id);
create index on public.sessions (candidate_id);
create index on public.sessions (counsellor_id, scheduled_at);
create index on public.roadmaps (candidate_id);
create index on public.roadmap_items (roadmap_id);
create index on public.reports (candidate_id, kind);
create index on public.swadharma_releases (report_id);
create index on public.notifications (user_id);
create unique index notifications_once_per_entity
  on public.notifications (user_id, kind, entity_id);

-- -----------------------------------------------------------------------------
-- Helper functions (private schema; SECURITY DEFINER so policies never recurse)
-- -----------------------------------------------------------------------------

create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.users where id = auth.uid()), false)
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('counsellor','admin') from public.users where id = auth.uid()), false)
$$;

-- True for the worker / Edge Functions (service-role JWT) and for direct
-- database sessions (migrations, SQL editor). session_user is unaffected by
-- SECURITY DEFINER, so definer functions do not accidentally qualify.
create or replace function private.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
      or session_user in ('postgres','supabase_admin')
$$;

create or replace function private.is_assigned_counsellor(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.candidates c
                 where c.id = p_candidate and c.counsellor_id = auth.uid())
$$;

-- assigned counsellor or admin
create or replace function private.can_manage(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_assigned_counsellor(p_candidate)
$$;

create or replace function private.is_own_candidate(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.candidates c
                 where c.id = p_candidate and c.user_id = auth.uid())
$$;

create or replace function private.is_parent_of(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.candidates c
                 where c.id = p_candidate and c.parent_user_id = auth.uid())
$$;

-- candidate themselves or linked parent
create or replace function private.is_family(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_own_candidate(p_candidate) or private.is_parent_of(p_candidate)
$$;

create or replace function private.can_read_candidate(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_family(p_candidate) or private.can_manage(p_candidate)
$$;

create or replace function private.is_released(p_report uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.swadharma_releases r where r.report_id = p_report)
$$;

create or replace function private.profile_approved(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profile_summary p
                 where p.candidate_id = p_candidate and p.approved_at is not null)
$$;

-- Under-18 rule. dob unknown is treated as a minor (fail closed).
create or replace function private.needs_guardian_consent(p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (c.dob is null or c.dob > (now() - interval '18 years')::date)
           and c.guardian_consent_at is null
    from public.candidates c where c.id = p_candidate), true)
$$;

create or replace function private.write_audit(p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, entity, entity_id, detail)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb))
$$;

grant execute on all functions in schema private to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.users               enable row level security;
alter table public.leads               enable row level security;
alter table public.candidates          enable row level security;
alter table public.birth_details       enable row level security;
alter table public.instruments         enable row level security;
alter table public.assessment_sessions enable row level security;
alter table public.assessment_results  enable row level security;
alter table public.profile_summary     enable row level security;
alter table public.subject_enjoyment   enable row level security;
alter table public.careers             enable row level security;
alter table public.education_pathways  enable row level security;
alter table public.stream_options      enable row level security;
alter table public.career_matches      enable row level security;
alter table public.stream_matches      enable row level security;
alter table public.swadharma_charts    enable row level security;
alter table public.swadharma_scores    enable row level security;
alter table public.swadharma_releases  enable row level security;
alter table public.sessions            enable row level security;
alter table public.roadmaps            enable row level security;
alter table public.roadmap_items       enable row level security;
alter table public.reports             enable row level security;
alter table public.outcomes            enable row level security;
alter table public.audit_log           enable row level security;
alter table public.notifications       enable row level security;

-- users ----------------------------------------------------------------------
create policy users_select on public.users for select to authenticated using (
  id = auth.uid()
  or private.is_admin()
  or (private.my_role() = 'counsellor')            -- counsellors see names of people they work with
  or exists (select 1 from public.candidates c     -- candidates/parents see their counsellor and each other
             where (c.user_id = auth.uid() or c.parent_user_id = auth.uid())
               and users.id in (c.counsellor_id, c.user_id, c.parent_user_id))
);
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy users_admin on public.users for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- leads: public INSERT (rate-limited by trigger), SELECT counsellor/admin -----
create policy leads_public_insert on public.leads for insert to anon, authenticated with check (
  coalesce(stage, 'new') = 'new' and assigned_counsellor is null
  and converted_candidate is null and next_followup is null
);
create policy leads_staff_select on public.leads for select to authenticated using (private.is_staff());
create policy leads_counsellor_update on public.leads for update to authenticated
  using (private.is_admin() or assigned_counsellor = auth.uid())
  with check (private.is_admin() or assigned_counsellor = auth.uid());
create policy leads_admin on public.leads for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- candidates -----------------------------------------------------------------
create policy candidates_select on public.candidates for select to authenticated using (
  user_id = auth.uid() or parent_user_id = auth.uid()
  or counsellor_id = auth.uid() or private.is_admin()
);
create policy candidates_counsellor_insert on public.candidates for insert to authenticated
  with check (counsellor_id = auth.uid() and private.my_role() = 'counsellor');
create policy candidates_counsellor_update on public.candidates for update to authenticated
  using (counsellor_id = auth.uid()) with check (counsellor_id = auth.uid());
create policy candidates_admin on public.candidates for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- birth_details / swadharma_charts / swadharma_scores -------------------------
-- SELECT only for the assigned counsellor and admin. No candidate/parent policy
-- exists on these tables at all. Writes come from the worker (service role).
create policy birth_details_staff_select on public.birth_details for select to authenticated
  using (private.can_manage(candidate_id));
create policy swadharma_charts_staff_select on public.swadharma_charts for select to authenticated
  using (private.can_manage(candidate_id));
create policy swadharma_scores_staff_select on public.swadharma_scores for select to authenticated
  using (private.can_manage(candidate_id));
-- Counsellor notes are the one field staff may edit (trigger guard_swadharma_scores
-- rejects any other column change from a non-service role).
create policy swadharma_scores_staff_notes on public.swadharma_scores for update to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

-- instruments: metadata readable, items/specs/norms hidden by column grants ---
create policy instruments_select on public.instruments for select to authenticated
  using (is_active or private.is_staff());
create policy instruments_admin on public.instruments for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- assessment_sessions ---------------------------------------------------------
create policy asess_select on public.assessment_sessions for select to authenticated
  using (private.can_read_candidate(candidate_id));
create policy asess_candidate_insert on public.assessment_sessions for insert to authenticated
  with check (
    private.is_own_candidate(candidate_id)
    and not private.needs_guardian_consent(candidate_id)
    and coalesce(status, 'in_progress') = 'in_progress'
    and completed_at is null
  );
create policy asess_staff on public.assessment_sessions for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

-- assessment_results / profile_summary: family sees them only after approval ---
create policy aresults_select on public.assessment_results for select to authenticated using (
  private.can_manage(candidate_id)
  or (private.is_family(candidate_id) and private.profile_approved(candidate_id))
);
create policy aresults_staff on public.assessment_results for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

create policy profile_select on public.profile_summary for select to authenticated using (
  private.can_manage(candidate_id)
  or (private.is_family(candidate_id) and approved_at is not null)
);
create policy profile_staff on public.profile_summary for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

-- subject_enjoyment -----------------------------------------------------------
create policy subj_select on public.subject_enjoyment for select to authenticated
  using (private.can_read_candidate(candidate_id));
create policy subj_candidate_insert on public.subject_enjoyment for insert to authenticated
  with check (private.is_own_candidate(candidate_id));
create policy subj_staff on public.subject_enjoyment for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

-- library: careers, pathways, streams -----------------------------------------
create policy careers_read on public.careers for select to authenticated using (true);
create policy careers_admin on public.careers for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy pathways_read on public.education_pathways for select to authenticated using (true);
create policy pathways_admin on public.education_pathways for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy streams_read on public.stream_options for select to authenticated using (true);
create policy streams_admin on public.stream_options for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- matches: staff only on the base tables; candidates use the views -----------
create policy cmatch_staff on public.career_matches for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));
create policy smatch_staff on public.stream_matches for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

-- sessions: staff on the base table; family reads v_candidate_sessions --------
-- (notes_private must never reach a candidate or parent)
create policy sessions_staff on public.sessions for all to authenticated
  using (private.can_manage(candidate_id))
  with check (private.can_manage(candidate_id));

-- roadmaps / items ------------------------------------------------------------
create policy roadmaps_family_select on public.roadmaps for select to authenticated
  using (private.is_family(candidate_id) and status in ('published','completed','paused'));
create policy roadmaps_staff on public.roadmaps for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

create or replace function private.roadmap_candidate(p_roadmap uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select candidate_id from public.roadmaps where id = p_roadmap
$$;
create or replace function private.roadmap_published(p_roadmap uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select status in ('published','completed','paused') from public.roadmaps where id = p_roadmap), false)
$$;
grant execute on function private.roadmap_candidate(uuid), private.roadmap_published(uuid) to authenticated, service_role;

create policy ritems_family_select on public.roadmap_items for select to authenticated using (
  private.is_family(private.roadmap_candidate(roadmap_id)) and private.roadmap_published(roadmap_id)
);
-- Candidate may update status/evidence on their own items; guard_roadmap_item
-- rejects changes to any other column.
create policy ritems_candidate_update on public.roadmap_items for update to authenticated
  using (private.is_own_candidate(private.roadmap_candidate(roadmap_id)) and private.roadmap_published(roadmap_id))
  with check (private.is_own_candidate(private.roadmap_candidate(roadmap_id)));
create policy ritems_staff on public.roadmap_items for all to authenticated
  using (private.can_manage(private.roadmap_candidate(roadmap_id)))
  with check (private.can_manage(private.roadmap_candidate(roadmap_id)));

-- reports ---------------------------------------------------------------------
create policy reports_staff_select on public.reports for select to authenticated
  using (private.can_manage(candidate_id));
create policy reports_candidate_select on public.reports for select to authenticated using (
  private.is_own_candidate(candidate_id)
  and visible_to in ('candidate','all')
  and (kind <> 'swadharma' or private.is_released(id))
);
create policy reports_parent_select on public.reports for select to authenticated using (
  private.is_parent_of(candidate_id)
  and visible_to in ('parent','all')
  and (kind <> 'swadharma' or private.is_released(id))
);
create policy reports_staff_insert on public.reports for insert to authenticated
  with check (private.can_manage(candidate_id) and generated_by = auth.uid());
-- no UPDATE / DELETE policy: a changed report is a new version.

-- swadharma_releases: INSERT only ----------------------------------------------
create policy releases_staff_select on public.swadharma_releases for select to authenticated
  using (private.can_manage(candidate_id));
create policy releases_staff_insert on public.swadharma_releases for insert to authenticated
  with check (private.can_manage(candidate_id) and released_by = auth.uid());

-- outcomes --------------------------------------------------------------------
create policy outcomes_select on public.outcomes for select to authenticated
  using (private.can_read_candidate(candidate_id));
create policy outcomes_staff on public.outcomes for all to authenticated
  using (private.can_manage(candidate_id)) with check (private.can_manage(candidate_id));

-- audit_log: INSERT only (own actor); admin can read --------------------------
create policy audit_insert on public.audit_log for insert to authenticated with check (actor = auth.uid());
create policy audit_admin_select on public.audit_log for select to authenticated using (private.is_admin());

-- notifications ---------------------------------------------------------------
create policy notif_own_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_own_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Column privileges
-- -----------------------------------------------------------------------------

-- Instrument content never leaves the database through the API.
revoke select on public.instruments from anon, authenticated;
grant select (id, code, name, version, track_variant, time_limit_min, is_active)
  on public.instruments to authenticated;

-- Append-only tables: no UPDATE/DELETE/TRUNCATE for any API role.
revoke update, delete, truncate on public.swadharma_releases from anon, authenticated, service_role;
revoke update, delete, truncate on public.audit_log          from anon, authenticated, service_role;
revoke delete, truncate on public.reports from anon, authenticated;

-- Anonymous visitors may only submit a lead.
revoke all on all tables in schema public from anon;
grant insert on public.leads to anon;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- New auth user → public.users. Self-signup can only be candidate or parent;
-- counsellor/admin roles are granted by an admin.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'candidate');
begin
  if v_role not in ('candidate','parent') then v_role := 'candidate'; end if;
  insert into public.users (id, role, full_name, phone, email)
  values (new.id, v_role,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email, new.phone, 'New user'), '@', 1)),
          new.phone, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users may edit their own profile but never their role.
create or replace function private.guard_users() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role and not (private.is_admin() or private.is_service()) then
    raise exception 'only an admin can change a role' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_users before update on public.users
  for each row execute function private.guard_users();

-- Lead form rate limit + field sanity.
create or replace function private.leads_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_staff() or private.is_service() then return new; end if;
  if length(coalesce(new.name,'')) not between 1 and 120
     or length(coalesce(new.notes,'')) > 2000
     or (new.phone is null and new.email is null) then
    raise exception 'invalid enquiry' using errcode = '22023';
  end if;
  if (select count(*) from public.leads l
      where l.created_at > now() - interval '1 hour'
        and ((new.phone is not null and l.phone = new.phone) or (new.email is not null and lower(l.email) = lower(new.email)))) >= 3 then
    raise exception 'too many enquiries from this contact, please try later' using errcode = 'P0429';
  end if;
  if (select count(*) from public.leads l where l.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'enquiry form is busy, please try again shortly' using errcode = 'P0429';
  end if;
  new.source := coalesce(new.source, 'web');
  new.stage := 'new';
  return new;
end $$;
create trigger leads_rate_limit before insert on public.leads
  for each row execute function private.leads_rate_limit();

-- Under-18 gate, for every role (the RLS policy also checks it for candidates).
create or replace function private.assessment_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.needs_guardian_consent(new.candidate_id) then
    raise exception 'guardian consent is required before an under-18 candidate can start an assessment'
      using errcode = '42501';
  end if;
  new.started_at := coalesce(new.started_at, now());
  new.responses := coalesce(new.responses, '{}'::jsonb);
  return new;
end $$;
create trigger assessment_gate before insert on public.assessment_sessions
  for each row execute function private.assessment_gate();

-- Calls an Edge Function through pg_net. URL and key live in Vault as
-- 'project_url' and 'service_role_key'. Never blocks the caller.
create or replace function private.invoke_edge_function(p_name text, p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_key text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  exception when others then
    raise warning 'vault not available: %', sqlerrm; return;
  end;
  if v_url is null or v_key is null then
    raise warning 'project_url / service_role_key not set in vault; % not called', p_name; return;
  end if;
  begin
    perform net.http_post(
      url     := v_url || '/functions/v1/' || p_name,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body    := p_body);
  exception when others then
    raise warning 'edge function % call failed: %', p_name, sqlerrm;
  end;
end $$;
revoke execute on function private.invoke_edge_function(text, jsonb) from public, anon, authenticated;

create or replace function private.on_assessment_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.invoke_edge_function('score_instrument',
    jsonb_build_object('session_id', new.id, 'candidate_id', new.candidate_id, 'instrument_id', new.instrument_id));
  return new;
end $$;
create trigger assessment_completed after update of status on public.assessment_sessions
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.on_assessment_completed();

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger profile_touch before insert or update on public.profile_summary
  for each row execute function private.touch_updated_at();

-- Staff may edit counsellor_notes only; scores themselves come from the worker.
create or replace function private.guard_swadharma_scores() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_service() then return new; end if;
  if (to_jsonb(new) - 'counsellor_notes') is distinct from (to_jsonb(old) - 'counsellor_notes') then
    raise exception 'only counsellor_notes can be edited' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_swadharma_scores before update on public.swadharma_scores
  for each row execute function private.guard_swadharma_scores();

-- Candidates may only change status / evidence on their roadmap items.
create or replace function private.guard_roadmap_item() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_service() or private.can_manage(private.roadmap_candidate(old.roadmap_id)) then
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'evidence_url' - 'completed_at')
     is distinct from (to_jsonb(old) - 'status' - 'evidence_url' - 'completed_at') then
    raise exception 'candidates can only update status and evidence' using errcode = '42501';
  end if;
  if new.status = 'missed' and old.status <> 'missed' then
    raise exception 'status missed is set by the system' using errcode = '42501';
  end if;
  new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) else null end;
  return new;
end $$;
create trigger guard_roadmap_item before update on public.roadmap_items
  for each row execute function private.guard_roadmap_item();

create or replace function private.on_roadmap_published() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;
create trigger roadmap_published before update on public.roadmaps
  for each row execute function private.on_roadmap_published();

-- Reports: version numbering, case files stay with the counsellor, write-once.
create or replace function private.reports_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.version := coalesce((select max(version) from public.reports
                           where candidate_id = new.candidate_id and kind = new.kind), 0) + 1;
  new.visible_to := coalesce(new.visible_to, 'counsellor');
  -- case_file contains Swadharma; a swadharma report is widened only by a release.
  if new.kind in ('case_file','swadharma') then new.visible_to := 'counsellor'; end if;
  return new;
end $$;
create trigger reports_before_insert before insert on public.reports
  for each row execute function private.reports_before_insert();

create or replace function private.reports_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 1) worker fills pdf_path (and render metadata in content) exactly once
  if private.is_service() and old.pdf_path is null and new.pdf_path is not null
     and (to_jsonb(new) - 'pdf_path' - 'content') = (to_jsonb(old) - 'pdf_path' - 'content') then
    return new;
  end if;
  -- 2) a swadharma release widens visible_to
  if current_setting('swadharmapath.releasing', true) = 'on'
     and (to_jsonb(new) - 'visible_to') = (to_jsonb(old) - 'visible_to') then
    return new;
  end if;
  raise exception 'reports are immutable; generate a new version instead' using errcode = '42501';
end $$;
create trigger reports_guard_update before update on public.reports
  for each row execute function private.reports_guard_update();

create or replace function private.deny_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only (% denied)', tg_table_name, tg_op using errcode = '42501';
end $$;
create trigger reports_no_delete before delete on public.reports
  for each row execute function private.deny_change();
create trigger releases_append_only before update or delete on public.swadharma_releases
  for each row execute function private.deny_change();
create trigger audit_append_only before update or delete on public.audit_log
  for each row execute function private.deny_change();
create trigger releases_no_truncate before truncate on public.swadharma_releases
  for each statement execute function private.deny_change();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.deny_change();

-- Swadharma release: validate, widen reports.visible_to, write audit_log.
create or replace function private.swadharma_release_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.reports where id = new.report_id;
  if r.id is null or r.kind <> 'swadharma' or r.candidate_id <> new.candidate_id then
    raise exception 'a release must reference this candidate''s swadharma report' using errcode = '22023';
  end if;
  if not exists (select 1 from public.candidates c join public.birth_details b on b.candidate_id = c.id
                 where c.id = new.candidate_id and c.swadharma_opted_in and b.consent_at is not null) then
    raise exception 'candidate has not consented to the Swadharma analysis' using errcode = '42501';
  end if;
  new.released_at := now();
  new.released_by := coalesce(new.released_by, auth.uid());
  return new;
end $$;
create trigger swadharma_release_before before insert on public.swadharma_releases
  for each row execute function private.swadharma_release_before();

create or replace function private.swadharma_release_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old text; v_new text;
begin
  select visible_to into v_old from public.reports where id = new.report_id;
  v_new := case
    when new.released_to = 'both' then 'all'
    when v_old = 'all' then 'all'
    when v_old in ('candidate','parent') and v_old <> new.released_to then 'all'
    else new.released_to end;
  perform set_config('swadharmapath.releasing', 'on', true);
  update public.reports set visible_to = v_new where id = new.report_id;
  perform set_config('swadharmapath.releasing', 'off', true);
  insert into public.audit_log (actor, action, entity, entity_id, detail)
  values (new.released_by, 'swadharma_release', 'reports', new.report_id,
          jsonb_build_object('release_id', new.id, 'candidate_id', new.candidate_id,
                             'released_to', new.released_to, 'reason', new.reason,
                             'visible_to_before', v_old, 'visible_to_after', v_new));
  return new;
end $$;
create trigger swadharma_release_after after insert on public.swadharma_releases
  for each row execute function private.swadharma_release_after();

-- Nightly: overdue roadmap items → missed, plus a notification row per owner.
create or replace function private.mark_missed_roadmap_items() returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with missed as (
    update public.roadmap_items i set status = 'missed'
    from public.roadmaps r
    where i.roadmap_id = r.id and r.status = 'published'
      and i.due_date < current_date and i.status in ('todo','in_progress')
    returning i.id, i.title, i.owner, i.due_date, r.candidate_id
  ), recipients as (
    select m.*, c.user_id, c.parent_user_id, c.counsellor_id from missed m
    join public.candidates c on c.id = m.candidate_id
  ), ins as (
    insert into public.notifications (user_id, candidate_id, kind, title, body, entity, entity_id)
    select x.uid, x.candidate_id, 'roadmap_missed', 'Missed: ' || x.title,
           'This item was due on ' || to_char(x.due_date, 'DD Mon YYYY') || '. Update it or talk to your counsellor.',
           'roadmap_items', x.id
    from (
      select id, title, due_date, candidate_id,
             unnest(array[case when owner = 'parent' then parent_user_id else user_id end, counsellor_id]) as uid
      from recipients
    ) x
    where x.uid is not null
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from missed;
  return v_count;
end $$;
revoke execute on function private.mark_missed_roadmap_items() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('swadharmapath-missed-items', '30 20 * * *',  -- 02:00 IST
                        'select private.mark_missed_roadmap_items()');
exception when others then raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

-- Candidate-facing matches: published, not hidden, swadharma key stripped.
-- Runs as owner (bypasses base-table RLS) and filters to the caller's family.
create view public.v_candidate_matches as
select m.id, m.candidate_id, m.career_id, m.fit_score,
       m.breakdown - 'swadharma' as breakdown,
       m.rank, m.counsellor_action, m.visible_to_candidate, m.match_version, m.created_at,
       c.name as career_name, c.family as career_family, c.outlook, c.riasec_code
from public.career_matches m
join public.careers c on c.id = m.career_id
where m.visible_to_candidate
  and m.counsellor_action is distinct from 'hidden'
  and (private.is_family(m.candidate_id) or private.can_manage(m.candidate_id));

create view public.v_candidate_stream_matches as
select m.id, m.candidate_id, m.stream_option_id, m.fit_score,
       m.breakdown - 'swadharma' as breakdown,
       m.rank, m.counsellor_action, m.visible_to_candidate, m.created_at,
       s.name as stream_name, s.board, s.subjects, s.keeps_open_families, s.closes_families
from public.stream_matches m
join public.stream_options s on s.id = m.stream_option_id
where m.visible_to_candidate
  and m.counsellor_action is distinct from 'hidden'
  and (private.is_family(m.candidate_id) or private.can_manage(m.candidate_id));

-- Candidate-facing sessions: everything except notes_private.
create view public.v_candidate_sessions as
select s.id, s.candidate_id, s.counsellor_id, s.scheduled_at, s.duration_min, s.mode,
       s.meeting_url, s.iccc_stage, s.summary_for_candidate, s.action_items, s.attended, s.created_at
from public.sessions s
where private.is_family(s.candidate_id) or private.can_manage(s.candidate_id);

-- Admin views run with the caller's rights, so RLS still applies.
create view public.v_funnel with (security_invoker = true) as
select stage, track, count(*)::int as leads,
       count(*) filter (where created_at > now() - interval '30 days')::int as last_30d
from public.leads group by stage, track;

create view public.v_counsellor_utilisation with (security_invoker = true) as
select u.id as counsellor_id, u.full_name,
       (select count(*) from public.candidates c where c.counsellor_id = u.id
          and c.status not in ('completed','closed'))::int as active_candidates,
       (select count(*) from public.sessions s where s.counsellor_id = u.id
          and s.scheduled_at between now() - interval '30 days' and now())::int as sessions_30d,
       (select coalesce(sum(s.duration_min), 0) from public.sessions s where s.counsellor_id = u.id
          and s.scheduled_at between now() - interval '30 days' and now() and s.attended)::int as minutes_30d
from public.users u where u.role = 'counsellor';

-- Report turnaround: last completed assessment → first candidate-facing report.
create view public.v_tat with (security_invoker = true) as
with done as (
  select candidate_id, max(completed_at) as assessed_at
  from public.assessment_sessions where status = 'completed' group by candidate_id
), first_report as (
  select candidate_id, min(created_at) as reported_at from public.reports
  where kind in ('candidate','candidate_junior','stream_choice') group by candidate_id
)
select c.id as candidate_id, c.counsellor_id, d.assessed_at, f.reported_at,
       round(extract(epoch from (coalesce(f.reported_at, now()) - d.assessed_at)) / 86400.0, 1) as tat_days,
       f.reported_at is null as pending
from public.candidates c join done d on d.candidate_id = c.id
left join first_report f on f.candidate_id = c.id;

create view public.v_outcomes with (security_invoker = true) as
select checkpoint, count(*)::int as recorded,
       round(avg(case when matched_top5 then 1 else 0 end)::numeric * 100, 1) as pct_matched_top5,
       round(avg(satisfaction)::numeric, 2) as avg_satisfaction
from public.outcomes group by checkpoint;

-- Counsellor caseload (additive helper for /cases). Report SLA: a
-- candidate-facing report is due 7 days after the last completed assessment.
create view public.v_caseload with (security_invoker = true) as
select c.id as candidate_id, c.track, c.status, c.counsellor_id, c.created_at,
       u.full_name, c.class_or_years_exp, c.city,
       coalesce((select s.iccc_stage from public.sessions s where s.candidate_id = c.id
                 and s.scheduled_at <= now() order by s.scheduled_at desc limit 1), 'know_self') as iccc_stage,
       (select min(s.scheduled_at) from public.sessions s where s.candidate_id = c.id and s.scheduled_at > now()) as next_session_at,
       (select count(*) from public.assessment_sessions a where a.candidate_id = c.id and a.status = 'completed')::int as assessments_done,
       (select count(*) from public.assessment_results r where r.candidate_id = c.id
          and r.validity_flags is not null and r.validity_flags <> '{}'::jsonb
          and exists (select 1 from jsonb_each(r.validity_flags) f where f.value = 'true'::jsonb))::int as validity_issues,
       (select count(*) from public.roadmap_items i join public.roadmaps r on r.id = i.roadmap_id
          where r.candidate_id = c.id and i.status = 'missed')::int as missed_items,
       (c.dob is null or c.dob > (now() - interval '18 years')::date) and c.guardian_consent_at is null as consent_pending,
       p.approved_at as profile_approved_at,
       t.assessed_at, t.reported_at,
       case when t.assessed_at is null then null
            else t.assessed_at + interval '7 days' end as report_due_at
from public.candidates c
left join public.users u on u.id = c.user_id
left join public.profile_summary p on p.candidate_id = c.id
left join public.v_tat t on t.candidate_id = c.id;

revoke all on public.v_candidate_matches, public.v_candidate_stream_matches, public.v_candidate_sessions,
              public.v_funnel, public.v_counsellor_utilisation, public.v_tat, public.v_outcomes, public.v_caseload
  from anon;
grant select on public.v_candidate_matches, public.v_candidate_stream_matches, public.v_candidate_sessions,
               public.v_funnel, public.v_counsellor_utilisation, public.v_tat, public.v_outcomes, public.v_caseload
  to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs for candidates (SECURITY DEFINER; each checks ownership itself)
-- -----------------------------------------------------------------------------

-- Instruments for the caller's track, with their latest session.
create or replace function public.my_instruments()
returns table (instrument_id uuid, code text, name text, track_variant text, time_limit_min int,
               item_count int, est_minutes int, session_id uuid, status text, answered int)
language sql stable security definer set search_path = '' as $$
  with me as (
    select c.id, case when c.track = 'early_explorer' then 'junior' else 'standard' end as variant
    from public.candidates c where c.user_id = auth.uid() order by c.created_at desc limit 1
  )
  select i.id, i.code, i.name, i.track_variant, i.time_limit_min,
         (select count(*) from jsonb_array_elements(i.items->'sections') s, jsonb_array_elements(s->'items'))::int,
         coalesce(i.time_limit_min, ceil((select count(*) from jsonb_array_elements(i.items->'sections') s,
                                                jsonb_array_elements(s->'items')) * 12 / 60.0)::int),
         a.id, a.status,
         (select count(*) from jsonb_object_keys(coalesce(a.responses, '{}'::jsonb) - '_meta'))::int
  from me join public.instruments i on i.track_variant = me.variant and i.is_active
  left join lateral (
    select * from public.assessment_sessions x
    where x.candidate_id = me.id and x.instrument_id = i.id and x.status <> 'invalidated'
    order by x.started_at desc nulls last limit 1
  ) a on true
  order by array_position(array['interest','subject_enjoyment','aptitude','workstyle','bigfive','values','school_values','learning'], i.code)
$$;

create or replace function private.session_for_caller(p_session uuid)
returns public.assessment_sessions
language plpgsql stable security definer set search_path = '' as $$
declare s public.assessment_sessions;
begin
  select a.* into s from public.assessment_sessions a
  join public.candidates c on c.id = a.candidate_id
  where a.id = p_session and c.user_id = auth.uid();
  if s.id is null then raise exception 'assessment session not found' using errcode = '42501'; end if;
  return s;
end $$;
revoke execute on function private.session_for_caller(uuid) from public, anon;
grant execute on function private.session_for_caller(uuid) to authenticated;

-- Flattened item list with section metadata (internal only).
create or replace function private.instrument_items(p_instrument uuid)
returns table (pos int, section_code text, section_name text, section_time_sec int,
               section_pos int, section_count int, item jsonb)
language sql stable security definer set search_path = '' as $$
  select (row_number() over (order by s.ord, it.ord))::int - 1,
         s.sec->>'code', s.sec->>'name', nullif(s.sec->>'time_limit_sec','')::int,
         (it.ord - 1)::int, jsonb_array_length(s.sec->'items'), it.item
  from public.instruments i,
       jsonb_array_elements(i.items->'sections') with ordinality s(sec, ord),
       jsonb_array_elements(s.sec->'items') with ordinality it(item, ord)
  where i.id = p_instrument
$$;
revoke execute on function private.instrument_items(uuid) from public, anon, authenticated;

-- One item at a time, scoring keys stripped. p_position null = resume at the
-- first unanswered item. Timed sections: the clock starts when the first item
-- is served, cannot be restarted, and earlier items cannot be revisited.
create or replace function public.next_item(p_session_id uuid, p_position int default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.assessment_sessions;
  v_total int; v_pos int; r record; v_started timestamptz; v_meta jsonb; v_furthest int;
  v_grace interval := interval '5 seconds';
begin
  s := private.session_for_caller(p_session_id);
  if s.status <> 'in_progress' then raise exception 'assessment is not in progress' using errcode = '22023'; end if;
  select count(*) into v_total from private.instrument_items(s.instrument_id);
  v_meta := coalesce(s.responses->'_meta', '{}'::jsonb);

  if p_position is null then
    select min(pos) into v_pos from private.instrument_items(s.instrument_id) x
    where not (s.responses ? (x.item->>'id'));
  else
    v_pos := p_position;
  end if;

  loop
    if v_pos is null or v_pos >= v_total then
      return jsonb_build_object('done', true, 'total', v_total);
    end if;
    select * into r from private.instrument_items(s.instrument_id) x where x.pos = v_pos;
    exit when r.section_time_sec is null;
    v_started := (v_meta->'section_started'->>r.section_code)::timestamptz;
    if v_started is not null and now() > v_started + make_interval(secs => r.section_time_sec) + v_grace then
      -- time is up for this section: skip to the first item of the next section
      select min(pos) into v_pos from private.instrument_items(s.instrument_id) x
      where x.pos > v_pos and x.section_code <> r.section_code;
      continue;
    end if;
    select max(x.pos) into v_furthest from private.instrument_items(s.instrument_id) x
    where x.section_code = r.section_code and s.responses ? (x.item->>'id');
    if v_furthest is not null and v_pos < v_furthest then
      raise exception 'back navigation is not allowed in a timed section' using errcode = '22023';
    end if;
    if v_started is null then
      v_started := now();
      v_meta := jsonb_set(v_meta, '{section_started}',
                          coalesce(v_meta->'section_started', '{}'::jsonb) || jsonb_build_object(r.section_code, v_started));
      update public.assessment_sessions set responses = jsonb_set(responses, '{_meta}', v_meta)
      where id = s.id;
    end if;
    exit;
  end loop;

  return jsonb_build_object(
    'done', false,
    'position', v_pos,
    'total', v_total,
    'section', jsonb_build_object(
      'code', r.section_code, 'name', r.section_name,
      'time_limit_sec', r.section_time_sec,
      'started_at', v_started,
      'server_now', now(),
      'index', r.section_pos, 'count', r.section_count),
    'item', jsonb_build_object(
      'id', r.item->>'id',
      'type', r.item->>'type',
      'prompt', r.item->>'prompt',
      'options', coalesce((select jsonb_agg(jsonb_build_object('value', o->'value', 'label', o->'label'))
                           from jsonb_array_elements(r.item->'options') o), '[]'::jsonb)),
    'answer', s.responses->(r.item->>'id'));
end $$;

-- Autosave. p_responses = {item_id: {"a": <answer>, "rt": <ms>}}. Answers for
-- unknown items, or for timed sections whose clock ran out, are dropped.
create or replace function public.save_responses(p_session_id uuid, p_responses jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  s public.assessment_sessions; v_clean jsonb := '{}'::jsonb; k text; v jsonb; r record; v_started timestamptz;
begin
  s := private.session_for_caller(p_session_id);
  if s.status <> 'in_progress' then raise exception 'assessment is not in progress' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(coalesce(p_responses, '{}'::jsonb) - '_meta') loop
    select * into r from private.instrument_items(s.instrument_id) x where x.item->>'id' = k;
    continue when r.pos is null;
    if r.section_time_sec is not null then
      v_started := (s.responses->'_meta'->'section_started'->>r.section_code)::timestamptz;
      continue when v_started is null
        or now() > v_started + make_interval(secs => r.section_time_sec) + interval '30 seconds';
    end if;
    v_clean := v_clean || jsonb_build_object(k, v);
  end loop;
  update public.assessment_sessions set responses = responses || v_clean where id = s.id;
  return (select count(*) from jsonb_object_keys(v_clean));
end $$;

create or replace function public.complete_assessment(p_session_id uuid, p_device text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.assessment_sessions;
begin
  s := private.session_for_caller(p_session_id);
  if s.status <> 'in_progress' then raise exception 'assessment is not in progress' using errcode = '22023'; end if;
  update public.assessment_sessions
     set status = 'completed', completed_at = now(), device = coalesce(p_device, device),
         duration_sec = extract(epoch from now() - coalesce(started_at, now()))::int
   where id = s.id;
end $$;

-- Disclaimer acknowledgement (timestamped).
create or replace function public.accept_disclaimer()
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v timestamptz := now();
begin
  update public.candidates set disclaimer_accepted_at = v where user_id = auth.uid();
  if not found then raise exception 'no candidate profile' using errcode = '42501'; end if;
  perform private.write_audit('disclaimer_accepted', 'candidates', null, jsonb_build_object('at', v));
  return v;
end $$;

-- Linked guardian gives consent for an under-18 candidate.
create or replace function public.give_guardian_consent(p_candidate_id uuid)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v timestamptz := now();
begin
  if not private.is_parent_of(p_candidate_id) then
    raise exception 'only the linked guardian can give consent' using errcode = '42501';
  end if;
  update public.candidates set guardian_consent_at = v where id = p_candidate_id;
  perform private.write_audit('guardian_consent', 'candidates', p_candidate_id, jsonb_build_object('at', v));
  return v;
end $$;

-- Optional birth details with versioned consent. Writes only; never returns
-- the stored row, so candidates and parents can never read birth_details.
create or replace function public.submit_birth_details(
  p_candidate_id uuid, p_birth_date date, p_birth_time time, p_time_certainty text,
  p_birth_place text, p_lat double precision, p_lng double precision, p_tz text,
  p_consent_text_version text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_family(p_candidate_id) then
    raise exception 'not your candidate profile' using errcode = '42501';
  end if;
  if coalesce(p_consent_text_version, '') = '' then
    raise exception 'consent text version is required' using errcode = '22023';
  end if;
  insert into public.birth_details as b (candidate_id, birth_date, birth_time, time_certainty, birth_place,
                                         lat, lng, tz, consent_given_by, consent_at, consent_text_version)
  values (p_candidate_id, p_birth_date, p_birth_time, coalesce(p_time_certainty, 'unknown'), p_birth_place,
          p_lat, p_lng, p_tz, auth.uid(), now(), p_consent_text_version)
  on conflict (candidate_id) do update set
    birth_date = excluded.birth_date, birth_time = excluded.birth_time,
    time_certainty = excluded.time_certainty, birth_place = excluded.birth_place,
    lat = excluded.lat, lng = excluded.lng, tz = excluded.tz,
    consent_given_by = excluded.consent_given_by, consent_at = excluded.consent_at,
    consent_text_version = excluded.consent_text_version;
  update public.candidates set swadharma_opted_in = true where id = p_candidate_id;
  perform private.write_audit('swadharma_consent', 'candidates', p_candidate_id,
                              jsonb_build_object('consent_text_version', p_consent_text_version));
end $$;

revoke execute on function public.my_instruments(), public.next_item(uuid, int), public.save_responses(uuid, jsonb),
  public.complete_assessment(uuid, text), public.accept_disclaimer(), public.give_guardian_consent(uuid),
  public.submit_birth_details(uuid, date, time, text, text, double precision, double precision, text, text)
  from anon, public;
grant execute on function public.my_instruments(), public.next_item(uuid, int), public.save_responses(uuid, jsonb),
  public.complete_assessment(uuid, text), public.accept_disclaimer(), public.give_guardian_consent(uuid),
  public.submit_birth_details(uuid, date, time, text, text, double precision, double precision, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: private buckets. reports/ has no client policy (signed URLs only).
-- documents/<candidate_id>/... readable by family and the assigned counsellor.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('reports', 'reports', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;

create policy documents_read on storage.objects for select to authenticated using (
  bucket_id = 'documents' and private.can_read_candidate(((storage.foldername(name))[1])::uuid)
);
create policy documents_write on storage.objects for insert to authenticated with check (
  bucket_id = 'documents'
  and (private.is_own_candidate(((storage.foldername(name))[1])::uuid)
       or private.can_manage(((storage.foldername(name))[1])::uuid))
);

-- =============================================================================
-- Seed data
-- =============================================================================

-- BEGIN GENERATED SEED (supabase/seed/build_seed.py)

-- Career library (20) with education pathways
with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Software Engineer', 'Engineering & Technology', 'IRC', array[0.6, 0.9, 0.3, 0.2, 0.3, 0.6]::numeric[],
    '{"numerical": "Average", "abstract": "High"}'::jsonb, '["D", "R"]'::jsonb, '["Learning", "Achievement", "Independence", "Creativity"]'::jsonb,
    'Designs, builds and maintains software, from mobile apps to large back-end systems.',
    'Stand-up with the team, a few focused hours writing and reviewing code, debugging a production issue, and a design discussion about the next feature.',
    '["B.Tech/B.E. in CSE or IT", "BCA + MCA", "Any degree + strong portfolio and internships"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [4, 12], "mid": [15, 35], "senior": [40, 90], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'transforming', 'medium',
    array['AI/ML engineer', 'Platform engineer', 'Security engineer']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('class11_12', 'PCM', '[]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '2 years', 'Computer Science as an elective helps but is not required.', null),
  ('ug', 'PCM', '[{"name": "JEE Main", "typical_window": "January and April sessions", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "JEE Advanced", "typical_window": "May-June", "body": "IITs", "note": "Check the official notification every cycle; dates move."}, {"name": "BITSAT", "typical_window": "May-June", "body": "BITS Pilani", "note": "Check the official notification every cycle; dates move."}, {"name": "State CETs (MHT-CET, KCET, etc.)", "typical_window": "April-May", "body": "State bodies", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Tech CSE', 'B.E. IT', 'BCA', 'B.Sc Computer Science']::text[], '{"tier1": ["IITs", "IIITs (Hyderabad, Bangalore, Delhi)", "BITS"], "tier2": ["NITs", "Top state universities"], "tier3": ["AICTE-approved private colleges"]}'::jsonb, '3-4 years', 'BCA/B.Sc followed by MCA; bootcamps plus open-source work for career switchers.', null),
  ('pg', null, '[{"name": "GATE", "typical_window": "February", "body": "IITs (rotating)", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Tech', 'MCA', 'MS abroad']::text[], '{"tier1": ["IITs", "IISc"], "tier2": ["NITs"], "tier3": ["State universities"]}'::jsonb, '2 years', null, 'Optional for most industry roles.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Civil Engineer', 'Engineering & Technology', 'RIC', array[0.9, 0.7, 0.2, 0.3, 0.4, 0.6]::numeric[],
    '{"numerical": "Average", "spatial": "High"}'::jsonb, '["D", "P"]'::jsonb, '["Security", "Achievement", "Helping others"]'::jsonb,
    'Plans, designs and supervises roads, bridges, buildings, water and urban infrastructure.',
    'Site visit to check progress and quality, coordination with contractors, reviewing drawings, and updating the project schedule.',
    '["B.Tech/B.E. Civil", "Diploma in Civil Engineering + lateral entry"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [3, 7], "mid": [8, 18], "senior": [20, 45], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'stable', 'low',
    array['Sustainable building consultant', 'Smart-city planner', 'BIM specialist']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'PCM', '[{"name": "JEE Main", "typical_window": "January and April sessions", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "State CETs", "typical_window": "April-May", "body": "State bodies", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Tech Civil', 'B.E. Civil']::text[], '{"tier1": ["IITs"], "tier2": ["NITs", "State government colleges"], "tier3": ["Private colleges"]}'::jsonb, '4 years', 'Polytechnic diploma after Class 10, then lateral entry into 2nd year B.Tech.', null),
  ('diploma', 'Class 10', '[{"name": "State polytechnic entrance", "typical_window": "May-June", "body": "State boards", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['Diploma in Civil Engineering']::text[], '{"tier1": ["Government polytechnics"], "tier2": ["Aided polytechnics"], "tier3": ["Private polytechnics"]}'::jsonb, '3 years', null, null),
  ('pg', null, '[{"name": "GATE", "typical_window": "February", "body": "IITs (rotating)", "note": "Check the official notification every cycle; dates move."}, {"name": "ESE (Engineering Services)", "typical_window": "Prelims around February", "body": "UPSC", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Tech Structural / Transportation / Environmental']::text[], '{"tier1": ["IITs"], "tier2": ["NITs"], "tier3": ["State universities"]}'::jsonb, '2 years', null, 'GATE also opens PSU jobs.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Data Scientist', 'Mathematics, Finance & Analytics', 'ICE', array[0.3, 0.9, 0.3, 0.2, 0.5, 0.7]::numeric[],
    '{"numerical": "High", "abstract": "High"}'::jsonb, '["D", "R"]'::jsonb, '["Learning", "Achievement", "Independence"]'::jsonb,
    'Finds patterns in data and builds models that help organisations predict and decide.',
    'Cleaning a messy dataset, testing a model, and explaining findings to a business team in plain language.',
    '["B.Tech/B.Sc with statistics or maths", "B.Stat / B.Math", "Economics + programming"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [5, 12], "mid": [15, 35], "senior": [40, 80], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'medium',
    array['ML engineer', 'Analytics translator', 'AI product analyst']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('class11_12', 'PCM or Commerce with Maths', '[]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '2 years', 'Maths is the key subject; keep it.', null),
  ('ug', 'Maths in Class 12', '[{"name": "ISI Admission Test", "typical_window": "May", "body": "Indian Statistical Institute", "note": "Check the official notification every cycle; dates move."}, {"name": "CMI Entrance", "typical_window": "May", "body": "Chennai Mathematical Institute", "note": "Check the official notification every cycle; dates move."}, {"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "JEE Main", "typical_window": "January and April", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Stat', 'B.Sc Statistics/Maths', 'B.Tech CSE/Data Science', 'BA Economics (Hons)']::text[], '{"tier1": ["ISI", "CMI", "IITs"], "tier2": ["Delhi University colleges", "NITs"], "tier3": ["State universities"]}'::jsonb, '3-4 years', null, null),
  ('pg', null, '[{"name": "IIT JAM", "typical_window": "February", "body": "IITs", "note": "Check the official notification every cycle; dates move."}, {"name": "GATE (DA paper)", "typical_window": "February", "body": "IITs", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Stat', 'M.Sc Data Science', 'M.Tech AI']::text[], '{"tier1": ["ISI", "IITs", "IISc"], "tier2": ["Central universities"], "tier3": ["Private universities"]}'::jsonb, '2 years', 'Certifications plus a strong project portfolio.', null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Chartered Accountant', 'Mathematics, Finance & Analytics', 'CEI', array[0.2, 0.6, 0.1, 0.3, 0.6, 0.9]::numeric[],
    '{"numerical": "High", "verbal": "Average"}'::jsonb, '["D", "P"]'::jsonb, '["Security", "Achievement", "Recognition"]'::jsonb,
    'Audits accounts, advises on tax and finance, and keeps organisations compliant.',
    'Reviewing a client''s books, preparing tax filings, and meeting a business owner about planning.',
    '["CA Foundation after Class 12", "Graduate route (direct entry to CA Intermediate)"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [6, 10], "mid": [12, 25], "senior": [30, 70], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'transforming', 'high',
    array['Forensic accountant', 'ESG reporting specialist', 'FP&A analyst']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('class11_12', 'Commerce (Maths preferred)', '[]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '2 years', 'Science students can also take the CA route.', null),
  ('certification', 'Class 12 any stream', '[{"name": "CA Foundation", "typical_window": "More than one sitting a year", "body": "ICAI", "note": "Check the official notification every cycle; dates move."}, {"name": "CA Intermediate", "typical_window": "More than one sitting a year", "body": "ICAI", "note": "Check the official notification every cycle; dates move."}, {"name": "CA Final", "typical_window": "More than one sitting a year", "body": "ICAI", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['CA']::text[], '{"tier1": ["ICAI (articleship at large firms)"], "tier2": ["Mid-size firms"], "tier3": ["Small practices"]}'::jsonb, '4.5-5 years incl. articleship', 'CMA (ICMAI) or CS (ICSI) are related professional routes.', null),
  ('ug', 'Commerce', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Com (Hons)']::text[], '{"tier1": ["SRCC and top DU colleges", "Christ, NMIMS"], "tier2": ["State universities"], "tier3": ["Private colleges"]}'::jsonb, '3 years', null, 'Many students pursue B.Com alongside CA.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Doctor (MBBS)', 'Medicine & Health', 'ISR', array[0.5, 0.9, 0.2, 0.8, 0.3, 0.4]::numeric[],
    '{"verbal": "High", "abstract": "Average", "numerical": "Average"}'::jsonb, '["D", "R"]'::jsonb, '["Helping others", "Achievement", "Security", "Recognition"]'::jsonb,
    'Diagnoses and treats illness, prevents disease, and cares for patients across their lives.',
    'Ward rounds, an outpatient clinic with dozens of patients, reviewing test results, and on-call duty.',
    '["NEET-UG → MBBS (5.5 years incl. internship)"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [8, 15], "mid": [15, 40], "senior": [40, 150], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['Telemedicine', 'Clinical informatics', 'Public-health specialist']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('class11_12', 'PCB', '[]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '2 years', 'PCMB keeps both medicine and engineering open.', null),
  ('ug', 'PCB', '[{"name": "NEET-UG", "typical_window": "May", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['MBBS', 'BDS', 'BAMS/BHMS (AYUSH)']::text[], '{"tier1": ["AIIMS", "JIPMER", "Top government medical colleges"], "tier2": ["State government medical colleges"], "tier3": ["Private and deemed medical colleges"]}'::jsonb, '5.5 years', 'MBBS abroad (check NMC rules and FMGE/NExT).', null),
  ('pg', null, '[{"name": "NEET-PG / NExT", "typical_window": "Annual; format in transition", "body": "NBEMS / NMC", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['MD', 'MS', 'DNB']::text[], '{"tier1": ["AIIMS", "PGIMER"], "tier2": ["State medical colleges"], "tier3": ["Private medical colleges"]}'::jsonb, '3 years', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Nurse', 'Medicine & Health', 'SIR', array[0.5, 0.6, 0.1, 0.9, 0.2, 0.5]::numeric[],
    '{"verbal": "Average"}'::jsonb, '["P", "A"]'::jsonb, '["Helping others", "Security", "Work-life balance"]'::jsonb,
    'Provides patient care, administers treatment, and supports patients and families.',
    'Handover, medication rounds, monitoring patients, updating records and reassuring families.',
    '["B.Sc Nursing", "GNM diploma"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [2.5, 5], "mid": [5, 10], "senior": [10, 25], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['Nurse practitioner', 'Critical-care nurse', 'International nursing']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'PCB', '[{"name": "NEET-UG (several states use it)", "typical_window": "May", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "AIIMS B.Sc Nursing / state nursing entrances", "typical_window": "June", "body": "AIIMS / states", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Sc Nursing']::text[], '{"tier1": ["AIIMS College of Nursing", "CMC Vellore"], "tier2": ["Government nursing colleges"], "tier3": ["Private nursing colleges"]}'::jsonb, '4 years', 'GNM diploma (3 years) and post-basic B.Sc.', null),
  ('pg', null, '[{"name": "NORCET", "typical_window": "Periodic", "body": "AIIMS", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Sc Nursing']::text[], '{"tier1": ["AIIMS"], "tier2": ["State colleges"], "tier3": ["Private colleges"]}'::jsonb, '2 years', null, 'NORCET is a recruitment exam for AIIMS nursing officers.'),
  ('global', null, '[{"name": "IELTS/OET and NCLEX or NMC (UK) tests", "typical_window": "Year-round", "body": "Various", "note": "Check the official notification every cycle; dates move."}]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '6-12 months', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Research Scientist', 'Pure Sciences & Research', 'IRA', array[0.5, 1.0, 0.5, 0.2, 0.1, 0.4]::numeric[],
    '{"abstract": "Very High", "numerical": "High"}'::jsonb, '["D", "P"]'::jsonb, '["Learning", "Independence", "Creativity"]'::jsonb,
    'Asks fundamental questions in physics, chemistry, biology or other sciences and answers them through experiments and theory.',
    'Running an experiment, reading new papers, analysing data, and discussing results with a lab group.',
    '["BS-MS at IISER/NISER", "B.Sc → M.Sc → PhD", "B.Tech → PhD"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [4, 8], "mid": [8, 18], "senior": [18, 40], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'stable', 'low',
    array['Computational scientist', 'Quantum technology', 'Biotech R&D']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'PCM or PCB', '[{"name": "IISER Aptitude Test", "typical_window": "June", "body": "IISERs", "note": "Check the official notification every cycle; dates move."}, {"name": "NEST", "typical_window": "June", "body": "NISER / CEBS", "note": "Check the official notification every cycle; dates move."}, {"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "INSPIRE-SHE scholarship (for top Class 12 scorers)", "typical_window": "Annual", "body": "DST", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BS-MS (dual)', 'B.Sc (Hons)']::text[], '{"tier1": ["IISc", "IISERs", "NISER"], "tier2": ["Central universities", "St. Stephen''s, St. Xavier''s"], "tier3": ["State universities"]}'::jsonb, '4-5 years', null, null),
  ('pg', null, '[{"name": "IIT JAM", "typical_window": "February", "body": "IITs", "note": "Check the official notification every cycle; dates move."}, {"name": "CSIR-NET / JEST / GATE", "typical_window": "Annual", "body": "Various", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Sc', 'Integrated PhD', 'PhD']::text[], '{"tier1": ["IISc", "TIFR", "IITs"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '2 + 4-6 years', 'PhD abroad with funding.', null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Environmental Scientist', 'Agriculture, Environment & Earth', 'IRS', array[0.7, 0.9, 0.2, 0.5, 0.3, 0.4]::numeric[],
    '{"numerical": "Average", "verbal": "Average"}'::jsonb, '["D", "P"]'::jsonb, '["Helping others", "Learning", "Variety"]'::jsonb,
    'Studies air, water, soil and climate, and advises on reducing environmental harm.',
    'Collecting field samples, running lab tests, modelling data, and writing an impact assessment.',
    '["B.Sc Environmental Science / Agriculture / Geology", "B.Tech Environmental"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [3, 6], "mid": [7, 15], "senior": [15, 35], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['Climate-risk analyst', 'ESG analyst', 'Carbon-markets specialist']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'PCB or PCM', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "ICAR AIEEA (via CUET)", "typical_window": "May-June", "body": "NTA/ICAR", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Sc Environmental Science', 'B.Sc Agriculture', 'B.Sc Geology']::text[], '{"tier1": ["IISERs", "Top agricultural universities"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '3-4 years', null, null),
  ('pg', null, '[{"name": "CUET-PG", "typical_window": "March", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "GATE (ES paper)", "typical_window": "February", "body": "IITs", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Sc Environmental Science', 'M.Tech Environmental', 'MA Sustainability']::text[], '{"tier1": ["TERI SAS", "IITs", "JNU"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '2 years', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Lawyer', 'Law & Governance', 'EIS', array[0.1, 0.7, 0.3, 0.6, 0.9, 0.5]::numeric[],
    '{"verbal": "High", "abstract": "Average"}'::jsonb, '["R", "A"]'::jsonb, '["Achievement", "Recognition", "Independence", "Helping others"]'::jsonb,
    'Advises clients, drafts contracts, and argues cases in courts and tribunals.',
    'Researching precedents, drafting a petition, a client call, and an afternoon hearing.',
    '["5-year integrated LLB after Class 12", "3-year LLB after graduation"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [4, 15], "mid": [12, 40], "senior": [40, 150], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'stable', 'medium',
    array['Tech and privacy law', 'Legal operations', 'Arbitration']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "CLAT", "typical_window": "December", "body": "Consortium of NLUs", "note": "Check the official notification every cycle; dates move."}, {"name": "AILET", "typical_window": "December", "body": "NLU Delhi", "note": "Check the official notification every cycle; dates move."}, {"name": "LSAT India / MH-CET Law", "typical_window": "January-May", "body": "Various", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BA LLB', 'BBA LLB', 'LLB (3-year)']::text[], '{"tier1": ["NLSIU, NLU Delhi, NALSAR"], "tier2": ["Other NLUs", "Symbiosis Law School"], "tier3": ["State law colleges"]}'::jsonb, '5 years (integrated) or 3 years', null, null),
  ('pg', null, '[{"name": "CLAT PG", "typical_window": "December", "body": "Consortium of NLUs", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['LLM']::text[], '{"tier1": ["NLUs"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '1 year', 'LLM abroad.', null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Civil Services Officer (IAS/IPS/IFS)', 'Public Service & Defence', 'ESI', array[0.2, 0.6, 0.2, 0.8, 0.9, 0.6]::numeric[],
    '{"verbal": "High", "abstract": "Average", "numerical": "Average"}'::jsonb, '["R", "D"]'::jsonb, '["Helping others", "Leadership", "Recognition", "Security"]'::jsonb,
    'Runs government administration, policing or diplomacy at district, state and national level.',
    'Reviewing district schemes, meeting citizens'' delegations, handling a law-and-order issue, and field inspections.',
    '["Any graduation → UPSC Civil Services Examination"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [10, 12], "mid": [15, 25], "senior": [25, 35], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'stable', 'low',
    array['Policy analyst', 'Public-sector tech roles']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['Any bachelor''s degree']::text[], '{"tier1": ["Top central universities"], "tier2": ["State universities"], "tier3": ["Distance learning"]}'::jsonb, '3-4 years', null, 'Choose a subject you enjoy; it can become your optional.'),
  ('certification', 'Graduate', '[{"name": "UPSC CSE Prelims", "typical_window": "May-June", "body": "UPSC", "note": "Check the official notification every cycle; dates move."}, {"name": "UPSC CSE Mains", "typical_window": "September", "body": "UPSC", "note": "Check the official notification every cycle; dates move."}, {"name": "State PSC exams", "typical_window": "Varies", "body": "State PSCs", "note": "Check the official notification every cycle; dates move."}]'::jsonb, '{}'::text[], '{"tier1": ["LBSNAA (training)"], "tier2": [], "tier3": []}'::jsonb, '1-3 years of preparation', 'State civil services through state PSCs.', null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Armed Forces Officer', 'Public Service & Defence', 'RES', array[0.9, 0.4, 0.1, 0.6, 0.8, 0.5]::numeric[],
    '{"numerical": "Average", "spatial": "Average", "verbal": "Average"}'::jsonb, '["R", "P"]'::jsonb, '["Leadership", "Security", "Recognition", "Achievement"]'::jsonb,
    'Leads teams in the Army, Navy or Air Force, in operations, engineering, medicine or logistics.',
    'Physical training, leading a unit''s drills, planning an exercise, and administrative duties.',
    '["NDA after Class 12", "CDS / AFCAT after graduation", "Technical entry schemes"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [10, 14], "mid": [15, 25], "senior": [25, 40], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'stable', 'low',
    array['Cyber and drone units', 'Defence technology']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('class11_12', 'PCM for Navy/Air Force wings at NDA', '[]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '2 years', 'Army wing of NDA accepts any stream.', null),
  ('ug', 'Class 12', '[{"name": "NDA & NA", "typical_window": "April and September", "body": "UPSC", "note": "Check the official notification every cycle; dates move."}, {"name": "SSB interview", "typical_window": "After written exam", "body": "Services Selection Boards", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Sc / B.Tech via NDA']::text[], '{"tier1": ["NDA Khadakwasla", "Indian Naval Academy"], "tier2": [], "tier3": []}'::jsonb, '3-4 years training', 'CDS, AFCAT, NCC special entry after graduation.', 'Physical and medical standards apply.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Entrepreneur / Startup Founder', 'Business, Management & Entrepreneurship', 'ECA', array[0.4, 0.5, 0.6, 0.5, 1.0, 0.4]::numeric[],
    '{"verbal": "Average", "numerical": "Average"}'::jsonb, '["R", "A"]'::jsonb, '["Independence", "Achievement", "Creativity", "Leadership"]'::jsonb,
    'Spots a problem, builds a product or service to solve it, and grows a team and business around it.',
    'Customer calls, a product review, hiring, investor follow-ups, and fixing whatever broke today.',
    '["Any degree + early work experience", "BBA / B.Tech + incubator", "Family business"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [0, 10], "mid": [5, 50], "senior": [10, 500], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['Social enterprise', 'D2C brands', 'Climate-tech ventures']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "IPMAT", "typical_window": "May", "body": "IIM Indore / Rohtak", "note": "Check the official notification every cycle; dates move."}, {"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "NPAT / SET", "typical_window": "January-May", "body": "NMIMS / Symbiosis", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BBA', 'IPM', 'B.Tech', 'B.Des']::text[], '{"tier1": ["IIM IPM programmes", "IITs"], "tier2": ["NMIMS, Symbiosis, Christ"], "tier3": ["State universities"]}'::jsonb, '3-5 years', 'Build while studying; college incubators and hackathons.', null),
  ('pg', null, '[{"name": "CAT", "typical_window": "November", "body": "IIMs", "note": "Check the official notification every cycle; dates move."}, {"name": "GMAT", "typical_window": "Year-round", "body": "GMAC", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['MBA / PGDM']::text[], '{"tier1": ["IIMs A/B/C, ISB"], "tier2": ["Newer IIMs, XLRI"], "tier3": ["Other AICTE B-schools"]}'::jsonb, '1-2 years', null, 'Optional; many founders skip it.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Digital Marketing Manager', 'Sales, Marketing & Media', 'EAS', array[0.1, 0.4, 0.7, 0.5, 0.9, 0.5]::numeric[],
    '{"verbal": "High", "numerical": "Average"}'::jsonb, '["A", "R"]'::jsonb, '["Creativity", "Variety", "Recognition", "Achievement"]'::jsonb,
    'Plans campaigns across search, social and content, and measures what grows a brand.',
    'Reviewing campaign dashboards, briefing designers, testing ad copy, and presenting results.',
    '["BBA / BMS / BA Mass Communication", "Any degree + certifications + portfolio"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [3, 6], "mid": [8, 20], "senior": [20, 50], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'transforming', 'high',
    array['Growth marketer', 'Marketing-automation specialist', 'Creator-economy manager']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "IPMAT / NPAT", "typical_window": "May", "body": "IIMs / NMIMS", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BBA', 'BMS', 'BA Journalism & Mass Communication']::text[], '{"tier1": ["IIMC (PG diploma)", "Top DU colleges", "MICA (PG)"], "tier2": ["Symbiosis, Christ"], "tier3": ["Private colleges"]}'::jsonb, '3 years', 'Google/Meta certifications with a live portfolio.', null),
  ('pg', null, '[{"name": "CAT / MICAT", "typical_window": "November-January", "body": "IIMs / MICA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['MBA Marketing', 'PGDM Communications']::text[], '{"tier1": ["IIMs", "MICA"], "tier2": ["Tier-2 B-schools"], "tier3": ["Others"]}'::jsonb, '2 years', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('UX / Product Designer', 'Arts, Design & Performance', 'AIE', array[0.3, 0.7, 1.0, 0.5, 0.5, 0.3]::numeric[],
    '{"spatial": "High", "abstract": "Average"}'::jsonb, '["A", "D"]'::jsonb, '["Creativity", "Helping others", "Learning", "Variety"]'::jsonb,
    'Designs how apps, websites and services look and work so they are useful and easy to use.',
    'User interviews, sketching flows, building a prototype in Figma, and reviewing it with engineers.',
    '["B.Des (Interaction / Communication)", "Any degree + design portfolio"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [4, 10], "mid": [12, 30], "senior": [30, 70], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'medium',
    array['Service designer', 'AI interaction designer', 'Design researcher']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "UCEED", "typical_window": "January", "body": "IIT Bombay", "note": "Check the official notification every cycle; dates move."}, {"name": "NID DAT", "typical_window": "December-January", "body": "NID", "note": "Check the official notification every cycle; dates move."}, {"name": "NIFT entrance", "typical_window": "February", "body": "NTA/NIFT", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Des']::text[], '{"tier1": ["IIT Bombay IDC, NID Ahmedabad"], "tier2": ["NIFT, Srishti, MIT ID"], "tier3": ["Private design schools"]}'::jsonb, '4 years', 'Self-taught with a strong portfolio and internships.', null),
  ('pg', null, '[{"name": "CEED", "typical_window": "January", "body": "IIT Bombay", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['M.Des']::text[], '{"tier1": ["IITs (IDC, IIT Delhi, IIT Hyderabad)", "IISc DM"], "tier2": ["NID PG"], "tier3": ["Private schools"]}'::jsonb, '2 years', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Journalist / Content Writer', 'Writing, Communication & Languages', 'AES', array[0.1, 0.6, 0.9, 0.6, 0.7, 0.3]::numeric[],
    '{"verbal": "High"}'::jsonb, '["A", "R"]'::jsonb, '["Creativity", "Variety", "Independence", "Helping others"]'::jsonb,
    'Researches, reports and writes stories, scripts and explainers for print, digital, audio and video.',
    'Pitching a story, interviews and fact-checking, writing to deadline, and editing with a desk.',
    '["BA English / Journalism / Political Science", "PG diploma in journalism"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [3, 5], "mid": [6, 15], "senior": [15, 40], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'transforming', 'high',
    array['Data journalist', 'Podcast producer', 'Fact-checker']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream (Humanities fits well)', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BA Journalism & Mass Communication', 'BA English (Hons)']::text[], '{"tier1": ["Top DU colleges", "Symbiosis SIMC"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '3 years', 'Freelancing, campus media and newsletters.', null),
  ('pg', null, '[{"name": "IIMC entrance (via CUET-PG)", "typical_window": "March", "body": "NTA / IIMC", "note": "Check the official notification every cycle; dates move."}, {"name": "ACJ entrance", "typical_window": "Varies", "body": "Asian College of Journalism", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['PG Diploma in Journalism']::text[], '{"tier1": ["IIMC", "ACJ Chennai"], "tier2": ["University departments"], "tier3": ["Private institutes"]}'::jsonb, '1 year', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('School Teacher', 'Education & Counselling', 'SAE', array[0.2, 0.5, 0.6, 1.0, 0.5, 0.4]::numeric[],
    '{"verbal": "Average"}'::jsonb, '["A", "P"]'::jsonb, '["Helping others", "Security", "Learning", "Work-life balance"]'::jsonb,
    'Teaches and mentors students, plans lessons, and supports each child''s growth.',
    'Five or six classes, a doubt-clearing session, correcting notebooks, and a parent call.',
    '["Graduation + B.Ed", "Integrated B.A./B.Sc B.Ed (ITEP)"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [2.5, 5], "mid": [5, 10], "senior": [10, 20], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'stable', 'low',
    array['EdTech content creator', 'Special educator', 'Learning designer']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "NCET (for ITEP)", "typical_window": "June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.A./B.Sc B.Ed (ITEP)', 'B.A./B.Sc + B.Ed']::text[], '{"tier1": ["RIEs (NCERT)", "Central universities"], "tier2": ["State universities"], "tier3": ["Private B.Ed colleges"]}'::jsonb, '4 years', null, null),
  ('certification', null, '[{"name": "CTET", "typical_window": "Typically twice a year", "body": "CBSE", "note": "Check the official notification every cycle; dates move."}, {"name": "State TETs", "typical_window": "Varies", "body": "States", "note": "Check the official notification every cycle; dates move."}]'::jsonb, '{}'::text[], '{"tier1": [], "tier2": [], "tier3": []}'::jsonb, '-', null, 'Needed for most government school posts.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Psychologist / Counsellor', 'Education & Counselling', 'SIA', array[0.1, 0.8, 0.5, 1.0, 0.3, 0.3]::numeric[],
    '{"verbal": "High"}'::jsonb, '["P", "A"]'::jsonb, '["Helping others", "Learning", "Independence"]'::jsonb,
    'Helps people understand themselves and cope with challenges, through assessment and talking therapies.',
    'Three or four client sessions, writing notes, supervision, and reading new research.',
    '["BA/B.Sc Psychology → MA/M.Sc → M.Phil Clinical (RCI) or counselling diploma"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [3, 6], "mid": [6, 15], "senior": [15, 40], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['School counsellor', 'Organisational psychologist', 'Digital mental-health']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream (Psychology elective helps)', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BA/B.Sc Psychology (Hons)']::text[], '{"tier1": ["Top DU colleges", "Christ, St. Xavier''s"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '3-4 years', null, null),
  ('pg', null, '[{"name": "CUET-PG", "typical_window": "March", "body": "NTA", "note": "Check the official notification every cycle; dates move."}, {"name": "RCI-recognised M.Phil/PsyD entrances", "typical_window": "Varies", "body": "NIMHANS and others", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['MA/M.Sc Psychology', 'M.Phil Clinical Psychology']::text[], '{"tier1": ["NIMHANS", "TISS"], "tier2": ["Central universities"], "tier3": ["Private universities"]}'::jsonb, '2-4 years', null, 'Clinical practice needs RCI registration.')
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Development Sector Professional', 'Social Work & Spirituality', 'SEA', array[0.2, 0.5, 0.5, 1.0, 0.7, 0.3]::numeric[],
    '{"verbal": "Average"}'::jsonb, '["A", "R"]'::jsonb, '["Helping others", "Variety", "Leadership"]'::jsonb,
    'Designs and runs programmes in health, education, livelihoods or rights with NGOs, foundations and CSR teams.',
    'Field visit to a programme site, a community meeting, monitoring data, and a donor report.',
    '["BA Social Work / Sociology", "MSW / MA Development Studies"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [3, 5], "mid": [6, 15], "senior": [15, 35], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['CSR manager', 'Impact evaluator', 'Climate-adaptation programmes']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "CUET-UG", "typical_window": "May-June", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['BSW', 'BA Sociology / Economics']::text[], '{"tier1": ["TISS (BA)", "Top DU colleges"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '3 years', 'Fellowships (e.g. Teach For India, Gandhi Fellowship).', null),
  ('pg', null, '[{"name": "TISS-NET / CUET-PG", "typical_window": "Early in the year", "body": "TISS / NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['MSW', 'MA Development Studies', 'MPP']::text[], '{"tier1": ["TISS", "Azim Premji University"], "tier2": ["Central universities"], "tier3": ["State universities"]}'::jsonb, '2 years', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('Hospitality Manager', 'Hospitality, Travel & Service', 'ESC', array[0.4, 0.2, 0.4, 0.8, 0.9, 0.6]::numeric[],
    '{"verbal": "Average"}'::jsonb, '["A", "P"]'::jsonb, '["Variety", "Helping others", "Achievement"]'::jsonb,
    'Runs hotels, restaurants, resorts and events so guests get a great experience.',
    'Morning briefing, handling a VIP arrival, checking kitchen and housekeeping, and resolving a guest complaint.',
    '["B.Sc Hospitality & Hotel Administration", "BBA Hospitality / Tourism"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [2.5, 5], "mid": [6, 15], "senior": [15, 40], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'medium',
    array['Experience designer', 'Wellness tourism', 'Revenue manager']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('ug', 'Any stream', '[{"name": "NCHM JEE", "typical_window": "April-May", "body": "NTA", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['B.Sc HHA', 'BBA Hospitality']::text[], '{"tier1": ["IHM Pusa, IHM Mumbai", "WGSHA Manipal"], "tier2": ["Other IHMs"], "tier3": ["Private hotel schools"]}'::jsonb, '3-4 years', 'Hotel management diplomas and on-the-job progression.', null),
  ('global', null, '[]'::jsonb, array['Swiss/International hospitality programmes']::text[], '{"tier1": ["EHL, Les Roches"], "tier2": [], "tier3": []}'::jsonb, '1-4 years', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

with c as (
  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,
    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)
  values ('EV & Solar Technician', 'Skilled Trades & Crafts', 'RCI', array[1.0, 0.5, 0.1, 0.2, 0.3, 0.6]::numeric[],
    '{"spatial": "Average", "numerical": "Average"}'::jsonb, '["P", "D"]'::jsonb, '["Security", "Independence", "Achievement"]'::jsonb,
    'Installs, maintains and repairs electric vehicles, chargers and solar systems.',
    'Diagnosing a battery fault, installing rooftop panels, safety checks, and updating service logs.',
    '["ITI Electrician / Electronics", "Diploma in Electrical", "Skill India (NSDC) courses"]'::jsonb, '{"currency": "INR", "unit": "lakh per annum", "entry": [1.8, 3.5], "mid": [4, 8], "senior": [8, 15], "note": "Indicative metro ranges; varies widely by city and employer."}'::jsonb, 'growing', 'low',
    array['Battery recycling', 'Charging-network operations', 'Own service business']::text[], '{"content": [{"name": "SwadharmaPath seed content", "status": "seed - verify before launch"}], "outlook": [{"name": "WEF Future of Jobs Report 2025", "url": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/", "status": "seed - verify mapping"}, {"name": "India Skills Report", "url": "https://wheebox.com/india-skills-report.htm", "status": "seed - verify mapping"}]}'::jsonb, null)
  returning id)
insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
select c.id, v.* from c, (values
  ('diploma', 'Class 10', '[{"name": "ITI / polytechnic admissions", "typical_window": "May-July", "body": "State DTEs", "note": "Check the official notification every cycle; dates move."}]'::jsonb, array['ITI Electrician', 'Diploma in Electrical / EEE']::text[], '{"tier1": ["Government ITIs and polytechnics"], "tier2": ["Aided institutes"], "tier3": ["Private ITIs"]}'::jsonb, '2-3 years', 'Apprenticeships under NAPS.', null),
  ('certification', null, '[]'::jsonb, array['NSDC / Skill Council certifications (e.g. Suryamitra)']::text[], '{"tier1": ["NISE (Suryamitra)"], "tier2": ["Sector skill councils"], "tier3": ["Training partners"]}'::jsonb, '3-6 months', null, null)
) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);

-- CBSE stream options (8)
insert into public.stream_options (name, board, subjects, keeps_open_families, closes_families, notes) values
  ('Science - PCM', 'CBSE', array['English', 'Physics', 'Chemistry', 'Mathematics', 'Elective: Computer Science / Physical Education / Economics']::text[], array['Engineering & Technology', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics', 'Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Agriculture, Environment & Earth', 'Hospitality, Travel & Service', 'Skilled Trades & Crafts']::text[], array['Medicine & Health']::text[], 'Biology-based medicine (MBBS, nursing) needs Biology in Class 12.'),
  ('Science - PCB', 'CBSE', array['English', 'Physics', 'Chemistry', 'Biology', 'Elective: Psychology / Physical Education / Mathematics']::text[], array['Medicine & Health', 'Pure Sciences & Research', 'Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Agriculture, Environment & Earth', 'Hospitality, Travel & Service']::text[], array['Engineering & Technology', 'Mathematics, Finance & Analytics']::text[], 'Taking Mathematics as the fifth subject reopens engineering and analytics.'),
  ('Science - PCMB', 'CBSE', array['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology']::text[], array['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics', 'Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Agriculture, Environment & Earth', 'Hospitality, Travel & Service', 'Skilled Trades & Crafts']::text[], '{}'::text[], 'The widest combination: keeps medicine and engineering both open. Heavier workload.'),
  ('Commerce with Mathematics', 'CBSE', array['English', 'Accountancy', 'Business Studies', 'Economics', 'Mathematics']::text[], array['Mathematics, Finance & Analytics', 'Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Hospitality, Travel & Service']::text[], array['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research']::text[], 'Maths keeps data, economics and finance degrees open.'),
  ('Commerce without Mathematics', 'CBSE', array['English', 'Accountancy', 'Business Studies', 'Economics', 'Elective: Informatics Practices / Entrepreneurship / Physical Education']::text[], array['Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Hospitality, Travel & Service']::text[], array['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics']::text[], 'Some economics and statistics degrees need Class 12 Maths.'),
  ('Humanities', 'CBSE', array['English', 'History', 'Political Science', 'Geography or Sociology', 'Elective: Psychology / Economics / Fine Arts']::text[], array['Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Agriculture, Environment & Earth', 'Hospitality, Travel & Service']::text[], array['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics']::text[], 'Strong route to law, civil services, psychology, design and media.'),
  ('Humanities with Mathematics', 'CBSE', array['English', 'Economics', 'Mathematics', 'Political Science', 'Elective: Psychology / Geography']::text[], array['Mathematics, Finance & Analytics', 'Law & Governance', 'Public Service & Defence', 'Business, Management & Entrepreneurship', 'Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Agriculture, Environment & Earth', 'Hospitality, Travel & Service']::text[], array['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research']::text[], 'Adds economics (Hons), statistics and analytics to the Humanities options.'),
  ('Arts, Design & Vocational', 'CBSE', array['English', 'Painting / Graphics / Applied Art', 'Skill subject (e.g. Design, IT, Tourism, Electronics)', 'Two of: History, Psychology, Business Studies']::text[], array['Sales, Marketing & Media', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Hospitality, Travel & Service', 'Skilled Trades & Crafts']::text[], array['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics', 'Public Service & Defence']::text[], 'Hands-on route. Design entrances (NID, NIFT, UCEED) accept any stream.');

-- Instruments: one junior and one standard version each (placeholder items)
insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('interest', 'What I like doing', '0.1-placeholder', 'junior',
   '{"sections": [{"code": "main", "name": "Activities", "time_limit_sec": null, "items": [{"id": "int_R1", "type": "likert5", "prompt": "Fix a bicycle or a broken toy", "scale": "R", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_I1", "type": "likert5", "prompt": "Find out how a rocket flies", "scale": "I", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_A1", "type": "likert5", "prompt": "Draw, paint or make a comic", "scale": "A", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_S1", "type": "likert5", "prompt": "Help a classmate with homework", "scale": "S", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_E1", "type": "likert5", "prompt": "Be the captain of a team", "scale": "E", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_C1", "type": "likert5", "prompt": "Arrange your books and notes neatly", "scale": "C", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_R2", "type": "likert5", "prompt": "Build a model with your hands", "scale": "R", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_I2", "type": "likert5", "prompt": "Do a science experiment", "scale": "I", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_A2", "type": "likert5", "prompt": "Make up a story or song", "scale": "A", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_S2", "type": "likert5", "prompt": "Look after a younger child", "scale": "S", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_E2", "type": "likert5", "prompt": "Sell things at a school fair", "scale": "E", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_C2", "type": "likert5", "prompt": "Keep score in a match", "scale": "C", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_R3", "type": "likert5", "prompt": "Grow plants in a garden", "scale": "R", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_I3", "type": "likert5", "prompt": "Solve a tricky riddle", "scale": "I", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_A3", "type": "likert5", "prompt": "Act in a school play", "scale": "A", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_S3", "type": "likert5", "prompt": "Raise money for a good cause", "scale": "S", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_E3", "type": "likert5", "prompt": "Give a speech in assembly", "scale": "E", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "int_C3", "type": "likert5", "prompt": "Make a timetable and stick to it", "scale": "C", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}]}]}'::jsonb,
   '{"method": "riasec", "scales": ["R", "I", "A", "S", "E", "C"], "min": 1, "max": 5}'::jsonb,
   '{"13-15": {"R": {"mean": 9.0, "sd": 2.4}, "I": {"mean": 9.0, "sd": 2.4}, "A": {"mean": 9.0, "sd": 2.4}, "S": {"mean": 9.0, "sd": 2.4}, "E": {"mean": 9.0, "sd": 2.4}, "C": {"mean": 9.0, "sd": 2.4}}, "16-18": {"R": {"mean": 9.0, "sd": 2.4}, "I": {"mean": 9.0, "sd": 2.4}, "A": {"mean": 9.0, "sd": 2.4}, "S": {"mean": 9.0, "sd": 2.4}, "E": {"mean": 9.0, "sd": 2.4}, "C": {"mean": 9.0, "sd": 2.4}}, "19-22": {"R": {"mean": 9.0, "sd": 2.4}, "I": {"mean": 9.0, "sd": 2.4}, "A": {"mean": 9.0, "sd": 2.4}, "S": {"mean": 9.0, "sd": 2.4}, "E": {"mean": 9.0, "sd": 2.4}, "C": {"mean": 9.0, "sd": 2.4}}, "23+": {"R": {"mean": 9.0, "sd": 2.4}, "I": {"mean": 9.0, "sd": 2.4}, "A": {"mean": 9.0, "sd": 2.4}, "S": {"mean": 9.0, "sd": 2.4}, "E": {"mean": 9.0, "sd": 2.4}, "C": {"mean": 9.0, "sd": 2.4}}}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('aptitude', 'Brain games', '0.1-placeholder', 'junior',
   '{"sections": [{"code": "numerical", "name": "Numbers", "time_limit_sec": 240, "items": [{"id": "apt_num1", "type": "mcq", "prompt": "A pencil costs ₹6. How much do 7 pencils cost?", "scale": "numerical", "key": 1, "options": [{"value": 0, "label": "₹36"}, {"value": 1, "label": "₹42"}, {"value": 2, "label": "₹48"}, {"value": 3, "label": "₹13"}]}, {"id": "apt_num2", "type": "mcq", "prompt": "What is half of 3 quarters?", "scale": "numerical", "key": 0, "options": [{"value": 0, "label": "3/8"}, {"value": 1, "label": "1/2"}, {"value": 2, "label": "3/4"}, {"value": 3, "label": "1/4"}]}, {"id": "apt_num3", "type": "mcq", "prompt": "Riya has ₹100 and spends ₹35. How much is left?", "scale": "numerical", "key": 1, "options": [{"value": 0, "label": "₹55"}, {"value": 1, "label": "₹65"}, {"value": 2, "label": "₹75"}, {"value": 3, "label": "₹45"}]}]}, {"code": "verbal", "name": "Words", "time_limit_sec": 240, "items": [{"id": "apt_ver1", "type": "mcq", "prompt": "HAPPY means nearly the same as …", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Sad"}, {"value": 1, "label": "Glad"}, {"value": 2, "label": "Angry"}, {"value": 3, "label": "Tired"}]}, {"id": "apt_ver2", "type": "mcq", "prompt": "BIRD is to NEST as BEE is to …", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Honey"}, {"value": 1, "label": "Hive"}, {"value": 2, "label": "Flower"}, {"value": 3, "label": "Wing"}]}, {"id": "apt_ver3", "type": "mcq", "prompt": "Which word is spelled correctly?", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Recieve"}, {"value": 1, "label": "Receive"}, {"value": 2, "label": "Receeve"}, {"value": 3, "label": "Riceive"}]}]}, {"code": "abstract", "name": "Patterns", "time_limit_sec": 240, "items": [{"id": "apt_abs1", "type": "mcq", "prompt": "What comes next: 1, 4, 9, 16, …", "scale": "abstract", "key": 2, "options": [{"value": 0, "label": "20"}, {"value": 1, "label": "24"}, {"value": 2, "label": "25"}, {"value": 3, "label": "32"}]}, {"id": "apt_abs2", "type": "mcq", "prompt": "What comes next: Z, X, V, T, …", "scale": "abstract", "key": 1, "options": [{"value": 0, "label": "S"}, {"value": 1, "label": "R"}, {"value": 2, "label": "Q"}, {"value": 3, "label": "P"}]}, {"id": "apt_abs3", "type": "mcq", "prompt": "Which one does not belong: circle, square, triangle, cube", "scale": "abstract", "key": 3, "options": [{"value": 0, "label": "circle"}, {"value": 1, "label": "square"}, {"value": 2, "label": "triangle"}, {"value": 3, "label": "cube"}]}]}, {"code": "spatial", "name": "Shapes and space", "time_limit_sec": 240, "items": [{"id": "apt_spa1", "type": "mcq", "prompt": "How many corners does a cube have?", "scale": "spatial", "key": 1, "options": [{"value": 0, "label": "6"}, {"value": 1, "label": "8"}, {"value": 2, "label": "10"}, {"value": 3, "label": "12"}]}, {"id": "apt_spa2", "type": "mcq", "prompt": "If you turn a ''b'' upside down (rotate 180°), what letter do you see?", "scale": "spatial", "key": 2, "options": [{"value": 0, "label": "d"}, {"value": 1, "label": "p"}, {"value": 2, "label": "q"}, {"value": 3, "label": "b"}]}, {"id": "apt_spa3", "type": "mcq", "prompt": "You face east and turn left. Which way are you facing?", "scale": "spatial", "key": 0, "options": [{"value": 0, "label": "North"}, {"value": 1, "label": "South"}, {"value": 2, "label": "West"}, {"value": 3, "label": "East"}]}]}]}'::jsonb,
   '{"method": "aptitude", "subtests": ["numerical", "verbal", "abstract", "spatial"], "bands": [[0, 25, "Low"], [25, 75, "Average"], [75, 90, "High"], [90, 101, "Very High"]]}'::jsonb,
   '{"13-15": {"numerical": {"mean": 1.65, "sd": 0.66}, "verbal": {"mean": 1.65, "sd": 0.66}, "abstract": {"mean": 1.65, "sd": 0.66}, "spatial": {"mean": 1.65, "sd": 0.66}}, "16-18": {"numerical": {"mean": 1.65, "sd": 0.66}, "verbal": {"mean": 1.65, "sd": 0.66}, "abstract": {"mean": 1.65, "sd": 0.66}, "spatial": {"mean": 1.65, "sd": 0.66}}, "19-22": {"numerical": {"mean": 1.65, "sd": 0.66}, "verbal": {"mean": 1.65, "sd": 0.66}, "abstract": {"mean": 1.65, "sd": 0.66}, "spatial": {"mean": 1.65, "sd": 0.66}}, "23+": {"numerical": {"mean": 1.65, "sd": 0.66}, "verbal": {"mean": 1.65, "sd": 0.66}, "abstract": {"mean": 1.65, "sd": 0.66}, "spatial": {"mean": 1.65, "sd": 0.66}}}'::jsonb, 16, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('workstyle', 'How I like to work', '0.1-placeholder', 'junior',
   '{"sections": [{"code": "main", "name": "Most and least like me", "time_limit_sec": null, "items": [{"id": "ws_1", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I like to win", "factor": "R"}, {"value": "b", "label": "I love chatting with friends", "factor": "A"}, {"value": "c", "label": "I stay calm", "factor": "P"}, {"value": "d", "label": "I like things neat", "factor": "D"}]}, {"id": "ws_2", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I say what I think", "factor": "R"}, {"value": "b", "label": "I cheer people up", "factor": "A"}, {"value": "c", "label": "I''m a loyal friend", "factor": "P"}, {"value": "d", "label": "I check my work", "factor": "D"}]}, {"id": "ws_3", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I like to be the leader", "factor": "R"}, {"value": "b", "label": "I''m full of energy", "factor": "A"}, {"value": "c", "label": "I go with the flow", "factor": "P"}, {"value": "d", "label": "I follow instructions", "factor": "D"}]}, {"id": "ws_4", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I''m brave", "factor": "R"}, {"value": "b", "label": "I''m fun", "factor": "A"}, {"value": "c", "label": "I''m patient", "factor": "P"}, {"value": "d", "label": "I''m careful", "factor": "D"}]}, {"id": "ws_5", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I decide fast", "factor": "R"}, {"value": "b", "label": "I get people excited", "factor": "A"}, {"value": "c", "label": "People can count on me", "factor": "P"}, {"value": "d", "label": "I think things through", "factor": "D"}]}, {"id": "ws_6", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I do things my way", "factor": "R"}, {"value": "b", "label": "I make friends easily", "factor": "A"}, {"value": "c", "label": "I like routines", "factor": "P"}, {"value": "d", "label": "I like getting it exactly right", "factor": "D"}]}, {"id": "ws_7", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I push hard", "factor": "R"}, {"value": "b", "label": "I make people laugh", "factor": "A"}, {"value": "c", "label": "I help others", "factor": "P"}, {"value": "d", "label": "I keep things organised", "factor": "D"}]}, {"id": "ws_8", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "I like challenges", "factor": "R"}, {"value": "b", "label": "I like parties", "factor": "A"}, {"value": "c", "label": "I like quiet time", "factor": "P"}, {"value": "d", "label": "I like rules that make sense", "factor": "D"}]}]}]}'::jsonb,
   '{"method": "workstyle", "factors": ["R", "A", "P", "D"], "graphs": ["others", "self"], "range": 19}'::jsonb,
   '{}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('school_values', 'What matters to me', '0.1-placeholder', 'junior',
   '{"sections": [{"code": "main", "name": "Choose one", "time_limit_sec": null, "items": [{"id": "sv_1", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being kind", "value_name": "Being kind"}, {"value": "b", "label": "Winning", "value_name": "Winning"}]}, {"id": "sv_2", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being kind", "value_name": "Being kind"}, {"value": "b", "label": "Making my family proud", "value_name": "Making my family proud"}]}, {"id": "sv_3", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being creative", "value_name": "Being creative"}, {"value": "b", "label": "Winning", "value_name": "Winning"}]}, {"id": "sv_4", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being creative", "value_name": "Being creative"}, {"value": "b", "label": "Making my family proud", "value_name": "Making my family proud"}]}, {"id": "sv_5", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Winning", "value_name": "Winning"}, {"value": "b", "label": "Making my family proud", "value_name": "Making my family proud"}]}, {"id": "sv_6", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Learning new things", "value_name": "Learning new things"}, {"value": "b", "label": "Making my family proud", "value_name": "Making my family proud"}]}, {"id": "sv_7", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being kind", "value_name": "Being kind"}, {"value": "b", "label": "Learning new things", "value_name": "Learning new things"}]}, {"id": "sv_8", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being kind", "value_name": "Being kind"}, {"value": "b", "label": "Having freedom", "value_name": "Having freedom"}]}, {"id": "sv_9", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being creative", "value_name": "Being creative"}, {"value": "b", "label": "Learning new things", "value_name": "Learning new things"}]}, {"id": "sv_10", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Being creative", "value_name": "Being creative"}, {"value": "b", "label": "Having freedom", "value_name": "Having freedom"}]}, {"id": "sv_11", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Winning", "value_name": "Winning"}, {"value": "b", "label": "Having freedom", "value_name": "Having freedom"}]}, {"id": "sv_12", "type": "pair", "prompt": "Which is more important to you?", "options": [{"value": "a", "label": "Learning new things", "value_name": "Learning new things"}, {"value": "b", "label": "Having freedom", "value_name": "Having freedom"}]}]}]}'::jsonb,
   '{"method": "values", "values": ["Being kind", "Being creative", "Winning", "Learning new things", "Making my family proud", "Having freedom"], "top": 5}'::jsonb,
   '{}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('learning', 'How I learn', '0.1-placeholder', 'junior',
   '{"sections": [{"code": "main", "name": "Learning", "time_limit_sec": null, "items": [{"id": "lrn_vis1", "type": "likert5", "prompt": "Pictures help me learn", "scale": "visual", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_aud1", "type": "likert5", "prompt": "I learn when someone explains out loud", "scale": "auditory", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_rea1", "type": "likert5", "prompt": "I like reading on my own", "scale": "reading", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_kin1", "type": "likert5", "prompt": "I learn by trying things", "scale": "kinesthetic", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_vis2", "type": "likert5", "prompt": "I like drawing mind-maps", "scale": "visual", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_aud2", "type": "likert5", "prompt": "I remember songs easily", "scale": "auditory", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_rea2", "type": "likert5", "prompt": "Writing things down helps me", "scale": "reading", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_kin2", "type": "likert5", "prompt": "I can''t sit still for long", "scale": "kinesthetic", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_vis3", "type": "likert5", "prompt": "I remember what I see", "scale": "visual", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_aud3", "type": "likert5", "prompt": "I like talking about what I learned", "scale": "auditory", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_rea3", "type": "likert5", "prompt": "I like lists", "scale": "reading", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}, {"id": "lrn_kin3", "type": "likert5", "prompt": "I like building models", "scale": "kinesthetic", "options": [{"value": 1, "label": "Not like me at all"}, {"value": 2, "label": "A little not like me"}, {"value": 3, "label": "In between"}, {"value": 4, "label": "A bit like me"}, {"value": 5, "label": "Very much like me"}]}]}]}'::jsonb,
   '{"method": "likert_scales", "scales": ["visual", "auditory", "reading", "kinesthetic"]}'::jsonb,
   '{"13-15": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}, "16-18": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}, "19-22": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}, "23+": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('interest', 'Interests', '0.1-placeholder', 'standard',
   '{"sections": [{"code": "main", "name": "Activities", "time_limit_sec": null, "items": [{"id": "int_R1", "type": "likert5", "prompt": "Repair a machine or gadget that has stopped working", "scale": "R", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_I1", "type": "likert5", "prompt": "Work out why an experiment gave an unexpected result", "scale": "I", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_A1", "type": "likert5", "prompt": "Design a poster, logo or app screen", "scale": "A", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_S1", "type": "likert5", "prompt": "Teach a friend something they find difficult", "scale": "S", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_E1", "type": "likert5", "prompt": "Convince people to support an idea", "scale": "E", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_C1", "type": "likert5", "prompt": "Keep records organised and accurate", "scale": "C", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_R2", "type": "likert5", "prompt": "Build something with tools in a workshop", "scale": "R", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_I2", "type": "likert5", "prompt": "Read about new discoveries in science", "scale": "I", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_A2", "type": "likert5", "prompt": "Write a story, poem or script", "scale": "A", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_S2", "type": "likert5", "prompt": "Help someone through a personal problem", "scale": "S", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_E2", "type": "likert5", "prompt": "Start and run a small business", "scale": "E", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_C2", "type": "likert5", "prompt": "Plan a budget and track spending", "scale": "C", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_R3", "type": "likert5", "prompt": "Work outdoors on a construction or farm project", "scale": "R", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_I3", "type": "likert5", "prompt": "Solve a hard puzzle or maths problem", "scale": "I", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_A3", "type": "likert5", "prompt": "Perform music, dance or drama", "scale": "A", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_S3", "type": "likert5", "prompt": "Volunteer for a community cause", "scale": "S", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_E3", "type": "likert5", "prompt": "Lead a team towards a target", "scale": "E", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_C3", "type": "likert5", "prompt": "Check a document carefully for errors", "scale": "C", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_R4", "type": "likert5", "prompt": "Operate equipment or drive specialised vehicles", "scale": "R", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_I4", "type": "likert5", "prompt": "Analyse data to find a hidden pattern", "scale": "I", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_A4", "type": "likert5", "prompt": "Photograph or film something in an original way", "scale": "A", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_S4", "type": "likert5", "prompt": "Care for people who are unwell", "scale": "S", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_E4", "type": "likert5", "prompt": "Negotiate a deal", "scale": "E", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}, {"id": "int_C4", "type": "likert5", "prompt": "Follow a clear process to get a task done", "scale": "C", "options": [{"value": 1, "label": "Strongly dislike"}, {"value": 2, "label": "Dislike"}, {"value": 3, "label": "Not sure"}, {"value": 4, "label": "Like"}, {"value": 5, "label": "Strongly like"}]}]}]}'::jsonb,
   '{"method": "riasec", "scales": ["R", "I", "A", "S", "E", "C"], "min": 1, "max": 5}'::jsonb,
   '{"13-15": {"R": {"mean": 12.0, "sd": 3.2}, "I": {"mean": 12.0, "sd": 3.2}, "A": {"mean": 12.0, "sd": 3.2}, "S": {"mean": 12.0, "sd": 3.2}, "E": {"mean": 12.0, "sd": 3.2}, "C": {"mean": 12.0, "sd": 3.2}}, "16-18": {"R": {"mean": 12.0, "sd": 3.2}, "I": {"mean": 12.0, "sd": 3.2}, "A": {"mean": 12.0, "sd": 3.2}, "S": {"mean": 12.0, "sd": 3.2}, "E": {"mean": 12.0, "sd": 3.2}, "C": {"mean": 12.0, "sd": 3.2}}, "19-22": {"R": {"mean": 12.0, "sd": 3.2}, "I": {"mean": 12.0, "sd": 3.2}, "A": {"mean": 12.0, "sd": 3.2}, "S": {"mean": 12.0, "sd": 3.2}, "E": {"mean": 12.0, "sd": 3.2}, "C": {"mean": 12.0, "sd": 3.2}}, "23+": {"R": {"mean": 12.0, "sd": 3.2}, "I": {"mean": 12.0, "sd": 3.2}, "A": {"mean": 12.0, "sd": 3.2}, "S": {"mean": 12.0, "sd": 3.2}, "E": {"mean": 12.0, "sd": 3.2}, "C": {"mean": 12.0, "sd": 3.2}}}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('aptitude', 'Aptitude', '0.1-placeholder', 'standard',
   '{"sections": [{"code": "numerical", "name": "Numbers", "time_limit_sec": 300, "items": [{"id": "apt_num1", "type": "mcq", "prompt": "A shirt costs ₹800 after a 20% discount. What was the price before the discount?", "scale": "numerical", "key": 1, "options": [{"value": 0, "label": "₹960"}, {"value": 1, "label": "₹1,000"}, {"value": 2, "label": "₹1,040"}, {"value": 3, "label": "₹640"}]}, {"id": "apt_num2", "type": "mcq", "prompt": "A train covers 180 km in 2 hours 30 minutes. What is its average speed?", "scale": "numerical", "key": 1, "options": [{"value": 0, "label": "60 km/h"}, {"value": 1, "label": "72 km/h"}, {"value": 2, "label": "75 km/h"}, {"value": 3, "label": "90 km/h"}]}, {"id": "apt_num3", "type": "mcq", "prompt": "If 3 pens and 2 pencils cost ₹50 and 1 pen costs ₹12, what does 1 pencil cost?", "scale": "numerical", "key": 2, "options": [{"value": 0, "label": "₹5"}, {"value": 1, "label": "₹6"}, {"value": 2, "label": "₹7"}, {"value": 3, "label": "₹8"}]}, {"id": "apt_num4", "type": "mcq", "prompt": "What is 15% of 240 plus 25% of 120?", "scale": "numerical", "key": 2, "options": [{"value": 0, "label": "54"}, {"value": 1, "label": "60"}, {"value": 2, "label": "66"}, {"value": 3, "label": "72"}]}]}, {"code": "verbal", "name": "Words", "time_limit_sec": 300, "items": [{"id": "apt_ver1", "type": "mcq", "prompt": "Choose the word closest in meaning to METICULOUS.", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Careless"}, {"value": 1, "label": "Precise"}, {"value": 2, "label": "Quick"}, {"value": 3, "label": "Loud"}]}, {"id": "apt_ver2", "type": "mcq", "prompt": "BOOK is to READ as FORK is to …", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Kitchen"}, {"value": 1, "label": "Eat"}, {"value": 2, "label": "Metal"}, {"value": 3, "label": "Spoon"}]}, {"id": "apt_ver3", "type": "mcq", "prompt": "Choose the word opposite in meaning to SCARCE.", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Rare"}, {"value": 1, "label": "Plentiful"}, {"value": 2, "label": "Small"}, {"value": 3, "label": "Hidden"}]}, {"id": "apt_ver4", "type": "mcq", "prompt": "Which sentence is correct?", "scale": "verbal", "key": 1, "options": [{"value": 0, "label": "Each of the students have a book."}, {"value": 1, "label": "Each of the students has a book."}, {"value": 2, "label": "Each of the student have a book."}, {"value": 3, "label": "Each students has a book."}]}]}, {"code": "abstract", "name": "Patterns", "time_limit_sec": 300, "items": [{"id": "apt_abs1", "type": "mcq", "prompt": "What comes next: 2, 6, 12, 20, 30, …", "scale": "abstract", "key": 2, "options": [{"value": 0, "label": "38"}, {"value": 1, "label": "40"}, {"value": 2, "label": "42"}, {"value": 3, "label": "44"}]}, {"id": "apt_abs2", "type": "mcq", "prompt": "What comes next: A, C, F, J, O, …", "scale": "abstract", "key": 2, "options": [{"value": 0, "label": "S"}, {"value": 1, "label": "T"}, {"value": 2, "label": "U"}, {"value": 3, "label": "V"}]}, {"id": "apt_abs3", "type": "mcq", "prompt": "Which one does not belong: 121, 144, 169, 196, 210", "scale": "abstract", "key": 3, "options": [{"value": 0, "label": "144"}, {"value": 1, "label": "169"}, {"value": 2, "label": "196"}, {"value": 3, "label": "210"}]}, {"id": "apt_abs4", "type": "mcq", "prompt": "If ▲ = 3 and ■ = ▲ + ▲ and ● = ■ × ▲, what is ●?", "scale": "abstract", "key": 2, "options": [{"value": 0, "label": "9"}, {"value": 1, "label": "12"}, {"value": 2, "label": "18"}, {"value": 3, "label": "27"}]}]}, {"code": "spatial", "name": "Shapes and space", "time_limit_sec": 300, "items": [{"id": "apt_spa1", "type": "mcq", "prompt": "A cube painted on all faces is cut into 27 equal small cubes. How many small cubes have exactly two painted faces?", "scale": "spatial", "key": 2, "options": [{"value": 0, "label": "6"}, {"value": 1, "label": "8"}, {"value": 2, "label": "12"}, {"value": 3, "label": "18"}]}, {"id": "apt_spa2", "type": "mcq", "prompt": "You face north, turn 90° right, then 180°. Which way are you facing now?", "scale": "spatial", "key": 3, "options": [{"value": 0, "label": "North"}, {"value": 1, "label": "East"}, {"value": 2, "label": "South"}, {"value": 3, "label": "West"}]}, {"id": "apt_spa3", "type": "mcq", "prompt": "How many faces does a triangular prism have?", "scale": "spatial", "key": 1, "options": [{"value": 0, "label": "4"}, {"value": 1, "label": "5"}, {"value": 2, "label": "6"}, {"value": 3, "label": "8"}]}, {"id": "apt_spa4", "type": "mcq", "prompt": "A clock shows 3:00. What time does its mirror image show?", "scale": "spatial", "key": 0, "options": [{"value": 0, "label": "9:00"}, {"value": 1, "label": "3:00"}, {"value": 2, "label": "6:00"}, {"value": 3, "label": "12:00"}]}]}]}'::jsonb,
   '{"method": "aptitude", "subtests": ["numerical", "verbal", "abstract", "spatial"], "bands": [[0, 25, "Low"], [25, 75, "Average"], [75, 90, "High"], [90, 101, "Very High"]]}'::jsonb,
   '{"13-15": {"numerical": {"mean": 2.2, "sd": 0.88}, "verbal": {"mean": 2.2, "sd": 0.88}, "abstract": {"mean": 2.2, "sd": 0.88}, "spatial": {"mean": 2.2, "sd": 0.88}}, "16-18": {"numerical": {"mean": 2.2, "sd": 0.88}, "verbal": {"mean": 2.2, "sd": 0.88}, "abstract": {"mean": 2.2, "sd": 0.88}, "spatial": {"mean": 2.2, "sd": 0.88}}, "19-22": {"numerical": {"mean": 2.2, "sd": 0.88}, "verbal": {"mean": 2.2, "sd": 0.88}, "abstract": {"mean": 2.2, "sd": 0.88}, "spatial": {"mean": 2.2, "sd": 0.88}}, "23+": {"numerical": {"mean": 2.2, "sd": 0.88}, "verbal": {"mean": 2.2, "sd": 0.88}, "abstract": {"mean": 2.2, "sd": 0.88}, "spatial": {"mean": 2.2, "sd": 0.88}}}'::jsonb, 20, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('workstyle', 'Work style', '0.1-placeholder', 'standard',
   '{"sections": [{"code": "main", "name": "Most and least like me", "time_limit_sec": null, "items": [{"id": "ws_1", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Driven to win", "factor": "R"}, {"value": "b", "label": "Lively with people", "factor": "A"}, {"value": "c", "label": "Calm and patient", "factor": "P"}, {"value": "d", "label": "Careful and exact", "factor": "D"}]}, {"id": "ws_2", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Direct", "factor": "R"}, {"value": "b", "label": "Persuasive", "factor": "A"}, {"value": "c", "label": "Loyal", "factor": "P"}, {"value": "d", "label": "Systematic", "factor": "D"}]}, {"id": "ws_3", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Takes charge", "factor": "R"}, {"value": "b", "label": "Enthusiastic", "factor": "A"}, {"value": "c", "label": "Easy-going", "factor": "P"}, {"value": "d", "label": "Follows the rules", "factor": "D"}]}, {"id": "ws_4", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Competitive", "factor": "R"}, {"value": "b", "label": "Talkative", "factor": "A"}, {"value": "c", "label": "Good listener", "factor": "P"}, {"value": "d", "label": "Thorough", "factor": "D"}]}, {"id": "ws_5", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Bold", "factor": "R"}, {"value": "b", "label": "Optimistic", "factor": "A"}, {"value": "c", "label": "Even-tempered", "factor": "P"}, {"value": "d", "label": "Accurate", "factor": "D"}]}, {"id": "ws_6", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Decisive", "factor": "R"}, {"value": "b", "label": "Inspiring", "factor": "A"}, {"value": "c", "label": "Dependable", "factor": "P"}, {"value": "d", "label": "Analytical", "factor": "D"}]}, {"id": "ws_7", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Independent", "factor": "R"}, {"value": "b", "label": "Sociable", "factor": "A"}, {"value": "c", "label": "Consistent", "factor": "P"}, {"value": "d", "label": "Precise", "factor": "D"}]}, {"id": "ws_8", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Forceful", "factor": "R"}, {"value": "b", "label": "Charming", "factor": "A"}, {"value": "c", "label": "Steady", "factor": "P"}, {"value": "d", "label": "Cautious", "factor": "D"}]}, {"id": "ws_9", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Daring", "factor": "R"}, {"value": "b", "label": "Expressive", "factor": "A"}, {"value": "c", "label": "Supportive", "factor": "P"}, {"value": "d", "label": "Orderly", "factor": "D"}]}, {"id": "ws_10", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Restless for results", "factor": "R"}, {"value": "b", "label": "Warm", "factor": "A"}, {"value": "c", "label": "Unhurried", "factor": "P"}, {"value": "d", "label": "Detail-minded", "factor": "D"}]}, {"id": "ws_11", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Firm", "factor": "R"}, {"value": "b", "label": "Playful", "factor": "A"}, {"value": "c", "label": "Cooperative", "factor": "P"}, {"value": "d", "label": "Logical", "factor": "D"}]}, {"id": "ws_12", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you", "options": [{"value": "a", "label": "Ambitious", "factor": "R"}, {"value": "b", "label": "Friendly", "factor": "A"}, {"value": "c", "label": "Patient", "factor": "P"}, {"value": "d", "label": "Diligent", "factor": "D"}]}]}]}'::jsonb,
   '{"method": "workstyle", "factors": ["R", "A", "P", "D"], "graphs": ["others", "stress", "self"], "range": 19}'::jsonb,
   '{}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('values', 'Work values', '0.1-placeholder', 'standard',
   '{"sections": [{"code": "main", "name": "Choose one", "time_limit_sec": null, "items": [{"id": "val_1", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Security", "value_name": "Security"}]}, {"id": "val_2", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Helping others", "value_name": "Helping others"}]}, {"id": "val_3", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Recognition", "value_name": "Recognition"}]}, {"id": "val_4", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_5", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_6", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Helping others", "value_name": "Helping others"}]}, {"id": "val_7", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Recognition", "value_name": "Recognition"}]}, {"id": "val_8", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_9", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_10", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Independence", "value_name": "Independence"}]}, {"id": "val_11", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Variety", "value_name": "Variety"}]}, {"id": "val_12", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_13", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Helping others", "value_name": "Helping others"}, {"value": "b", "label": "Independence", "value_name": "Independence"}]}, {"id": "val_14", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Helping others", "value_name": "Helping others"}, {"value": "b", "label": "Variety", "value_name": "Variety"}]}, {"id": "val_15", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Helping others", "value_name": "Helping others"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_16", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Independence", "value_name": "Independence"}, {"value": "b", "label": "Recognition", "value_name": "Recognition"}]}, {"id": "val_17", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Independence", "value_name": "Independence"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_18", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Independence", "value_name": "Independence"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_19", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Recognition", "value_name": "Recognition"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_20", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Recognition", "value_name": "Recognition"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_21", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Variety", "value_name": "Variety"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_22", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Work-life balance", "value_name": "Work-life balance"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_23", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Learning", "value_name": "Learning"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_24", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Creativity", "value_name": "Creativity"}]}, {"id": "val_25", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Independence", "value_name": "Independence"}]}, {"id": "val_26", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Variety", "value_name": "Variety"}]}, {"id": "val_27", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Achievement", "value_name": "Achievement"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_28", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Creativity", "value_name": "Creativity"}]}, {"id": "val_29", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Independence", "value_name": "Independence"}]}, {"id": "val_30", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Variety", "value_name": "Variety"}]}, {"id": "val_31", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Security", "value_name": "Security"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_32", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Helping others", "value_name": "Helping others"}]}, {"id": "val_33", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Recognition", "value_name": "Recognition"}]}, {"id": "val_34", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_35", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Creativity", "value_name": "Creativity"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_36", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Helping others", "value_name": "Helping others"}, {"value": "b", "label": "Recognition", "value_name": "Recognition"}]}, {"id": "val_37", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Helping others", "value_name": "Helping others"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_38", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Helping others", "value_name": "Helping others"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_39", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Independence", "value_name": "Independence"}, {"value": "b", "label": "Variety", "value_name": "Variety"}]}, {"id": "val_40", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Independence", "value_name": "Independence"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_41", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Recognition", "value_name": "Recognition"}, {"value": "b", "label": "Variety", "value_name": "Variety"}]}, {"id": "val_42", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Recognition", "value_name": "Recognition"}, {"value": "b", "label": "Learning", "value_name": "Learning"}]}, {"id": "val_43", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Variety", "value_name": "Variety"}, {"value": "b", "label": "Work-life balance", "value_name": "Work-life balance"}]}, {"id": "val_44", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Variety", "value_name": "Variety"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}, {"id": "val_45", "type": "pair", "prompt": "Which matters more to you?", "options": [{"value": "a", "label": "Work-life balance", "value_name": "Work-life balance"}, {"value": "b", "label": "Leadership", "value_name": "Leadership"}]}]}]}'::jsonb,
   '{"method": "values", "values": ["Achievement", "Security", "Creativity", "Helping others", "Independence", "Recognition", "Variety", "Work-life balance", "Learning", "Leadership"], "top": 5}'::jsonb,
   '{}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('learning', 'How I learn', '0.1-placeholder', 'standard',
   '{"sections": [{"code": "main", "name": "Learning", "time_limit_sec": null, "items": [{"id": "lrn_vis1", "type": "likert5", "prompt": "I understand best from diagrams and charts", "scale": "visual", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_aud1", "type": "likert5", "prompt": "I learn well by listening to explanations", "scale": "auditory", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_rea1", "type": "likert5", "prompt": "I like reading the textbook before class", "scale": "reading", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_kin1", "type": "likert5", "prompt": "I learn best by doing", "scale": "kinesthetic", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_vis2", "type": "likert5", "prompt": "I remember faces better than names", "scale": "visual", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_aud2", "type": "likert5", "prompt": "I remember things I have discussed aloud", "scale": "auditory", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_rea2", "type": "likert5", "prompt": "Writing notes helps me remember", "scale": "reading", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_kin2", "type": "likert5", "prompt": "I need to move around while studying", "scale": "kinesthetic", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_vis3", "type": "likert5", "prompt": "I like colour-coding my notes", "scale": "visual", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_aud3", "type": "likert5", "prompt": "I like podcasts or recorded lectures", "scale": "auditory", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_rea3", "type": "likert5", "prompt": "I prefer written instructions", "scale": "reading", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "lrn_kin3", "type": "likert5", "prompt": "I like hands-on experiments", "scale": "kinesthetic", "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}]}]}'::jsonb,
   '{"method": "likert_scales", "scales": ["visual", "auditory", "reading", "kinesthetic"]}'::jsonb,
   '{"13-15": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}, "16-18": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}, "19-22": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}, "23+": {"visual": {"mean": 9.0, "sd": 2.4}, "auditory": {"mean": 9.0, "sd": 2.4}, "reading": {"mean": 9.0, "sd": 2.4}, "kinesthetic": {"mean": 9.0, "sd": 2.4}}}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('bigfive', 'Personality (Big Five)', '0.1-placeholder', 'standard',
   '{"sections": [{"code": "main", "name": "About me", "time_limit_sec": null, "items": [{"id": "bf_O1", "type": "likert5", "prompt": "I enjoy thinking about new ideas", "scale": "O", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_C1", "type": "likert5", "prompt": "I keep my things organised", "scale": "C", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_E1", "type": "likert5", "prompt": "I am outgoing and sociable", "scale": "E", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_A1", "type": "likert5", "prompt": "I am considerate of others'' feelings", "scale": "A", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_N1", "type": "likert5", "prompt": "I worry a lot", "scale": "N", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_O2", "type": "likert5", "prompt": "I like art, music or literature", "scale": "O", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_C2", "type": "likert5", "prompt": "I finish what I start", "scale": "C", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_E2", "type": "likert5", "prompt": "I feel energised around people", "scale": "E", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_SD1", "type": "likert5", "prompt": "I have never been annoyed with anyone", "scale": "SD", "sd": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_A2", "type": "likert5", "prompt": "I trust people easily", "scale": "A", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_N2", "type": "likert5", "prompt": "I get stressed easily", "scale": "N", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_O3", "type": "likert5", "prompt": "I prefer routines to new experiences", "scale": "O", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_C3", "type": "likert5", "prompt": "I often leave tasks to the last minute", "scale": "C", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_E3", "type": "likert5", "prompt": "I tend to be quiet in groups", "scale": "E", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_A3", "type": "likert5", "prompt": "I can be cold or distant", "scale": "A", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_N3", "type": "likert5", "prompt": "I stay calm under pressure", "scale": "N", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_O4", "type": "likert5", "prompt": "I am curious about many things", "scale": "O", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_SD2", "type": "likert5", "prompt": "I always keep every promise I make", "scale": "SD", "sd": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_C4", "type": "likert5", "prompt": "I plan ahead", "scale": "C", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_E4", "type": "likert5", "prompt": "I start conversations easily", "scale": "E", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_A4", "type": "likert5", "prompt": "I like to cooperate", "scale": "A", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_N4", "type": "likert5", "prompt": "My mood changes often", "scale": "N", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_O5", "type": "likert5", "prompt": "I find abstract ideas boring", "scale": "O", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_C5", "type": "likert5", "prompt": "I can be careless", "scale": "C", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_E5", "type": "likert5", "prompt": "I prefer to stay in the background", "scale": "E", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_A5", "type": "likert5", "prompt": "I start arguments", "scale": "A", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_SD3", "type": "likert5", "prompt": "I have never taken anything that was not mine", "scale": "SD", "sd": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_N5", "type": "likert5", "prompt": "I rarely feel anxious", "scale": "N", "reverse": true, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_O6", "type": "likert5", "prompt": "I enjoy imagining possibilities", "scale": "O", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_C6", "type": "likert5", "prompt": "I work steadily until a job is done", "scale": "C", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_E6", "type": "likert5", "prompt": "I am full of energy", "scale": "E", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_A6", "type": "likert5", "prompt": "I forgive easily", "scale": "A", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}, {"id": "bf_N6", "type": "likert5", "prompt": "I get upset easily", "scale": "N", "reverse": false, "options": [{"value": 1, "label": "Disagree strongly"}, {"value": 2, "label": "Disagree a little"}, {"value": 3, "label": "Neutral"}, {"value": 4, "label": "Agree a little"}, {"value": 5, "label": "Agree strongly"}]}]}]}'::jsonb,
   '{"method": "bigfive", "domains": ["O", "C", "E", "A", "N"], "score": "mean", "note": "Load licensed BFI-2-S items and keys before launch."}'::jsonb,
   '{"13-15": {"O": {"mean": 3.4, "sd": 0.7}, "C": {"mean": 3.4, "sd": 0.7}, "E": {"mean": 3.4, "sd": 0.7}, "A": {"mean": 3.4, "sd": 0.7}, "N": {"mean": 3.4, "sd": 0.7}, "SD": {"mean": 2.6, "sd": 0.8}}, "16-18": {"O": {"mean": 3.4, "sd": 0.7}, "C": {"mean": 3.4, "sd": 0.7}, "E": {"mean": 3.4, "sd": 0.7}, "A": {"mean": 3.4, "sd": 0.7}, "N": {"mean": 3.4, "sd": 0.7}, "SD": {"mean": 2.6, "sd": 0.8}}, "19-22": {"O": {"mean": 3.4, "sd": 0.7}, "C": {"mean": 3.4, "sd": 0.7}, "E": {"mean": 3.4, "sd": 0.7}, "A": {"mean": 3.4, "sd": 0.7}, "N": {"mean": 3.4, "sd": 0.7}, "SD": {"mean": 2.6, "sd": 0.8}}, "23+": {"O": {"mean": 3.4, "sd": 0.7}, "C": {"mean": 3.4, "sd": 0.7}, "E": {"mean": 3.4, "sd": 0.7}, "A": {"mean": 3.4, "sd": 0.7}, "N": {"mean": 3.4, "sd": 0.7}, "SD": {"mean": 2.6, "sd": 0.8}}}'::jsonb, null, true);

insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values
  ('subject_enjoyment', 'Subjects I enjoy', '0.1-placeholder', 'junior',
   '{"sections": [{"code": "main", "name": "Subjects", "time_limit_sec": null, "items": [{"id": "subj_maths", "type": "likert5", "prompt": "How much do you enjoy Maths?", "scale": "maths", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "subj_science", "type": "likert5", "prompt": "How much do you enjoy Science?", "scale": "science", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "subj_languages", "type": "likert5", "prompt": "How much do you enjoy Languages (English, Hindi, others)?", "scale": "languages", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "subj_social_science", "type": "likert5", "prompt": "How much do you enjoy Social Science?", "scale": "social_science", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "subj_art", "type": "likert5", "prompt": "How much do you enjoy Art and craft?", "scale": "art", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "subj_computers", "type": "likert5", "prompt": "How much do you enjoy Computers?", "scale": "computers", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}, {"id": "subj_sports", "type": "likert5", "prompt": "How much do you enjoy Sports and PE?", "scale": "sports", "options": [{"value": 1, "label": "Not for me"}, {"value": 2, "label": "Not really"}, {"value": 3, "label": "Maybe"}, {"value": 4, "label": "I like it"}, {"value": 5, "label": "Love it!"}]}]}]}'::jsonb,
   '{"method": "likert_scales", "scales": ["maths", "science", "languages", "social_science", "art", "computers", "sports"], "per_item": true}'::jsonb,
   '{}'::jsonb, null, true);
