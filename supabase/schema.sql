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

-- ============ Migration 9 : liens Hevy / Strava de chacun ============
alter table profiles add column if not exists links jsonb not null default '{}'::jsonb;

create or replace function set_links(p_token uuid, p_hevy text, p_strava text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if coalesce(p_hevy,'') <> '' and p_hevy !~ '^https://' then raise exception 'lien invalide'; end if;
  if coalesce(p_strava,'') <> '' and p_strava !~ '^https://' then raise exception 'lien invalide'; end if;
  update profiles set links = jsonb_build_object('hevy', coalesce(left(p_hevy,300),''), 'strava', coalesce(left(p_strava,300),'')) where id = me.id;
end $$;
revoke all on function set_links(uuid,text,text) from public;
grant execute on function set_links(uuid,text,text) to anon, authenticated;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin, 'gcal_shared', me.gcal_shared),
    'profiles', coalesce((select json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin,'links',links) order by created_at)
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

-- ============ Migration 10 : séances Hevy ============
-- La clé API Hevy de chacun est stockée dans une table verrouillée (aucune fonction ne la renvoie jamais).
-- La synchro est faite par la fonction Edge "hevy-sync" (clé de service), qui remplit la table workouts.
create table if not exists hevy_keys (
  profile_id text primary key references profiles(id) on delete cascade,
  api_key    text not null,
  synced_at  timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists workouts (
  id         text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  title      text not null default '',
  day        date not null,
  start_time timestamptz,
  end_time   timestamptz,
  n_sets     int not null default 0,
  volume     int not null default 0,
  ex         jsonb not null default '[]'::jsonb
);
create index if not exists workouts_day on workouts(day);
alter table hevy_keys enable row level security;
alter table workouts enable row level security;

create or replace function set_hevy_key(p_token uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); k text := trim(coalesce(p_key, ''));
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if k = '' then
    delete from hevy_keys where profile_id = me.id;
    delete from workouts where profile_id = me.id;
    return;
  end if;
  if k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'clé invalide'; end if;
  insert into hevy_keys(profile_id, api_key) values (me.id, lower(k))
  on conflict (profile_id) do update set api_key = excluded.api_key, synced_at = null, updated_at = now();
end $$;
revoke all on function set_hevy_key(uuid, text) from public;
grant execute on function set_hevy_key(uuid, text) to anon, authenticated;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin, 'gcal_shared', me.gcal_shared,
                            'hevy', exists(select 1 from hevy_keys where profile_id = me.id),
                            'hevy_sync', (select synced_at from hevy_keys where profile_id = me.id)),
    'profiles', coalesce((select json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin,'links',links) order by created_at)
                          from profiles
                          where me.is_admin or id = me.id or (_is_pair(me.id) and _is_pair(id))), '[]'::json),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope,'meta',meta))
                        from events where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'progress_b',progress_b,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'gcal',   coalesce((select json_agg(json_build_object('id',g.id,'title',g.title,'date',g.date,'time',g.time,'owner',g.owner))
                        from gcal_events g join profiles pr on pr.id = g.owner
                        where _is_pair(me.id) and _is_pair(g.owner) and (g.owner = me.id or pr.gcal_shared)), '[]'::json),
    'workouts', coalesce((select json_agg(json_build_object('id',w.id,'owner',w.profile_id,'title',w.title,'day',w.day,'start',w.start_time,'end',w.end_time,'sets',w.n_sets,'vol',w.volume,'ex',w.ex) order by w.start_time desc)
                        from workouts w
                        where w.day >= current_date - 400 and (w.profile_id = me.id or (_is_pair(me.id) and _is_pair(w.profile_id)))), '[]'::json)
  );
end $$;

-- ============ Migration 11 : groupes musculaires des exercices Hevy (cache) + droits de la fonction hevy-sync ============
create table if not exists exercise_muscles (template_id text primary key, muscle text not null);
alter table exercise_muscles enable row level security;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles, public.hevy_keys, public.workouts, public.exercise_muscles to service_role;

-- ============ Migration 12 : objectif sport (jours / semaine), pole dance saisie à la main, synchro Hevy quotidienne ============
-- Un objectif est valable à partir de la semaine où il est enregistré (l'historique des semaines passées reste juste).
create table if not exists sport_goals (
  profile_id text not null references profiles(id) on delete cascade,
  from_week  date not null,
  gym  int not null default 0 check (gym  between 0 and 7),
  pole int not null default 0 check (pole between 0 and 7),
  primary key (profile_id, from_week)
);
create table if not exists sport_logs (
  profile_id text not null references profiles(id) on delete cascade,
  day  date not null,
  kind text not null check (kind in ('pole')),
  primary key (profile_id, day, kind)
);
create table if not exists cron_secret (value text primary key);
alter table sport_goals enable row level security;
alter table sport_logs enable row level security;
alter table cron_secret enable row level security;
insert into cron_secret(value) select gen_random_uuid()::text where not exists (select 1 from cron_secret);
grant select on public.cron_secret to service_role;
grant select on public.hevy_keys to service_role;

create or replace function set_sport_goal(p_token uuid, p_gym int, p_pole int) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); mon date := date_trunc('week', now() at time zone 'Europe/Paris')::date;
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  insert into sport_goals(profile_id, from_week, gym, pole)
  values (me.id, mon, greatest(0, least(7, coalesce(p_gym, 0))), greatest(0, least(7, coalesce(p_pole, 0))))
  on conflict (profile_id, from_week) do update set gym = excluded.gym, pole = excluded.pole;
end $$;

