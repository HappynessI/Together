-- Persistent check-in email outbox for existing Pair Star deployments.
-- Run this file once in Supabase Dashboard -> SQL Editor before deploying the
-- API version that contains /api/checkin. The migration is safe to re-run.

begin;

create extension if not exists pgcrypto;

create table if not exists public.checkin_notifications (
  id uuid primary key,
  room_id text not null default 'pair' check (room_id = 'pair'),
  role_id text not null references public.profiles(id) on delete restrict,
  log_date date not null,
  log_updated_at timestamptz not null,
  idempotency_key uuid not null,
  message_id text not null check (
    char_length(message_id) between 3 and 255
    and message_id !~ '[[:cntrl:]]'
  ),
  status text not null default 'reserved'
    check (status in ('reserved', 'sending', 'sent', 'failed', 'unknown')),
  failure_code text,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, role_id, idempotency_key)
);

create index if not exists checkin_notifications_recent_idx
  on public.checkin_notifications (room_id, role_id, created_at desc);

-- A saved log revision can have only one notification whose delivery is still
-- possible or already completed. Definitive failures are excluded so an
-- operator/user can retry with a fresh idempotency key after fixing config.
create unique index if not exists checkin_notifications_active_revision_idx
  on public.checkin_notifications (room_id, role_id, log_date, log_updated_at)
  where status in ('reserved', 'sending', 'sent', 'unknown');

drop trigger if exists checkin_notifications_touch_updated_at
  on public.checkin_notifications;
create trigger checkin_notifications_touch_updated_at
before update on public.checkin_notifications
for each row execute function public.touch_updated_at();

-- Atomically reads the canonical saved log and reserves one email delivery.
-- The API supplies p_role_id from the signed session and calls this RPC only
-- with the service-role client. Browser-provided journal text is never used.
create or replace function public.reserve_checkin_notification(
  p_room_id text,
  p_role_id text,
  p_log_date date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.daily_logs%rowtype;
  v_profile public.profiles%rowtype;
  v_notice public.checkin_notifications%rowtype;
  v_notice_id uuid;
  v_retry_after integer;
  v_action text;
begin
  if p_room_id <> 'pair'
     or p_role_id not in ('me', 'partner')
     or p_log_date is null
     or p_idempotency_key is null then
    raise exception 'forbidden: invalid check-in reservation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'checkin|' || p_room_id || '|' || p_role_id,
    0
  ));

  select * into v_notice
  from public.checkin_notifications
  where room_id = p_room_id
    and role_id = p_role_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_notice.status in ('reserved', 'sending')
       and coalesce(v_notice.lease_expires_at, v_notice.created_at) <= now() then
      update public.checkin_notifications
      set status = 'unknown',
          failure_code = 'delivery_result_unconfirmed',
          lease_expires_at = null
      where id = v_notice.id
      returning * into v_notice;
    end if;

    v_action := case v_notice.status
      when 'sent' then 'sent'
      when 'unknown' then 'unknown'
      when 'failed' then 'failed'
      else 'in_progress'
    end;
    return jsonb_build_object(
      'action', v_action,
      'notification', to_jsonb(v_notice)
    );
  end if;

  select * into v_log
  from public.daily_logs
  where room_id = p_room_id
    and role_id = p_role_id
    and log_date = p_log_date;
  if not found then
    raise exception 'checkin_log_not_found';
  end if;
  if btrim(coalesce(v_log.growth_text, '')) = ''
     and btrim(coalesce(v_log.life_text, '')) = ''
     and v_log.growth_score = 0
     and v_log.life_score = 0 then
    raise exception 'empty_checkin';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_role_id;
  if not found then
    raise exception 'not_found: profile';
  end if;

  select * into v_notice
  from public.checkin_notifications
  where room_id = p_room_id
    and role_id = p_role_id
    and log_date = p_log_date
    and log_updated_at = v_log.updated_at
    and status in ('reserved', 'sending', 'sent', 'unknown')
  order by created_at desc
  limit 1;

  if found then
    if v_notice.status in ('reserved', 'sending')
       and coalesce(v_notice.lease_expires_at, v_notice.created_at) <= now() then
      update public.checkin_notifications
      set status = 'unknown',
          failure_code = 'delivery_result_unconfirmed',
          lease_expires_at = null
      where id = v_notice.id
      returning * into v_notice;
    end if;

    v_action := case v_notice.status
      when 'sent' then 'sent'
      when 'unknown' then 'unknown'
      else 'in_progress'
    end;
    return jsonb_build_object(
      'action', v_action,
      'notification', to_jsonb(v_notice)
    );
  end if;

  select greatest(
           1,
           ceil(extract(epoch from ((created_at + interval '60 seconds') - now())))::integer
         )
    into v_retry_after
  from public.checkin_notifications
  where room_id = p_room_id
    and role_id = p_role_id
    and status <> 'failed'
    and created_at > now() - interval '60 seconds'
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'action', 'rate_limited',
      'retry_after', v_retry_after
    );
  end if;

  v_notice_id := gen_random_uuid();
  insert into public.checkin_notifications (
    id, room_id, role_id, log_date, log_updated_at,
    idempotency_key, message_id, status, lease_expires_at
  ) values (
    v_notice_id, p_room_id, p_role_id, p_log_date, v_log.updated_at,
    p_idempotency_key,
    '<pair-' || v_notice_id::text || '@pair-star-journal>',
    'reserved',
    now() + interval '45 seconds'
  )
  returning * into v_notice;

  return jsonb_build_object(
    'action', 'send',
    'notification', to_jsonb(v_notice),
    'role_name', v_profile.display_name,
    'log', jsonb_build_object(
      'date', v_log.log_date,
      'growthText', v_log.growth_text,
      'lifeText', v_log.life_text,
      'growthScore', v_log.growth_score,
      'lifeScore', v_log.life_score
    )
  );
end;
$$;

alter table public.checkin_notifications enable row level security;

revoke all on table public.checkin_notifications from public, anon, authenticated;
grant all on table public.checkin_notifications to service_role;

revoke execute on function public.reserve_checkin_notification(text,text,date,uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_checkin_notification(text,text,date,uuid)
  to service_role;

commit;
