-- Archiving with backdated activity. Run as the database owner after library_archive_test.sql;
-- the owner backdates rows, then acts as the admin through the API role.
\set QUIET on
\o /dev/null
\set admin    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set c1       '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''

-- The minor's case went quiet three years ago; the adult had a session two days ago.
update candidates set created_at = now() - interval '3 years' where id = '10000000-0000-0000-0000-000000000001';
update assessment_sessions set started_at = now() - interval '3 years', completed_at = null
 where candidate_id = '10000000-0000-0000-0000-000000000001';
update candidates set created_at = now() - interval '3 years' where id = '10000000-0000-0000-0000-000000000002';
insert into leads (id, name, phone, stage, created_at) values
  ('50000000-0000-0000-0000-000000000001', 'Old lead',  '6000000001', 'lost', now() - interval '2 years'),
  ('50000000-0000-0000-0000-000000000002', 'Paid lead', '6000000002', 'paid', now() - interval '2 years');

select set_config('request.jwt.claims', :admin, false); set role authenticated;
select public.archive_preview(current_date - 365, current_date - 365) as preview \gset
reset role;
select set_config('tests.preview', :'preview', false);
do $$ declare p jsonb := current_setting('tests.preview')::jsonb; begin
  assert jsonb_array_length(p->'candidates') = 1, 'only the idle candidate is previewed';
  assert p->'candidates'->0->>'id' = '10000000-0000-0000-0000-000000000001', 'idle minor previewed';
  assert exists (select 1 from jsonb_array_elements(p->'leads') l where l->>'id' = '50000000-0000-0000-0000-000000000001'), 'old lead previewed';
  assert not exists (select 1 from jsonb_array_elements(p->'leads') l where l->>'id' = '50000000-0000-0000-0000-000000000002'), 'paid lead never archived';
end $$;

select set_config('request.jwt.claims', :admin, false); set role authenticated;
select public.archive_inactive(current_date - 365, current_date - 365) as archived \gset
reset role;
do $$ begin
  assert (select archived_at is not null and archived_by = '00000000-0000-0000-0000-0000000000a1'
            from candidates where id = '10000000-0000-0000-0000-000000000001'), 'idle candidate archived by admin';
  assert (select archived_at is null from candidates where id = '10000000-0000-0000-0000-000000000002'), 'active candidate kept';
  assert (select archived_at is not null from leads where id = '50000000-0000-0000-0000-000000000001'), 'old lead archived';
  assert (select archived_at is null from leads where id = '50000000-0000-0000-0000-000000000002'), 'paid lead kept';
  assert exists (select 1 from assessment_sessions where candidate_id = '10000000-0000-0000-0000-000000000001'), 'archiving deletes nothing';
  assert exists (select 1 from audit_log where action = 'archive_inactive'), 'archive audited';
end $$;

select set_config('request.jwt.claims', :c1, false); set role authenticated;
do $$ begin assert (select count(*) from v_caseload) = 1, 'archived case leaves the caseload'; end $$;
reset role;
select tests.expect_error($$ insert into assessment_sessions (candidate_id, instrument_id)
  values ('10000000-0000-0000-0000-000000000001', (select id from instruments limit 1)) $$, 'archived');

select set_config('request.jwt.claims', :admin, false); set role authenticated;
select public.restore_archived('candidate', '10000000-0000-0000-0000-000000000001');
select tests.expect_error($$ select public.restore_archived('candidate', '10000000-0000-0000-0000-000000000001') $$, 'nothing archived');
select tests.expect_error($$ select public.restore_archived('report', '10000000-0000-0000-0000-000000000001') $$, 'entity must be');
reset role;
select set_config('request.jwt.claims', :c1, false); set role authenticated;
do $$ begin assert (select count(*) from v_caseload) = 2, 'restored case is back'; end $$;
reset role;

-- Nightly auto-archive uses the admin's timeframe (saved as 400 days in library_archive_test.sql).
select set_config('request.jwt.claims', '', false);
select private.run_auto_archive() as auto \gset
do $$ begin
  assert (select archived_at is not null from candidates where id = '10000000-0000-0000-0000-000000000001'), 'auto-archive archived the idle case';
  assert (select last_auto_run_at is not null from archive_settings), 'auto run stamped';
  assert (select (detail->>'auto')::boolean from audit_log where action = 'archive_inactive' order by at desc limit 1), 'auto run audited as auto';
end $$;
update archive_settings set auto_archive = false;
do $$ begin assert private.run_auto_archive() is null, 'auto-archive off does nothing'; end $$;

\echo 'Archive owner tests passed'
