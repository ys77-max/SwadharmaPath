-- RLS / trigger tests. Run as the `authenticator` login (like PostgREST) after
-- supabase_stub.sql, 001_init.sql, fixtures.sql and test_helpers.sql.
-- Any failed assertion stops the run (psql -v ON_ERROR_STOP=1).
\set QUIET on
\o /dev/null
\set admin    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set c1       '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''
\set c2       '''{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'''
\set minor    '''{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}'''
\set adult    '''{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}'''
\set parent   '''{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'''
\set service  '''{"role":"service_role"}'''

-- ---------------------------------------------------------------- Swadharma tables
select set_config('request.jwt.claims', :adult, false); set role authenticated;
do $$ begin
  assert (select count(*) from birth_details) = 0, 'candidate must not read birth_details';
  assert (select count(*) from swadharma_charts) = 0, 'candidate must not read swadharma_charts';
  assert (select count(*) from swadharma_scores) = 0, 'candidate must not read swadharma_scores';
  assert (select count(*) from career_matches) = 0, 'candidate must not read career_matches base table';
  assert (select count(*) from v_candidate_matches) = 3, 'candidate sees the 3 published matches';
  assert not exists (select 1 from v_candidate_matches where breakdown ? 'swadharma'), 'swadharma key must be stripped';
  assert (select count(*) from sessions) = 0, 'candidate must not read sessions base table (private notes)';
  assert (select count(*) from v_candidate_sessions) = 1, 'candidate reads sessions through the view';
  assert not exists (select 1 from information_schema.columns where table_name = 'v_candidate_sessions' and column_name = 'notes_private'),
    'v_candidate_sessions must not expose notes_private';
  assert (select count(*) from profile_summary) = 0, 'profile hidden until counsellor approves';
