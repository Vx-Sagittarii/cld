-- iwi2me : base en ligne (Supabase / Postgres)
-- Principe : chaque profil a un jeton secret (le "lien unique"). Les tables sont verrouillées
-- (RLS activée, aucune politique = personne ne peut les lire directement). L'appli n'accède
-- aux données que par les fonctions ci-dessous, qui vérifient le jeton.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id        text primary key,
  name      text not null,
  color     text not null,
  is_admin  boolean not null default false,
  token     uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists events (
  id    text primary key,
  title text not null,
  date  date not null,
  time  text not null default '',
  owner text not null references profiles(id) on delete cascade,
  scope text not null check (scope in ('perso','commun')),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id       text primary key,
  title    text not null,
  period   text not null check (period in ('day','week','month','year')),
  key      text not null,
  progress int  not null default 0 check (progress between 0 and 100),
  owner    text not null references profiles(id) on delete cascade,
  scope    text not null check (scope in ('perso','commun')),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table events   enable row level security;
alter table tasks    enable row level security;
-- Aucune politique : accès direct refusé à tout le monde (clé anon comprise).

-- ---------- Outils internes ----------
create or replace function _me(p_token uuid) returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where token = p_token limit 1;
$$;

create or replace function _is_pair(p_id text) returns boolean
language sql immutable as $$ select p_id in ('nelson','sophie'); $$;

-- Un profil peut écrire pour lui-même ; Nelson et Sophie peuvent aussi écrire l'un pour l'autre.
create or replace function _can_write(p_me text, p_owner text, p_scope text) returns boolean
language sql immutable as $$
  select case
    when p_scope = 'commun' then _is_pair(p_me)
    else p_me = p_owner or (_is_pair(p_me) and _is_pair(p_owner))
  end;
$$;

-- ---------- Première installation ----------
-- Crée Nelson (admin) et Sophie si la table est vide, et renvoie leurs liens secrets UNE fois.
create or replace function bootstrap_admin() returns json
language plpgsql security definer set search_path = public as $$
declare n profiles; s profiles;
begin
  if exists (select 1 from profiles) then raise exception 'déjà initialisé'; end if;
  insert into profiles(id,name,color,is_admin) values ('nelson','Nelson','#8B45D9',true) returning * into n;
  insert into profiles(id,name,color)          values ('sophie','Sophie','#FF8A3D')      returning * into s;
  return json_build_object('nelson', n.token, 'sophie', s.token);
end $$;

-- ---------- Lecture ----------
create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin),
    -- Les profils visibles : Nelson et Sophie se voient ; l'admin voit tout le monde ; les autres se voient seuls
    'profiles', coalesce((select json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin) order by created_at)
                          from profiles
                          where me.is_admin or id = me.id or (_is_pair(me.id) and _is_pair(id))), '[]'::json),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope))
                        from events where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json)
  );
end $$;