create or replace function set_sport_log(p_token uuid, p_day date, p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if p_kind <> 'pole' or p_day < current_date - 400 or p_day > current_date + 1 then raise exception 'invalide'; end if;
  if coalesce(p_on, false) then
    insert into sport_logs(profile_id, day, kind) values (me.id, p_day, p_kind) on conflict do nothing;
  else
    delete from sport_logs where profile_id = me.id and day = p_day and kind = p_kind;
  end if;
end $$;

-- Objectifs et jours de pole dance : les siens + ceux de l'autre membre du couple (lecture seule)
create or replace function get_sport(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'goals', coalesce((select json_agg(json_build_object('owner', g.profile_id, 'from', g.from_week, 'gym', g.gym, 'pole', g.pole))
                       from sport_goals g where g.profile_id = me.id or (_is_pair(me.id) and _is_pair(g.profile_id))), '[]'::json),
    'logs',  coalesce((select json_agg(json_build_object('owner', l.profile_id, 'day', l.day, 'kind', l.kind))
                       from sport_logs l where l.day >= current_date - 400 and (l.profile_id = me.id or (_is_pair(me.id) and _is_pair(l.profile_id)))), '[]'::json));
end $$;
revoke all on function set_sport_goal(uuid,int,int), set_sport_log(uuid,date,text,boolean), get_sport(uuid) from public;
grant execute on function set_sport_goal(uuid,int,int), set_sport_log(uuid,date,text,boolean), get_sport(uuid) to anon, authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Synchro Hevy automatique : tous les jours à 22 h (heure de Paris). On déclenche à 20 h et 21 h UTC ; la fonction ne fait rien
-- si l'heure de Paris n'est pas 22 h (gère heure d'été / d'hiver).
select cron.schedule('hevy-daily', '0 20,21 * * *', $$
  select net.http_post(url := 'https://smypdolihotxtdlbgqua.supabase.co/functions/v1/hevy-sync',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('cron', (select value from cron_secret limit 1)));
$$);
-- ============ Migration 13 : montre connectée (Strava par OAuth, Garmin par API personnelle) ============
create table if not exists watch_keys (
  profile_id text not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin')),
  api_key text,            -- Garmin : clé API personnelle
  client_id text,          -- Strava : identifiant de ton application
  client_secret text,      -- Strava : secret de ton application (jamais renvoyé à l'appli)
  refresh_token text, access_token text, expires_at timestamptz,
  synced_at timestamptz,
  primary key (profile_id, provider)
);
create table if not exists activities (
  id text primary key,     -- "strava:123" / "garmin:456"
  profile_id text not null references profiles(id) on delete cascade,
  provider text not null,
  day date not null,
  title text, kind text,
  start_time timestamptz, secs int, dist_m int, kcal int, avg_hr int
);
create index if not exists activities_day on activities(profile_id, day);
alter table watch_keys enable row level security;
alter table activities enable row level security;
grant select, insert, update, delete on public.watch_keys, public.activities to service_role;

create or replace function set_watch_key(p_token uuid, p_provider text, p_api_key text, p_client_id text, p_client_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if p_provider not in ('strava','garmin') then raise exception 'invalide'; end if;
  insert into watch_keys(profile_id, provider, api_key, client_id, client_secret)
  values (me.id, p_provider, nullif(trim(p_api_key), ''), nullif(trim(p_client_id), ''), nullif(trim(p_client_secret), ''))
  on conflict (profile_id, provider) do update set api_key = excluded.api_key, client_id = excluded.client_id, client_secret = excluded.client_secret,
    refresh_token = null, access_token = null, expires_at = null;
end $$;

create or replace function delete_watch(p_token uuid, p_provider text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from watch_keys where profile_id = me.id and provider = p_provider;
  delete from activities where profile_id = me.id and provider = p_provider;
end $$;

-- get_sport enrichi : montres connectées (sans secrets) + activités (les siennes + celles de l'autre membre du couple)
create or replace function get_sport(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'goals', coalesce((select json_agg(json_build_object('owner', g.profile_id, 'from', g.from_week, 'gym', g.gym, 'pole', g.pole))
                       from sport_goals g where g.profile_id = me.id or (_is_pair(me.id) and _is_pair(g.profile_id))), '[]'::json),
    'logs',  coalesce((select json_agg(json_build_object('owner', l.profile_id, 'day', l.day, 'kind', l.kind))
                       from sport_logs l where l.day >= current_date - 400 and (l.profile_id = me.id or (_is_pair(me.id) and _is_pair(l.profile_id)))), '[]'::json),
    'watch', coalesce((select json_agg(json_build_object('provider', k.provider, 'synced_at', k.synced_at, 'linked', (k.refresh_token is not null or k.api_key is not null), 'client_id', k.client_id))
                       from watch_keys k where k.profile_id = me.id), '[]'::json),
    'acts',  coalesce((select json_agg(json_build_object('owner', a.profile_id, 'id', a.id, 'provider', a.provider, 'day', a.day, 'title', a.title, 'kind', a.kind,
                         'start', a.start_time, 'secs', a.secs, 'dist', a.dist_m, 'kcal', a.kcal, 'hr', a.avg_hr) order by a.start_time desc)
                       from activities a where a.day >= current_date - 400 and (a.profile_id = me.id or (_is_pair(me.id) and _is_pair(a.profile_id)))), '[]'::json));
end $$;
revoke all on function set_watch_key(uuid,text,text,text,text), delete_watch(uuid,text) from public;
grant execute on function set_watch_key(uuid,text,text,text,text), delete_watch(uuid,text) to anon, authenticated;
-- ============ Migration 14 : objectifs sport génériques (salle, course, pole, activités perso) + invitations + droits ============
alter table profiles add column if not exists perms jsonb not null default '{}'::jsonb;   -- clé à false = fonction désactivée (tasks, sport, astro, integrations)
alter table sport_goals add column if not exists targets jsonb;                            -- ex. {"gym":5,"run":2,"pole":1,"c_ab12":3}
alter table sport_logs drop constraint if exists sport_logs_kind_check;                    -- jours saisis à la main : pole, run, ou activité perso c_xxxx
create table if not exists sport_custom (
  profile_id text not null references profiles(id) on delete cascade,
  id text not null check (id ~ '^c_[a-z0-9]{3,12}$'),
  name text not null check (char_length(name) between 1 and 24),
  primary key (profile_id, id)
);
alter table sport_custom enable row level security;
create table if not exists invites (
  code uuid primary key default gen_random_uuid(),
  label text, perms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by text
);
alter table invites enable row level security;

create or replace function set_sport_targets(p_token uuid, p_targets jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); mon date := date_trunc('week', now() at time zone 'Europe/Paris')::date; k text; clean jsonb := '{}'::jsonb; n int;
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  for k in select jsonb_object_keys(coalesce(p_targets, '{}'::jsonb)) loop
    if k !~ '^(gym|pole|run|c_[a-z0-9]{3,12})$' then continue; end if;
    n := greatest(0, least(7, coalesce((p_targets ->> k)::int, 0)));
    clean := clean || jsonb_build_object(k, n);
  end loop;
  insert into sport_goals(profile_id, from_week, gym, pole, targets)
  values (me.id, mon, coalesce((clean ->> 'gym')::int, 0), coalesce((clean ->> 'pole')::int, 0), clean)
  on conflict (profile_id, from_week) do update set gym = excluded.gym, pole = excluded.pole, targets = excluded.targets;
end $$;

create or replace function set_sport_log(p_token uuid, p_day date, p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if p_kind !~ '^(pole|run|c_[a-z0-9]{3,12})$' or p_day < current_date - 400 or p_day > current_date + 1 then raise exception 'invalide'; end if;
  if coalesce(p_on, false) then
    insert into sport_logs(profile_id, day, kind) values (me.id, p_day, p_kind) on conflict do nothing;
  else
    delete from sport_logs where profile_id = me.id and day = p_day and kind = p_kind;
  end if;
end $$;

create or replace function set_sport_custom(p_token uuid, p_id text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  insert into sport_custom(profile_id, id, name) values (me.id, p_id, left(trim(p_name), 24))
  on conflict (profile_id, id) do update set name = excluded.name;
end $$;

create or replace function delete_sport_custom(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  delete from sport_custom where profile_id = me.id and id = p_id;
  delete from sport_logs where profile_id = me.id and kind = p_id;
end $$;

create or replace function get_sport(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'perms', me.perms,
    'goals', coalesce((select json_agg(json_build_object('owner', g.profile_id, 'from', g.from_week, 'gym', g.gym, 'pole', g.pole,
                         'targets', coalesce(g.targets, jsonb_build_object('gym', g.gym, 'pole', g.pole))))
                       from sport_goals g where g.profile_id = me.id or (_is_pair(me.id) and _is_pair(g.profile_id))), '[]'::json),
    'logs',  coalesce((select json_agg(json_build_object('owner', l.profile_id, 'day', l.day, 'kind', l.kind))
                       from sport_logs l where l.day >= current_date - 400 and (l.profile_id = me.id or (_is_pair(me.id) and _is_pair(l.profile_id)))), '[]'::json),
    'custom', coalesce((select json_agg(json_build_object('owner', c.profile_id, 'id', c.id, 'name', c.name))
                       from sport_custom c where c.profile_id = me.id or (_is_pair(me.id) and _is_pair(c.profile_id))), '[]'::json),
    'watch', coalesce((select json_agg(json_build_object('provider', k.provider, 'synced_at', k.synced_at, 'linked', (k.refresh_token is not null or k.api_key is not null), 'client_id', k.client_id))
                       from watch_keys k where k.profile_id = me.id), '[]'::json),
    'acts',  coalesce((select json_agg(json_build_object('owner', a.profile_id, 'id', a.id, 'provider', a.provider, 'day', a.day, 'title', a.title, 'kind', a.kind,
                         'start', a.start_time, 'secs', a.secs, 'dist', a.dist_m, 'kcal', a.kcal, 'hr', a.avg_hr) order by a.start_time desc)
                       from activities a where a.day >= current_date - 400 and (a.profile_id = me.id or (_is_pair(me.id) and _is_pair(a.profile_id)))), '[]'::json));
end $$;

-- ---------- Administration : invitations et droits ----------
create or replace function create_invite(p_token uuid, p_label text, p_perms jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); c uuid;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  insert into invites(label, perms) values (left(trim(coalesce(p_label, '')), 40), coalesce(p_perms, '{}'::jsonb)) returning code into c;
  return c;
end $$;

create or replace function revoke_invite(p_token uuid, p_code uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  delete from invites where code = p_code and used_by is null;
end $$;

create or replace function set_perms(p_token uuid, p_id text, p_perms jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin or _is_pair(p_id) then raise exception 'interdit'; end if;
  update profiles set perms = coalesce(p_perms, '{}'::jsonb) where id = p_id;
end $$;

create or replace function get_admin(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  return json_build_object(
    'users', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'color', color, 'perms', perms, 'created', created_at) order by created_at)
                       from profiles where not _is_pair(id)), '[]'::json),
    'invites', coalesce((select json_agg(json_build_object('code', code, 'label', label, 'perms', perms, 'expires', expires_at, 'used_by', used_by) order by created_at desc)
                         from invites where used_by is null and expires_at > now()), '[]'::json));
end $$;

-- Création d'un compte depuis un lien d'invitation (appelée sans être connecté)
create or replace function claim_invite(p_code uuid, p_name text, p_email text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare inv invites; np profiles; nm text := left(trim(coalesce(p_name, '')), 24); em text := lower(trim(coalesce(p_email, ''))); pid text; pal text[] := array['#4DB8FF','#FF7AC8','#FFD54D','#B28CFF','#5EEAD4','#FF9F6B']; n int;
begin
  select * into inv from invites where code = p_code and used_by is null and expires_at > now() for update;
  if inv.code is null then return json_build_object('error', 'Ce lien d''invitation n''est plus valide.'); end if;
  if char_length(nm) < 2 then return json_build_object('error', 'Saisis ton prénom.'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return json_build_object('error', 'E-mail invalide.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6,12}$' then return json_build_object('error', 'Le code doit faire 6 à 12 chiffres.'); end if;
  if exists (select 1 from profiles where lower(email) = em) then return json_build_object('error', 'Cet e-mail a déjà un compte : connecte-toi.'); end if;
  pid := coalesce(nullif(regexp_replace(lower(nm), '[^a-z0-9]', '', 'g'), ''), 'user') || '-' || substr(md5(random()::text), 1, 5);
  select count(*) into n from profiles;
  insert into profiles(id, name, color, email, pin_hash, perms) values (pid, nm, pal[1 + n % 6], em, crypt(p_pin, gen_salt('bf')), inv.perms) returning * into np;
  update invites set used_by = np.id where code = inv.code;
  return json_build_object('token', np.token, 'id', np.id);
end $$;

revoke all on function set_sport_targets(uuid,jsonb), set_sport_custom(uuid,text,text), delete_sport_custom(uuid,text), create_invite(uuid,text,jsonb), revoke_invite(uuid,uuid),
  set_perms(uuid,text,jsonb), get_admin(uuid), claim_invite(uuid,text,text,text) from public;
grant execute on function set_sport_targets(uuid,jsonb), set_sport_custom(uuid,text,text), delete_sport_custom(uuid,text), create_invite(uuid,text,jsonb), revoke_invite(uuid,uuid),
  set_perms(uuid,text,jsonb), get_admin(uuid), claim_invite(uuid,text,text,text) to anon, authenticated;
-- ============ Migration 15 : durcissement (droits côté serveur, validations) ============
create or replace function _perm(p_me profiles, p_key text) returns boolean
language sql immutable as $$
  select coalesce(p_me.is_admin, false) or _is_pair(p_me.id) or coalesce((p_me.perms ->> p_key)::boolean, true);
$$;

create or replace function upsert_task(p_token uuid, p_id text, p_title text, p_period text, p_key text, p_progress int, p_owner text, p_scope text, p_progress_b int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  if not _perm(me, 'tasks') then raise exception 'fonction désactivée'; end if;
  insert into tasks(id,title,period,key,progress,progress_b,owner,scope,created_by)
  values (p_id,left(trim(coalesce(p_title,'')),200),p_period,p_key,greatest(0,least(100,coalesce(p_progress,0))),greatest(0,least(100,coalesce(p_progress_b,0))),p_owner,p_scope,me.id)
  on conflict (id) do update set title=excluded.title, updated_at=now()
    where _can_modify(me.id, tasks.owner, tasks.scope, tasks.created_by);
end $$;

create or replace function set_sport_targets(p_token uuid, p_targets jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); mon date := date_trunc('week', now() at time zone 'Europe/Paris')::date; k text; clean jsonb := '{}'::jsonb; n int;
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if not _perm(me, 'sport') then raise exception 'fonction désactivée'; end if;
  for k in select jsonb_object_keys(coalesce(p_targets, '{}'::jsonb)) loop
    if k !~ '^(gym|pole|run|c_[a-z0-9]{3,12})$' then continue; end if;
    n := greatest(0, least(7, coalesce((p_targets ->> k)::int, 0)));
    clean := clean || jsonb_build_object(k, n);
  end loop;
  insert into sport_goals(profile_id, from_week, gym, pole, targets)
  values (me.id, mon, coalesce((clean ->> 'gym')::int, 0), coalesce((clean ->> 'pole')::int, 0), clean)
  on conflict (profile_id, from_week) do update set gym = excluded.gym, pole = excluded.pole, targets = excluded.targets;
end $$;

create or replace function set_sport_log(p_token uuid, p_day date, p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if not _perm(me, 'sport') then raise exception 'fonction désactivée'; end if;
  if p_kind !~ '^(pole|run|c_[a-z0-9]{3,12})$' or p_day < current_date - 400 or p_day > current_date + 1 then raise exception 'invalide'; end if;
  if coalesce(p_on, false) then
    insert into sport_logs(profile_id, day, kind) values (me.id, p_day, p_kind) on conflict do nothing;
  else
    delete from sport_logs where profile_id = me.id and day = p_day and kind = p_kind;
  end if;
end $$;

create or replace function set_sport_custom(p_token uuid, p_id text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); nm text := left(trim(coalesce(p_name, '')), 24);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if not _perm(me, 'sport') then raise exception 'fonction désactivée'; end if;
  if p_id !~ '^c_[a-z0-9]{3,12}$' or char_length(nm) < 1 then raise exception 'invalide'; end if;
  if not exists (select 1 from sport_custom where profile_id = me.id and id = p_id)
     and (select count(*) from sport_custom where profile_id = me.id) >= 12 then raise exception '12 activités maximum'; end if;
  insert into sport_custom(profile_id, id, name) values (me.id, p_id, nm)
  on conflict (profile_id, id) do update set name = excluded.name;
end $$;

create or replace function set_hevy_key(p_token uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); k text := trim(coalesce(p_key, ''));
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if not _perm(me, 'integrations') then raise exception 'fonction désactivée'; end if;
  if k = '' then
    delete from hevy_keys where profile_id = me.id;
    delete from workouts where profile_id = me.id;
    return;
  end if;
  if k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'clé invalide'; end if;
  insert into hevy_keys(profile_id, api_key) values (me.id, lower(k))
  on conflict (profile_id) do update set api_key = excluded.api_key, synced_at = null, updated_at = now();
end $$;

create or replace function set_watch_key(p_token uuid, p_provider text, p_api_key text, p_client_id text, p_client_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if not _perm(me, 'integrations') then raise exception 'fonction désactivée'; end if;
  if p_provider not in ('strava','garmin') then raise exception 'invalide'; end if;
  insert into watch_keys(profile_id, provider, api_key, client_id, client_secret)
  values (me.id, p_provider, nullif(trim(p_api_key), ''), nullif(trim(p_client_id), ''), nullif(trim(p_client_secret), ''))
  on conflict (profile_id, provider) do update set api_key = excluded.api_key, client_id = excluded.client_id, client_secret = excluded.client_secret,
    refresh_token = null, access_token = null, expires_at = null;
end $$;

-- set_perms : ne garde que les clés connues, en booléens
create or replace function set_perms(p_token uuid, p_id text, p_perms jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); k text; clean jsonb := '{}'::jsonb;
begin
  if me.id is null or not me.is_admin or _is_pair(p_id) then raise exception 'interdit'; end if;
  for k in select unnest(array['tasks','sport','astro','integrations']) loop
    if p_perms ? k and jsonb_typeof(p_perms -> k) = 'boolean' then clean := clean || jsonb_build_object(k, p_perms -> k); end if;
  end loop;
  update profiles set perms = clean where id = p_id;
end $$;

revoke all on function _perm(profiles, text) from public;

-- ============ Migration 16 : validation des comptes par l'admin, surveillance, admin enrichie ============
alter table profiles add column if not exists status text not null default 'active';
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check check (status in ('active','pending','blocked'));
alter table profiles add column if not exists last_login timestamptz;
alter table profiles add column if not exists last_seen timestamptz;
alter table profiles add column if not exists requested_at timestamptz;

-- un compte en attente ou suspendu ne peut plus rien faire, même avec un jeton
create or replace function _me(p_token uuid) returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where token = p_token and status = 'active' limit 1;
$$;

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
  if p.status = 'pending' then return json_build_object('error', 'Ton compte attend la validation de l''admin.'); end if;
  if p.status = 'blocked' then return json_build_object('error', 'Ton accès a été suspendu.'); end if;
  update profiles set last_login = now(), last_seen = now() where id = p.id;
  return json_build_object('token', p.token, 'id', p.id);
end $$;

create or replace function claim_invite(p_code uuid, p_name text, p_email text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare inv invites; np profiles; nm text := left(trim(coalesce(p_name, '')), 24); em text := lower(trim(coalesce(p_email, ''))); pid text; pal text[] := array['#4DB8FF','#FF7AC8','#FFD54D','#B28CFF','#5EEAD4','#FF9F6B']; n int;
begin
  select * into inv from invites where code = p_code and used_by is null and expires_at > now() for update;
  if inv.code is null then return json_build_object('error', 'Ce lien d''invitation n''est plus valide.'); end if;
  if char_length(nm) < 2 then return json_build_object('error', 'Saisis ton prénom.'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return json_build_object('error', 'E-mail invalide.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6,12}$' then return json_build_object('error', 'Le code doit faire 6 à 12 chiffres.'); end if;
  if exists (select 1 from profiles where lower(email) = em) then return json_build_object('error', 'Cet e-mail a déjà un compte : connecte-toi.'); end if;
  pid := coalesce(nullif(regexp_replace(lower(nm), '[^a-z0-9]', '', 'g'), ''), 'user') || '-' || substr(md5(random()::text), 1, 5);
  select count(*) into n from profiles;
  insert into profiles(id, name, color, email, pin_hash, perms, status, requested_at) values (pid, nm, pal[1 + n % 6], em, crypt(p_pin, gen_salt('bf')), inv.perms, 'pending', now()) returning * into np;
  update invites set used_by = np.id where code = inv.code;
  return json_build_object('pending', true, 'id', np.id);
end $$;

create or replace function ping(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then return; end if;
  update profiles set last_seen = now() where id = me.id and (last_seen is null or last_seen < now() - interval '5 minutes');
end $$;

-- Accepter (active) ou refuser (supprime la demande)
create or replace function decide_profile(p_token uuid, p_id text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin or _is_pair(p_id) then raise exception 'interdit'; end if;
  if coalesce(p_ok, false) then update profiles set status = 'active' where id = p_id and status = 'pending';
  else delete from profiles where id = p_id and status = 'pending'; end if;
end $$;

-- Suspendre / rétablir un accès
create or replace function set_status(p_token uuid, p_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin or _is_pair(p_id) or p_status not in ('active','blocked') then raise exception 'interdit'; end if;
  update profiles set status = p_status where id = p_id and status in ('active','blocked');
end $$;

create or replace function get_admin(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token); al jsonb := '[]'::jsonb; np int; r record; mb numeric;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  select count(*) into np from profiles where status = 'pending';
  if np > 0 then al := al || jsonb_build_array(np || ' demande(s) de compte à valider'); end if;
  for r in select p.name, k.synced_at from hevy_keys k join profiles p on p.id = k.profile_id where k.synced_at is null or k.synced_at < now() - interval '36 hours' loop
    al := al || jsonb_build_array('Synchro Hevy ancienne ou jamais faite pour ' || r.name);
  end loop;
  for r in select p.name, k.provider from watch_keys k join profiles p on p.id = k.profile_id where (k.refresh_token is not null or k.api_key is not null) and (k.synced_at is null or k.synced_at < now() - interval '36 hours') loop
    al := al || jsonb_build_array('Synchro ' || r.provider || ' ancienne pour ' || r.name);
  end loop;
  mb := round(pg_database_size(current_database()) / 1048576.0, 1);
  if mb > 400 then al := al || jsonb_build_array('Base de données à ' || mb || ' Mo sur 500 Mo (plan gratuit)'); end if;
  return json_build_object(
    'alerts', al, 'db_mb', mb,
    'users', coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'color', p.color, 'perms', p.perms, 'created', p.created_at, 'status', p.status,
                         'email', p.email, 'last_login', p.last_login, 'last_seen', p.last_seen, 'requested', p.requested_at,
                         'n_events', (select count(*) from events e where e.owner = p.id), 'n_tasks', (select count(*) from tasks t where t.owner = p.id),
                         'n_acts', (select count(*) from activities a where a.profile_id = p.id) + (select count(*) from workouts w where w.profile_id = p.id)) order by p.created_at)
                       from profiles p where not _is_pair(p.id)), '[]'::json),
    'invites', coalesce((select json_agg(json_build_object('code', code, 'label', label, 'perms', perms, 'expires', expires_at, 'used_by', used_by) order by created_at desc)
                         from invites where used_by is null and expires_at > now()), '[]'::json));
end $$;

-- get_data : seuls les profils actifs apparaissent
create or replace function _profiles_visible(me profiles) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin,'links',links) order by created_at), '[]'::json)
  from profiles where status = 'active' and (me.is_admin or id = me.id or (_is_pair(me.id) and _is_pair(id)));
$$;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin, 'gcal_shared', me.gcal_shared,
                            'hevy', exists(select 1 from hevy_keys where profile_id = me.id),
                            'hevy_sync', (select synced_at from hevy_keys where profile_id = me.id)),
    'profiles', _profiles_visible(me),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope,'meta',meta))
                        from events where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'progress_b',progress_b,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _is_pair(me.id))), '[]'::json),
    'gcal',   coalesce((select json_agg(json_build_object('id',g.id,'title',g.title,'date',g.date,'time',g.time,'owner',g.owner))
                        from gcal_events g join profiles pr on pr.id = g.owner
                        where _is_pair(me.id) and _is_pair(g.owner) and (g.owner = me.id or pr.gcal_shared)), '[]'::json),
    'workouts', coalesce((select json_agg(json_build_object('id',w.id,'owner',w.profile_id,'title',w.title,'day',w.day,'start',w.start_time,'end',w.end_time,'sets',w.n_sets,'vol',w.volume,'ex',w.ex) order by w.start_time desc)
                        from workouts w
                        where w.day >= current_date - 400 and (w.profile_id = me.id or (_is_pair(me.id) and _is_pair(w.profile_id)))), '[]'::json)
  );
end $$;

revoke all on function ping(uuid), decide_profile(uuid,text,boolean), set_status(uuid,text,text), get_admin(uuid), _profiles_visible(profiles), login(text,text), claim_invite(uuid,text,text,text) from public;
grant execute on function ping(uuid), decide_profile(uuid,text,boolean), set_status(uuid,text,text), get_admin(uuid), login(text,text), claim_invite(uuid,text,text,text) to anon, authenticated;

revoke all on function get_data(uuid) from public; grant execute on function get_data(uuid) to anon, authenticated;

-- ============ Migration 17 : comptes créés par l'admin, couples d'utilisateurs ============

alter table profiles add column if not exists partner text;

create or replace function _cp(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select case when p_id in ('nelson','sophie') then 'nelson+sophie'
    else (select least(p.id, p.partner) || '+' || greatest(p.id, p.partner) from profiles p
          where p.id = p_id and p.partner is not null and exists (select 1 from profiles q where q.id = p.partner and q.partner = p.id)) end;
$$;
create or replace function _samecp(a text, b text) returns boolean
language sql stable security definer set search_path = public as $$ select _cp(a) is not null and _cp(a) = _cp(b); $$;
create or replace function _second(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_id in ('nelson','sophie') then p_id = 'sophie' else p_id = (select greatest(p.id, p.partner) from profiles p where p.id = p_id) end;
$$;
create or replace function _couple(p_id text) returns json
language sql stable security definer set search_path = public as $$
  select case when p_id in ('nelson','sophie') then '["nelson","sophie"]'::json
    when _cp(p_id) is null then '[]'::json
    else (select json_build_array(least(p.id, p.partner), greatest(p.id, p.partner)) from profiles p where p.id = p_id) end;
$$;

create or replace function _can_write(p_me text, p_owner text, p_scope text) returns boolean
language sql stable as $$
  select case
    when p_scope = 'commun' then _samecp(p_me, p_owner)
    else p_me = p_owner or (_samecp(p_me, p_owner))
  end;
$$;

create or replace function _can_modify(p_me text, p_owner text, p_scope text, p_created_by text) returns boolean
language sql stable as $$
  select case when p_scope = 'commun' then _samecp(p_me, p_owner)
              else p_me = p_owner or p_me = coalesce(p_created_by, p_owner) end;
$$;

create or replace function set_progress(p_token uuid, p_id text, p_value int) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); t tasks; v int := greatest(0, least(100, coalesce(p_value, 0)));
begin
  select * into t from tasks where id = p_id;
  if not found then raise exception 'introuvable'; end if;
  if t.scope = 'commun' and _samecp(me.id, t.owner) then
    if _second(me.id) then update tasks set progress_b = v, updated_at = now() where id = p_id;
    else update tasks set progress = v, updated_at = now() where id = p_id; end if;
  elsif t.owner = me.id then
    update tasks set progress = v, updated_at = now() where id = p_id;
  else
    raise exception 'interdit';
  end if;
end $$;

create or replace function get_sport(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'perms', me.perms,
    'goals', coalesce((select json_agg(json_build_object('owner', g.profile_id, 'from', g.from_week, 'gym', g.gym, 'pole', g.pole,
                         'targets', coalesce(g.targets, jsonb_build_object('gym', g.gym, 'pole', g.pole))))
                       from sport_goals g where g.profile_id = me.id or (_samecp(me.id, g.profile_id))), '[]'::json),
    'logs',  coalesce((select json_agg(json_build_object('owner', l.profile_id, 'day', l.day, 'kind', l.kind))
                       from sport_logs l where l.day >= current_date - 400 and (l.profile_id = me.id or (_samecp(me.id, l.profile_id)))), '[]'::json),
    'custom', coalesce((select json_agg(json_build_object('owner', c.profile_id, 'id', c.id, 'name', c.name))
                       from sport_custom c where c.profile_id = me.id or (_samecp(me.id, c.profile_id))), '[]'::json),
    'watch', coalesce((select json_agg(json_build_object('provider', k.provider, 'synced_at', k.synced_at, 'linked', (k.refresh_token is not null or k.api_key is not null), 'client_id', k.client_id))
                       from watch_keys k where k.profile_id = me.id), '[]'::json),
    'acts',  coalesce((select json_agg(json_build_object('owner', a.profile_id, 'id', a.id, 'provider', a.provider, 'day', a.day, 'title', a.title, 'kind', a.kind,
                         'start', a.start_time, 'secs', a.secs, 'dist', a.dist_m, 'kcal', a.kcal, 'hr', a.avg_hr) order by a.start_time desc)
                       from activities a where a.day >= current_date - 400 and (a.profile_id = me.id or (_samecp(me.id, a.profile_id)))), '[]'::json));
end $$;

create or replace function _profiles_visible(me profiles) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id',id,'name',name,'color',color,'admin',is_admin,'links',links) order by created_at), '[]'::json)
  from profiles where status = 'active' and (me.is_admin or id = me.id or (_samecp(me.id, id)));
$$;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin, 'gcal_shared', me.gcal_shared,
                            'hevy', exists(select 1 from hevy_keys where profile_id = me.id),
                            'hevy_sync', (select synced_at from hevy_keys where profile_id = me.id), 'couple', _couple(me.id)),
    'profiles', _profiles_visible(me),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope,'meta',meta))
                        from events where owner = me.id or (scope = 'commun' and _samecp(me.id, owner))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'progress_b',progress_b,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _samecp(me.id, owner))), '[]'::json),
    'gcal',   coalesce((select json_agg(json_build_object('id',g.id,'title',g.title,'date',g.date,'time',g.time,'owner',g.owner))
                        from gcal_events g join profiles pr on pr.id = g.owner
                        where _samecp(me.id, g.owner) and (g.owner = me.id or pr.gcal_shared)), '[]'::json),
    'workouts', coalesce((select json_agg(json_build_object('id',w.id,'owner',w.profile_id,'title',w.title,'day',w.day,'start',w.start_time,'end',w.end_time,'sets',w.n_sets,'vol',w.volume,'ex',w.ex) order by w.start_time desc)
                        from workouts w
                        where w.day >= current_date - 400 and (w.profile_id = me.id or (_samecp(me.id, w.profile_id)))), '[]'::json)
  );
