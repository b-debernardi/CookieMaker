-- Initial schema: profiles, the Pro library (items and versions), exports,
-- subscriptions, Pro gifts, settings and the admin audit log.
--
-- Security model (see PLAN.md, "Seguridad"):
-- * Nothing is reachable from the API unless granted here. Default
--   privileges are revoked, every table has RLS, and each role gets only
--   the columns it may write.
-- * The plan a user is on is decided in one place, private.entitlement_of().
-- * Functions that need more rights than the caller are SECURITY DEFINER
--   with an empty search_path and fully qualified names.
-- * The private schema is not exposed by the API (only public is).

-- ---------------------------------------------------------------- privileges

-- Future objects: nothing for the API roles unless granted. (Postgres gives
-- EXECUTE on every new function to PUBLIC globally, which a per-schema rule
-- can't take away, hence the global line.) The objects below are also
-- revoked explicitly at the end, so this file doesn't depend on defaults.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- -------------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per user, created when the user signs up.';

-- A single row with the values Bruno changes from the admin panel.
create table public.settings (
  id boolean primary key default true check (id),
  price_usd numeric(6, 2) not null default 7.99 check (price_usd > 0),
  -- Price charged by Mercado Pago. Null until it is set from the panel.
  price_ars integer check (price_ars > 0),
  free_exports_per_month integer not null default 3 check (free_exports_per_month between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'mercadopago' check (provider in ('mercadopago')),
  -- The provider's id for the subscription (Mercado Pago preapproval id).
  provider_id text not null check (char_length(provider_id) between 1 and 100),
  status text not null check (status in ('pending', 'authorized', 'paused', 'cancelled')),
  price_ars integer check (price_ars > 0),
  -- Paid until. Pro lasts until then plus a short grace period for retries.
  current_period_end timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id)
);
create index subscriptions_user_idx on public.subscriptions (user_id);
comment on table public.subscriptions is 'Written only by the payment Edge Functions (service role).';

-- Pro given by hand: beta testers, friends, compensations.
create table public.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  until timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 200),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index grants_user_idx on public.grants (user_id);

-- A cutter in the library. The SVG is the one the app regenerates from the
-- outlines (designToSvg), never the file the user uploaded; is_clean_svg()
-- enforces that shape.
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null default '' check (char_length(category) <= 60),
  source text not null check (source in ('svg', 'image', 'text')),
  svg text not null,
  text text check (char_length(text) <= 200),
  font_id text check (font_id ~ '^[a-z0-9-]{1,40}$'),
  letter_spacing real check (letter_spacing between -20 and 40),
  thumb bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index items_user_idx on public.items (user_id, updated_at desc);

-- One size and piece of a cutter. The STL is not stored: it is rebuilt in the
-- browser from the item's SVG and these parameters.
create table public.versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  user_id uuid not null default auth.uid(),
  piece text not null check (piece in ('cutter', 'imprint', 'stamp', 'set')),
  params jsonb not null check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 16384),
  -- Longest side, mm, measured outside the cutting wall.
  size real not null check (size > 0 and size <= 1000),
  -- Saving the same size (to the mm) and piece again replaces the version.
  size_mm integer generated always as (round(size)::integer) stored,
  dims real[] not null check (array_length(dims, 1) = 3 and array_ndims(dims) = 1),
  thumb bytea,
  created_at timestamptz not null default now(),
  -- The owner is always the item's owner.
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade,
  unique (item_id, piece, size_mm)
);
create index versions_user_idx on public.versions (user_id);

create table public.exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  piece text not null check (piece in ('cutter', 'imprint', 'stamp', 'set')),
  -- Plan at the time: the free monthly limit only counts exports made without Pro.
  plan text not null check (plan in ('free', 'pro', 'pro_readonly')),
  created_at timestamptz not null default now()
);
create index exports_user_idx on public.exports (user_id, created_at);
comment on table public.exports is 'Written only by register_export().';

