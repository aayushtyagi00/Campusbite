begin;

create table public.campus_reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (length(btrim(comment)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index campus_reviews_recent on public.campus_reviews (created_at desc, id desc);
alter table public.campus_reviews enable row level security;
revoke all on public.campus_reviews from public, anon, authenticated, service_role;
grant select, insert (name, rating, comment) on public.campus_reviews to service_role;

commit;
