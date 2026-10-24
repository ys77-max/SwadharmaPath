-- =============================================================================
-- SwadharmaPath — 002_library_refresh_archive.sql
-- Admin-triggered library refresh (careers and streams) and admin archiving.
--
-- Library refresh:
--   * An admin queues a run with request_library_refresh(): source 'ai' (the
--     worker drafts changes with Claude and web search) or 'csv' (the admin
--     uploads an edited CSV). The quarterly worker job queues a 'scheduled' run.
--   * The worker turns each run into library_refresh_proposals (one per career
--     or stream that would change) and sets status 'review'.
--   * The admin approves or rejects each proposal, then apply_library_refresh()
--     writes the approved changes, stamps last_reviewed and marks the run
--     'applied'. The worker then recomputes every candidate's matches.
--
-- Archiving:
--   * candidates and leads get archived_at / archived_by. Archived rows leave
--     the caseload, worker jobs and lead lists; nothing is deleted and
--     restore_archived() brings a row back. audit_log and reports are untouched.
--   * The admin sets the inactivity timeframe in archive_settings and either
--     archives on demand (archive_inactive) or turns on the nightly auto-archive.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Library: review stamps for streams
-- -----------------------------------------------------------------------------

alter table public.stream_options
  add column if not exists sources       jsonb,
  add column if not exists last_reviewed date;

-- -----------------------------------------------------------------------------
-- Library refresh tables
-- -----------------------------------------------------------------------------

create table public.library_refresh_runs (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('careers','streams','all')),
  source        text not null check (source in ('ai','csv','scheduled')),
  status        text not null default 'queued'
                check (status in ('queued','running','review','applied','failed','cancelled')),
  requested_by  uuid references public.users(id),
  csv_text      text check (csv_text is null or length(csv_text) <= 2000000),
  summary       jsonb not null default '{}',
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  applied_at    timestamptz,
  applied_by    uuid references public.users(id),
  rematched_at  timestamptz,
  check ((source = 'csv') = (csv_text is not null)),
  check (source <> 'csv' or scope <> 'all')
);

create table public.library_refresh_proposals (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.library_refresh_runs(id) on delete cascade,
  entity      text not null check (entity in ('career','stream')),
  entity_id   uuid,               -- null: a new career or stream
  entity_name text not null,
  changes     jsonb not null,     -- {field: {"old": ..., "new": ...}}
  sources     jsonb not null default '[]',
  rationale   text,
  decision    text not null default 'pending' check (decision in ('pending','approved','rejected','skipped')),
  decided_by  uuid references public.users(id),
  decided_at  timestamptz,
  check (jsonb_typeof(changes) = 'object')
);

create index on public.library_refresh_runs (status);
create index on public.library_refresh_proposals (run_id);
-- At most one open run per scope family: a second click while one is in flight is refused.
create unique index library_refresh_one_open
  on public.library_refresh_runs ((true)) where status in ('queued','running','review');

alter table public.library_refresh_runs      enable row level security;
alter table public.library_refresh_proposals enable row level security;

create policy refresh_runs_admin_select on public.library_refresh_runs for select to authenticated
  using (private.is_admin());
create policy refresh_proposals_admin_select on public.library_refresh_proposals for select to authenticated
  using (private.is_admin());
-- Writes go through the RPCs below (admin) or the worker (service role bypasses RLS).

revoke all on public.library_refresh_runs, public.library_refresh_proposals from anon;
grant select on public.library_refresh_runs, public.library_refresh_proposals to authenticated;

