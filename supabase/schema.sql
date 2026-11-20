-- NTS ENGINE PASSPORT v2
-- Выполнять в SQL Editor нового проекта Supabase.
create extension if not exists pgcrypto;

create type public.nts_role as enum ('mechanic','quality','admin');
create type public.nts_engine_status as enum ('MAINTENANCE','VERIFIED','REBUILT');

create table public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.nts_role not null default 'mechanic',
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.current_nts_role()
returns public.nts_role language sql stable security definer
set search_path = public
as $$ select role from public.staff_roles where user_id = auth.uid() $$;

create or replace function public.is_nts_staff()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists(select 1 from public.staff_roles where user_id = auth.uid()) $$;

create table public.engine_passports (
  id uuid primary key default gen_random_uuid(),
  engine_number text not null unique,
  engine_model text not null,
  vehicle_brand text,
  vehicle_model text,
  year integer check (year is null or year between 1950 and 2100),
  engine_type text,
  serial_number text,
  order_number text,
  status public.nts_engine_status not null default 'MAINTENANCE',
  description text,
  public_summary text,
  quality_approved_by uuid references auth.users(id),
  quality_approved_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.engine_history (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.engine_passports(id) on delete cascade,
  title text not null,
  description text,
  work_date date not null default current_date,
  order_number text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.engine_photos (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.engine_passports(id) on delete cascade,
  storage_path text not null,
  caption text,
  is_public boolean not null default true,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid default auth.uid(),
  action text not null,
  table_name text not null,
  record_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
create trigger engine_passports_touch before update on public.engine_passports
for each row execute function public.touch_updated_at();

alter table public.staff_roles enable row level security;
alter table public.engine_passports enable row level security;
alter table public.engine_history enable row level security;
alter table public.engine_photos enable row level security;
alter table public.audit_log enable row level security;

-- Staff may read all records. Admin controls staff roles.
create policy "staff read roles" on public.staff_roles for select to authenticated using (public.is_nts_staff());
create policy "admin manage roles" on public.staff_roles for all to authenticated
using (public.current_nts_role()='admin') with check (public.current_nts_role()='admin');

create policy "staff read passports" on public.engine_passports for select to authenticated using (public.is_nts_staff());
create policy "mechanic quality admin insert passports" on public.engine_passports for insert to authenticated
with check (public.current_nts_role() in ('mechanic','quality','admin'));
create policy "staff update passports" on public.engine_passports for update to authenticated
using (public.is_nts_staff())
with check (
  public.is_nts_staff() and
  (status = (select p.status from public.engine_passports p where p.id = id)
   or public.current_nts_role() in ('quality','admin'))
);
create policy "admin delete passports" on public.engine_passports for delete to authenticated
using (public.current_nts_role()='admin');

create policy "staff read history" on public.engine_history for select to authenticated using (public.is_nts_staff());
create policy "staff add history" on public.engine_history for insert to authenticated with check (public.is_nts_staff());
create policy "quality admin edit history" on public.engine_history for update to authenticated
using (public.current_nts_role() in ('quality','admin')) with check (public.current_nts_role() in ('quality','admin'));
create policy "admin delete history" on public.engine_history for delete to authenticated using (public.current_nts_role()='admin');

create policy "staff read photos" on public.engine_photos for select to authenticated using (public.is_nts_staff());
create policy "staff upload photos" on public.engine_photos for insert to authenticated with check (public.is_nts_staff());
create policy "quality admin edit photos" on public.engine_photos for update to authenticated
using (public.current_nts_role() in ('quality','admin')) with check (public.current_nts_role() in ('quality','admin'));
create policy "admin delete photos" on public.engine_photos for delete to authenticated using (public.current_nts_role()='admin');
create policy "admin read audit" on public.audit_log for select to authenticated using (public.current_nts_role()='admin');

-- Public full passport RPC: intentionally exposes all technical passport fields,
-- history and public photos, but never staff emails, user IDs or private notes.
create or replace function public.public_engine_passport(p_engine_number text)
returns jsonb language plpgsql stable security definer
set search_path = public
as $$
declare p public.engine_passports; h jsonb; ph jsonb;
begin
  select * into p from public.engine_passports where upper(engine_number)=upper(trim(p_engine_number));
  if not found then return jsonb_build_object('passport',null); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date desc,x.created_at desc),'[]'::jsonb)
  into h from (select title,description,work_date,order_number,created_at from public.engine_history where passport_id=p.id) x;
  select coalesce(jsonb_agg(jsonb_build_object('url',storage_path,'caption',caption)),'[]'::jsonb)
  into ph from public.engine_photos where passport_id=p.id and is_public=true;
  return jsonb_build_object('passport',to_jsonb(p)-'created_by'-'quality_approved_by','history',h,'photos',ph);
end $$;
grant execute on function public.public_engine_passport(text) to anon, authenticated;

create or replace function public.staff_engine_passport(p_engine_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public
as $$
declare p public.engine_passports; h jsonb; ph jsonb;
begin
  if not public.is_nts_staff() then raise exception 'Not authorized'; end if;
  select * into p from public.engine_passports where id=p_engine_id;
  if not found then return jsonb_build_object('passport',null); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date desc,x.created_at desc),'[]'::jsonb)
  into h from (select * from public.engine_history where passport_id=p.id) x;
  select coalesce(jsonb_agg(jsonb_build_object('url',storage_path,'caption',caption,'is_public',is_public)),'[]'::jsonb)
  into ph from public.engine_photos where passport_id=p.id;
  return jsonb_build_object('passport',to_jsonb(p),'history',h,'photos',ph);
end $$;
grant execute on function public.staff_engine_passport(uuid) to authenticated;

-- Storage bucket: public read is required for public passport images.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('engine-photos','engine-photos',true,12582912,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "staff upload engine photos" on storage.objects for insert to authenticated
with check (bucket_id='engine-photos' and public.is_nts_staff());
create policy "public read engine photos" on storage.objects for select to anon,authenticated
using (bucket_id='engine-photos');
create policy "staff delete engine photos" on storage.objects for delete to authenticated
using (bucket_id='engine-photos' and public.current_nts_role() in ('quality','admin'));

-- Important: create the first admin account in Supabase Auth, then insert its UUID:
-- insert into public.staff_roles(user_id,role,display_name)
-- values ('AUTH-USER-UUID','admin','NTS Admin');
-- АВТОМАТИЧЕСКАЯ ВЫДАЧА ПРАВ (Supabase изменил политику по умолчанию 30.10.2026)
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;