-- Run as the database owner after rls_test.sql.
\set QUIET on
\o /dev/null
-- ---------------------------------------------------------------- Missed items job (as owner)
do $$ begin assert not exists (select 1 from leads where stage <> 'new'), 'public leads always start at stage new'; end $$;
select private.mark_missed_roadmap_items() as missed \gset
do $$ begin
  assert (select status from roadmap_items where id = '31000000-0000-0000-0000-000000000002') = 'missed', 'overdue item marked missed';
  assert (select count(*) from notifications where kind = 'roadmap_missed') = 2, 'candidate and counsellor notified';
end $$;
select private.mark_missed_roadmap_items() as missed_again \gset
do $$ begin assert (select count(*) from notifications) = 2, 'job is idempotent'; end $$;

-- trigger secret check (service role only; see rls_test for the denial)
do $$ begin
  assert public.verify_trigger_secret('test-trigger-secret'), 'matching trigger secret accepted';
  assert not public.verify_trigger_secret('wrong'), 'wrong trigger secret rejected';
  assert not coalesce(public.verify_trigger_secret(null), false), 'missing trigger secret rejected';
end $$;

-- even the database owner cannot rewrite history
select tests.expect_error($$ update audit_log set action = 'x' $$, 'append-only');
select tests.expect_error($$ delete from swadharma_releases $$, 'append-only');
select tests.expect_error($$ update reports set visible_to = 'all' $$, 'immutable');
select tests.expect_error($$ delete from reports $$, 'append-only');

\echo 'Owner-level tests passed'
