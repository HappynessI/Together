-- Pair Star shared journal schema. Run once in Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists profiles (
  id text primary key check (id in ('me','partner')),
  display_name text not null,
  initials text not null,
  avatar_url text,
  background_url text,
  updated_at timestamptz not null default now()
);

create table if not exists daily_logs (
  room_id text not null default 'pair',
  role_id text not null references profiles(id) on delete cascade,
  log_date date not null,
  growth_text text not null default '',
  life_text text not null default '',
  growth_score integer not null default 0 check (growth_score between 0 and 5),
  life_score integer not null default 0 check (life_score between 0 and 5),
  images jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (room_id, role_id, log_date)
);

create table if not exists wallets (
  room_id text not null default 'pair',
  role_id text not null references profiles(id) on delete cascade,
  points integer not null default 0 check (points between 0 and 99),
  stars integer not null default 0 check (stars >= 0),
  updated_at timestamptz not null default now(),
  primary key (room_id, role_id)
);

create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'pair',
  from_role_id text not null references profiles(id),
  to_role_id text not null references profiles(id),
  text text not null check (char_length(text) between 1 and 280),
  status text not null default 'pending' check (status in ('pending','accepted','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_role_id <> to_role_id)
);

create table if not exists reactions (
  room_id text not null default 'pair',
  target_role_id text not null references profiles(id) on delete cascade,
  log_date date not null,
  reactor_role_id text not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, target_role_id, log_date, reactor_role_id),
  check (target_role_id <> reactor_role_id)
);

insert into profiles (id, display_name, initials) values
  ('me', '我', '我'), ('partner', '搭档', '友')
on conflict (id) do nothing;
insert into wallets (room_id, role_id) values ('pair','me'), ('pair','partner')
on conflict (room_id, role_id) do nothing;

create or replace function save_daily_log(
  p_room_id text, p_role_id text, p_log_date date,
  p_growth_text text, p_life_text text,
  p_growth_score integer, p_life_score integer, p_images jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare old_total integer := 0; new_total integer; delta integer; next_points integer; next_stars integer;
begin
  if p_role_id not in ('me','partner') or p_room_id <> 'pair' then raise exception 'forbidden'; end if;
  if p_growth_score not between 0 and 5 or p_life_score not between 0 and 5 then raise exception 'invalid_score'; end if;
  select growth_score + life_score into old_total from daily_logs where room_id=p_room_id and role_id=p_role_id and log_date=p_log_date;
  old_total := coalesce(old_total,0); new_total := p_growth_score + p_life_score; delta := new_total-old_total;
  insert into daily_logs(room_id,role_id,log_date,growth_text,life_text,growth_score,life_score,images,updated_at)
  values(p_room_id,p_role_id,p_log_date,coalesce(p_growth_text,''),coalesce(p_life_text,''),p_growth_score,p_life_score,coalesce(p_images,'[]'::jsonb),now())
  on conflict(room_id,role_id,log_date) do update set growth_text=excluded.growth_text, life_text=excluded.life_text,
    growth_score=excluded.growth_score, life_score=excluded.life_score, images=excluded.images, updated_at=now();
  insert into wallets(room_id,role_id) values(p_room_id,p_role_id) on conflict do nothing;
  select points, stars into next_points,next_stars from wallets where room_id=p_room_id and role_id=p_role_id for update;
  next_points := next_points + delta;
  while next_points < 0 and next_stars > 0 loop next_points := next_points + 100; next_stars := next_stars - 1; end loop;
  if next_points < 0 then next_points := 0; end if;
  while next_points >= 100 loop next_points := next_points - 100; next_stars := next_stars + 1; end loop;
  update wallets set points=next_points, stars=next_stars, updated_at=now() where room_id=p_room_id and role_id=p_role_id;
  return jsonb_build_object('date',p_log_date,'points',next_points,'stars',next_stars,'delta',delta);
end $$;

create or replace function toggle_reaction(p_room_id text, p_target_role_id text, p_log_date date, p_reactor_role_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare active boolean;
begin
  if p_room_id <> 'pair' or p_target_role_id = p_reactor_role_id then raise exception 'forbidden'; end if;
  select exists(select 1 from reactions where room_id=p_room_id and target_role_id=p_target_role_id and log_date=p_log_date and reactor_role_id=p_reactor_role_id) into active;
  if active then delete from reactions where room_id=p_room_id and target_role_id=p_target_role_id and log_date=p_log_date and reactor_role_id=p_reactor_role_id;
  else insert into reactions(room_id,target_role_id,log_date,reactor_role_id) values(p_room_id,p_target_role_id,p_log_date,p_reactor_role_id); end if;
  return jsonb_build_object('active',not active);
end $$;

create or replace function create_wish(p_room_id text, p_from_role_id text, p_to_role_id text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wish_row wishes;
begin
  if p_room_id <> 'pair' or p_from_role_id = p_to_role_id then raise exception 'forbidden'; end if;
  update wallets set stars=stars-1, updated_at=now() where room_id=p_room_id and role_id=p_from_role_id and stars > 0;
  if not found then raise exception 'insufficient_stars'; end if;
  insert into wishes(room_id,from_role_id,to_role_id,text) values(p_room_id,p_from_role_id,p_to_role_id,p_text) returning * into wish_row;
  return to_jsonb(wish_row);
end $$;

create or replace function update_wish_status(p_wish_id uuid, p_actor_role_id text, p_next_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wish_row wishes;
begin
  select * into wish_row from wishes where id=p_wish_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_actor_role_id <> wish_row.to_role_id and p_actor_role_id <> wish_row.from_role_id then raise exception 'forbidden'; end if;
  if p_next_status is null then p_next_status := case when wish_row.status='pending' then 'accepted' when wish_row.status='accepted' then 'done' else 'done' end; end if;
  if p_next_status not in ('accepted','done') or (p_next_status='accepted' and wish_row.status<>'pending') or (p_next_status='done' and wish_row.status<>'accepted') then raise exception 'invalid_transition'; end if;
  update wishes set status=p_next_status, updated_at=now() where id=p_wish_id returning * into wish_row;
  return to_jsonb(wish_row);
end $$;

revoke all on all tables in schema public from anon, authenticated;
grant execute on function save_daily_log(text,text,date,text,text,integer,integer,jsonb) to anon, authenticated;
grant execute on function toggle_reaction(text,text,date,text) to anon, authenticated;
grant execute on function create_wish(text,text,text,text) to anon, authenticated;
grant execute on function update_wish_status(uuid,text,text) to anon, authenticated;

insert into storage.buckets (id, name, public) values ('pair-media','pair-media',true) on conflict (id) do update set public=true;
