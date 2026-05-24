-- Local-development seed. Replace admin@example.com with the first real lowercase Google email
-- before using this against a shared Supabase project.
insert into public.authorized_users (email, role, created_by_email, updated_by_email)
values ('neverismine@gmail.com', 'admin', 'seed', 'seed')
on conflict (email) do update set role = excluded.role, updated_by_email = excluded.updated_by_email;

insert into public.leagues (id, name, status, source_data, document_version, updated_by_email)
values (
  '00000000-0000-0000-0000-000000000001',
  'Demo League',
  'active',
  '{"id":"00000000-0000-0000-0000-000000000001","name":"Demo League","status":"active","tournaments":[]}'::jsonb,
  1,
  'seed'
)
on conflict (id) do nothing;
