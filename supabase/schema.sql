-- 并肩 · 固定双人共享空间
--
-- 在 Supabase Dashboard → SQL Editor 中完整执行一次。
-- 浏览器不会直接连接 Supabase；Vercel API 使用 service role key 访问这些表，
-- 所以 anon/authenticated 默认没有业务表和 RPC 的权限。

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id text primary key check (id in ('me', 'partner')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  initials text not null check (char_length(initials) between 1 and 4),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  avatar_url text,
  background_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists theme text not null default 'light';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.daily_logs (
  room_id text not null default 'pair' check (room_id = 'pair'),
  role_id text not null references public.profiles(id) on delete restrict,
  log_date date not null,
  growth_text text not null default '' check (char_length(growth_text) <= 50000),
  life_text text not null default '' check (char_length(life_text) <= 50000),
  growth_score smallint not null default 0 check (growth_score between 0 and 5),
  life_score smallint not null default 0 check (life_score between 0 and 5),
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, role_id, log_date)
);

create table if not exists public.wallets (
  room_id text not null default 'pair' check (room_id = 'pair'),
  role_id text not null references public.profiles(id) on delete restrict,
  -- Cached projection. The RPCs recalculate these values from logs/wishes;
  -- they are never accepted from the browser.
  lifetime_points bigint not null default 0 check (lifetime_points >= 0),
  points integer not null default 0 check (points between 0 and 99),
  stars integer not null default 0 check (stars >= 0),
  updated_at timestamptz not null default now(),
  primary key (room_id, role_id)
);

alter table public.wallets add column if not exists lifetime_points bigint not null default 0;

create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'pair' check (room_id = 'pair'),
  from_role_id text not null references public.profiles(id) on delete restrict,
  to_role_id text not null references public.profiles(id) on delete restrict,
  text text not null check (char_length(btrim(text)) between 1 and 280),
  cost smallint not null default 1 check (cost = 1),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'done')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  check (from_role_id <> to_role_id)
);

alter table public.wishes add column if not exists cost smallint not null default 1;
alter table public.wishes add column if not exists accepted_at timestamptz;
alter table public.wishes add column if not exists done_at timestamptz;

create table if not exists public.reactions (
  room_id text not null default 'pair' check (room_id = 'pair'),
  target_role_id text not null references public.profiles(id) on delete restrict,
  log_date date not null,
  reactor_role_id text not null references public.profiles(id) on delete restrict,
  kind text not null default 'heart' check (kind = 'heart'),
  created_at timestamptz not null default now(),
  primary key (room_id, target_role_id, log_date, reactor_role_id, kind),
  check (target_role_id <> reactor_role_id)
);

alter table public.reactions add column if not exists kind text not null default 'heart';
alter table public.reactions add column if not exists created_at timestamptz not null default now();

create index if not exists daily_logs_recent_idx
  on public.daily_logs (room_id, log_date desc, role_id);
create index if not exists wishes_recent_idx
  on public.wishes (room_id, created_at desc);
create index if not exists wishes_recipient_status_idx
  on public.wishes (to_role_id, status, created_at desc);
create index if not exists reactions_log_idx
  on public.reactions (room_id, target_role_id, log_date);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists daily_logs_touch_updated_at on public.daily_logs;
create trigger daily_logs_touch_updated_at
before update on public.daily_logs
for each row execute function public.touch_updated_at();

drop trigger if exists wallets_touch_updated_at on public.wallets;
create trigger wallets_touch_updated_at
before update on public.wallets
for each row execute function public.touch_updated_at();

drop trigger if exists wishes_touch_updated_at on public.wishes;
create trigger wishes_touch_updated_at
before update on public.wishes
for each row execute function public.touch_updated_at();

insert into public.profiles (id, display_name, initials, theme)
values
  ('me', '我', '我', 'light'),
  ('partner', '搭档', '友', 'light')
on conflict (id) do nothing;

insert into public.wallets (room_id, role_id)
values ('pair', 'me'), ('pair', 'partner')
on conflict (room_id, role_id) do nothing;

-- Deterministic wallet projection.  A Star is earned by current score and
-- consumed by a wish; editing a log can never mint a duplicate Star.
drop view if exists public.wallet_summary;
create or replace view public.wallet_summary
with (security_invoker = true)
as
with totals as (
  select role_id,
         coalesce(sum(growth_score + life_score), 0)::bigint as lifetime_points
  from public.daily_logs
  where room_id = 'pair'
  group by role_id
), spent as (
  select from_role_id as role_id,
         coalesce(sum(cost), 0)::bigint as spent_stars
  from public.wishes
  where room_id = 'pair'
  group by from_role_id
)
select
  p.id as role_id,
  'pair'::text as room_id,
  coalesce(t.lifetime_points, 0)::bigint as lifetime_points,
  mod(coalesce(t.lifetime_points, 0), 100)::integer as points,
  floor(coalesce(t.lifetime_points, 0) / 100.0)::bigint as earned_stars,
  coalesce(s.spent_stars, 0)::bigint as spent_stars,
  greatest(
    floor(coalesce(t.lifetime_points, 0) / 100.0)::bigint - coalesce(s.spent_stars, 0),
    0
  )::integer as stars,
  (100 - mod(coalesce(t.lifetime_points, 0), 100))::integer as points_to_next_star