-- What admins did. No foreign keys, so the record survives deleted accounts.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null check (char_length(action) between 1 and 60),
  target uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ validation

-- The only SVG accepted: <svg> and <path> elements with plain attributes,
-- as designToSvg() writes it. No entities, scripts, links, styles or other
-- elements, and attribute values limited to the characters a path needs.
-- Mirrored in packages/core (isCleanSvg) and tested against each other.
create function private.is_clean_svg(svg text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
begin
  if svg is null or octet_length(svg) > 1048576 then return false; end if;
  if svg !~ '^\s*<svg[\s>]' or svg !~ '</svg>\s*$' then return false; end if;
  -- No entities, comments, CDATA, processing instructions or single quotes.
  if position('&' in svg) > 0 or svg ~ '<[!?]' or position('''' in svg) > 0 then return false; end if;
  for m in select regexp_matches(svg, '<\s*/?\s*([^\s/>]*)', 'g') loop
    if m[1] not in ('svg', 'path') then return false; end if;
  end loop;
  for m in select regexp_matches(svg, '([^\s<>"=]+)\s*=\s*"([^"]*)"', 'g') loop
    if m[1] not in ('xmlns', 'viewBox', 'd', 'fill', 'fill-rule', 'stroke', 'stroke-width',
                    'stroke-linecap', 'stroke-linejoin') then
      return false;
    end if;
    if m[1] = 'xmlns' and m[2] <> 'http://www.w3.org/2000/svg' then return false; end if;
    if m[1] <> 'xmlns' and m[2] !~ '^[A-Za-z0-9#.,\- ]*$' then return false; end if;
  end loop;
  -- Every "=" must belong to a quoted attribute matched above.
  if (select count(*) from regexp_matches(svg, '=', 'g'))
     <> (select count(*) from regexp_matches(svg, '([^\s<>"=]+)\s*=\s*"([^"]*)"', 'g')) then
    return false;
  end if;
  return true;
end $$;

-- A small PNG: the signature and a size cap.
create function private.is_small_png(b bytea) returns boolean
language sql immutable set search_path = '' as $$
  select b is null or (octet_length(b) <= 65536 and substring(b from 1 for 8) = '\x89504e470d0a1a0a'::bytea)
$$;

alter table public.items add constraint items_svg_clean check (private.is_clean_svg(svg));
alter table public.items add constraint items_thumb_png check (private.is_small_png(thumb));
alter table public.versions add constraint versions_thumb_png check (private.is_small_png(thumb));

-- ------------------------------------------------------------- plan logic

-- Days of Pro kept after a paid period ends, while Mercado Pago retries.
create function private.grace() returns interval language sql immutable set search_path = '' as $$
  select interval '3 days'
$$;

-- Until when a subscription gives Pro. ended_at, when set, is when access
-- ends (a cancelled subscription keeps Pro until the end of what was paid).
-- Otherwise an authorized one lasts its paid period plus the grace days.
-- A pending one (never paid) gives nothing.
create function private.access_until(s public.subscriptions) returns timestamptz
language sql immutable set search_path = '' as $$
  select case
    when s.status = 'pending' then null
    when s.ended_at is not null then s.ended_at
    when s.status = 'authorized' then s.current_period_end + private.grace()
    else s.current_period_end
  end
$$;

-- 'anon', 'free', 'pro' or 'pro_readonly' (Pro ended less than 6 months ago:
-- the library can be read, downloaded and deleted, not changed).
create function private.entitlement_of(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  with s as (
    select greatest(
      (select max(g.until) from public.grants g where g.user_id = uid),
      (select max(private.access_until(s)) from public.subscriptions s where s.user_id = uid)
    ) as until
  )
  select case
    when uid is null then 'anon'
    when s.until > now() then 'pro'
    when s.until > now() - interval '6 months' then 'pro_readonly'
    else 'free'
  end
  from s
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false)
$$;

-- --------------------------------------------------------------- triggers

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), ''), 80));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger items_touch before update on public.items
  for each row execute function private.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

-- Caps per account so storage stays bounded.
create function private.enforce_library_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'items' then
    perform pg_advisory_xact_lock(hashtextextended('items:' || new.user_id::text, 0));
    if (select count(*) from public.items where user_id = new.user_id) >= 500 then
      raise exception 'Llegaste al máximo de 500 cortantes.' using errcode = 'P0001', hint = 'items_limit';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('versions:' || new.item_id::text, 0));
    if (select count(*) from public.versions where item_id = new.item_id) >= 20 then
      raise exception 'Llegaste al máximo de 20 versiones por cortante.' using errcode = 'P0001', hint = 'versions_limit';
    end if;
  end if;
  return new;
end $$;

create trigger items_limit before insert on public.items
  for each row execute function private.enforce_library_limits();
create trigger versions_limit before insert on public.versions
  for each row execute function private.enforce_library_limits();

-- -------------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.subscriptions enable row level security;
alter table public.grants enable row level security;
alter table public.items enable row level security;
alter table public.versions enable row level security;
alter table public.exports enable row level security;
alter table public.audit_log enable row level security;

-- "(select ...)" makes Postgres evaluate the function once per query, not per row.
create policy "own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "anyone reads settings" on public.settings for select to anon, authenticated using (true);
create policy "admins edit settings" on public.settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "own subscriptions" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own grants" on public.grants for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own exports" on public.exports for select to authenticated
  using (user_id = (select auth.uid()));
create policy "admins read audit log" on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- Library: Pro reads and writes; after cancelling, read and delete only.
create policy "read own items" on public.items for select to authenticated
  using (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) in ('pro', 'pro_readonly'));
create policy "create own items" on public.items for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) = 'pro');
create policy "edit own items" on public.items for update to authenticated
  using (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) = 'pro')
  with check (user_id = (select auth.uid()));
create policy "delete own items" on public.items for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) in ('pro', 'pro_readonly'));

create policy "read own versions" on public.versions for select to authenticated
  using (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) in ('pro', 'pro_readonly'));
create policy "create own versions" on public.versions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) = 'pro');
create policy "edit own versions" on public.versions for update to authenticated
  using (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) = 'pro')
  with check (user_id = (select auth.uid()));
create policy "delete own versions" on public.versions for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.entitlement_of(auth.uid())) in ('pro', 'pro_readonly'));

-- ------------------------------------------------------------- table grants

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

grant select on public.settings to anon, authenticated;
grant update (price_ars, free_exports_per_month) on public.settings to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.subscriptions, public.grants, public.exports, public.audit_log to authenticated;

grant select, delete on public.items to authenticated;
grant insert (id, name, category, source, svg, text, font_id, letter_spacing, thumb) on public.items to authenticated;
grant update (name, category, svg, text, font_id, letter_spacing, thumb) on public.items to authenticated;

grant select, delete on public.versions to authenticated;
grant insert (id, item_id, piece, params, size, dims, thumb) on public.versions to authenticated;
grant update (params, size, dims, thumb) on public.versions to authenticated;

-- The service role (Edge Functions) bypasses RLS but still needs privileges.
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- -------------------------------------------------------------- API (RPC)

-- What the app needs to show the plan and the export counter.
create function public.my_plan() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  plan text := private.entitlement_of(uid);
  lim integer;
  used integer;
begin
  if uid is null then
    return jsonb_build_object('plan', plan);
  end if;
  select s.free_exports_per_month into lim from public.settings s;
  select count(*) into used from public.exports e
   where e.user_id = uid and e.plan <> 'pro'
     and e.created_at >= date_trunc('month', now(), 'America/Argentina/Buenos_Aires');
  return jsonb_build_object('plan', plan, 'free_exports_used', used, 'free_exports_limit', coalesce(lim, 3));
end $$;

-- Called right before the app writes an STL or 3MF. Counts the export and
-- says whether it is allowed:
--   {ok: true, plan, used?, limit?}
--   {ok: false, reason: 'pro_only' | 'limit' | 'rate_limited', plan, ...}
-- The file itself is built in the browser, so a determined user can skip
-- this (accepted in PLAN.md); the count is still the source of truth.
create function public.register_export(p_piece text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  plan text;
  lim integer;
  used integer;
  today integer;
begin
  if uid is null then
    raise exception 'Tenés que entrar con tu cuenta para exportar.' using errcode = '28000', hint = 'login_required';
  end if;
  if p_piece is null or p_piece not in ('cutter', 'imprint', 'stamp', 'set') then
    raise exception 'Pieza desconocida.' using errcode = '22023', hint = 'bad_piece';
  end if;
  -- One export at a time per user, so two tabs can't both take the last one.
  perform pg_advisory_xact_lock(hashtextextended('exports:' || uid::text, 0));
  plan := private.entitlement_of(uid);

  -- A ceiling for everyone, so a script can't fill the table.
  select count(*) into today from public.exports e where e.user_id = uid and e.created_at > now() - interval '1 day';
  if today >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'plan', plan);
  end if;

  if plan <> 'pro' then
    if p_piece <> 'imprint' then
      return jsonb_build_object('ok', false, 'reason', 'pro_only', 'plan', plan);
    end if;
    select s.free_exports_per_month into lim from public.settings s;
    lim := coalesce(lim, 3);
    select count(*) into used from public.exports e
     where e.user_id = uid and e.plan <> 'pro'
       and e.created_at >= date_trunc('month', now(), 'America/Argentina/Buenos_Aires');
    if used >= lim then
      return jsonb_build_object('ok', false, 'reason', 'limit', 'plan', plan, 'used', used, 'limit', lim);
    end if;
    insert into public.exports (user_id, piece, plan) values (uid, p_piece, plan);
    return jsonb_build_object('ok', true, 'plan', plan, 'used', used + 1, 'limit', lim);
  end if;

  insert into public.exports (user_id, piece, plan) values (uid, p_piece, plan);
  return jsonb_build_object('ok', true, 'plan', plan);
end $$;

-- Everything stored about the user, for "Bajar mis datos".
create function public.export_my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'thumb' || jsonb_build_object('thumb_png_base64', encode(i.thumb, 'base64')) order by i.created_at)
      from public.items i where i.user_id = auth.uid()), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(to_jsonb(v) - 'thumb' order by v.created_at)
      from public.versions v where v.user_id = auth.uid()), '[]'::jsonb),
    'exports', coalesce((
      select jsonb_agg(jsonb_build_object('piece', e.piece, 'plan', e.plan, 'created_at', e.created_at) order by e.created_at)
      from public.exports e where e.user_id = auth.uid()), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at)
      from public.subscriptions s where s.user_id = auth.uid()), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('until', g.until, 'reason', g.reason, 'created_at', g.created_at) order by g.created_at)
      from public.grants g where g.user_id = auth.uid()), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

-- Deletes the account and everything in it. A running subscription has to
-- be cancelled first, so nobody keeps being charged for a deleted account.
create function public.delete_my_account() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Tenés que entrar con tu cuenta.' using errcode = '28000', hint = 'login_required';
  end if;
  if exists (
    select 1 from public.subscriptions s
    where s.user_id = uid and s.status in ('pending', 'authorized') and s.ended_at is null
  ) then
    raise exception 'Cancelá la suscripción antes de borrar la cuenta.' using errcode = 'P0001', hint = 'subscription_active';
  end if;
  delete from auth.users where id = uid;
end $$;

-- ------------------------------------------------------- function grants

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function
  private.is_clean_svg(text), private.is_small_png(bytea), private.grace(),
  private.access_until(public.subscriptions), private.entitlement_of(uuid), private.is_admin()
  to authenticated, service_role;

grant execute on function public.my_plan() to anon, authenticated;
grant execute on function public.register_export(text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