end $$;

create or replace function get_admin(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token); al jsonb := '[]'::jsonb; np int; r record; mb numeric;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  select count(*) into np from profiles where status = 'pending';
  if np > 0 then al := al || jsonb_build_array(np || ' demande(s) de compte à valider'); end if;
  for r in select p.name, k.synced_at from hevy_keys k join profiles p on p.id = k.profile_id where k.synced_at is null or k.synced_at < now() - interval '36 hours' loop
    al := al || jsonb_build_array('Synchro Hevy ancienne ou jamais faite pour ' || r.name);
  end loop;
  for r in select p.name, k.provider from watch_keys k join profiles p on p.id = k.profile_id where (k.refresh_token is not null or k.api_key is not null) and (k.synced_at is null or k.synced_at < now() - interval '36 hours') loop
    al := al || jsonb_build_array('Synchro ' || r.provider || ' ancienne pour ' || r.name);
  end loop;
  mb := round(pg_database_size(current_database()) / 1048576.0, 1);
  if mb > 400 then al := al || jsonb_build_array('Base de données à ' || mb || ' Mo sur 500 Mo (plan gratuit)'); end if;
  return json_build_object(
    'alerts', al, 'db_mb', mb,
    'users', coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'color', p.color, 'perms', p.perms, 'created', p.created_at, 'status', p.status,
                         'email', p.email, 'partner', (select q.name from profiles q where q.id = p.partner), 'last_login', p.last_login, 'last_seen', p.last_seen, 'requested', p.requested_at,
                         'n_events', (select count(*) from events e where e.owner = p.id), 'n_tasks', (select count(*) from tasks t where t.owner = p.id),
                         'n_acts', (select count(*) from activities a where a.profile_id = p.id) + (select count(*) from workouts w where w.profile_id = p.id)) order by p.created_at)
                       from profiles p where not _is_pair(p.id)), '[]'::json),
    'invites', coalesce((select json_agg(json_build_object('code', code, 'label', label, 'perms', perms, 'expires', expires_at, 'used_by', used_by) order by created_at desc)
                         from invites where used_by is null and expires_at > now()), '[]'::json));
