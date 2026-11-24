-- Install once on the selected deployment after enabling pg_cron, pg_net and Vault.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='campusbite_worker_url' and decrypted_secret ~ '^https://[^/]+/api/jobs/commerce$')
    or not exists(select 1 from vault.decrypted_secrets where name='campusbite_worker_secret' and length(decrypted_secret)>0)
  then raise exception 'Set the worker URL and bearer secret in this project Vault first'; end if;
end $$;
select cron.schedule('campusbite-commerce','15 seconds',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='campusbite_worker_url'),
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='campusbite_worker_secret')),
    body:='{}'::jsonb,timeout_milliseconds:=55000
  );
$job$);