end $$;
select tests.expect_error($$ select items from instruments $$, 'permission denied');
select tests.expect_error($$ select * from instruments $$, 'permission denied');
select tests.expect_error($$ select public.verify_trigger_secret('test-trigger-secret') $$, 'permission denied');
do $$ begin assert (select count(*) from instruments where track_variant = 'standard') = 6, 'instrument metadata readable'; end $$;
select tests.expect_error($$ update users set role = 'admin' where id = auth.uid() $$, 'only an admin');
select tests.expect_error($$ select public.submit_birth_details('10000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 'v1') $$, 'not your candidate');
reset role;

select set_config('request.jwt.claims', :parent, false); set role authenticated;
do $$ begin
  assert (select count(*) from birth_details) = 0, 'parent must not read birth_details';
  assert (select count(*) from swadharma_scores) = 0, 'parent must not read swadharma_scores';
  assert (select count(*) from candidates) = 1, 'parent sees linked child only';
end $$;
reset role;

select set_config('request.jwt.claims', :c1, false); set role authenticated;
do $$ begin
  assert (select count(*) from birth_details) = 1, 'assigned counsellor reads birth_details';
  assert (select count(*) from swadharma_scores) = 1, 'assigned counsellor reads swadharma_scores';
  assert (select count(*) from career_matches) = 5, 'counsellor reads all matches';
  assert (select count(*) from v_caseload) = 2, 'caseload shows both candidates';
end $$;
update swadharma_scores set counsellor_notes = 'Matches interest profile' where id = '20000000-0000-0000-0000-000000000001';
select tests.expect_error($$ update swadharma_scores set points = 99 $$, 'only counsellor_notes');
reset role;

select set_config('request.jwt.claims', :c2, false); set role authenticated;
do $$ begin
  assert (select count(*) from birth_details) = 0, 'unassigned counsellor must not read birth_details';
  assert (select count(*) from swadharma_scores) = 0, 'unassigned counsellor must not read swadharma_scores';
  assert (select count(*) from candidates) = 0, 'unassigned counsellor sees no candidates';
end $$;
reset role;

-- ---------------------------------------------------------------- Under-18 gate
select set_config('request.jwt.claims', :minor, false); set role authenticated;
select tests.expect_error($$
  insert into assessment_sessions (candidate_id, instrument_id)
  select '10000000-0000-0000-0000-000000000001', id from instruments where code = 'interest' and track_variant = 'junior' $$,
  'guardian consent');
reset role;
-- counsellors are gated too (trigger)
select set_config('request.jwt.claims', :c1, false); set role authenticated;
select tests.expect_error($$
  insert into assessment_sessions (candidate_id, instrument_id)
  select '10000000-0000-0000-0000-000000000001', id from instruments where code = 'interest' and track_variant = 'junior' $$,
  'guardian consent');
reset role;
select set_config('request.jwt.claims', :minor, false); set role authenticated;
select tests.expect_error($$ select public.give_guardian_consent('10000000-0000-0000-0000-000000000001') $$, 'only the linked guardian');
reset role;
select set_config('request.jwt.claims', :parent, false); set role authenticated;
select public.give_guardian_consent('10000000-0000-0000-0000-000000000001') is not null as consent_given \gset
reset role;
select set_config('request.jwt.claims', :minor, false); set role authenticated;
insert into assessment_sessions (candidate_id, instrument_id)
select '10000000-0000-0000-0000-000000000001', id from instruments where code = 'interest' and track_variant = 'junior';
do $$ begin assert (select count(*) from my_instruments()) = 6, 'junior candidate sees 6 junior instruments'; end $$;
reset role;

-- ---------------------------------------------------------------- Test runner RPCs
select set_config('request.jwt.claims', :adult, false); set role authenticated;
insert into assessment_sessions (candidate_id, instrument_id)
select '10000000-0000-0000-0000-000000000002', id from instruments where code = 'aptitude' and track_variant = 'standard'
returning id as apt_session \gset
select set_config('tests.apt', :'apt_session', false);
do $$
declare s uuid := current_setting('tests.apt')::uuid; j jsonb; j2 jsonb;
begin
  j := public.next_item(s);
  assert (j->>'position')::int = 0, 'first item at position 0';
  assert not (j->'item' ? 'key') and not (j->'item' ? 'scale'), 'scoring keys stripped';
  assert not exists (select 1 from jsonb_array_elements(j->'item'->'options') o where o ? 'factor' or o ? 'key'), 'option keys stripped';
  assert (j->'section'->>'time_limit_sec')::int = 300 and j->'section'->>'started_at' is not null, 'timed section clock started';
  perform public.save_responses(s, jsonb_build_object(j->'item'->>'id', '{"a":1,"rt":4200}'::jsonb,
                                                      'bogus_item', '{"a":1}'::jsonb,
                                                      '_meta', '{"section_started":{}}'::jsonb));
  assert (select count(*) from jsonb_object_keys((select responses from assessment_sessions where id = s) - '_meta')) = 1, 'only known items saved';
  assert (select responses->'_meta'->'section_started' ? 'numerical' from assessment_sessions where id = s), 'client cannot overwrite _meta';
  j2 := public.next_item(s);
  assert (j2->>'position')::int = 1, 'resume at first unanswered item';
  j2 := public.next_item(s, 2);
  perform public.save_responses(s, jsonb_build_object(j2->'item'->>'id', '{"a":0,"rt":3000}'::jsonb));
end $$;
select tests.expect_error(format($$ select public.next_item(%L, 0) $$, :'apt_session'), 'back navigation');
select public.complete_assessment(:'apt_session', 'test');
select tests.expect_error(format($$ select public.save_responses(%L, '{}') $$, :'apt_session'), 'not in progress');
update assessment_sessions set status = 'in_progress';  -- no candidate UPDATE policy: silently 0 rows
reset role;
do $$ begin
  assert (select count(*) from net.calls where url like '%/functions/v1/score_instrument') = 1, 'score_instrument called on completion';
  assert (select headers->>'x-trigger-secret' from net.calls where url like '%/functions/v1/score_instrument') = 'test-trigger-secret', 'trigger sends its shared secret';
end $$;
select set_config('request.jwt.claims', :admin, false); set role authenticated;
do $$ begin
  assert (select status from assessment_sessions where id = current_setting('tests.apt')::uuid) = 'completed', 'candidate cannot reopen';
end $$;
reset role;

-- the adult candidate cannot use the minor's session
select set_config('request.jwt.claims', :adult, false); set role authenticated;
select tests.expect_error($$ select public.next_item((select id from assessment_sessions where candidate_id = '10000000-0000-0000-0000-000000000001' limit 1)) $$, 'not found');
reset role;

-- ---------------------------------------------------------------- Roadmap items
select set_config('request.jwt.claims', :adult, false); set role authenticated;
update roadmap_items set status = 'done', evidence_url = 'documents/x.pdf' where id = '31000000-0000-0000-0000-000000000001';
do $$ begin assert (select completed_at is not null from roadmap_items where id = '31000000-0000-0000-0000-000000000001'), 'completed_at set'; end $$;
select tests.expect_error($$ update roadmap_items set title = 'hacked' where id = '31000000-0000-0000-0000-000000000001' $$, 'only update status');
reset role;
-- nightly job
select set_config('request.jwt.claims', '', false);
reset role;

-- ---------------------------------------------------------------- Reports + Swadharma release
select set_config('request.jwt.claims', :c1, false); set role authenticated;
insert into reports (candidate_id, kind, generated_by, visible_to)
values ('10000000-0000-0000-0000-000000000002', 'swadharma', '00000000-0000-0000-0000-0000000000c1', 'all')
returning id as swa_report \gset
insert into reports (candidate_id, kind, generated_by, visible_to)
values ('10000000-0000-0000-0000-000000000002', 'case_file', '00000000-0000-0000-0000-0000000000c1', 'candidate');
insert into reports (candidate_id, kind, generated_by, visible_to)
values ('10000000-0000-0000-0000-000000000002', 'candidate', '00000000-0000-0000-0000-0000000000c1', 'candidate');
do $$ begin
  assert (select visible_to from reports where kind = 'swadharma') = 'counsellor', 'swadharma report starts counsellor-only';
  assert (select visible_to from reports where kind = 'case_file') = 'counsellor', 'case file stays counsellor-only';
end $$;
update reports set visible_to = 'all';   -- no UPDATE policy: 0 rows
select tests.expect_error($$ delete from reports $$, 'permission denied');
do $$ begin
  assert (select count(*) from reports) = 3, 'counsellor cannot delete reports';
  assert (select visible_to from reports where kind = 'swadharma') = 'counsellor', 'counsellor cannot widen visibility';
end $$;
reset role;

select set_config('request.jwt.claims', :adult, false); set role authenticated;
do $$ begin
  assert (select count(*) from reports) = 1, 'candidate sees only the released candidate report';
  assert not exists (select 1 from reports where kind = 'swadharma'), 'unreleased swadharma report hidden';
end $$;
select tests.expect_error(format($$ insert into swadharma_releases (candidate_id, released_by, released_to, reason, report_id)
  values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'candidate', 'self', %L) $$, :'swa_report'), 'row-level security');
reset role;

select set_config('request.jwt.claims', :c1, false); set role authenticated;
select tests.expect_error(format($$ insert into swadharma_releases (candidate_id, released_by, released_to, reason, report_id)
  values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'candidate', '', %L) $$, :'swa_report'), 'check constraint');
