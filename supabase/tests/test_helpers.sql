create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;
create or replace function tests.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then return; end if;
    raise exception 'expected error matching "%" but got "%" for: %', p_pattern, sqlerrm, p_sql;
  end;
  raise exception 'expected error matching "%" but statement succeeded: %', p_pattern, p_sql;
end $$;
grant execute on function tests.expect_error(text, text) to anon, authenticated, service_role;
