// Edge Function "hevy-sync" : copie les seances Hevy de la personne (cle API stockee en base) dans la table workouts,
// avec le groupe musculaire principal de chaque exercice (via les modeles d'exercices Hevy, mis en cache dans exercise_muscles).
// Appelee par l'appli avec { token } (jeton de session). La cle Hevy ne sort jamais de la base.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, full } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(token || "")) return J({ error: "jeton invalide" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me, error: e1 } = await db.from("profiles").select("id").eq("token", token).maybeSingle();
    if (e1) return J({ error: "lecture profil impossible", detail: String(e1.message || e1) }, 500);
    if (!me) return J({ error: "jeton invalide" }, 401);
    const { data: k, error: e2 } = await db.from("hevy_keys").select("api_key, synced_at").eq("profile_id", me.id).maybeSingle();
    if (e2) return J({ error: "lecture cle impossible", detail: String(e2.message || e2) }, 500);
    if (!k) return J({ error: "aucune cle Hevy" }, 400);
    const H = { "api-key": k.api_key, accept: "application/json" };

    // 1) seances : jusqu'a 30 pages de 10 a la 1re synchro (ou sur demande), sinon les 2 pages les plus recentes
    const maxPages = (!k.synced_at || full) ? 30 : 2;
    const raw: any[] = [];
    let page = 1, pageCount = 1;
    while (page <= Math.min(pageCount, maxPages)) {
      const r = await fetch("https://api.hevyapp.com/v1/workouts?page=" + page + "&pageSize=10", { headers: H });
      if (r.status === 401 || r.status === 403) return J({ error: "Cle Hevy refusee (Hevy Pro requis)" }, 400);
      if (!r.ok) return J({ error: "Hevy indisponible (" + r.status + ")" }, 502);
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
      if (error) return J({ error: "ecriture impossible", detail: String(error.message || error) }, 500);
    }
    await db.from("hevy_keys").update({ synced_at: new Date().toISOString() }).eq("profile_id", me.id);
    return J({ ok: true, count: rows.length, muscles: known.size });
  } catch (e) {
    return J({ error: "erreur", detail: String((e as any)?.message || e) }, 500);
  }
});