insert into swadharma_releases (candidate_id, released_by, released_to, reason, report_id)
values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'candidate', 'Candidate asked to see it after session 3', :'swa_report');
select tests.expect_error($$ update swadharma_releases set reason = 'x' $$, 'permission denied');
select tests.expect_error($$ delete from swadharma_releases $$, 'permission denied');
reset role;

select set_config('request.jwt.claims', :adult, false); set role authenticated;
do $$ begin assert exists (select 1 from reports where kind = 'swadharma'), 'released swadharma report visible to candidate'; end $$;
reset role;

select set_config('request.jwt.claims', :admin, false); set role authenticated;
do $$ begin
  assert (select count(*) from audit_log where action = 'swadharma_release') = 1, 'release audited';
  assert (select detail->>'visible_to_after' from audit_log where action = 'swadharma_release') = 'candidate', 'visible_to widened to candidate';
end $$;
select tests.expect_error($$ update audit_log set action = 'x' $$, 'permission denied');
select tests.expect_error($$ delete from audit_log $$, 'permission denied');
reset role;

-- ---------------------------------------------------------------- Leads
select set_config('request.jwt.claims', '{"role":"anon"}', false); set role anon;
insert into leads (name, phone, track) values ('Ravi', '9999900000', 'student');
insert into leads (name, phone, track) values ('Ravi', '9999900000', 'student');
insert into leads (name, phone, track) values ('Ravi', '9999900000', 'student');
select tests.expect_error($$ insert into leads (name, phone, track) values ('Ravi', '9999900000', 'student') $$, 'too many');
insert into leads (name, phone, stage) values ('Sneaky', '8888800000', 'paid');  -- trigger forces stage = 'new'
select tests.expect_error($$ insert into leads (name, phone, assigned_counsellor) values ('Sneaky', '7777700000', '00000000-0000-0000-0000-0000000000c1') $$, 'row-level security');
select tests.expect_error($$ select * from leads $$, 'permission denied');
select tests.expect_error($$ select * from candidates $$, 'permission denied');
reset role;

\echo 'RLS tests (API roles) passed'