-- Fields an approved proposal may write. Anything else in `changes` is ignored.
create or replace function private.library_fields(p_entity text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_entity
    when 'career' then array['name','family','riasec_code','interest_weights','aptitude_min','workstyle_fit','values_fit',
                             'description','day_in_life','typical_entry_paths','india_salary_band','outlook',
                             'automation_exposure','adjacent_emerging','pathways']
    when 'stream' then array['name','board','subjects','keeps_open_families','closes_families','notes']
  end
$$;

-- -----------------------------------------------------------------------------
-- Library refresh RPCs (admin only)
-- -----------------------------------------------------------------------------

create or replace function public.request_library_refresh(p_scope text, p_source text default 'ai', p_csv text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'only an admin can refresh the library' using errcode = '42501';
  end if;
  if p_source not in ('ai','csv') then
    raise exception 'source must be ai or csv' using errcode = '22023';
  end if;
  if p_source = 'csv' and (p_csv is null or length(trim(p_csv)) = 0) then
    raise exception 'upload a CSV file first' using errcode = '22023';
  end if;
  if exists (select 1 from public.library_refresh_runs where status in ('queued','running','review')) then
    raise exception 'a library refresh is already in progress; finish or cancel it first' using errcode = '55000';
  end if;
  insert into public.library_refresh_runs (scope, source, requested_by, csv_text)
  values (p_scope, p_source, auth.uid(), case when p_source = 'csv' then p_csv end)
  returning id into v_id;
  perform private.write_audit('library_refresh_requested', 'library_refresh_runs', v_id,
                              jsonb_build_object('scope', p_scope, 'source', p_source));
  return v_id;
end $$;

create or replace function public.cancel_library_refresh(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin can cancel a library refresh' using errcode = '42501';
  end if;
  update public.library_refresh_runs set status = 'cancelled', finished_at = coalesce(finished_at, now())
   where id = p_run_id and status in ('queued','running','review');
  if not found then
    raise exception 'this refresh is not open' using errcode = '55000';
  end if;
  perform private.write_audit('library_refresh_cancelled', 'library_refresh_runs', p_run_id, '{}'::jsonb);
end $$;

create or replace function public.decide_refresh_proposal(p_proposal_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_run uuid;
begin
  if not private.is_admin() then
    raise exception 'only an admin can review library changes' using errcode = '42501';
  end if;
  if p_decision not in ('approved','rejected','pending') then
    raise exception 'decision must be approved, rejected or pending' using errcode = '22023';
  end if;
  select p.run_id into v_run
    from public.library_refresh_proposals p join public.library_refresh_runs r on r.id = p.run_id
   where p.id = p_proposal_id and r.status = 'review';
  if v_run is null then
    raise exception 'this change is not awaiting review' using errcode = '55000';
  end if;
  update public.library_refresh_proposals
     set decision = p_decision,
         decided_by = case when p_decision = 'pending' then null else auth.uid() end,
         decided_at = case when p_decision = 'pending' then null else now() end
   where id = p_proposal_id;
end $$;

-- Writes approved proposals. Pending ones are marked 'skipped'. Every career or
-- stream in the run's scope gets last_reviewed = today, changed or not, because
-- the run reviewed it.
create or replace function public.apply_library_refresh(p_run_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_run public.library_refresh_runs;
  p record;
  v_new jsonb;
  v_career public.careers;
  v_stream public.stream_options;
  v_applied int := 0;
  v_source jsonb;
begin
  if not private.is_admin() then
    raise exception 'only an admin can apply library changes' using errcode = '42501';
  end if;
  select * into v_run from public.library_refresh_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'review' then
    raise exception 'this refresh is not awaiting review' using errcode = '55000';
  end if;

  for p in select * from public.library_refresh_proposals where run_id = p_run_id and decision = 'approved' loop
    select coalesce(jsonb_object_agg(key, value->'new'), '{}'::jsonb) into v_new
      from jsonb_each(p.changes)
     where key = any(private.library_fields(p.entity)) and key <> 'pathways';
    v_source := jsonb_build_object('run_id', p_run_id, 'reviewed_on', current_date, 'sources', p.sources);

    if p.entity = 'career' then
      if p.entity_id is null then
        v_career := jsonb_populate_record(null::public.careers, v_new);
        v_career.id := gen_random_uuid();
      else
        select * into v_career from public.careers where id = p.entity_id;
        if v_career.id is null then continue; end if;
        v_career := jsonb_populate_record(v_career, v_new);
      end if;
      v_career.last_reviewed := current_date;
      v_career.sources := jsonb_set(coalesce(v_career.sources, '{}'::jsonb), '{refresh}',
                                    coalesce(v_career.sources->'refresh', '[]'::jsonb) || jsonb_build_array(v_source));
      insert into public.careers select v_career.*
        on conflict (id) do update set
          name = excluded.name, family = excluded.family, riasec_code = excluded.riasec_code,
          interest_weights = excluded.interest_weights, aptitude_min = excluded.aptitude_min,
          workstyle_fit = excluded.workstyle_fit, values_fit = excluded.values_fit,
          description = excluded.description, day_in_life = excluded.day_in_life,
          typical_entry_paths = excluded.typical_entry_paths, india_salary_band = excluded.india_salary_band,
          outlook = excluded.outlook, automation_exposure = excluded.automation_exposure,
          adjacent_emerging = excluded.adjacent_emerging, sources = excluded.sources,
          last_reviewed = excluded.last_reviewed;
      if p.changes ? 'pathways' and jsonb_typeof(p.changes->'pathways'->'new') = 'array' then
        delete from public.education_pathways where career_id = v_career.id;
        insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)
        select v_career.id, x.level, x.stream_required, coalesce(x.exams, '[]'::jsonb), coalesce(x.degrees, '{}'::text[]),
               coalesce(x.institutions, '{}'::jsonb), x.duration, x.alternative_routes, x.notes
          from jsonb_populate_recordset(null::public.education_pathways, p.changes->'pathways'->'new') x;
      end if;
    else
      if p.entity_id is null then
        v_stream := jsonb_populate_record(null::public.stream_options, v_new);
        v_stream.id := gen_random_uuid();
      else
        select * into v_stream from public.stream_options where id = p.entity_id;
        if v_stream.id is null then continue; end if;
        v_stream := jsonb_populate_record(v_stream, v_new);
      end if;
      v_stream.last_reviewed := current_date;
      v_stream.sources := coalesce(v_stream.sources, '[]'::jsonb) || jsonb_build_array(v_source);
      insert into public.stream_options select v_stream.*
        on conflict (id) do update set
          name = excluded.name, board = excluded.board, subjects = excluded.subjects,
          keeps_open_families = excluded.keeps_open_families, closes_families = excluded.closes_families,
          notes = excluded.notes, sources = excluded.sources, last_reviewed = excluded.last_reviewed;
    end if;
    v_applied := v_applied + 1;
  end loop;

  if v_run.scope in ('careers','all') then
    update public.careers set last_reviewed = current_date where last_reviewed is distinct from current_date;
  end if;
  if v_run.scope in ('streams','all') then
    update public.stream_options set last_reviewed = current_date where last_reviewed is distinct from current_date;
  end if;

  update public.library_refresh_proposals set decision = 'skipped' where run_id = p_run_id and decision = 'pending';
  update public.library_refresh_runs
     set status = 'applied', applied_at = now(), applied_by = auth.uid(),
         summary = summary || jsonb_build_object('applied', v_applied)
   where id = p_run_id;
  perform private.write_audit('library_refresh_applied', 'library_refresh_runs', p_run_id,
                              jsonb_build_object('applied', v_applied, 'scope', v_run.scope, 'source', v_run.source));
  return v_applied;
end $$;

-- -----------------------------------------------------------------------------
-- Archiving
-- -----------------------------------------------------------------------------

alter table public.candidates
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id);
alter table public.leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id);
create index on public.candidates (archived_at);
create index on public.leads (archived_at);

-- Single row. The admin decides the timeframe; defaults are conservative and auto-archive is off.
create table public.archive_settings (
  id                      boolean primary key default true check (id),
  auto_archive            boolean not null default false,
  candidate_inactive_days int not null default 730 check (candidate_inactive_days between 30 and 3650),
  lead_inactive_days      int not null default 365 check (lead_inactive_days between 30 and 3650),
  last_auto_run_at        timestamptz,
  updated_by              uuid references public.users(id),
  updated_at              timestamptz not null default now()
);
insert into public.archive_settings (id) values (true) on conflict do nothing;

alter table public.archive_settings enable row level security;
create policy archive_settings_admin_select on public.archive_settings for select to authenticated
  using (private.is_admin());
revoke all on public.archive_settings from anon;
grant select on public.archive_settings to authenticated;

-- Last time anything happened on a case: sign-up, assessments, sessions, roadmap
-- work, reports or outcomes.
create or replace function private.candidate_last_activity(p_candidate uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    (select created_at from public.candidates where id = p_candidate),
    (select max(greatest(a.started_at, a.completed_at)) from public.assessment_sessions a where a.candidate_id = p_candidate),
    (select max(s.scheduled_at) from public.sessions s where s.candidate_id = p_candidate),
    (select max(i.completed_at) from public.roadmap_items i join public.roadmaps r on r.id = i.roadmap_id where r.candidate_id = p_candidate),
    (select max(r.published_at) from public.roadmaps r where r.candidate_id = p_candidate),
    (select max(r.created_at) from public.reports r where r.candidate_id = p_candidate),
    (select max(o.recorded_at) from public.outcomes o where o.candidate_id = p_candidate)
  )
$$;

create or replace function private.lead_last_activity(p_lead uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(l.created_at, l.next_followup::timestamptz) from public.leads l where l.id = p_lead
$$;

-- Rows that would be archived for the given cutoffs. Candidates with a future
-- session, and leads that are paid or active, are never picked.
create or replace function private.archive_candidates_before(p_cutoff timestamptz)
returns table (id uuid, name text, last_activity timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, u.full_name, private.candidate_last_activity(c.id)
    from public.candidates c left join public.users u on u.id = c.user_id
   where c.archived_at is null
     and private.candidate_last_activity(c.id) < p_cutoff
     and not exists (select 1 from public.sessions s where s.candidate_id = c.id and s.scheduled_at > now())
$$;

create or replace function private.archive_leads_before(p_cutoff timestamptz)
returns table (id uuid, name text, last_activity timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.name, private.lead_last_activity(l.id)
    from public.leads l
   where l.archived_at is null
     and l.stage not in ('paid','active')
     and private.lead_last_activity(l.id) < p_cutoff
$$;

revoke execute on function private.archive_candidates_before(timestamptz), private.archive_leads_before(timestamptz),
  private.candidate_last_activity(uuid), private.lead_last_activity(uuid)
  from public, anon, authenticated;

create or replace function public.archive_preview(p_candidates_before date, p_leads_before date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin can archive data' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'last_activity', last_activity) order by last_activity)
                              from private.archive_candidates_before(p_candidates_before::timestamptz)), '[]'::jsonb),
    'leads',      coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'last_activity', last_activity) order by last_activity)
                              from private.archive_leads_before(p_leads_before::timestamptz)), '[]'::jsonb));
