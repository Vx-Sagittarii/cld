// Edge Function "hevy-sync" : lit les séances Hevy de la personne (clé API stockée en base) et les copie dans la table workouts.
// Appelée par l'appli avec { token } (le jeton de session). La clé Hevy ne sort jamais de la base.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, full } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(token || "")) return J({ error: "jeton invalide" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await db.from("profiles").select("id").eq("token", token).maybeSingle();
    if (!me) return J({ error: "jeton invalide" }, 401);
    const { data: k } = await db.from("hevy_keys").select("api_key, synced_at").eq("profile_id", me.id).maybeSingle();
    if (!k) return J({ error: "aucune clé Hevy" }, 400);

    // 1re synchro (ou demandée) : jusqu'à 30 pages de 10 séances ; ensuite seulement les 2 plus récentes pages
    const maxPages = (!k.synced_at || full) ? 30 : 2;
    const rows: Record<string, unknown>[] = [];
    let page = 1, pageCount = 1;
    while (page <= Math.min(pageCount, maxPages)) {
      const r = await fetch(`https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`, { headers: { "api-key": k.api_key, accept: "application/json" } });
      if (r.status === 401 || r.status === 403) return J({ error: "Clé Hevy refusée (Hevy Pro requis)" }, 400);
      if (!r.ok) return J({ error: "Hevy indisponible (" + r.status + ")" }, 502);
      const d = await r.json();
      pageCount = d.page_count || 1;
      for (const w of d.workouts || []) {
        const exs = (w.exercises || []).map((e: any) => ({ t: e.title, s: (e.sets || []).filter((s: any) => s.type !== "warmup").length }));
        let vol = 0, ns = 0;
        for (const e of w.exercises || []) for (const s of e.sets || []) { ns++; vol += Math.round((s.weight_kg || 0) * (s.reps || 0)); }
        const st = w.start_time ? new Date(w.start_time) : null;
        rows.push({
          id: String(w.id), profile_id: me.id, title: w.title || "Séance", start_time: st, end_time: w.end_time ? new Date(w.end_time) : null,
          day: st ? st.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) : new Date().toISOString().slice(0, 10),
          n_sets: ns, volume: vol, ex: exs,
        });
      }
      page++;
    }
    if (rows.length) {
      const { error } = await db.from("workouts").upsert(rows, { onConflict: "id" });
      if (error) return J({ error: "écriture impossible" }, 500);
    }
    await db.from("hevy_keys").update({ synced_at: new Date().toISOString() }).eq("profile_id", me.id);
    return J({ ok: true, count: rows.length });
  } catch (e) {
    return J({ error: "erreur" }, 500);
  }
});