end $$;


create or replace function create_account(p_token uuid, p_name text, p_login text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me profiles := _me(p_token); nm text := left(trim(coalesce(p_name, '')), 24); lg text := lower(trim(coalesce(p_login, ''))); pid text; np profiles; pal text[] := array['#4DB8FF','#FF7AC8','#FFD54D','#B28CFF','#5EEAD4','#FF9F6B']; n int;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  if char_length(nm) < 2 then return json_build_object('error', 'Prénom trop court.'); end if;
  if lg !~ '^[a-z0-9._@+-]{3,40}$' then return json_build_object('error', 'Identifiant : 3 à 40 caractères (lettres, chiffres, . _ - @).'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6,12}$' then return json_build_object('error', 'Le code doit faire 6 à 12 chiffres.'); end if;
  if exists (select 1 from profiles where lower(email) = lg) then return json_build_object('error', 'Cet identifiant existe déjà.'); end if;
  pid := coalesce(nullif(regexp_replace(lower(nm), '[^a-z0-9]', '', 'g'), ''), 'user') || '-' || substr(md5(random()::text), 1, 5);
  select count(*) into n from profiles;
  insert into profiles(id, name, color, email, pin_hash, perms, status) values (pid, nm, pal[1 + n % 6], lg, crypt(p_pin, gen_salt('bf')), '{}'::jsonb, 'active') returning * into np;
  return json_build_object('id', np.id);
end $$;

create or replace function link_profiles(p_token uuid, p_a text, p_b text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  if p_a = p_b or _is_pair(p_a) or _is_pair(p_b) then raise exception 'invalide'; end if;
  if (select count(*) from profiles where id in (p_a, p_b) and status = 'active') <> 2 then raise exception 'profil introuvable'; end if;
  update profiles set partner = null where partner in (p_a, p_b) or id in (p_a, p_b);
  update profiles set partner = p_b where id = p_a;
  update profiles set partner = p_a where id = p_b;
end $$;

create or replace function unlink_profile(p_token uuid, p_a text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not me.is_admin or _is_pair(p_a) then raise exception 'interdit'; end if;
  update profiles set partner = null where id = p_a or partner = p_a;
end $$;

revoke all on function _cp(text), _samecp(text,text), _second(text), _couple(text), create_account(uuid,text,text,text), link_profiles(uuid,text,text), unlink_profile(uuid,text), _can_write(text,text,text), _can_modify(text,text,text,text),
  set_progress(uuid,text,int), get_sport(uuid), get_data(uuid), get_admin(uuid), _profiles_visible(profiles) from public;
grant execute on function create_account(uuid,text,text,text), link_profiles(uuid,text,text), unlink_profile(uuid,text), set_progress(uuid,text,int), get_sport(uuid), get_data(uuid), get_admin(uuid) to anon, authenticated;


-- ============ Migration 18 : pseudo obligatoire, comptes par nom de compte, durcissement ============

alter table profiles add column if not exists need_pseudo boolean not null default false;

create or replace function _pseudo_ok(p text) returns boolean
language sql immutable as $$
  select coalesce(p, '') ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9._-]{3,20}$' and lower(p) not in ('nelson','sophie','admin','administrateur','iwi2me');
$$;
create or replace function _pseudo_err(p text, p_self text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p, '') = '' then 'Choisis un pseudo.'
    when char_length(p) < 3 then 'Pseudo trop court (3 caractères minimum).'
    when char_length(p) > 20 then 'Pseudo trop long (20 caractères maximum).'
    when p ~ '\s' then 'Pas d''espace dans le pseudo.'
    when p !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9._-]+$' then 'Pseudo : lettres (accents possibles), chiffres, point, tiret et underscore seulement.'
    when not _pseudo_ok(p) then 'Ce pseudo n''est pas disponible.'
    when exists (select 1 from profiles where lower(name) = lower(p) and id <> coalesce(p_self, '')) then 'Ce pseudo est déjà pris.'
    else null end;
$$;

drop function if exists create_account(uuid,text,text,text);

create or replace function create_account(p_token uuid, p_login text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me profiles := _me(p_token); lg text := lower(trim(coalesce(p_login, ''))); pid text; np profiles; pal text[] := array['#4DB8FF','#FF7AC8','#FFD54D','#B28CFF','#5EEAD4','#FF9F6B']; n int;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  if lg = '' then return json_build_object('error', 'Saisis un nom de compte.'); end if;
  if char_length(lg) < 3 then return json_build_object('error', 'Nom de compte trop court (3 caractères minimum).'); end if;
  if char_length(lg) > 40 then return json_build_object('error', 'Nom de compte trop long (40 caractères maximum).'); end if;
  if lg !~ '^[a-z0-9._@+-]+$' then return json_build_object('error', 'Nom de compte : lettres, chiffres, point, tiret, @ seulement, sans espace.'); end if;
  if coalesce(p_pin, '') = '' then return json_build_object('error', 'Saisis un mot de passe.'); end if;
  if p_pin !~ '^[0-9]+$' then return json_build_object('error', 'Le mot de passe ne doit contenir que des chiffres.'); end if;
  if char_length(p_pin) < 6 then return json_build_object('error', 'Mot de passe : 6 chiffres minimum.'); end if;
  if char_length(p_pin) > 12 then return json_build_object('error', 'Mot de passe : 12 chiffres maximum.'); end if;
  if exists (select 1 from profiles where lower(email) = lg) then return json_build_object('error', 'Ce nom de compte existe déjà.'); end if;
  pid := 'u-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  select count(*) into n from profiles;
  insert into profiles(id, name, color, email, pin_hash, perms, status, need_pseudo) values (pid, 'Nouveau', pal[1 + n % 6], lg, crypt(p_pin, gen_salt('bf')), '{}'::jsonb, 'active', true) returning * into np;
  return json_build_object('id', np.id);
end $$;

create or replace function set_pseudo(p_token uuid, p_pseudo text) returns json
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); pz text := trim(coalesce(p_pseudo, '')); er text;
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  if not me.need_pseudo then return json_build_object('error', 'Ton pseudo est déjà choisi.'); end if;
  er := _pseudo_err(pz, me.id);
  if er is not null then return json_build_object('error', er); end if;
  update profiles set name = pz, need_pseudo = false where id = me.id;
  return json_build_object('ok', true);
end $$;

create or replace function claim_invite(p_code uuid, p_name text, p_email text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare inv invites; np profiles; nm text := trim(coalesce(p_name, '')); pe text; em text := lower(trim(coalesce(p_email, ''))); pid text; pal text[] := array['#4DB8FF','#FF7AC8','#FFD54D','#B28CFF','#5EEAD4','#FF9F6B']; n int;
begin
  select * into inv from invites where code = p_code and used_by is null and expires_at > now() for update;
  if inv.code is null then return json_build_object('error', 'Ce lien d''invitation n''est plus valide.'); end if;
  pe := _pseudo_err(nm, null); if pe is not null then return json_build_object('error', pe); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return json_build_object('error', 'E-mail invalide.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6,12}$' then return json_build_object('error', 'Le code doit faire 6 à 12 chiffres.'); end if;
  if exists (select 1 from profiles where lower(email) = em) then return json_build_object('error', 'Cet e-mail a déjà un compte : connecte-toi.'); end if;
  pid := 'u-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  select count(*) into n from profiles;
  insert into profiles(id, name, color, email, pin_hash, perms, status, requested_at) values (pid, nm, pal[1 + n % 6], em, crypt(p_pin, gen_salt('bf')), inv.perms, 'pending', now()) returning * into np;
  update invites set used_by = np.id where code = inv.code;
  return json_build_object('pending', true, 'id', np.id);
end $$;

create or replace function get_data(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null then raise exception 'lien invalide'; end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'admin', me.is_admin, 'gcal_shared', me.gcal_shared,
                            'hevy', exists(select 1 from hevy_keys where profile_id = me.id),
                            'hevy_sync', (select synced_at from hevy_keys where profile_id = me.id), 'couple', _couple(me.id), 'need_pseudo', me.need_pseudo),
    'profiles', _profiles_visible(me),
    'events', coalesce((select json_agg(json_build_object('id',id,'title',title,'date',date,'time',time,'owner',owner,'scope',scope,'meta',meta))
                        from events where owner = me.id or (scope = 'commun' and _samecp(me.id, owner))), '[]'::json),
    'tasks',  coalesce((select json_agg(json_build_object('id',id,'title',title,'period',period,'key',key,'progress',progress,'progress_b',progress_b,'owner',owner,'scope',scope))
                        from tasks  where owner = me.id or (scope = 'commun' and _samecp(me.id, owner))), '[]'::json),
    'gcal',   coalesce((select json_agg(json_build_object('id',g.id,'title',g.title,'date',g.date,'time',g.time,'owner',g.owner))
                        from gcal_events g join profiles pr on pr.id = g.owner
                        where _samecp(me.id, g.owner) and (g.owner = me.id or pr.gcal_shared)), '[]'::json),
    'workouts', coalesce((select json_agg(json_build_object('id',w.id,'owner',w.profile_id,'title',w.title,'day',w.day,'start',w.start_time,'end',w.end_time,'sets',w.n_sets,'vol',w.volume,'ex',w.ex) order by w.start_time desc)
                        from workouts w
                        where w.day >= current_date - 400 and (w.profile_id = me.id or (_samecp(me.id, w.profile_id)))), '[]'::json)
  );
end $$;

create or replace function get_admin(p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _me(p_token); al jsonb := '[]'::jsonb; np int; r record; mb numeric;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  select count(*) into np from profiles where status = 'pending';
  if np > 0 then al := al || jsonb_build_array(np || ' demande(s) de compte à valider'); end if;
  for r in select p.name, k.synced_at from hevy_keys k join profiles p on p.id = k.profile_id where k.synced_at is null or k.synced_at < now() - interval '36 hours' loop
    al := al || jsonb_build_array('Synchro Hevy ancienne ou jamais faite pour ' || r.name);
  end loop;
  for r in select p.name, k.provider from watch_keys k join profiles p on p.id = k.profile_id where (k.refresh_token is not null or k.api_key is not null) and (k.synced_at is null or k.synced_at < now() - interval '36 hours') loop
    al := al || jsonb_build_array('Synchro ' || r.provider || ' ancienne pour ' || r.name);
  end loop;
  mb := round(pg_database_size(current_database()) / 1048576.0, 1);
  if mb > 400 then al := al || jsonb_build_array('Base de données à ' || mb || ' Mo sur 500 Mo (plan gratuit)'); end if;
  return json_build_object(
    'alerts', al, 'db_mb', mb,
    'users', coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'color', p.color, 'perms', p.perms, 'created', p.created_at, 'status', p.status,
                         'need_pseudo', p.need_pseudo, 'partner', (select q.name from profiles q where q.id = p.partner), 'last_login', p.last_login, 'last_seen', p.last_seen, 'requested', p.requested_at,
                         'n_events', (select count(*) from events e where e.owner = p.id), 'n_tasks', (select count(*) from tasks t where t.owner = p.id),
                         'n_acts', (select count(*) from activities a where a.profile_id = p.id) + (select count(*) from workouts w where w.profile_id = p.id)) order by p.created_at)
                       from profiles p where not _is_pair(p.id)), '[]'::json),
    'invites', coalesce((select json_agg(json_build_object('code', code, 'label', label, 'perms', perms, 'expires', expires_at, 'used_by', used_by) order by created_at desc)
                         from invites where used_by is null and expires_at > now()), '[]'::json));