end $$;

-- Archives everything inactive before the cutoffs. Either cutoff may be null to
-- skip that entity. Admin, or the service role / pg_cron for auto-archive.
create or replace function public.archive_inactive(p_candidates_before date, p_leads_before date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c int := 0; v_l int := 0;
begin
  if not (private.is_admin() or private.is_service()) then
    raise exception 'only an admin can archive data' using errcode = '42501';
  end if;
  if p_candidates_before is not null and p_candidates_before > current_date - 30 then
    raise exception 'the candidate cutoff must be at least 30 days ago' using errcode = '22023';
  end if;
  if p_leads_before is not null and p_leads_before > current_date - 30 then
    raise exception 'the lead cutoff must be at least 30 days ago' using errcode = '22023';
  end if;
  if p_candidates_before is not null then
    update public.candidates c set archived_at = now(), archived_by = auth.uid()
      from private.archive_candidates_before(p_candidates_before::timestamptz) a where c.id = a.id;
    get diagnostics v_c = row_count;
  end if;
  if p_leads_before is not null then
    update public.leads l set archived_at = now(), archived_by = auth.uid()
      from private.archive_leads_before(p_leads_before::timestamptz) a where l.id = a.id;
    get diagnostics v_l = row_count;
  end if;
  perform private.write_audit('archive_inactive', 'archive_settings', null,
    jsonb_build_object('candidates_before', p_candidates_before, 'leads_before', p_leads_before,
                       'candidates', v_c, 'leads', v_l, 'auto', not private.is_admin()));
  return jsonb_build_object('candidates', v_c, 'leads', v_l);
end $$;

create or replace function public.restore_archived(p_entity text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin can restore archived data' using errcode = '42501';
  end if;
  if p_entity = 'candidate' then
    update public.candidates set archived_at = null, archived_by = null where id = p_id and archived_at is not null;
  elsif p_entity = 'lead' then
    update public.leads set archived_at = null, archived_by = null where id = p_id and archived_at is not null;
  else
    raise exception 'entity must be candidate or lead' using errcode = '22023';
  end if;
  if not found then
    raise exception 'nothing archived with that id' using errcode = 'P0002';
  end if;
  perform private.write_audit('archive_restored', p_entity || 's', p_id, '{}'::jsonb);
end $$;

create or replace function public.save_archive_settings(p_auto boolean, p_candidate_days int, p_lead_days int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin can change archive settings' using errcode = '42501';
  end if;
  update public.archive_settings
     set auto_archive = p_auto, candidate_inactive_days = p_candidate_days, lead_inactive_days = p_lead_days,
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.write_audit('archive_settings_saved', 'archive_settings', null,
    jsonb_build_object('auto', p_auto, 'candidate_days', p_candidate_days, 'lead_days', p_lead_days));
end $$;

-- Nightly: archive with the admin's timeframe when auto-archive is on.
create or replace function private.run_auto_archive() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.archive_settings; v jsonb;
begin
  select * into s from public.archive_settings where id;
  if not coalesce(s.auto_archive, false) then return null; end if;
  v := public.archive_inactive(current_date - s.candidate_inactive_days, current_date - s.lead_inactive_days);
  update public.archive_settings set last_auto_run_at = now() where id;
  return v;
end $$;
revoke execute on function private.run_auto_archive() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('swadharmapath-auto-archive', '0 21 * * *',  -- 02:30 IST
                        'select private.run_auto_archive()');
exception when others then raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;

-- Archived cases leave the caseload (and so the SLA job and dashboards built on it).
create or replace view public.v_caseload with (security_invoker = true) as
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
left join public.v_tat t on t.candidate_id = c.id
where c.archived_at is null;

-- Archived candidates are read-only for assessments: no new sessions.
create or replace function private.assessment_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.candidates where id = new.candidate_id and archived_at is not null) then
    raise exception 'this case is archived; ask your counsellor to restore it' using errcode = '42501';
  end if;
  if private.needs_guardian_consent(new.candidate_id) then
    raise exception 'guardian consent is required before an under-18 candidate can start an assessment'
      using errcode = '42501';
  end if;
  new.started_at := coalesce(new.started_at, now());
  new.responses := coalesce(new.responses, '{}'::jsonb);
  return new;
end $$;

-- Admin RPCs check is_admin() themselves; candidates and parents get an error, not data.
revoke execute on function public.request_library_refresh(text, text, text), public.cancel_library_refresh(uuid),
  public.decide_refresh_proposal(uuid, text), public.apply_library_refresh(uuid),
  public.archive_preview(date, date), public.archive_inactive(date, date),
  public.restore_archived(text, uuid), public.save_archive_settings(boolean, int, int)
  from public, anon;
grant execute on function public.request_library_refresh(text, text, text), public.cancel_library_refresh(uuid),
  public.decide_refresh_proposal(uuid, text), public.apply_library_refresh(uuid),
  public.archive_preview(date, date), public.archive_inactive(date, date),
  public.restore_archived(text, uuid), public.save_archive_settings(boolean, int, int)
  to authenticated, service_role;
