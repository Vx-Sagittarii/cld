// Edge Function "hevy-sync" : copie les seances Hevy de la personne (cle API stockee en base) dans la table workouts,
// avec le groupe musculaire principal de chaque exercice (via les modeles d'exercices Hevy, mis en cache dans exercise_muscles).
// Appelee par l'appli avec { token } (jeton de session). La cle Hevy ne sort jamais de la base.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

// Synchronise une personne : renvoie un objet {ok,count,muscles} ou {error,...,status}
async function syncOne(db: any, profileId: string, k: { api_key: string; synced_at: string | null }, full: boolean) {
  const me = { id: profileId };
    const H = { "api-key": k.api_key, accept: "application/json" };

    // 1) seances : jusqu'a 30 pages de 10 a la 1re synchro (ou sur demande), sinon les 2 pages les plus recentes
    const maxPages = (!k.synced_at || full) ? 30 : 2;
    const raw: any[] = [];
    let page = 1, pageCount = 1;
    while (page <= Math.min(pageCount, maxPages)) {
      const r = await fetch("https://api.hevyapp.com/v1/workouts?page=" + page + "&pageSize=10", { headers: H });
      if (r.status === 401 || r.status === 403) return { error: "Cle Hevy refusee (Hevy Pro requis)", status: 400 };
      if (!r.ok) return { error: "Hevy indisponible (" + r.status + ")", status: 502 };
      const d = await r.json();
      pageCount = d.page_count || 1;
      raw.push(...(d.workouts || []));
      page++;
    }

    // 2) muscles : on complete le cache exercise_muscles pour les modeles d'exercices inconnus
    const ids = [...new Set(raw.flatMap((w) => (w.exercises || []).map((e: any) => String(e.exercise_template_id || ""))).filter(Boolean))];
    const known = new Map<string, string>();
    if (ids.length) {
      const { data: cached } = await db.from("exercise_muscles").select("template_id, muscle").in("template_id", ids);
      (cached || []).forEach((c: any) => known.set(c.template_id, c.muscle));
    }
    const missing = new Set(ids.filter((i) => !known.has(i)));
    if (missing.size) {
      const add: { template_id: string; muscle: string }[] = [];
      let tp = 1, tCount = 1;
      while (tp <= Math.min(tCount, 20) && missing.size) {
        const r = await fetch("https://api.hevyapp.com/v1/exercise_templates?page=" + tp + "&pageSize=100", { headers: H });
        if (!r.ok) break;
        const d = await r.json();
        tCount = d.page_count || 1;
        for (const t of d.exercise_templates || []) {
          const id = String(t.id);
          if (missing.has(id)) { const mu = t.primary_muscle_group || "other"; known.set(id, mu); add.push({ template_id: id, muscle: mu }); missing.delete(id); }
        }
        tp++;
      }
      if (add.length) await db.from("exercise_muscles").upsert(add, { onConflict: "template_id" });
    }

    // 3) lignes a ecrire
    const rows = raw.map((w) => {
      const exs = (w.exercises || []).map((e: any) => ({
        t: e.title, m: known.get(String(e.exercise_template_id || "")) || null,
        s: (e.sets || []).filter((s: any) => s.type !== "warmup").length,
      }));
      let vol = 0, ns = 0;
      for (const e of w.exercises || []) for (const s of e.sets || []) { ns++; vol += Math.round((s.weight_kg || 0) * (s.reps || 0)); }
      const st = w.start_time ? new Date(w.start_time) : null;
      return {
        id: String(w.id), profile_id: me.id, title: w.title || "Seance", start_time: st, end_time: w.end_time ? new Date(w.end_time) : null,
        day: st ? st.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) : new Date().toISOString().slice(0, 10),
        n_sets: ns, volume: vol, ex: exs,
      };
    });
    if (rows.length) {
      const { error } = await db.from("workouts").upsert(rows, { onConflict: "id" });
      if (error) return { error: "ecriture impossible", detail: String(error.message || error), status: 500 };
    }
    await db.from("hevy_keys").update({ synced_at: new Date().toISOString() }).eq("profile_id", me.id);
    return { ok: true, count: rows.length, muscles: known.size };
}

