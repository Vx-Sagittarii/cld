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