-- ---------- Écriture ----------
create or replace function upsert_event(p_token uuid, p_id text, p_title text, p_date date, p_time text, p_owner text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into events(id,title,date,time,owner,scope) values (p_id,p_title,p_date,coalesce(p_time,''),p_owner,p_scope)
  on conflict (id) do update set title=excluded.title, date=excluded.date, time=excluded.time, updated_at=now()
    where _can_write(me.id, events.owner, events.scope);
end $$;

create or replace function delete_event(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from events where id = p_id and _can_write(me.id, owner, scope);
end $$;

create or replace function upsert_task(p_token uuid, p_id text, p_title text, p_period text, p_key text, p_progress int, p_owner text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into tasks(id,title,period,key,progress,owner,scope) values (p_id,p_title,p_period,p_key,p_progress,p_owner,p_scope)
  on conflict (id) do update set title=excluded.title, progress=excluded.progress, updated_at=now()
    where _can_write(me.id, tasks.owner, tasks.scope);
end $$;

create or replace function delete_task(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from tasks where id = p_id and _can_write(me.id, owner, scope);
end $$;

-- ---------- Gestion des profils (admin = Nelson) ----------
create or replace function create_profile(p_token uuid, p_id text, p_name text, p_color text) returns json
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); np profiles;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  insert into profiles(id,name,color) values (p_id,p_name,p_color) returning * into np;
  return json_build_object('id', np.id, 'token', np.token);
end $$;

create or replace function rename_profile(p_token uuid, p_id text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not (me.is_admin or me.id = p_id) then raise exception 'interdit'; end if;
  update profiles set name = p_name where id = p_id;
end $$;

create or replace function delete_profile(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin or _is_pair(p_id) then raise exception 'interdit'; end if;
  delete from profiles where id = p_id;
end $$;

-- Renvoie le lien d'un profil (admin) ; regenerate = true invalide l'ancien lien.
create or replace function get_profile_link(p_token uuid, p_id text, p_regenerate boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); t uuid;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  if p_regenerate then update profiles set token = gen_random_uuid() where id = p_id; end if;
  select token into t from profiles where id = p_id;
  return t;
end $$;

-- Seules ces fonctions sont appelables depuis l'appli (clé anon)
revoke all on function _me(uuid), _is_pair(text), _can_write(text,text,text) from public, anon, authenticated;
revoke all on function bootstrap_admin(), get_data(uuid),
  upsert_event(uuid,text,text,date,text,text,text), delete_event(uuid,text),
  upsert_task(uuid,text,text,text,text,int,text,text), delete_task(uuid,text),
  create_profile(uuid,text,text,text), rename_profile(uuid,text,text), delete_profile(uuid,text),
  get_profile_link(uuid,text,boolean) from public;
grant execute on function bootstrap_admin(), get_data(uuid),
  upsert_event(uuid,text,text,date,text,text,text), delete_event(uuid,text),
  upsert_task(uuid,text,text,text,text,int,text,text), delete_task(uuid,text),
  create_profile(uuid,text,text,text), rename_profile(uuid,text,text), delete_profile(uuid,text),
  get_profile_link(uuid,text,boolean) to anon, authenticated;

-- ---------- Migration 2 : qui peut modifier quoi ----------
alter table events add column if not exists created_by text;
alter table tasks  add column if not exists created_by text;
update events set created_by = owner where created_by is null;
update tasks  set created_by = owner where created_by is null;

-- Créer pour l'autre est permis ; modifier/supprimer seulement ce qui est à soi ou qu'on a créé soi-même.
create or replace function _can_modify(p_me text, p_owner text, p_scope text, p_created_by text) returns boolean
language sql immutable as $$
  select case when p_scope = 'commun' then _is_pair(p_me)
              else p_me = p_owner or p_me = coalesce(p_created_by, p_owner) end;
$$;

create or replace function upsert_event(p_token uuid, p_id text, p_title text, p_date date, p_time text, p_owner text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into events(id,title,date,time,owner,scope,created_by) values (p_id,p_title,p_date,coalesce(p_time,''),p_owner,p_scope,me.id)
  on conflict (id) do update set title=excluded.title, date=excluded.date, time=excluded.time, updated_at=now()
    where _can_modify(me.id, events.owner, events.scope, events.created_by);
end $$;

create or replace function delete_event(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from events where id = p_id and _can_modify(me.id, owner, scope, created_by);
end $$;

create or replace function upsert_task(p_token uuid, p_id text, p_title text, p_period text, p_key text, p_progress int, p_owner text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into tasks(id,title,period,key,progress,owner,scope,created_by) values (p_id,p_title,p_period,p_key,p_progress,p_owner,p_scope,me.id)
  on conflict (id) do update set title=excluded.title, progress=excluded.progress, updated_at=now()
    where _can_modify(me.id, tasks.owner, tasks.scope, tasks.created_by);
end $$;

create or replace function delete_task(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from tasks where id = p_id and _can_modify(me.id, owner, scope, created_by);
end $$;

revoke all on function _can_modify(text,text,text,text) from public, anon, authenticated;
revoke all on function upsert_event(uuid,text,text,date,text,text,text), delete_event(uuid,text),
  upsert_task(uuid,text,text,text,text,int,text,text), delete_task(uuid,text) from public;
grant execute on function upsert_event(uuid,text,text,date,text,text,text), delete_event(uuid,text),
  upsert_task(uuid,text,text,text,text,int,text,text), delete_task(uuid,text) to anon, authenticated;
-- ---------- Migration 3 : meta événements, % de Sophie, notifications ----------
alter table events add column if not exists meta text not null default '';
alter table tasks  add column if not exists progress_b int not null default 0 check (progress_b between 0 and 100);

create table if not exists push_subs (
  id bigserial primary key,
  profile_id text not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create table if not exists reminders_sent (
  event_id text not null,
  occ_date date not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occ_date)
);
alter table push_subs enable row level security;
alter table reminders_sent enable row level security;

drop function if exists upsert_event(uuid,text,text,date,text,text,text);
create or replace function upsert_event(p_token uuid, p_id text, p_title text, p_date date, p_time text, p_owner text, p_scope text, p_meta text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into events(id,title,date,time,owner,scope,created_by,meta) values (p_id,p_title,p_date,coalesce(p_time,''),p_owner,p_scope,me.id,coalesce(p_meta,''))
  on conflict (id) do update set title=excluded.title, date=excluded.date, time=excluded.time, meta=excluded.meta, updated_at=now()
    where _can_modify(me.id, events.owner, events.scope, events.created_by);
  delete from reminders_sent where event_id = p_id;
end $$;

drop function if exists upsert_task(uuid,text,text,text,text,int,text,text);
create or replace function upsert_task(p_token uuid, p_id text, p_title text, p_period text, p_key text, p_progress int, p_owner text, p_scope text, p_progress_b int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into tasks(id,title,period,key,progress,progress_b,owner,scope,created_by) values (p_id,p_title,p_period,p_key,p_progress,coalesce(p_progress_b,0),p_owner,p_scope,me.id)
  on conflict (id) do update set title=excluded.title, progress=excluded.progress, progress_b=excluded.progress_b, updated_at=now()
    where _can_modify(me.id, tasks.owner, tasks.scope, tasks.created_by);
end $$;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin),
    'profiles', coalesce((select json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin) order by created_at)
                          from profiles
                          where me.is_admin or id = me.id or (_is_pair(me.id) and _is_pair(id))), '[]'::json),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope,'meta',meta))
                        from events where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'progress_b',progress_b,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json)
  );
end $$;

create or replace function save_sub(p_token uuid, p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  insert into push_subs(profile_id,endpoint,p256dh,auth) values (me.id,p_endpoint,p_p256dh,p_auth)
  on conflict (endpoint) do update set profile_id = me.id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function delete_sub(p_token uuid, p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from push_subs where endpoint = p_endpoint and profile_id = me.id;
end $$;

revoke all on function upsert_event(uuid,text,text,date,text,text,text,text), upsert_task(uuid,text,text,text,text,int,text,text,int),
  get_data(uuid), save_sub(uuid,text,text,text), delete_sub(uuid,text) from public;
grant execute on function upsert_event(uuid,text,text,date,text,text,text,text), upsert_task(uuid,text,text,text,text,int,text,text,int),
  get_data(uuid), save_sub(uuid,text,text,text), delete_sub(uuid,text) to anon, authenticated;

-- ============ Migration 4 : connexion par e-mail + code numérique ============
-- Plus de lien secret : on se connecte avec son e-mail et un code. Le code n'est jamais stocké en clair
-- (empreinte bcrypt). Après 5 erreurs, la connexion est bloquée 15 minutes.
-- Si un profil n'a pas encore d'e-mail (cas de Sophie), le premier e-mail saisi avec le bon code est enregistré.
alter table profiles add column if not exists email text, add column if not exists pin_hash text;

create table if not exists login_throttle (k text primary key, fails int not null default 0, locked_until timestamptz);
alter table login_throttle enable row level security;

create or replace function login(p_email text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p profiles; em text := lower(trim(coalesce(p_email, ''))); th login_throttle; kk text; nf int;
begin
  select * into p from profiles where lower(email) = em and pin_hash is not null;
  kk := coalesce(p.id, '*nouveau');
  select * into th from login_throttle where k = kk;
  if th.locked_until is not null and th.locked_until > now() then
    return json_build_object('error', 'Trop de tentatives, réessaie dans 15 minutes.');
  end if;
  if p.id is null and em like '%@%' then   -- premier accès d'un profil sans e-mail : on vérifie le code seul
    select * into p from profiles where email is null and pin_hash is not null and pin_hash = crypt(coalesce(p_pin, ''), pin_hash) limit 1;
    if p.id is not null then update profiles set email = em where id = p.id; end if;
  elsif p.id is not null and p.pin_hash <> crypt(coalesce(p_pin, ''), p.pin_hash) then
    p := null;
  end if;
  if p.id is null then
    nf := case when th.k is null or (th.locked_until is not null and th.locked_until <= now()) then 1 else th.fails + 1 end;
    insert into login_throttle(k, fails, locked_until) values (kk, nf, case when nf >= 5 then now() + interval '15 minutes' end)
      on conflict (k) do update set fails = excluded.fails, locked_until = excluded.locked_until;
    return json_build_object('error', 'E-mail ou code incorrect.');   -- pas d''exception : elle annulerait le compteur d''essais
  end if;
  delete from login_throttle where k = kk;
  return json_build_object('token', p.token, 'id', p.id);
end $$;

drop function if exists get_profile_link(uuid, text, boolean);   -- plus de lien secret à distribuer
revoke all on function login(text, text) from public;
grant execute on function login(text, text) to anon, authenticated;

-- ============ Migration 5 : code numérique uniquement + changement de code validé par e-mail ============
alter table profiles add column if not exists chg_hash text, add column if not exists chg_pin text,
  add column if not exists chg_expires timestamptz, add column if not exists chg_fails int not null default 0;

-- Connexion : tout ce qui n'est pas 4 à 12 chiffres est refusé
create or replace function login(p_email text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p profiles; em text := lower(trim(coalesce(p_email, ''))); th login_throttle; kk text; nf int; lim int;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,12}$' then p_pin := ''; end if;   -- non numérique : jamais accepté
  select * into p from profiles where lower(email) = em and pin_hash is not null;
  kk := coalesce(p.id, '*nouveau');
  lim := case when kk in ('*nouveau', 'sophie') then 10 else 5 end;   -- 10 essais pour la 1re connexion / Sophie, 5 sinon
  select * into th from login_throttle where k = kk;
  if th.locked_until is not null and th.locked_until > now() then
    return json_build_object('error', 'Trop de tentatives, réessaie dans 15 minutes.');
  end if;
  if p_pin <> '' and p.id is null and em like '%@%' then
    select * into p from profiles where email is null and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash) limit 1;
    if p.id is not null then update profiles set email = em where id = p.id; end if;
  elsif p.id is not null and (p_pin = '' or p.pin_hash <> crypt(p_pin, p.pin_hash)) then
    p := null;
  end if;
  if p.id is null then
    nf := case when th.k is null or (th.locked_until is not null and th.locked_until <= now()) then 1 else th.fails + 1 end;
    insert into login_throttle(k, fails, locked_until) values (kk, nf, case when nf >= lim then now() + interval '15 minutes' end)
      on conflict (k) do update set fails = excluded.fails, locked_until = excluded.locked_until;
    return json_build_object('error', 'E-mail ou code incorrect.');
  end if;
  delete from login_throttle where k = kk;
  return json_build_object('token', p.token, 'id', p.id);
end $$;

-- Changement de code direct (chiffres uniquement) : exige l'ancien code ; 5 erreurs = blocage 15 min ; les autres appareils sont déconnectés
create or replace function change_pin(p_token uuid, p_old text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p profiles := _me(p_token); th login_throttle; kk text := 'chg-' || p.id; nf int; nt uuid;
begin
  if p_new is null or p_new !~ '^[0-9]{6,12}$' then return json_build_object('error', 'Le code doit contenir uniquement des chiffres (6 à 12).'); end if;
  select * into th from login_throttle where k = kk;
  if th.locked_until is not null and th.locked_until > now() then return json_build_object('error', 'Trop d''erreurs, réessaie dans 15 minutes.'); end if;
  if p_old is null or p_old !~ '^[0-9]{4,12}$' or p.pin_hash is null or p.pin_hash <> crypt(p_old, p.pin_hash) then
    nf := case when th.k is null or (th.locked_until is not null and th.locked_until <= now()) then 1 else th.fails + 1 end;
    insert into login_throttle(k, fails, locked_until) values (kk, nf, case when nf >= 5 then now() + interval '15 minutes' end)
      on conflict (k) do update set fails = excluded.fails, locked_until = excluded.locked_until;
    return json_build_object('error', 'Code actuel incorrect.');
  end if;
  delete from login_throttle where k = kk;
  nt := gen_random_uuid();
  update profiles set pin_hash = crypt(p_new, gen_salt('bf')), token = nt where id = p.id;
  return json_build_object('token', nt);
end $$;
revoke all on function change_pin(uuid, text, text) from public;
grant execute on function change_pin(uuid, text, text) to anon, authenticated;
drop function if exists request_pin_change(uuid, text);
drop function if exists confirm_pin_change(uuid, text);

-- ============ Migration 6 : chacun enregistre SON avancement sur une tâche commune ============
-- Avant : l'enregistrement renvoyait toute la tâche, ce qui était refusé pour une tâche créée par l'autre
-- (et pouvait écraser son %). Maintenant : set_progress ne modifie que la part de la personne connectée.
create or replace function set_progress(p_token uuid, p_id text, p_value int) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); t tasks; v int := greatest(0, least(100, coalesce(p_value, 0)));
begin
  select * into t from tasks where id = p_id;
  if not found then raise exception 'introuvable'; end if;
  if t.scope = 'commun' and _is_pair(me.id) then
    if me.id = 'sophie' then update tasks set progress_b = v, updated_at = now() where id = p_id;
    else update tasks set progress = v, updated_at = now() where id = p_id; end if;
  elsif t.owner = me.id then
    update tasks set progress = v, updated_at = now() where id = p_id;
  else
    raise exception 'interdit';
  end if;
end $$;
revoke all on function set_progress(uuid, text, int) from public;
grant execute on function set_progress(uuid, text, int) to anon, authenticated;

-- upsert_task ne touche plus aux pourcentages d'une tâche existante (seulement le titre)
create or replace function upsert_task(p_token uuid, p_id text, p_title text, p_period text, p_key text, p_progress int, p_owner text, p_scope text, p_progress_b int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into tasks(id,title,period,key,progress,progress_b,owner,scope,created_by) values (p_id,p_title,p_period,p_key,p_progress,coalesce(p_progress_b,0),p_owner,p_scope,me.id)
  on conflict (id) do update set title=excluded.title, updated_at=now()
    where _can_modify(me.id, tasks.owner, tasks.scope, tasks.created_by);
end $$;

-- ============ Migration 7 : Google Agenda partageable ============
-- Si on active « Partager », l'appli envoie une copie des événements Google (titre, date, heure) pour que
-- l'autre les voie en lecture seule. Rien n'est envoyé tant que le partage est désactivé ; en le désactivant, la copie est effacée.
alter table profiles add column if not exists gcal_shared boolean not null default false;
create table if not exists gcal_events (
  id text not null, owner text not null references profiles(id) on delete cascade,
  title text not null, date date not null, time text not null default '',
  primary key (owner, id)
);
alter table gcal_events enable row level security;

create or replace function set_gcal_shared(p_token uuid, p_shared boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if not _is_pair(me.id) then raise exception 'interdit'; end if;
  update profiles set gcal_shared = coalesce(p_shared, false) where id = me.id;
  if not coalesce(p_shared, false) then delete from gcal_events where owner = me.id; end if;
end $$;

create or replace function sync_gcal(p_token uuid, p_from date, p_to date, p_items json) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if not _is_pair(me.id) then raise exception 'interdit'; end if;
  if not me.gcal_shared then return; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'période invalide'; end if;
  delete from gcal_events where owner = me.id and date between p_from and p_to;
  insert into gcal_events(id, owner, title, date, time)
    select left(x.id, 120), me.id, left(coalesce(x.title, ''), 200), x.date, left(coalesce(x.time, ''), 11)
    from json_to_recordset(p_items) as x(id text, title text, date date, time text)
    where x.date between p_from and p_to limit 600
  on conflict (owner, id) do update set title = excluded.title, date = excluded.date, time = excluded.time;
end $$;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin, 'gcal_shared', me.gcal_shared),
    'profiles', coalesce((select json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin) order by created_at)
                          from profiles
                          where me.is_admin or id = me.id or (_is_pair(me.id) and _is_pair(id))), '[]'::json),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope,'meta',meta))
                        from events where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'progress_b',progress_b,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'gcal',   coalesce((select json_agg(json_build_object('id',g.id,'title',g.title,'date',g.date,'time',g.time,'owner',g.owner))
                        from gcal_events g join profiles pr on pr.id = g.owner
                        where _is_pair(me.id) and _is_pair(g.owner) and (g.owner = me.id or pr.gcal_shared)), '[]'::json)
  );
end $$;

revoke all on function set_gcal_shared(uuid, boolean), sync_gcal(uuid, date, date, json) from public;
grant execute on function set_gcal_shared(uuid, boolean), sync_gcal(uuid, date, date, json) to anon, authenticated;

-- ============ Migration 8 : passer un événement de privé à public (et inversement) ============
-- Public -> privé réservé à la personne qui a créé l'événement ; privé -> public possible pour le propriétaire.
create or replace function upsert_event(p_token uuid, p_id text, p_title text, p_date date, p_time text, p_owner text, p_scope text, p_meta text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  insert into events(id,title,date,time,owner,scope,created_by,meta) values (p_id,p_title,p_date,coalesce(p_time,''),p_owner,p_scope,me.id,coalesce(p_meta,''))
  on conflict (id) do update set title=excluded.title, date=excluded.date, time=excluded.time, meta=excluded.meta,
      scope=excluded.scope, owner=excluded.owner, updated_at=now()
    where _can_modify(me.id, events.owner, events.scope, events.created_by)
      and (excluded.scope = 'commun' or events.scope = 'perso' or events.created_by = me.id or events.created_by is null);
  delete from reminders_sent where event_id = p_id;
end $$;