// ----- Montres connectees : Strava (OAuth, appli personnelle de l'utilisateur) et Garmin (API personnelle) -----
async function watchSync(db: any, profileId: string, provider: string, code: string | null, full: boolean) {
  const { data: k, error } = await db.from("watch_keys").select("*").eq("profile_id", profileId).eq("provider", provider).maybeSingle();
  if (error) return { error: "lecture impossible", detail: String(error.message || error), status: 500 };
  if (!k) return { error: "aucune connexion " + provider, status: 400 };
  let rows: any[] = [];
  if (provider === "strava") {
    const tok = async (params: Record<string, string>) => {
      const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: k.client_id, client_secret: k.client_secret, ...params }) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) return { err: "Strava a refuse la connexion (" + r.status + ") " + (t.message || "") };
      await db.from("watch_keys").update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(t.expires_at * 1000).toISOString() }).eq("profile_id", profileId).eq("provider", provider);
      k.access_token = t.access_token; k.refresh_token = t.refresh_token; k.expires_at = new Date(t.expires_at * 1000).toISOString();
      return {};
    };
    if (!k.client_id || !k.client_secret) return { error: "Identifiant ou secret Strava manquant", status: 400 };
    if (code) { const e = await tok({ code, grant_type: "authorization_code" }); if ((e as any).err) return { error: (e as any).err, status: 400 }; }
    else if (!k.refresh_token) return { error: "Strava pas encore autorise : clique sur Connecter Strava", status: 400 };
    else if (!k.expires_at || new Date(k.expires_at).getTime() < Date.now() + 60000) { const e = await tok({ grant_type: "refresh_token", refresh_token: k.refresh_token }); if ((e as any).err) return { error: (e as any).err, status: 400 }; }
    const after = Math.floor((Date.now() - (!k.synced_at || full || code ? 400 : 14) * 86400000) / 1000);
    const maxPages = (!k.synced_at || full || code) ? 5 : 1;
    for (let p = 1; p <= maxPages; p++) {
      const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=100&page=" + p + "&after=" + after, { headers: { Authorization: "Bearer " + k.access_token } });
      if (r.status === 401) return { error: "Strava : autorisation refusee (scope activity:read_all ?)", status: 400 };
      if (r.status === 429) return { error: "Strava : limite de requetes atteinte, reessaie plus tard", status: 429 };
      if (!r.ok) return { error: "Strava indisponible (" + r.status + ")", status: 502 };
      const list = await r.json();
      for (const a of list) rows.push({
        id: "strava:" + a.id, profile_id: profileId, provider, day: String(a.start_date_local || a.start_date).slice(0, 10), title: a.name || "Activite",
        kind: String(a.sport_type || a.type || "").toLowerCase(), start_time: a.start_date ? new Date(a.start_date) : null,
        secs: Math.round(a.moving_time || 0), dist_m: Math.round(a.distance || 0), kcal: a.calories ? Math.round(a.calories) : null, avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      });
      if (list.length < 100) break;
    }
  } else {
    if (!k.api_key) return { error: "cle Garmin manquante", status: 400 };
    const B = "https://personal.connectapi.garmin.com";
    const tr = await fetch(B + "/personalapitoken-service/personal-api/personal-api-key/token", { method: "POST", headers: { Authorization: "ApiKey " + k.api_key } });
    const tt = await tr.text();
    if (!tr.ok) return { error: "Garmin a refuse la cle (" + tr.status + ")", detail: tt.slice(0, 200), status: 400 };
    let token = tt.trim().replace(/^"|"$/g, "");
    try { const j = JSON.parse(tt); token = (typeof j === "string" ? j : (j.access_token || j.accessToken || j.token || j.jwt || "")) || token; } catch (_) {}
    const pages = (!k.synced_at || full) ? 3 : 1;
    for (let p = 0; p < pages; p++) {
      const r = await fetch(B + "/activitylist-service/activities/search/activities?start=" + (p * 100) + "&limit=100", { headers: { Authorization: "Bearer " + token, accept: "application/json" } });
      const t = await r.text();
      if (!r.ok) return { error: "Garmin : lecture des activites impossible (" + r.status + ")", detail: t.slice(0, 200), status: 502 };
      let list: any = []; try { list = JSON.parse(t); } catch (_) { return { error: "Garmin : reponse inattendue", detail: t.slice(0, 200), status: 502 }; }
      if (!Array.isArray(list)) list = list.activities || list.activityList || list.items || [];
      for (const a of list) {
        const loc = String(a.startTimeLocal || a.startTimeGMT || "");
        if (!a.activityId || !loc) continue;
        rows.push({
          id: "garmin:" + a.activityId, profile_id: profileId, provider, day: loc.slice(0, 10), title: a.activityName || "Activite",
          kind: String(a.activityType?.typeKey || a.activityType || "").toLowerCase(),
          start_time: a.startTimeGMT ? new Date(String(a.startTimeGMT).replace(" ", "T") + "Z") : null,
          secs: Math.round(a.duration || 0), dist_m: Math.round(a.distance || 0), kcal: a.calories ? Math.round(a.calories) : null, avg_hr: a.averageHR ? Math.round(a.averageHR) : null,
        });
      }
      if (list.length < 100) break;
    }
  }
  if (rows.length) {
    const { error: e } = await db.from("activities").upsert(rows, { onConflict: "id" });
    if (e) return { error: "ecriture impossible", detail: String(e.message || e), status: 500 };
  }
  await db.from("watch_keys").update({ synced_at: new Date().toISOString() }).eq("profile_id", profileId).eq("provider", provider);
  return { ok: true, count: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, full, cron, provider, code } = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Mode planifie (pg_cron, 20 h et 21 h UTC) : n'agit que s'il est 22 h a Paris, pour toutes les cles Hevy
    if (cron) {
      const { data: sec } = await db.from("cron_secret").select("value").limit(1).maybeSingle();
      if (!sec || sec.value !== cron) return J({ error: "refuse" }, 401);
      const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Paris" }).format(new Date()));
      if (hour !== 22) return J({ ok: true, skipped: "pas 22h a Paris" });
      const { data: keys } = await db.from("hevy_keys").select("profile_id, api_key, synced_at");
      const out: unknown[] = [];
      for (const k of keys || []) out.push(await syncOne(db, k.profile_id, k, false));
      const { data: wk } = await db.from("watch_keys").select("profile_id, provider");
      for (const w of wk || []) out.push(await watchSync(db, w.profile_id, w.provider, null, false));
      return J({ ok: true, cron: true, results: out });
    }

    if (!/^[0-9a-f-]{36}$/i.test(token || "")) return J({ error: "jeton invalide" }, 401);
    const { data: me, error: e1 } = await db.from("profiles").select("id").eq("token", token).maybeSingle();
    if (e1) return J({ error: "lecture profil impossible", detail: String(e1.message || e1) }, 500);
    if (!me) return J({ error: "jeton invalide" }, 401);
    if (provider === "strava" || provider === "garmin") {
      const r: any = await watchSync(db, me.id, provider, typeof code === "string" ? code : null, !!full);
      return J(r, r.status || 200);
    }
    const { data: k, error: e2 } = await db.from("hevy_keys").select("api_key, synced_at").eq("profile_id", me.id).maybeSingle();
    if (e2) return J({ error: "lecture cle impossible", detail: String(e2.message || e2) }, 500);
    if (!k) return J({ error: "aucune cle Hevy" }, 400);
    const r: any = await syncOne(db, me.id, k, !!full);
    return J(r, r.status || 200);
  } catch (e) {
    return J({ error: "erreur", detail: String((e as any)?.message || e) }, 500);
  }
});
