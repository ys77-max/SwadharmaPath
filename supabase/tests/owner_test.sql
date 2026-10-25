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

-- assessment battery v0.2: one active version per track, placeholders retired
do $$ begin
  assert private.track_variant('early_explorer') = 'junior' and private.track_variant('student') = 'standard'
     and private.track_variant('professional') = 'adult', 'track to variant mapping';
  assert (select count(*) from instruments where is_active and track_variant = 'junior') = 7, '7 junior instruments';
  assert (select count(*) from instruments where is_active and track_variant = 'standard') = 6, '6 standard instruments';
  assert (select count(*) from instruments where is_active and track_variant = 'adult') = 7, '7 adult instruments';
  assert not exists (select 1 from instruments where is_active and version <> '0.2-original'), 'only v0.2 is active';
  assert (select count(*) from instruments i, jsonb_array_elements(i.items->'sections') s, jsonb_array_elements(s->'items')
          where i.is_active and i.track_variant = 'standard') = 265, 'standard battery has 265 questions';
end $$;

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