from public.profiles p
left join totals t on t.role_id = p.id
left join spent s on s.role_id = p.id;

-- Save/edit a log and reconcile the wallet in one transaction.  The advisory
-- lock is per member, so saving two different dates cannot lose points.
create or replace function public.save_daily_log(
  p_room_id text,
  p_role_id text,
  p_log_date date,
  p_growth_text text,
  p_life_text text,
  p_growth_score integer,
  p_life_score integer,
  p_images jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_earned bigint;
  v_spent bigint;
  v_points integer;
  v_stars bigint;
  v_log jsonb;
begin
  if p_room_id <> 'pair' or p_role_id not in ('me', 'partner') then
    raise exception 'forbidden: invalid room or role';
  end if;
  if p_log_date is null
     or p_growth_score is null or p_life_score is null
     or p_growth_score not between 0 and 5
     or p_life_score not between 0 and 5 then
    raise exception 'invalid_score';
  end if;
  if char_length(coalesce(p_growth_text, '')) > 50000
     or char_length(coalesce(p_life_text, '')) > 50000 then
    raise exception 'invalid_text';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'invalid_images';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('wallet|' || p_room_id || '|' || p_role_id, 0));

  insert into public.daily_logs (
    room_id, role_id, log_date, growth_text, life_text,
    growth_score, life_score, images
  ) values (
    p_room_id, p_role_id, p_log_date,
    coalesce(p_growth_text, ''), coalesce(p_life_text, ''),
    p_growth_score, p_life_score, p_images
  )
  on conflict (room_id, role_id, log_date) do update set
    growth_text = excluded.growth_text,
    life_text = excluded.life_text,
    growth_score = excluded.growth_score,
    life_score = excluded.life_score,
    images = excluded.images;

  select coalesce(sum(growth_score + life_score), 0)::bigint
    into v_total
  from public.daily_logs
  where room_id = p_room_id and role_id = p_role_id;
  select floor(v_total / 100.0)::bigint into v_earned;
  select coalesce(sum(cost), 0)::bigint into v_spent
  from public.wishes
  where room_id = p_room_id and from_role_id = p_role_id;
  if v_earned < v_spent then
    raise exception 'insufficient_stars: score would be below spent Stars';
  end if;

  v_points := mod(v_total, 100)::integer;
  v_stars := v_earned - v_spent;
  insert into public.wallets (room_id, role_id, lifetime_points, points, stars)
  values (p_room_id, p_role_id, v_total, v_points, v_stars::integer)
  on conflict (room_id, role_id) do update set
    lifetime_points = excluded.lifetime_points,
    points = excluded.points,
    stars = excluded.stars;

  select to_jsonb(d) into v_log
  from public.daily_logs d
  where d.room_id = p_room_id and d.role_id = p_role_id and d.log_date = p_log_date;
  return jsonb_build_object(
    'log', v_log,
    'wallet', jsonb_build_object('points', v_points, 'stars', v_stars)
  );
end;
$$;

create or replace function public.create_wish(
  p_room_id text,
  p_from_role_id text,
  p_to_role_id text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_earned bigint;
  v_spent bigint;
  v_wish public.wishes%rowtype;
begin
  if p_room_id <> 'pair'
     or p_from_role_id not in ('me', 'partner')
     or p_to_role_id not in ('me', 'partner')
     or p_from_role_id = p_to_role_id then
    raise exception 'forbidden: invalid room or roles';
  end if;
  if char_length(btrim(coalesce(p_text, ''))) not between 1 and 280 then
    raise exception 'invalid_wish';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('wallet|' || p_room_id || '|' || p_from_role_id, 0));
  select coalesce(sum(growth_score + life_score), 0)::bigint into v_total
  from public.daily_logs where room_id = p_room_id and role_id = p_from_role_id;
  v_earned := floor(v_total / 100.0)::bigint;
  select coalesce(sum(cost), 0)::bigint into v_spent
  from public.wishes where room_id = p_room_id and from_role_id = p_from_role_id;
  if v_earned - v_spent < 1 then
    raise exception 'insufficient_stars';
  end if;

  insert into public.wishes (room_id, from_role_id, to_role_id, text, cost)
  values (p_room_id, p_from_role_id, p_to_role_id, btrim(p_text), 1)
  returning * into v_wish;

  insert into public.wallets (room_id, role_id, lifetime_points, points, stars)
  values (p_room_id, p_from_role_id, v_total, mod(v_total, 100)::integer, (v_earned - v_spent - 1)::integer)
  on conflict (room_id, role_id) do update set
    lifetime_points = excluded.lifetime_points,
    points = excluded.points,
    stars = excluded.stars;
  return to_jsonb(v_wish);