end $$;

create or replace function upsert_event(p_token uuid, p_id text, p_title text, p_date date, p_time text, p_owner text, p_scope text, p_meta text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  if coalesce(p_id,'') !~ '^[A-Za-z0-9_-]{1,60}$' then raise exception 'invalide'; end if;
  insert into events(id,title,date,time,owner,scope,created_by,meta) values (p_id,left(trim(coalesce(p_title,'')),200),p_date,left(coalesce(p_time,''),40),p_owner,p_scope,me.id,left(coalesce(p_meta,''),300))
  on conflict (id) do update set title=excluded.title, date=excluded.date, time=excluded.time, meta=excluded.meta,
      scope=excluded.scope, owner=excluded.owner, updated_at=now()
    where _can_modify(me.id, events.owner, events.scope, events.created_by)
      and (excluded.scope = 'commun' or events.scope = 'perso' or events.created_by = me.id or events.created_by is null);
  delete from reminders_sent where event_id = p_id;
end $$;

create or replace function upsert_task(p_token uuid, p_id text, p_title text, p_period text, p_key text, p_progress int, p_owner text, p_scope text, p_progress_b int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token);
begin
  if me.id is null or not _can_write(me.id, p_owner, p_scope) then raise exception 'interdit'; end if;
  if not _perm(me, 'tasks') then raise exception 'fonction désactivée'; end if;
  if coalesce(p_id,'') !~ '^[A-Za-z0-9_-]{1,60}$' or p_period not in ('day','week','month','year') then raise exception 'invalide'; end if;
  insert into tasks(id,title,period,key,progress,progress_b,owner,scope,created_by)
  values (p_id,left(trim(coalesce(p_title,'')),200),p_period,p_key,greatest(0,least(100,coalesce(p_progress,0))),greatest(0,least(100,coalesce(p_progress_b,0))),p_owner,p_scope,me.id)
  on conflict (id) do update set title=excluded.title, updated_at=now()
    where _can_modify(me.id, tasks.owner, tasks.scope, tasks.created_by);
end $$;

create or replace function create_invite(p_token uuid, p_label text, p_perms jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles := _me(p_token); c uuid; k text; clean jsonb := '{}'::jsonb;
begin
  if me.id is null or not me.is_admin then raise exception 'réservé à l''admin'; end if;
  for k in select unnest(array['tasks','sport','astro','integrations']) loop
    if p_perms ? k and jsonb_typeof(p_perms -> k) = 'boolean' then clean := clean || jsonb_build_object(k, p_perms -> k); end if;
  end loop;
  insert into invites(label, perms) values (left(trim(coalesce(p_label, '')), 40), clean) returning code into c;
  return c;
end $$;
revoke all on function _pseudo_ok(text), _pseudo_err(text,text), create_account(uuid,text,text), set_pseudo(uuid,text), claim_invite(uuid,text,text,text), get_data(uuid), get_admin(uuid), upsert_event(uuid,text,text,date,text,text,text,text), upsert_task(uuid,text,text,text,text,int,text,text,int), create_invite(uuid,text,jsonb) from public;
grant execute on function create_account(uuid,text,text), set_pseudo(uuid,text), claim_invite(uuid,text,text,text), get_data(uuid), get_admin(uuid), upsert_event(uuid,text,text,date,text,text,text,text), upsert_task(uuid,text,text,text,text,int,text,text,int), create_invite(uuid,text,jsonb) to anon, authenticated;


-- 19. Demande d'accès sans invitation (profil en attente, invisible tant que l'admin n'a pas accepté)
create or replace function request_access(p_pseudo text, p_email text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare nm text := trim(coalesce(p_pseudo, '')); pe text; em text := lower(trim(coalesce(p_email, ''))); pid text; pal text[] := array['#4DB8FF','#FF7AC8','#FFD54D','#B28CFF','#5EEAD4','#FF9F6B']; n int;
begin
  pe := _pseudo_err(nm, null); if pe is not null then return json_build_object('error', pe); end if;
  if char_length(em) > 80 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return json_build_object('error', 'E-mail invalide.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6,12}$' then return json_build_object('error', 'Le mot de passe doit faire 6 à 12 chiffres.'); end if;
  if exists (select 1 from profiles where lower(email) = em) then return json_build_object('error', 'Cet e-mail a déjà un compte ou une demande en cours.'); end if;
  if (select count(*) from profiles where status = 'pending') >= 30 then return json_build_object('error', 'Trop de demandes en attente, réessaie plus tard.'); end if;
  pid := 'u-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  select count(*) into n from profiles;
  insert into profiles(id, name, color, email, pin_hash, perms, status, requested_at) values (pid, nm, pal[1 + n % 6], em, crypt(p_pin, gen_salt('bf')), '{}'::jsonb, 'pending', now());
  return json_build_object('pending', true);
end $$;
revoke all on function request_access(text,text,text) from public;
grant execute on function request_access(text,text,text) to anon, authenticated;

-- 20. Mot de passe admin séparé (réservé à Nelson, session de 30 min).
-- Le mot de passe n'est PAS dans ce dépôt : il a été enregistré (haché) directement dans la table admin_secret.
alter table profiles add column if not exists admin_until timestamptz;
create table if not exists admin_secret (id int primary key default 1 check (id = 1), hash text not null);
alter table admin_secret enable row level security;
-- insert into admin_secret(id, hash) values (1, crypt('<mot de passe>', gen_salt('bf'))) on conflict (id) do update set hash = excluded.hash;
-- _adm(me), admin_unlock(token, pass), admin_status(token), admin_lock(token) ; toutes les fonctions admin exigent maintenant _adm(me) au lieu de me.is_admin.
-- admin_unlock : réservé à nelson, 5 erreurs = blocage 15 min (login_throttle, clé 'adm-nelson').

-- 21. Chatbot (dormant tant que CHAT_ON=false dans app.js et que la fonction n'est pas redéployée) :
-- tables chat_messages / chat_usage, chat_begin (20 messages/jour/personne, 120/jour au total, alerte admin quand la limite est atteinte),
-- chat_end, chat_history, chat_purge (cron à 23h59 Paris : chat-purge-a / chat-purge-b). Voir aussi get_admin (alerte "Chatbot : limite…").
