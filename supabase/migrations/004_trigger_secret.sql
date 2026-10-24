-- Trigger -> Edge Function calls authenticate with a dedicated shared secret
-- (Vault 'edge_trigger_secret', Edge Function secret EDGE_TRIGGER_SECRET) sent
-- in the x-trigger-secret header, so they no longer depend on the Vault copy of
-- the service-role key matching the function's own key. The bearer from Vault
-- 'service_role_key' is still sent when present. Never blocks the caller.
begin;

create or replace function private.invoke_edge_function(p_name text, p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_secret text; v_key text; v_headers jsonb;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'edge_trigger_secret';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  exception when others then
    raise warning 'vault not available: %', sqlerrm; return;
  end;
  if v_url is null or (v_secret is null and v_key is null) then
    raise warning 'project_url / edge_trigger_secret not set in vault; % not called', p_name; return;
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json');
  if v_secret is not null then v_headers := v_headers || jsonb_build_object('x-trigger-secret', v_secret); end if;
  if v_key is not null then v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_key); end if;
  begin
    perform net.http_post(url := v_url || '/functions/v1/' || p_name, headers := v_headers, body := p_body);
  exception when others then
    raise warning 'edge function % call failed: %', p_name, sqlerrm;
  end;
end $$;
revoke execute on function private.invoke_edge_function(text, jsonb) from public, anon, authenticated;

commit;