end;
$$;

create or replace function public.update_wish_status(
  p_wish_id uuid,
  p_actor_role_id text,
  p_next_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wish public.wishes%rowtype;
  v_next text;
begin
  if p_actor_role_id not in ('me', 'partner') then
    raise exception 'forbidden: invalid role';
  end if;
  select * into v_wish from public.wishes where id = p_wish_id for update;
  if not found then raise exception 'not_found: wish'; end if;
  if v_wish.to_role_id <> p_actor_role_id then
    raise exception 'forbidden: only recipient can update wish';
  end if;
  v_next := coalesce(
    p_next_status,
    case v_wish.status when 'pending' then 'accepted' when 'accepted' then 'done' else null end
  );
  if not (
    (v_wish.status = 'pending' and v_next = 'accepted')
    or (v_wish.status = 'accepted' and v_next = 'done')
  ) then
    raise exception 'invalid_transition';
  end if;
  update public.wishes
  set status = v_next,
      accepted_at = case when v_next = 'accepted' then now() else accepted_at end,
      done_at = case when v_next = 'done' then now() else done_at end
  where id = p_wish_id
  returning * into v_wish;
  return to_jsonb(v_wish);
end;
$$;

create or replace function public.toggle_reaction(
  p_room_id text,
  p_target_role_id text,
  p_log_date date,
  p_reactor_role_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
  v_active boolean;
  v_count integer;
  v_by jsonb;
begin
  if p_room_id <> 'pair'
     or p_target_role_id not in ('me', 'partner')
     or p_reactor_role_id not in ('me', 'partner')
     or p_target_role_id = p_reactor_role_id
     or p_log_date is null then
    raise exception 'forbidden: invalid reaction';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'reaction|' || p_room_id || '|' || p_target_role_id || '|' || p_log_date::text || '|' || p_reactor_role_id,
    0
  ));
  delete from public.reactions
  where room_id = p_room_id and target_role_id = p_target_role_id
    and log_date = p_log_date and reactor_role_id = p_reactor_role_id and kind = 'heart';
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    insert into public.reactions (room_id, target_role_id, log_date, reactor_role_id, kind)
    values (p_room_id, p_target_role_id, p_log_date, p_reactor_role_id, 'heart');
    v_active := true;
  else
    v_active := false;
  end if;
  select count(*)::integer,
         coalesce(jsonb_agg(reactor_role_id order by reactor_role_id), '[]'::jsonb)
    into v_count, v_by
  from public.reactions
  where room_id = p_room_id and target_role_id = p_target_role_id
    and log_date = p_log_date and kind = 'heart';
  return jsonb_build_object('active', v_active, 'count', v_count, 'by', v_by);
end;
$$;

-- The server supplies p_role_id exclusively from the signed session.  The
-- RPC limits the update to that one fixed profile; the browser cannot choose
-- another member as an update target.
create or replace function public.update_profile_display_name(
  p_role_id text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_name text;
begin
  if p_role_id not in ('me', 'partner') then
    raise exception 'forbidden: invalid role';
  end if;
  v_name := btrim(coalesce(p_display_name, ''));
  if char_length(v_name) not between 1 and 16
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_display_name';
  end if;
  update public.profiles
  set display_name = v_name
  where id = p_role_id
  returning * into v_profile;
  if not found then
    raise exception 'not_found: profile';
  end if;
  return jsonb_build_object(
    'id', v_profile.id,
    'displayName', v_profile.display_name,
    'initials', v_profile.initials
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.daily_logs enable row level security;
alter table public.wallets enable row level security;
alter table public.wishes enable row level security;
alter table public.reactions enable row level security;

revoke all on table public.profiles, public.daily_logs, public.wallets,
  public.wishes, public.reactions from anon, authenticated;
revoke all on table public.wallet_summary from anon, authenticated;
grant all on table public.profiles, public.daily_logs, public.wallets,
  public.wishes, public.reactions to service_role;
grant select on table public.wallet_summary to service_role;

revoke execute on function public.save_daily_log(text,text,date,text,text,integer,integer,jsonb)
  from public, anon, authenticated;
revoke execute on function public.create_wish(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.update_wish_status(uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.toggle_reaction(text,text,date,text)
  from public, anon, authenticated;
revoke execute on function public.update_profile_display_name(text,text)
  from public, anon, authenticated;
grant execute on function public.save_daily_log(text,text,date,text,text,integer,integer,jsonb) to service_role;
grant execute on function public.create_wish(text,text,text,text) to service_role;
grant execute on function public.update_wish_status(uuid,text,text) to service_role;
grant execute on function public.toggle_reaction(text,text,date,text) to service_role;
grant execute on function public.update_profile_display_name(text,text) to service_role;

-- The API uploads with service_role and issues short-lived signed URLs to the
-- authenticated browser sessions. The stored files themselves stay private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pair-media', 'pair-media', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
