-- Library refresh and archiving (002). Run as the `authenticator` login after rls_test.sql.
\set QUIET on
\o /dev/null
\set admin    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set c1       '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''
\set adult    '''{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}'''
\set parent   '''{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}'''
\set service  '''{"role":"service_role"}'''

-- ---------------------------------------------------------------- Non-admins are refused
select set_config('request.jwt.claims', :c1, false); set role authenticated;
select tests.expect_error($$ select public.request_library_refresh('careers') $$, 'only an admin');
select tests.expect_error($$ select public.archive_preview(current_date - 400, current_date - 400) $$, 'only an admin');
select tests.expect_error($$ select public.archive_inactive(current_date - 400, null) $$, 'only an admin');
select tests.expect_error($$ select public.save_archive_settings(true, 365, 365) $$, 'only an admin');
do $$ begin
  assert (select count(*) from library_refresh_runs) = 0, 'counsellor cannot read refresh runs';
  assert (select count(*) from archive_settings) = 0, 'counsellor cannot read archive settings';
end $$;
select tests.expect_error($$ insert into library_refresh_runs (scope, source) values ('all','ai') $$, 'row-level security');
reset role;

select set_config('request.jwt.claims', :adult, false); set role authenticated;
select tests.expect_error($$ select public.request_library_refresh('all') $$, 'only an admin');
select tests.expect_error($$ select public.restore_archived('candidate', '10000000-0000-0000-0000-000000000002') $$, 'only an admin');
reset role;

-- ---------------------------------------------------------------- Refresh lifecycle
select set_config('request.jwt.claims', :admin, false); set role authenticated;
select tests.expect_error($$ select public.request_library_refresh('careers', 'csv', '') $$, 'upload a CSV');
select tests.expect_error($$ select public.request_library_refresh('careers', 'scheduled') $$, 'source must be');
select public.request_library_refresh('all') as run1 \gset
select tests.expect_error($$ select public.request_library_refresh('careers') $$, 'already in progress');
select tests.expect_error(format($$ select public.decide_refresh_proposal(gen_random_uuid(), 'approved') $$), 'not awaiting review');
select public.cancel_library_refresh(:'run1');
select tests.expect_error(format($$ select public.cancel_library_refresh(%L) $$, :'run1'), 'not open');
select public.request_library_refresh('all') as run2 \gset
reset role;

-- The worker (service role) drafts proposals and moves the run to review.
select set_config('request.jwt.claims', :service, false); set role service_role;
update library_refresh_runs set status = 'review' where id = :'run2';
insert into library_refresh_proposals (id, run_id, entity, entity_id, entity_name, changes, sources) values
  ('40000000-0000-0000-0000-000000000001', :'run2', 'career', (select id from careers where name = 'Armed Forces Officer'),
   'Armed Forces Officer',
   '{"outlook": {"old": "stable", "new": "growing"},
     "last_reviewed": {"old": null, "new": "1999-01-01"},
     "pathways": {"old": null, "new": [{"level": "ug", "degrees": ["B.Sc"], "exams": ["NDA"], "notes": "via NDA"}]}}',
   '[{"url": "https://example.org/nda", "title": "NDA notice"}]'),
  ('40000000-0000-0000-0000-000000000002', :'run2', 'career', null, 'Climate Data Analyst',
   '{"name": {"old": null, "new": "Climate Data Analyst"}, "family": {"old": null, "new": "Science & Research"},
     "riasec_code": {"old": null, "new": "ICR"}, "outlook": {"old": null, "new": "growing"},
     "automation_exposure": {"old": null, "new": "medium"}, "interest_weights": {"old": null, "new": [0.2,1,0.2,0.1,0.2,0.6]}}',
   '[]'),
  ('40000000-0000-0000-0000-000000000003', :'run2', 'stream', (select id from stream_options where name = 'Science - PCM'),
   'Science - PCM', '{"notes": {"old": null, "new": "JEE Main twice a year"}}', '[]'),
  ('40000000-0000-0000-0000-000000000004', :'run2', 'stream', (select id from stream_options where name = 'Science - PCM'),
   'Science - PCM', '{"name": {"old": "Science - PCM", "new": "Rejected rename"}}', '[]');
reset role;

select set_config('request.jwt.claims', :admin, false); set role authenticated;
do $$ begin assert (select count(*) from library_refresh_proposals) = 4, 'admin reads proposals'; end $$;
select public.decide_refresh_proposal('40000000-0000-0000-0000-000000000001', 'approved');
select public.decide_refresh_proposal('40000000-0000-0000-0000-000000000002', 'approved');
select public.decide_refresh_proposal('40000000-0000-0000-0000-000000000003', 'approved');
select tests.expect_error($$ select public.decide_refresh_proposal('40000000-0000-0000-0000-000000000004', 'maybe') $$, 'decision must be');
select public.apply_library_refresh(:'run2') as applied \gset
do $$ begin
  assert (select outlook from careers where name = 'Armed Forces Officer') = 'growing', 'approved field applied';
  assert (select last_reviewed from careers where name = 'Armed Forces Officer') = current_date, 'non-whitelisted field ignored, review stamped today';
  assert (select count(*) from education_pathways p join careers c on c.id = p.career_id where c.name = 'Armed Forces Officer') = 1,
    'pathways replaced';
  assert (select jsonb_array_length(sources->'refresh') from careers where name = 'Armed Forces Officer') = 1, 'refresh source recorded';
  assert exists (select 1 from careers where name = 'Climate Data Analyst' and family = 'Science & Research'), 'new career inserted';
  assert (select notes from stream_options where name = 'Science - PCM') = 'JEE Main twice a year', 'stream change applied';
  assert not exists (select 1 from stream_options where name = 'Rejected rename'), 'pending proposal not applied';
  assert (select decision from library_refresh_proposals where id = '40000000-0000-0000-0000-000000000004') = 'skipped', 'pending marked skipped';
  assert not exists (select 1 from careers where last_reviewed is distinct from current_date), 'whole scope stamped';
  assert not exists (select 1 from stream_options where last_reviewed is distinct from current_date), 'streams stamped';
  assert (select status from library_refresh_runs order by created_at desc limit 1) = 'applied', 'run applied';
  assert (select count(*) from audit_log where action like 'library_refresh_%') = 4, 'refresh actions audited';
end $$;
select tests.expect_error(format($$ select public.apply_library_refresh(%L) $$, :'run2'), 'not awaiting review');
select public.request_library_refresh('streams', 'csv', E'id,name\n,New stream') as run3 \gset
do $$ begin assert (select csv_text from library_refresh_runs where status = 'queued') like 'id,name%', 'CSV kept on the run'; end $$;
select public.cancel_library_refresh(:'run3');
reset role;

-- ---------------------------------------------------------------- Archiving
select set_config('request.jwt.claims', :admin, false); set role authenticated;
select tests.expect_error($$ select public.archive_inactive(current_date - 5, null) $$, 'at least 30 days');
select tests.expect_error($$ select public.save_archive_settings(true, 5, 365) $$, 'check constraint');
select public.save_archive_settings(true, 400, 400);
do $$ begin assert (select auto_archive and candidate_inactive_days = 400 from archive_settings), 'settings saved'; end $$;
reset role;

\echo 'Library refresh and archive tests (API roles) passed'
