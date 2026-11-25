/* iwi2me — calendrier + tâches pour un couple.
   Étape 1 : les données sont stockées dans le téléphone (localStorage).
   Étape suivante : on remplacera load()/save() par Supabase pour partager à deux. */

"use strict";

// ---------------------------------------------------------------
// 1. DONNÉES
// ---------------------------------------------------------------
const KEY = "iwi2me-v2", LEGACY = "iwi2me-v1", SESSION = "iwi2me-session";
const COMMUN_COLOR = "#B46BFF";
const EXTRA_COLORS = ["#3D8BFF", "#F2B705", "#FF5C8A", "#1FB5E8", "#9AE04A", "#E06BFF"];
// Couleurs imposées aux deux profils de base (appliquées aussi aux anciennes données et à la base)
const BASE_COLORS = { nelson: "#FF8A3D", sophie: "#3DDC97" };
const fixColors = (profiles) => profiles.forEach((p) => { if (BASE_COLORS[p.id]) p.color = BASE_COLORS[p.id]; });
const PAIR = ["nelson", "sophie"]; // seuls ces deux profils partagent le calendrier commun

const defaultState = {
  profiles: [
    { id: "nelson", name: "Nelson", admin: true, color: "#FF8A3D" },
    { id: "sophie", name: "Sophie", color: "#3DDC97" }
  ],
  // owner = id d'un profil ; scope = "perso" (visible par le seul propriétaire) ou "commun" (Nelson + Sophie)
  events: [], // { id, title, date, time, owner, scope }
  tasks: []   // { id, title, period, key, owner, scope, progress }
};

// Migration depuis la v1 (me / partner / shared) vers les profils
function migrate(old) {
  const map = { me: "nelson", partner: "sophie", shared: "nelson" };
  const fix = (x) => Object.assign({}, x, { owner: map[x.owner] || x.owner, scope: x.owner === "shared" ? "commun" : (x.scope || "perso") });
  return { profiles: structuredClone(defaultState.profiles), events: (old.events || []).map(fix), tasks: (old.tasks || []).map(fix) };
}

// ----- Mode en ligne : connexion par e-mail + code ; le jeton reçu est gardé sur cet appareil -----
const TOKEN_KEY = "iwi2me-token", CACHE_KEY = "iwi2me-cache";
const CFG = window.IWI_CONFIG || {};
if (location.hash.includes("k=")) history.replaceState(null, "", location.pathname + location.search); // anciens liens secrets : désactivés
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
const cloud = !!(token && CFG.url && CFG.key);
const needLogin = !token && !!(CFG.url && CFG.key); // pas de session : écran de connexion
let loaded = !cloud;   // en ligne : on attend la première réponse de la base
let isAdmin = false;

// Appel d'une fonction de la base (seul point d'entrée : la clé publique + le jeton du profil)
async function rpc(fn, args) {
  const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: CFG.key, "Content-Type": "application/json" }, body: JSON.stringify(args)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return t ? JSON.parse(t) : null;
}
// Envoie une modification à la base (la mise à jour de l'écran est déjà faite, localement)
function push(fn, args) {
  if (!cloud) return;
  rpc(fn, Object.assign({ p_token: token }, args)).catch((e) => { console.warn(fn, e); toast("Hors connexion : modification non enregistrée"); });
}
const evArgs = (e) => ({ p_id: e.id, p_title: e.title, p_date: e.date, p_time: e.time || "", p_owner: e.owner, p_scope: e.scope, p_meta: e.meta || "" });
const tkArgs = (t) => ({ p_id: t.id, p_title: t.title, p_period: t.period, p_key: t.key, p_progress: t.progress, p_progress_b: t.progress_b || 0, p_owner: t.owner, p_scope: t.scope });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(structuredClone(defaultState), JSON.parse(raw));
    const old = localStorage.getItem(LEGACY);
    if (old) return migrate(JSON.parse(old));
  } catch (e) { /* données illisibles : on repart de zéro */ }
  return structuredClone(defaultState);
}
function save() {
  if (cloud) return; // en ligne, les données vivent dans la base (push)
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

const state = load();
fixColors(state.profiles);
const uid = () => Math.random().toString(36).slice(2, 10);

// Profil actif sur cet appareil (par défaut Nelson, l'admin)
let me = (() => { try { return localStorage.getItem(SESSION); } catch (e) { return null; } })();
if (cloud) me = null; // en ligne, le profil vient du lien
else if (!state.profiles.some((p) => p.id === me)) me = "nelson";
const prof = (id) => state.profiles.find((p) => p.id === id);
const isPair = (id) => PAIR.includes(id);

// Règles de visibilité : le commun n'est vu que par Nelson et Sophie ; le reste que par son propriétaire
const canSee = (it) => it.scope === "commun" ? isPair(me) : it.owner === me;
// Deux volets : « Perso » = tout ce que je vois (privé + public avec l'autre) ; « Commun » = seulement le public
const passes = (it) => canSee(it) && (!isPair(me) || ui.filter !== "commun" || it.scope === "commun");
const persoView = () => isPair(me) && ui.filter !== "commun";
const colorOf = (it) => it.scope === "commun" ? (document.body.classList.contains("noel") ? "#FF5A6E" : COMMUN_COLOR) : (prof(it.owner)?.color || "#A45CFF");
// Avancement d'une tâche : en commun, moyenne de Nelson (progress) et Sophie (progress_b)
const pendingProg = new Map(); // % modifiés mais pas encore sauvegardés
const tp = (t) => t.scope === "commun" ? Math.round((t.progress + (t.progress_b || 0)) / 2) : t.progress;
// Ma part d'une tâche : sur une tâche commune, Nelson = progress, Sophie = progress_b
const myField = (t) => (t.scope === "commun" && me === "sophie") ? "progress_b" : "progress";
const mine = (t) => t[myField(t)] || 0;
const shown = (t) => persoView() ? mine(t) : tp(t); // volet Perso : seulement mon %, volet Commun : la moyenne
const labelOf = (it) => (it.google && it.owner !== me) ? `${prof(it.owner)?.name || "L'autre"} · Google` : persoView() ? (it.scope === "commun" ? "👥 Public" : "🔒 Privé") : (it.scope === "commun" ? "Commun" : (prof(it.owner)?.name || "?"));

// État de l'interface (non sauvegardé)
const ui = {
  tab: "cal",
  selected: toISO(new Date()),
  month: startOfMonth(new Date()),
  period: "day",
  filter: "perso" // perso | commun
};

// ---------------------------------------------------------------
// 2. OUTILS DE DATES
// ---------------------------------------------------------------
function pad(n) { return String(n).padStart(2, "0"); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// Semaine ISO (le lundi est le premier jour)
function mondayOf(d) { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); return r; }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7) };
}

// Clé de "période" : permet de rattacher une tâche à un jour, une semaine, un mois ou une année.
function periodKey(period, d) {
  if (period === "day") return toISO(d);
  if (period === "week") { const w = isoWeek(d); return `${w.year}-W${pad(w.week)}`; }
  if (period === "month") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return String(d.getFullYear());
}
// Décale la date de référence d'une période (suivant / précédent)
function shift(period, d, dir) {
  if (period === "day") return addDays(d, dir);
  if (period === "week") return addDays(d, 7 * dir);
  if (period === "month") return new Date(d.getFullYear(), d.getMonth() + dir, 1);
  return new Date(d.getFullYear() + dir, d.getMonth(), 1);
}
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function periodLabel(period, d) {
  if (period === "day") return `${JOURS_LONG[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
  if (period === "week") {
    const a = mondayOf(d), b = addDays(a, 6);
    return `Semaine ${isoWeek(d).week} · ${a.getDate()} ${MOIS[a.getMonth()]} – ${b.getDate()} ${MOIS[b.getMonth()]}`;
  }
  if (period === "month") return `${MOIS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

// Heures d'un événement (texte) : "19:30", "19:30-21:00", avec date de fin facultative ">2026-12-03"
// (ex. "22:00-02:00>2026-11-27" ; ">2026-12-03" seul = plusieurs jours sans heure). "" = toute la journée.
function parseTime(t) {
  const m = /^(?:(\d\d):(\d\d)(?:-(\d\d):(\d\d))?)?(?:>(\d{4}-\d\d-\d\d))?$/.exec(t || "");
  if (!m || !t) return null;
  return { s: m[1] !== undefined ? +m[1] * 60 + +m[2] : null, e: m[3] !== undefined ? +m[3] * 60 + +m[4] : null, endDate: m[5] || null };
}
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const dm = (iso) => { const d = fromISO(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
// Dernier jour d'un événement (= son jour de début s'il tient sur une journée)
function endDateOf(e) { const p = parseTime(e.time); return p && p.endDate && p.endDate > e.date ? p.endDate : e.date; }
// Options d'un événement (répétition, rappel, compte à rebours) : petit JSON dans e.meta
const _mc = new WeakMap();
function metaOf(e) {
  const k = e.meta || ""; const c = _mc.get(e); if (c && c.k === k) return c.m;
  let m = {}; try { m = k ? JSON.parse(k) : {}; } catch (x) {}
  _mc.set(e, { k, m }); return m;
}
const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);
// Une occurrence de l'événement COMMENCE-t-elle ce jour-là ? (gère la répétition)
function repMatch(e, iso) {
  if (iso < e.date) return false;
  const r = metaOf(e).rep; if (!r) return iso === e.date;
  const a = fromISO(e.date), b = fromISO(iso);
  if (r === "d") return true;
  if (r === "w") return daysBetween(e.date, iso) % 7 === 0;
  if (r === "m") return a.getDate() === b.getDate();
  if (r === "y") return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return false;
}
// L'événement (ou une de ses répétitions) tombe-t-il sur ce jour ? Renvoie l'occurrence (copie décalée) ou null.
function inst(e, iso) {
  const sp = daysBetween(e.date, endDateOf(e));
  for (let k = 0; k <= sp; k++) {
    const o = toISO(addDays(fromISO(iso), -k));
    if (!repMatch(e, o)) continue;
    if (o === e.date) return e;
    const sh = daysBetween(e.date, o), p = parseTime(e.time);
    const time = p && p.endDate ? e.time.replace(/>.*$/, ">" + toISO(addDays(fromISO(p.endDate), sh))) : e.time;
    return Object.assign({}, e, { date: o, time });
  }
  return null;
}
const onDay = (e, iso) => !!inst(e, iso);
const REP_LABEL = { d: "Tous les jours", w: "Toutes les semaines", m: "Tous les mois", y: "Tous les ans" };
// Partie de l'événement qui tombe sur le jour `iso` : {s,e} en minutes, ou null = toute la journée
function segFor(e, iso) {
  const p = parseTime(e.time), end = endDateOf(e);
  if (end === e.date) return p && p.s !== null ? { s: p.s, e: p.e !== null && p.e > p.s ? p.e : null } : null;
  if (iso === e.date) return p && p.s !== null ? { s: p.s, e: 1440 } : null;
  if (iso === end) return p && p.e !== null ? { s: 0, e: p.e } : null;
  return null;
}
function fmtWhen(e) {
  const p = parseTime(e.time), end = endDateOf(e);
  if (end === e.date) return p && p.s !== null ? (p.e !== null && p.e > p.s ? `${hhmm(p.s)}–${hhmm(p.e)}` : hhmm(p.s)) : "";
  return `${dm(e.date)}${p && p.s !== null ? " " + hhmm(p.s) : ""} → ${dm(end)}${p && p.e !== null ? " " + hhmm(p.e) : ""}`;
}
// Règle des heures : si la fin est avant le début, elle compte pour le lendemain.
function computeSpan(date, endIn, t1, t2) {
  if (!t1 && t2) return { err: "Indique aussi l'heure de début (De)." };
  let endDate = endIn && endIn !== date ? endIn : "";
  if (endDate && endDate < date) return { err: "La date de fin doit être après la date de début." };
  if (t1 && t2 && !endDate) {
    if (t2 === t1) return { err: "Le début et la fin sont identiques." };
    if (t2 < t1) endDate = toISO(addDays(fromISO(date), 1));
  }
  return { endDate };
}

// ---------------------------------------------------------------
// 3. OUTILS D'AFFICHAGE
// ---------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const hero = $("#hero");

// ---------------------------------------------------------------
// 4. VUES
// ---------------------------------------------------------------
let pinCode = "";
const pinDots = () => pinCode ? "●".repeat(pinCode.length) : `<span class="muted">Saisis ton code</span>`;
function pinKey(k) {
  if (k === "del") pinCode = pinCode.slice(0, -1);
  else if (k === "clr") pinCode = "";
  else if (/^\d$/.test(k) && pinCode.length < 12) pinCode += k;
  const d = document.querySelector("#lgDots"); if (d) d.innerHTML = pinDots();
}
function viewLogin() {
  return `<div class="login-box">
    <h1>iwi2me</h1>
    <p class="muted">Connecte-toi pour retrouver ton espace.</p>
    <div class="field"><label>E-mail</label><input id="lgMail" type="email" autocomplete="email" inputmode="email" autocapitalize="off"></div>
    <div class="field"><label>Code</label>
      <div class="pin-dots" id="lgDots" aria-live="polite">${pinDots()}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-act="pin-key" data-k="${n}">${n}</button>`).join("")}
        <button type="button" class="alt" data-act="pin-key" data-k="del" aria-label="Effacer">⌫</button>
        <button type="button" data-act="pin-key" data-k="0">0</button>
        <button type="button" class="alt" data-act="pin-key" data-k="clr" aria-label="Tout effacer">C</button></div></div>
    <p class="muted">Indice : devine</p>
    <p class="lg-err" id="lgErr"></p>
    <button class="btn" data-act="login">Se connecter</button>
  </div>`;
}

function render(animate = false) {
  document.body.classList.toggle("login", needLogin);
  if (needLogin) { view.innerHTML = viewLogin(); hero.classList.add("off"); return; }
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === ui.tab));
  renderHero();
  applySeason();
  if (!loaded) { view.innerHTML = `<div class="empty">Chargement…</div>`; return; }
  if (ui.tab === "cal") view.innerHTML = viewCalendar();
  else if (ui.tab === "tasks") view.innerHTML = viewTasks();
  else if (ui.tab === "astro") view.innerHTML = viewAstro();
  else view.innerHTML = viewSettings();
  view.classList.toggle("enter", animate);
  if (gcal.on && gcal.token && ui.tab === "cal") ensureGcal();        // cascade d'apparition seulement au changement d'onglet
  hero.classList.toggle("off", ui.tab !== "cal"); // le bandeau photo n'apparaît que sur le calendrier
}


// ---------------------------------------------------------------
// GOOGLE AGENDA (lecture seule, propre à chaque téléphone / profil)
// ---------------------------------------------------------------
const GKEY = "iwi2me-gcal";
const gcal = { on: false, token: null, loading: false, cache: {}, events: [], gisReady: null };
let gShared = false;                       // mon Google Agenda est-il partagé avec l'autre ?
const gScope = () => gShared ? "commun" : "perso";
const partnerId = () => PAIR.find((x) => x !== me);
try { gcal.on = localStorage.getItem(GKEY) === "1"; } catch (e) {}
const gReady = () => !!CFG.googleClientId;
// Événements Google de l'autre (copie partagée, lecture seule)
const partnerG = () => (state.gcalShared || []).filter((e) => e.owner !== me).map((e) => ({ id: "gp_" + e.owner + "_" + e.id, title: e.title, date: e.date, time: e.time || "", owner: e.owner, scope: "commun", google: true }));
const allEvents = () => (gcal.on ? state.events.concat(gcal.events) : state.events).concat(cloud ? partnerG() : []);

function loadGIS() {
  if (gcal.gisReady) return gcal.gisReady;
  gcal.gisReady = new Promise((ok, ko) => {
    const el = document.createElement("script");
    el.src = "https://accounts.google.com/gsi/client"; el.async = true;
    el.onload = ok; el.onerror = () => { gcal.gisReady = null; ko(new Error("gis")); };
    document.head.appendChild(el);
  });
  return gcal.gisReady;
}
// Demande (ou renouvelle) l'accès. Doit être déclenchée par un toucher de l'utilisateur.
async function connectGoogle(silent) {
  if (!gReady()) { toast("Google Agenda n'est pas encore configuré"); return; }
  try { await loadGIS(); } catch (e) { toast("Impossible de joindre Google"); return; }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CFG.googleClientId,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    callback: (r) => {
      if (r.error || !r.access_token) { toast("Connexion Google annulée"); return; }
      gcal.token = r.access_token; gcal.on = true; gcal.cache = {}; gcal.events = [];
      try { localStorage.setItem(GKEY, "1"); } catch (e) {}
      toast("Google Agenda connecté");
      // Connexion = partage automatique avec l'autre (visible directement dans le calendrier)
      if (cloud && isPair(me) && !gShared) {
        gShared = true;
        rpc("set_gcal_shared", { p_token: token, p_shared: true }).then(() => { gcal.cache = {}; ensureGcal(); }).catch(() => {});
      }
      render(); ensureGcal();
    }
  });
  client.requestAccessToken({ prompt: silent ? "" : "consent" });
}
function disconnectGoogle() {
  try { if (gcal.token && window.google) google.accounts.oauth2.revoke(gcal.token); } catch (e) {}
  gcal.on = false; gcal.token = null; gcal.cache = {}; gcal.events = [];
  if (cloud && gShared) { gShared = false; rpc("set_gcal_shared", { p_token: token, p_shared: false }).catch(() => {}); } // la copie partagée est effacée
  try { localStorage.removeItem(GKEY); } catch (e) {}
  render(); toast("Google Agenda déconnecté");
}
// Charge les événements Google de la grille affichée (42 jours), une fois par mois
async function ensureGcal() {
  if (!gcal.on || !gcal.token || gcal.loading) return;
  const first = mondayOf(ui.month), key = toISO(first);
  if (gcal.cache[key]) return;
  gcal.loading = true;
  try {
    const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250"
      + "&timeMin=" + encodeURIComponent(first.toISOString()) + "&timeMax=" + encodeURIComponent(addDays(first, 42).toISOString());
    const r = await fetch(url, { headers: { Authorization: "Bearer " + gcal.token } });
    if (r.status === 401) { gcal.token = null; render(); return; } // jeton expiré : bouton « Reconnecter »
    if (!r.ok) throw new Error(r.status);
    const data = await r.json(), list = [];
    (data.items || []).forEach((g) => {
      if (g.status === "cancelled") return;
      const title = g.summary || "(sans titre)";
      if (g.start?.dateTime) { // événement horaire
        const a = new Date(g.start.dateTime), b = g.end?.dateTime ? new Date(g.end.dateTime) : null;
        const same = b && toISO(a) === toISO(b);
        list.push({ id: "g_" + g.id, title, date: toISO(a), time: `${pad(a.getHours())}:${pad(a.getMinutes())}` + (same ? `-${pad(b.getHours())}:${pad(b.getMinutes())}` : ""), owner: me, scope: gScope(), google: true });
      } else if (g.start?.date) { // journée entière (éventuellement plusieurs jours)
        let d = fromISO(g.start.date); const end = fromISO(g.end?.date || g.start.date);
        for (let i = 0; i < 31 && d < end; i++, d = addDays(d, 1)) list.push({ id: "g_" + g.id + "_" + i, title, date: toISO(d), time: "", owner: me, scope: gScope(), google: true });
      }
    });
    gcal.cache[key] = true;
    gcal.events = gcal.events.filter((e) => !list.some((x) => x.id === e.id)).concat(list);
    if (cloud && gShared) // copie partagée pour l'autre (seulement si le partage est activé)
      rpc("sync_gcal", { p_token: token, p_from: toISO(first), p_to: toISO(addDays(first, 41)), p_items: list.map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time })) }).catch(() => {});
    render();
  } catch (e) { toast("Google Agenda : chargement impossible"); }
  finally { gcal.loading = false; }
}

// ---------------------------------------------------------------
// MODE NOËL : calendrier de l'avent pour décembre
// ---------------------------------------------------------------
const isDec = () => ui.month.getMonth() === 11;
const NOEL_IMG = "img/scene-noel.svg", BASE_IMG = "img/scene.svg";
function applySeason() {
  const dec = isDec();
  document.body.classList.toggle("noel", dec);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dec ? "#0B2118" : "#130A33");
  document.querySelectorAll("#heroMedia img, #photo img").forEach((i) => {
    const want = dec ? NOEL_IMG : BASE_IMG;
    if (i.getAttribute("src") !== want) i.setAttribute("src", want);
  });
  let snow = document.getElementById("snow");
  if (dec && !snow) {
    snow = document.createElement("div"); snow.id = "snow"; snow.setAttribute("aria-hidden", "true");
    snow.innerHTML = Array.from({ length: 26 }, (_, i) => `<i style="left:${(i * 37) % 100}%;--s:${(3 + (i % 5) * 1.6).toFixed(1)}px;--t:${(9 + (i * 7) % 9)}s;--d:-${(i * 1.3).toFixed(1)}s;--x:${(i % 2 ? 1 : -1) * (14 + (i % 4) * 8)}px"></i>`).join("");
    document.body.appendChild(snow);
  } else if (!dec && snow) snow.remove();
}
function adventCountdown() {
  const y = ui.month.getFullYear(), today = new Date(), noel = new Date(y, 11, 25);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t0.getFullYear() !== y) return `<div class="card advent"><h3>Calendrier de l'avent</h3><div class="count">🎄 <b>Décembre ${y}</b></div></div>`;
  const n = Math.round((noel - t0) / 86400000);
  const txt = n > 1 ? `Plus que <b>${n}</b> jours avant Noël` : n === 1 ? `Noël, c'est <b>demain</b> !` : n === 0 ? `<b>Joyeux Noël !</b> 🎁` : `Joyeuses fêtes ! ✨`;
  return `<div class="card advent"><h3>Calendrier de l'avent</h3><div class="count">🎄 ${txt}</div></div>`;
}
// Animation : la case du jour s'ouvre quand on ajoute un événement en décembre
function adventBurst(iso) {
  const d = fromISO(iso); if (d.getMonth() !== 11) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { toast(`Case du ${d.getDate()} décembre ouverte 🎁`); return; }
  const colors = ["#FFE08A", "#FF4D5E", "#3DDC97", "#FFFFFF"];
  const sparks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2, r = 100 + Math.random() * 90;
    return `<i style="--x:${(Math.cos(a) * r).toFixed(0)}px;--y:${(Math.sin(a) * r).toFixed(0)}px;--d:${(Math.random() * .35).toFixed(2)}s;--c:${colors[i % 4]}"></i>`;
  }).join("");
  const el = document.createElement("div");
  el.className = "burst";
  el.innerHTML = `<div class="bdoor"><div class="inside"><span>🎁</span></div><div class="panel"><b>${d.getDate()}</b></div>${sparks}</div><p>Case du ${d.getDate()} décembre ouverte !</p>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("go")));
  const kill = () => el.remove();
  el.addEventListener("click", kill); setTimeout(kill, 3000);
}

// ----- Barre profils + filtre perso/commun -----
function profileBar() {
  if (cloud) return "";
  const chips = state.profiles.map((p) => `<button class="pchip ${p.id === me ? "on" : ""}" style="--c:${p.color}" data-act="profile" data-id="${p.id}"><i></i>${esc(p.name)}</button>`).join("");
  return `<div class="pbar">${chips}<button class="pchip add" data-act="new-profile" aria-label="Ajouter un profil">+</button></div>`;
}
function filterBar() {
  if (!isPair(me)) return "";
  const f = [["perso", "Perso"], ["commun", "Commun"]];
  return `<div class="seg two">${f.map(([k, l]) => `<button class="${k === ui.filter ? "on" : ""}" data-act="filter" data-f="${k}">${l}</button>`).join("")}</div>`;
}
function renderHero() {
  document.querySelectorAll(".spot").forEach((s) => s.classList.toggle("active", s.dataset.id === me));
}

// ----- Mini-journée : les événements du jour en un coup d'œil -----
function dayStrip(evs) {
  if (!evs.length) return "";
  const timed = evs.map((e) => ({ e, p: segFor(e, ui.selected) })).filter((x) => x.p);
  const allday = evs.filter((e) => !segFor(e, ui.selected));
  let html = allday.map((e) => `<span class="allday" style="--c:${colorOf(e)}">${esc(e.title)}</span>`).join("");
  if (allday.length) html = `<div class="alldays">${html}</div>`;
  if (timed.length) {
    // Plage adaptée : au moins 8 h–20 h, élargie si besoin, arrondie à l'heure
    const end = (x) => x.p.e ?? Math.min(x.p.s + 60, 1440);
    const lo = Math.max(0, Math.min(8 * 60, Math.floor(Math.min(...timed.map((x) => x.p.s)) / 60) * 60));
    const hi = Math.min(1440, Math.max(20 * 60, Math.ceil(Math.max(...timed.map(end)) / 60) * 60));
    const span = hi - lo;
    const MINW = 0.22 * span; // largeur visuelle minimale (pour que le titre reste lisible)
    const vend = (x) => Math.max(end(x), x.p.s + MINW);
    // Pistes : deux événements qui se chevauchent (visuellement) sont empilés
    const lanes = [];
    timed.sort((a, b) => a.p.s - b.p.s).forEach((x) => {
      let i = lanes.findIndex((l) => l <= x.p.s);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = vend(x); x.lane = i;
    });
    const step = span > 12 * 60 ? 180 : 120;
    let ticks = "";
    for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) ticks += `<i style="left:${((m - lo) / span) * 100}%"><b>${Math.floor(m / 60)}h</b></i>`;
    const bars = timed.map((x) => {
      const left = ((x.p.s - lo) / span) * 100, w = Math.max(((end(x) - x.p.s) / span) * 100, 22);
      return `<div class="bar" style="left:${left}%;width:${Math.min(w, 100 - left)}%;top:${x.lane * 30}px;--c:${colorOf(x.e)}" title="${esc(x.e.title)} ${fmtWhen(x.e)}"><span>${esc(x.e.title)}</span></div>`;
    }).join("");
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const nowLine = ui.selected === toISO(now) && nowMin >= lo && nowMin <= hi ? `<u class="now" style="left:${((nowMin - lo) / span) * 100}%"></u>` : "";
    html += `<div class="strip" style="height:${lanes.length * 30 + 20}px"><div class="ticks">${ticks}</div>${bars}${nowLine}</div>`;
  }
  return `<div class="card"><h3>La journée en un coup d'œil</h3>${html}</div>`;
}

// ----- Compte à rebours (événements marqués « afficher en compte à rebours ») -----
function countdownCards() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = state.events.filter((e) => metaOf(e).cd && canSee(e)).map((e) => {
    for (let i = 0; i <= 400; i++) { const iso = toISO(addDays(today, i)); if (repMatch(e, iso)) return { e, iso, i }; }
    return null;
  }).filter(Boolean).sort((a, b) => a.i - b.i).slice(0, 3);
  if (!items.length) return "";
  return `<div class="cd-row">${items.map((x) => `<div class="cd" style="--c:${colorOf(x.e)}"><b>${x.i === 0 ? "Aujourd'hui" : x.i === 1 ? "Demain" : "J-" + x.i}</b><span>${esc(x.e.title)}</span><small>${dm(x.iso)}</small></div>`).join("")}</div>`;
}

// ----- Calendrier -----
function viewCalendar() {
  const m = ui.month, today = toISO(new Date());
  const EV = allEvents(), dec = isDec();
  const first = mondayOf(m); // on commence à la semaine qui contient le 1er du mois
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(first, i), iso = toISO(d);
    if (i >= 35 && d.getMonth() !== m.getMonth()) break; // pas de 6e ligne inutile
    // Pastilles de couleur : qui a quelque chose ce jour-là ?
    const cols = new Set([
      ...EV.filter((e) => onDay(e, iso) && passes(e)).map(colorOf),
      ...state.tasks.filter((t) => t.period === "day" && t.key === iso && passes(t)).map(colorOf)
    ]);
    const dots = [...cols].slice(0, 3).map((c) => `<i class="dot" style="background:${c}"></i>`).join("");
    const inMonth = d.getMonth() === m.getMonth();
    const door = dec && inMonth && d.getDate() <= 25;
    const has = door && EV.some((e) => onDay(e, iso) && passes(e));
    const cls = ["day", !inMonth ? "out" : "", iso === today ? "today" : "", iso === ui.selected ? "sel" : "",
      door ? "door" : "", door && d.getDate() % 2 ? "odd" : "", has ? "open" : "", dec && inMonth && d.getDate() === 24 ? "eve" : ""].join(" ");
    cells += `<button class="${cls}" data-act="pick" data-date="${iso}">${d.getDate()}<span class="dots">${dots}</span></button>`;
  }

  const sel = fromISO(ui.selected);
  const evs = EV.map((e) => inst(e, ui.selected)).filter((e) => e && passes(e)).sort((a, b) => (segFor(a, ui.selected)?.s ?? -1) - (segFor(b, ui.selected)?.s ?? -1));
  const tks = state.tasks.filter((t) => t.period === "day" && t.key === ui.selected && passes(t));

  return `
    <div class="head">
      <div><h1>${MOIS_LONG[m.getMonth()]} ${m.getFullYear()}</h1><div class="sub">Calendrier de ${esc(prof(me).name)}</div></div>
      <div class="nav">
        <button class="icon-btn nav-btn" data-act="month" data-dir="-1" aria-label="Mois précédent" title="Mois précédent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>
        <button class="icon-btn nav-btn" data-act="month" data-dir="1" aria-label="Mois suivant" title="Mois suivant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
      </div>
    </div>
    ${profileBar()}${filterBar()}
    ${countdownCards()}
    ${dec ? adventCountdown() : ""}
    ${gcal.on && !gcal.token ? `<button class="add-btn gre" data-act="gcal-connect-silent">Reconnecter Google Agenda</button>` : ""}
    <div class="card ${dec ? "advent-grid" : ""}">
      <div class="dow"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="grid">${cells}</div>
    </div>

    ${dayStrip(evs)}
    <div class="card">
      <h3>${JOURS_LONG[sel.getDay()]} ${sel.getDate()} ${MOIS_LONG[sel.getMonth()]}</h3>
      ${evs.length ? evs.map((e) => `
        <div class="row">
          <div class="bar-owner" style="background:${colorOf(e)}"></div>
          <div class="t" ${e.google ? "" : `data-act="edit-event" data-id="${e.id}"`}><b>${esc(e.title)}</b><small>${esc(labelOf(e))}${metaOf(e).rep ? " · ↻ " + REP_LABEL[metaOf(e).rep].toLowerCase() : ""}${metaOf(e).rem !== undefined ? " · 🔔" : ""}${endDateOf(e) > e.date ? " · " + esc(fmtWhen(e)) : ""}</small></div>
          <div class="time">${endDateOf(e) > e.date ? `Jour ${Math.round((fromISO(ui.selected) - fromISO(e.date)) / 864e5) + 1}/${Math.round((fromISO(endDateOf(e)) - fromISO(e.date)) / 864e5) + 1}` : fmtWhen(e) || "Journée"}</div>
          ${e.google ? `<span class="gtag" title="Google Agenda">G</span>` : `<button class="del" data-act="del-event" data-id="${e.id}" aria-label="Supprimer">×</button>`}
        </div>`).join("") : `<div class="empty">Rien de prévu ce jour-là.</div>`}
      <button class="add-btn" data-act="new-event">+ Ajouter un événement</button>
    </div>

    ${tks.length ? `<div class="card"><h3>Tâches du jour</h3>${tks.map((t) => `
      <div class="row">
        <div class="bar-owner" style="background:${colorOf(t)}"></div>
        <div class="t"><b>${esc(t.title)}</b><small>${esc(labelOf(t))}</small></div>
        <div class="time">${persoView() ? mine(t) + "%" : t.scope === "commun" ? `${prof("nelson")?.name[0] || "N"} ${t.progress}% · ${prof("sophie")?.name[0] || "S"} ${t.progress_b || 0}%` : t.progress + "%"}</div>
      </div>`).join("")}</div>` : ""}

    <div class="card">
      <h3>Sport</h3>
      <div class="sport">
        <div class="badge">🏋️</div>
        <div><b>Pas encore connecté</b>Les séances Hevy et Strava de la journée apparaîtront ici.</div>
      </div>
    </div>`;
}

// ----- Tâches -----
function viewTasks() {
  const ref = fromISO(ui.selected);
  const key = periodKey(ui.period, ref);
  const list = state.tasks.filter((t) => t.period === ui.period && t.key === key && passes(t));
  const avg = list.length ? Math.round(list.reduce((s, t) => s + shown(t), 0) / list.length) : 0;
  const labels = { day: "Jour", week: "Semaine", month: "Mois", year: "Année" };

  return `
    <div class="head">
      <div><h1>Tâches</h1><div class="sub">${periodLabel(ui.period, ref)}</div></div>
      <div class="nav">
        <button class="icon-btn nav-btn" data-act="shift" data-dir="-1" aria-label="Période précédente" title="Précédent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>
        <button class="icon-btn nav-btn" data-act="shift" data-dir="1" aria-label="Période suivante" title="Suivant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
      </div>
    </div>
    ${profileBar()}${filterBar()}
    <div class="seg">${Object.keys(labels).map((p) => `<button class="${p === ui.period ? "on" : ""}" data-act="period" data-p="${p}">${labels[p]}</button>`).join("")}</div>

    <div class="card overall">
      <div class="ring" id="ring" style="--p:${avg}"><span id="ringTxt">${avg}%</span></div>
      <div class="t"><b>Avancement ${ui.period === "day" ? "du jour" : ui.period === "week" ? "de la semaine" : ui.period === "month" ? "du mois" : "de l'année"}</b>
      <small>${list.length ? `${list.length} tâche${list.length > 1 ? "s" : ""}` : "Aucune tâche pour l'instant"}</small></div>
    </div>

    <div class="card">
      ${list.map((t) => {
        const two = t.scope === "commun" && !persoView();
        const w1 = myField(t) === "progress_b" ? "b" : "a";
        const sl = (val, who, c, off) => `<input type="range" min="0" max="100" step="5" value="${val}" data-act="slide" data-id="${t.id}" data-who="${who}" style="--v:${val};--c:${c}" ${off ? "disabled" : ""}>`;
        return `
        <div class="task ${shown(t) >= 100 ? "done" : ""}" data-id="${t.id}">
          <div class="task-top">
            <i class="chip" style="background:${colorOf(t)}"></i>
            <b>${esc(t.title)}</b>
            ${persoView() ? `<small class="vis">${labelOf(t)}</small>` : ""}
            ${two ? "" : `<span class="pct" data-w="${w1}">${mine(t)}%</span>`}
            <button class="del" data-act="del-task" data-id="${t.id}" aria-label="Supprimer">×</button>
          </div>
          ${two ? [["nelson", "a", t.progress], ["sophie", "b", t.progress_b || 0]].map(([id, w, v]) => `
            <div class="who"><span style="color:${prof(id)?.color}">${esc(prof(id)?.name || id)}${(me === "sophie") === (w === "b") ? " (toi)" : ""}</span><span class="pct" data-w="${w}">${v}%</span></div>${sl(v, w, prof(id)?.color, (me === "sophie") !== (w === "b"))}`).join("")
            : sl(mine(t), w1, colorOf(t))}
          <button class="btn small save-prog" data-act="save-prog" data-id="${t.id}" ${pendingProg.has(t.id) ? "" : "hidden"}>Sauvegarder</button>
        </div>`; }).join("") || `<div class="empty">Ajoute une première tâche.</div>`}
      <button class="add-btn" data-act="new-task">+ Ajouter une tâche</button>
    </div>
    ${goalsCard()}`;
}

// ----- Objectifs : vue d'ensemble (semaine / mois / année) avec échéance et % en lecture seule -----
function deadlineOf(t) {
  if (t.period === "day") return fromISO(t.key);
  if (t.period === "week") { const [y, w] = t.key.split("-W").map(Number); return addDays(addDays(mondayOf(new Date(y, 0, 4)), (w - 1) * 7), 6); }
  if (t.period === "month") { const [y, m] = t.key.split("-").map(Number); return new Date(y, m, 0); }
  return new Date(Number(t.key), 11, 31);
}
function startOfTask(t) {
  if (t.period === "day") return fromISO(t.key);
  if (t.period === "week") { const [y, w] = t.key.split("-W").map(Number); return addDays(mondayOf(new Date(y, 0, 4)), (w - 1) * 7); }
  if (t.period === "month") { const [y, m] = t.key.split("-").map(Number); return new Date(y, m - 1, 1); }
  return new Date(Number(t.key), 0, 1);
}
function goalsCard() {
  const today = fromISO(toISO(new Date())), PL = { week: "Semaine", month: "Mois", year: "Année" };
  const goals = state.tasks.filter((t) => t.period !== "day" && passes(t)).map((t) => ({ t, d: deadlineOf(t) }))
    .filter((g) => g.d >= today).sort((a, b) => a.d - b.d || a.t.title.localeCompare(b.t.title)).slice(0, 12);
  if (!goals.length) return "";
  return `<div class="card goals"><h3>Objectifs à venir</h3>
    ${goals.map(({ t, d }) => {
      const left = Math.round((d - today) / 864e5), p = shown(t);
      const when = left === 0 ? "aujourd'hui" : left === 1 ? "demain" : `dans ${left} j`;
      return `<button class="goal ${p >= 100 ? "done" : left <= 3 ? "soon" : ""}" data-act="goto-task" data-id="${t.id}">
        <i class="chip" style="background:${colorOf(t)}"></i>
        <div class="g-t"><b>${esc(t.title)}</b>
          <small>${PL[t.period]}${persoView() ? " · " + labelOf(t) : ""} · échéance ${d.getDate()} ${MOIS[d.getMonth()]} (${when})</small>
          <div class="g-bar"><span style="width:${p}%;background:${colorOf(t)}"></span></div></div>
        <span class="g-pct">${p >= 100 ? "✓" : p + "%"}</span><span class="g-go" aria-hidden="true">›</span></button>`;
    }).join("")}
    <small class="muted">Touche un objectif pour modifier son avancement.</small></div>`;
}

// ----- Rappels par notification (Web Push) -----
const PUSH_KEY = "iwi2me-push";
const pushSupported = () => cloud && CFG.vapidPublicKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64u = (s) => { const r = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
function pushCard() {
  if (!cloud) return "";
  if (!pushSupported()) return `<div class="card"><h3>Rappels</h3><p class="muted">Les notifications ne sont pas disponibles ici. Sur iPhone : ouvre le site dans Safari, « Partager » puis « Sur l'écran d'accueil », et lance l'appli depuis l'icône.</p></div>`;
  const on = Notification.permission === "granted" && localStorage.getItem(PUSH_KEY) === "1";
  return `<div class="card"><h3>Rappels 🔔</h3>
    <p class="muted">${on ? "Les rappels sont activés sur ce téléphone : tu seras prévenu avant tes événements (quand tu as choisi un rappel)." : "Reçois une notification avant tes événements. À activer sur chaque téléphone."}</p>
    <div class="btn-line">${on ? `<button class="btn small danger" data-act="push-off">Désactiver les rappels</button>` : `<button class="btn small" data-act="push-on">Activer les rappels</button>`}</div></div>`;
}
async function pushOn() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications refusées dans le navigateur"); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(CFG.vapidPublicKey) });
    const j = sub.toJSON();
    await rpc("save_sub", { p_token: token, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    localStorage.setItem(PUSH_KEY, "1");
    reg.showNotification("iwi2me", { body: "Rappels activés ✓", icon: "icons/icon-192.png" });
    render();
  } catch (e) { console.warn(e); toast("Impossible d'activer les rappels"); }
}
async function pushOff() {
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { try { await rpc("delete_sub", { p_token: token, p_endpoint: sub.endpoint }); } catch (e) {} await sub.unsubscribe(); }
  } catch (e) {}
  localStorage.removeItem(PUSH_KEY); render();
}

// ----- Astro -----
function viewAstro() {
  if (!ui.astro) ui.astro = PAIR.includes(me) ? me : "nelson";
  if (cloud) window.AstroLoad?.(CFG.url, () => { if (ui.tab === "astro") render(); });
  try {
    return window.AstroView(ui.astro, { nameOf: (id) => esc(prof(id)?.name || id), colorOf: (id) => prof(id)?.color || "#fff" });
  } catch (e) { return `<div class="empty">Astro indisponible</div>`; }
}

// ----- Changement du code de connexion (chiffres uniquement, directement depuis Réglages) -----
function pinCard() {
  const pc = ui.pc, msg = pc?.msg ? `<p class="lg-err">${esc(pc.msg)}</p>` : "";
  const inner = !pc
    ? `<p class="muted">Ton code ne contient que des chiffres (6 à 12). Tu peux le changer ici, il faut juste saisir l'ancien.</p>
       <div class="btn-line"><button class="btn small" data-act="pc-start">Changer mon code</button></div>`
    : `<div class="field"><label>Code actuel</label><input class="numonly" id="pcOld" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password"></div>
       <div class="field"><label>Nouveau code (6 à 12 chiffres)</label><input class="numonly" id="pcNew" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
       <div class="field"><label>Confirme le nouveau code</label><input class="numonly" id="pcNew2" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
       ${msg}<div class="btn-line"><button class="btn small" data-act="pc-save">Enregistrer</button><button class="btn small" data-act="pc-cancel">Annuler</button></div>`;
  return `<div class="card"><h3>Code de connexion</h3>${inner}</div>`;
}
document.addEventListener("input", (ev) => { if (ev.target.classList?.contains("numonly")) ev.target.value = ev.target.value.replace(/\D/g, ""); });

// ----- Réglages -----
function viewSettings() {
  const lock = cloud && !isAdmin; // en ligne, seul l'admin gère les profils
  const rows = state.profiles.map((p) => `
      <div class="set-row"><i class="dot-lg" style="background:${p.color}"></i>
        <input data-pname="${p.id}" value="${esc(p.name)}" maxlength="24" ${lock || (cloud && !isAdmin && p.id !== me) ? "disabled" : ""}>
        ${p.admin || p.id === "nelson" ? `<span class="tag-admin">admin</span>` : ""}
        ${!PAIR.includes(p.id) && (!cloud || isAdmin) ? `<button class="del" data-act="del-profile" data-id="${p.id}" aria-label="Supprimer">×</button>` : ""}
      </div>`).join("");
  const linkCard = cloud
    ? (isAdmin ? `<div class="card"><h3>Connexion</h3>
        <p class="muted">Chacun se connecte avec son e-mail et un code numérique. Pour Sophie : envoie-lui l'adresse de l'appli ; elle saisit son e-mail et son code (indice affiché : « devine »). Son e-mail est enregistré à sa première connexion. Après 5 erreurs, la connexion est bloquée 15 minutes.</p>
        <div class="btn-line"><button class="btn small" data-act="copy-app">Copier l'adresse de l'appli</button></div></div>`
      : `<div class="card"><h3>Ton espace</h3><p class="muted">Tu es connectée avec ton e-mail et ton code. Ne les partage pas : ils donnent accès à ton calendrier.</p></div>`)
    : `<div class="card"><h3>Mode sur ce téléphone</h3><p class="muted">Données enregistrées sur cet appareil uniquement.</p></div>`;
  return `
    <div class="head"><div><h1>Réglages</h1><div class="sub">Personnalise ton espace</div></div></div>
    <div class="card">
      <h3>Profils</h3>
      ${rows}
      ${!lock ? `<button class="add-btn" data-act="new-profile">+ Ajouter un profil</button>` : ""}
      <p class="muted">Nelson et Sophie ont chacun leur calendrier et partagent le calendrier « Commun ». Les autres profils sont de simples noms avec leur propre calendrier privé.</p>
    </div>
    ${linkCard}
    ${cloud ? pinCard() : ""}
    <div class="card">
      <h3>Google Agenda</h3>
      <p class="muted">${!gReady()
        ? "Cette fonction sera activée dès que la connexion Google aura été configurée."
        : gcal.on
          ? "Connecté. Tes événements Google s'affichent directement dans le calendrier (lecture seule)."
          : "Connecte ton Google Agenda : tes événements apparaissent directement dans le calendrier (lecture seule)."}</p>
      ${gReady() ? `<div class="btn-line">${gcal.on
        ? `<button class="btn small danger" data-act="gcal-disconnect">Déconnecter Google Agenda</button>`
        : `<button class="btn small" data-act="gcal-connect">Connecter mon Google Agenda</button>`}</div>` : ""}
    </div>
    ${pushCard()}
    <div class="card">
      <h3>Sauvegarde</h3>
      <p class="muted">${cloud ? "Tes données sont enregistrées en ligne. Tu peux aussi en garder une copie." : "Les données restent sur ce téléphone. Exporte-les pour les garder en sécurité ou les transférer."}</p>
      <div class="btn-line">
        <button class="btn small" data-act="export">Exporter</button>
        <button class="btn small" data-act="import">Importer</button>
      </div>
      <div class="btn-line">${cloud ? `<button class="btn small danger" data-act="logout">Se déconnecter de ce téléphone</button>` : `<button class="btn small danger" data-act="reset">Tout effacer</button>`}</div>
      <input type="file" id="importFile" accept="application/json" hidden>
    </div>
    <div class="card">
      <h3>Connexions sport</h3>
      <p class="muted">Hevy et Strava seront branchés dans une prochaine étape. Rappel : Strava n'autorise l'affichage que de tes propres activités.</p>
    </div>`;
}

// ---------------------------------------------------------------
// 5. FEUILLE DE SAISIE (ajout événement / tâche)
// ---------------------------------------------------------------
const sheet = $("#sheet"), sheetForm = $("#sheetForm");
// Champ « Pour » : Nelson et Sophie peuvent remplir à la place de l'autre, ou pour le commun.
// Les autres profils n'ont pas le choix : tout va dans leur propre calendrier.
// Tâche : privé (juste moi) ou public (Nelson + Sophie = commun)
const visField = () => isPair(me)
  ? `<div class="field"><label>Visibilité</label><select id="fVis">
      <option value="perso" ${ui.filter === "commun" ? "" : "selected"}>Privé (juste moi)</option>
      <option value="commun" ${ui.filter === "commun" ? "selected" : ""}>Public (${esc(prof("nelson").name)} + ${esc(prof("sophie").name)})</option>
    </select></div>`
  : "";
const scopeField = (forId) => isPair(me)
  ? `<div class="field"><label>Visibilité</label><select id="fScope">
      <option value="commun" ${!forId ? "selected" : ""}>Public (${esc(prof("nelson").name)} + ${esc(prof("sophie").name)})</option>
      <option value="nelson" ${forId === "nelson" ? "selected" : ""}>Privé · ${esc(prof("nelson").name)}</option>
      <option value="sophie" ${forId === "sophie" ? "selected" : ""}>Privé · ${esc(prof("sophie").name)}</option>
    </select></div>`
  : "";
// Modification : passer un événement de Public à Privé (toi) ou inversement
const visEditField = (e) => (isPair(me) && (e.scope === "commun" || e.owner === me))
  ? `<div class="field"><label>Visibilité</label><select id="fScope">
      <option value="commun" ${e.scope === "commun" ? "selected" : ""}>Public (${esc(prof("nelson").name)} + ${esc(prof("sophie").name)})</option>
      <option value="${me}" ${e.scope !== "commun" ? "selected" : ""}>Privé (juste moi)</option>
    </select></div>`
  : "";
// Renvoie { owner, scope } selon le choix du champ « Pour »
function readFor() {
  const v = $("#fScope") ? $("#fScope").value : me;
  return v === "commun" ? { owner: me, scope: "commun" } : { owner: v, scope: "perso" };
}
function notifyFor(f) {
  if (f.scope === "perso" && f.owner !== me) toast(`Ajouté au calendrier de ${(prof(f.owner) || {}).name || "l'autre"}`);
}

// Message d'erreur visible DANS la fenêtre (le toast passe derrière un <dialog>)
function sheetErr(msg) {
  let e = $("#sheetErr");
  if (!e) { e = document.createElement("div"); e.id = "sheetErr"; e.className = "sheet-err"; const a = sheetForm.querySelector(".actions"); a.parentNode.insertBefore(e, a); }
  e.textContent = msg;
}

function openEventSheet(forId, edit) {
  const p = edit ? parseTime(edit.time) : null, m = edit ? metaOf(edit) : {};
  const v = { title: edit ? edit.title : "", date: edit ? edit.date : ui.selected, end: p && p.endDate ? p.endDate : "",
    t1: p && p.s !== null ? hhmm(p.s) : "", t2: p && p.e !== null ? hhmm(p.e) : "" };
  const opt = (val, label, cur) => `<option value="${val}" ${String(cur ?? "") === String(val) ? "selected" : ""}>${label}</option>`;
  sheetForm.dataset.edit = edit ? edit.id : "";
  sheetForm.innerHTML = `<div class="sheet">
    <h2>${edit ? "Modifier l'événement" : "Nouvel événement"}</h2>
    <div class="field"><label>Titre</label><input type="text" id="fTitle" value="${esc(v.title)}" placeholder="Dîner chez les parents" autocomplete="off"></div>
    <div class="two">
      <div class="field"><label>Date</label><input type="date" id="fDate" value="${v.date}"></div>
      <div class="field"><label>Jusqu'au (facultatif)</label><input type="date" id="fEnd" value="${v.end}" min="${v.date}"></div>
    </div>
    <div class="two">
      <div class="field"><label>De</label><input type="time" id="fTime" value="${v.t1}"></div>
      <div class="field"><label>À (facultatif)</label><input type="time" id="fTimeEnd" value="${v.t2}"></div>
    </div>
    <div class="span-hint" id="spanHint"></div>
    ${edit ? visEditField(edit) : scopeField(forId)}
    <div class="two">
      <div class="field"><label>Répéter</label><select id="fRep">${opt("", "Jamais", m.rep)}${Object.keys(REP_LABEL).map((k) => opt(k, REP_LABEL[k], m.rep)).join("")}</select></div>
      <div class="field"><label>Rappel 🔔</label><select id="fRem">${opt("", "Aucun", m.rem)}${opt(0, "À l'heure", m.rem)}${opt(10, "10 min avant", m.rem)}${opt(60, "1 h avant", m.rem)}${opt(1440, "1 jour avant", m.rem)}</select></div>
    </div>
    <label class="check"><input type="checkbox" id="fCd" ${m.cd ? "checked" : ""}><span>Afficher en compte à rebours sur l'accueil</span></label>
    <div class="actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="button" class="btn primary" data-act="save-event">${edit ? "Enregistrer" : "Ajouter"}</button></div>
  </div>`;
  sheet.showModal();
  const upd = () => {
    const date = $("#fDate").value || ui.selected;
    $("#fEnd").min = date;
    const r = computeSpan(date, $("#fEnd").value, $("#fTime").value, $("#fTimeEnd").value), h = $("#spanHint");
    const er = $("#sheetErr"); if (er) er.remove();
    if (r.err || !r.endDate) h.textContent = "";
    else { const n = daysBetween(date, r.endDate); h.textContent = n === 1 && !$("#fEnd").value ? `La fin compte pour le lendemain (${dm(r.endDate)}).` : `Sur ${n + 1} jours : du ${dm(date)} au ${dm(r.endDate)}.`; }
  };
  ["fDate", "fEnd", "fTime", "fTimeEnd"].forEach((i) => $("#" + i).addEventListener("input", upd));
  $("#fRem").addEventListener("change", () => { if ($("#fRem").value !== "" && cloud && !(Notification?.permission === "granted" && localStorage.getItem(PUSH_KEY) === "1")) toast("Active les rappels dans Réglages pour être notifié"); });
  upd();
  if (!edit) setTimeout(() => $("#fTitle").focus(), 50);
}

function openTaskSheet() {
  const labels = { day: "Jour", week: "Semaine", month: "Mois", year: "Année" };
  sheetForm.innerHTML = `<div class="sheet">
    <h2>Nouvelle tâche</h2>
    <div class="field"><label>Titre</label><input type="text" id="fTitle" placeholder="Réviser le code de la route" autocomplete="off"></div>
    <div class="two">
      <div class="field"><label>Période</label><select id="fPeriod">${Object.keys(labels).map((p) => `<option value="${p}" ${p === ui.period ? "selected" : ""}>${labels[p]}</option>`).join("")}</select></div>
    </div>
    ${visField()}
    <div class="actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="button" class="btn primary" data-act="save-task">Ajouter</button></div>
  </div>`;
  sheet.showModal();
  setTimeout(() => $("#fTitle").focus(), 50);
}

// ---------------------------------------------------------------
// 6. ACTIONS (un seul écouteur de clics pour toute l'appli)
// ---------------------------------------------------------------
document.addEventListener("keydown", (ev) => {
  if (!needLogin) return;
  if (ev.key === "Enter") { document.querySelector("[data-act=login]")?.click(); return; }
  if (ev.target.matches?.("input")) return; // on tape l'e-mail normalement ; le clavier physique sert au code sinon
  if (/^\d$/.test(ev.key)) pinKey(ev.key); else if (ev.key === "Backspace") pinKey("del");
});
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act], .tab");
  if (!el) return;
  if (el.classList.contains("tab")) { ui.tab = el.dataset.tab; render(true); window.scrollTo(0, 0); return; }

  const act = el.dataset.act;
  switch (act) {
    case "pick": ui.selected = el.dataset.date; render(); break;
    case "month": ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + Number(el.dataset.dir), 1); render(); break;
    case "today": ui.selected = toISO(new Date()); ui.month = startOfMonth(new Date()); render(); break;
    case "shift": { const d = shift(ui.period, fromISO(ui.selected), Number(el.dataset.dir)); ui.selected = toISO(d); ui.month = startOfMonth(d); render(); break; }
    case "astro-sub": ui.astro = el.dataset.s; render(); break;
    case "period": ui.period = el.dataset.p; render(); break;
    case "new-event": openEventSheet(); break;
    case "new-task": openTaskSheet(); break;
    case "close": sheet.close(); break;
    case "edit-event": { const o = state.events.find((x) => x.id === el.dataset.id); if (o) openEventSheet(null, o); break; }
    case "save-event": {
      const title = $("#fTitle").value.trim();
      if (!title) { $("#fTitle").focus(); return; }
      const date = $("#fDate").value || ui.selected;
      const t1 = $("#fTime").value, t2 = $("#fTimeEnd").value;
      const span = computeSpan(date, $("#fEnd").value, t1, t2);
      if (span.err) { sheetErr(span.err); return; }
      const time = (t1 ? (t2 ? `${t1}-${t2}` : t1) : "") + (span.endDate ? `>${span.endDate}` : "");
      const mo = {}; if ($("#fRep").value) mo.rep = $("#fRep").value; if ($("#fRem").value !== "") mo.rem = Number($("#fRem").value); if ($("#fCd").checked) mo.cd = 1;
      const meta = Object.keys(mo).length ? JSON.stringify(mo) : "";
      const editId = sheetForm.dataset.edit;
      if (editId) {
        const o = state.events.find((x) => x.id === editId);
        if (o) {
          Object.assign(o, { title, date, time, meta });
          if ($("#fScope")) { const f = readFor(); if (!(f.scope === "commun" && o.scope === "commun")) Object.assign(o, f); }
          push("upsert_event", evArgs(o));
        }
        save(); sheet.close(); ui.selected = date; ui.month = startOfMonth(fromISO(date)); render(); toast("Événement modifié"); break;
      }
      const f = readFor();
      const ev = { id: uid(), title, date, time, meta, ...f };
      state.events.push(ev); push("upsert_event", evArgs(ev));
      save(); sheet.close(); ui.selected = date; ui.month = startOfMonth(fromISO(date)); render(); notifyFor(f); adventBurst(date); break;
    }
    case "save-task": {
      const title = $("#fTitle").value.trim();
      if (!title) { $("#fTitle").focus(); return; }
      const period = $("#fPeriod").value;
      const f = $("#fVis") && $("#fVis").value === "commun" ? { owner: me, scope: "commun" } : { owner: me, scope: "perso" };
      const tk = { id: uid(), title, period, key: periodKey(period, fromISO(ui.selected)), ...f, progress: 0, progress_b: 0 };
      state.tasks.push(tk); push("upsert_task", tkArgs(tk));
      save(); sheet.close(); ui.period = period; render(); notifyFor(f); break;
    }
    case "del-event": state.events = state.events.filter((e) => e.id !== el.dataset.id); push("delete_event", { p_id: el.dataset.id }); save(); render(); break;
    case "del-task": state.tasks = state.tasks.filter((t) => t.id !== el.dataset.id); push("delete_task", { p_id: el.dataset.id }); save(); render(); break;
    case "save-prog": {
      const t = state.tasks.find((x) => x.id === el.dataset.id);
      if (t) { pendingProg.delete(t.id); save(); push("set_progress", { p_id: t.id, p_value: mine(t) }); el.hidden = true; toast("Avancement sauvegardé"); }
      break;
    }
    case "push-on": pushOn(); break;
    case "push-off": pushOff(); break;
    case "gcal-connect": connectGoogle(false); break;
    case "gcal-connect-silent": connectGoogle(true); break;
    case "gcal-disconnect": disconnectGoogle(); break;
    case "gcal-share": {
      const on = !gShared;
      if (on && !gcal.on) { toast("Connecte d'abord ton Google Agenda"); break; }
      gShared = on; gcal.events.forEach((e) => { e.scope = gScope(); }); if (on) gcal.cache = {};
      rpc("set_gcal_shared", { p_token: token, p_shared: on }).then(() => { if (on && gcal.token) ensureGcal(); }).catch(() => toast("Action impossible pour le moment"));
      render(); toast(on ? "Agenda partagé" : "Partage arrêté");
      break;
    }
    case "profile": setMe(el.dataset.id); break;
    case "filter": ui.filter = el.dataset.f; render(); break;
    case "goto-task": {
      const t = state.tasks.find((x) => x.id === el.dataset.id); if (!t) break;
      const d = startOfTask(t); ui.period = t.period; ui.selected = toISO(d); ui.month = startOfMonth(d); render();
      setTimeout(() => { const n = document.querySelector(`.task[data-id="${t.id}"]`); if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); n.classList.add("flash"); setTimeout(() => n.classList.remove("flash"), 1800); } }, 80);
      break;
    }
    case "new-profile": {
      const name = (prompt("Nom du nouveau profil ?") || "").trim().slice(0, 24);
      if (!name) break;
      const color = EXTRA_COLORS[(state.profiles.length - 2) % EXTRA_COLORS.length];
      const id = "p" + uid();
      if (cloud) {
        rpc("create_profile", { p_token: token, p_id: id, p_name: name, p_color: color })
          .then(() => { state.profiles.push({ id, name, color }); render(); toast(`Profil ${name} créé : copie son lien`); })
          .catch(() => toast("Impossible de créer le profil"));
      } else { state.profiles.push({ id, name, color }); save(); setMe(id); }
      break;
    }
    case "del-profile": {
      const p = prof(el.dataset.id);
      if (p && confirm(`Supprimer le profil « ${p.name} » et ses événements ?`)) {
        state.profiles = state.profiles.filter((x) => x.id !== p.id);
        state.events = state.events.filter((x) => x.owner !== p.id || x.scope === "commun");
        state.tasks = state.tasks.filter((x) => x.owner !== p.id || x.scope === "commun");
        if (!cloud && me === p.id) me = "nelson";
        push("delete_profile", { p_id: p.id });
        save(); render();
      }
      break;
    }
    case "copy-app": {
      const link = location.origin + location.pathname;
      try { navigator.clipboard.writeText(link).then(() => toast("Adresse copiée")); } catch (e) { prompt("Copie cette adresse :", link); }
      break;
    }
    case "pin-key": pinKey(el.dataset.k); break;
    case "pc-start": ui.pc = {}; render(); break;
    case "pc-cancel": ui.pc = null; render(); break;
    case "pc-save": {
      const o = $("#pcOld").value, a = $("#pcNew").value, b = $("#pcNew2").value;
      if (!/^\d{4,12}$/.test(o)) { ui.pc.msg = "Saisis ton code actuel (chiffres uniquement)."; render(); break; }
      if (!/^\d{6,12}$/.test(a)) { ui.pc.msg = "Le nouveau code doit contenir uniquement des chiffres (6 à 12)."; render(); break; }
      if (a !== b) { ui.pc.msg = "Les deux nouveaux codes ne sont pas identiques."; render(); break; }
      el.disabled = true;
      rpc("change_pin", { p_token: token, p_old: o, p_new: a }).then((r) => {
        if (r?.token) { try { localStorage.setItem(TOKEN_KEY, r.token); } catch (e) {} ui.pc = null; alert("Code modifié. Tes autres appareils devront se reconnecter avec le nouveau code."); location.reload(); }
        else { ui.pc = { msg: r?.error || "Impossible de changer le code." }; render(); }
      }).catch(() => { ui.pc = { msg: "Connexion impossible." }; render(); });
      break;
    }
    case "login": {
      const em = $("#lgMail").value.trim(), pin = pinCode, err = $("#lgErr");
      err.textContent = "";
      if (!em || !pin) { err.textContent = "Saisis ton e-mail et ton code."; break; }
      el.disabled = true;
      rpc("login", { p_email: em, p_pin: pin }).then((r) => {
        if (r?.token) { try { localStorage.setItem(TOKEN_KEY, r.token); } catch (e) {} location.reload(); }
        else { err.textContent = r?.error || "Connexion impossible."; el.disabled = false; }
      }).catch(() => { err.textContent = "Connexion impossible, vérifie ta connexion internet."; el.disabled = false; });
      break;
    }
    case "logout":
      if (confirm("Se déconnecter de cet appareil ? Tu pourras te reconnecter avec ton e-mail et ton code.")) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CACHE_KEY); location.reload(); }
      break;
    case "zoom": $("#photo").showModal(); break;
    case "export": exportData(); break;
    case "import": $("#importFile").click(); break;
    case "reset":
      if (confirm("Effacer toutes les données de ce téléphone ?")) { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY); localStorage.removeItem(SESSION); location.reload(); }
      break;
  }
});

// Curseur de progression : on met à jour en direct SANS re-render (sinon le glissement se coupe)
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.act === "slide") {
    const t = state.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    const val = Number(el.value), w = el.dataset.who === "b" ? "b" : "a";
    if (w === "b") t.progress_b = val; else t.progress = val;
    el.style.setProperty("--v", val);
    const card = el.closest(".task");
    const pc = card.querySelector(`.pct[data-w="${w}"]`); if (pc) pc.textContent = val + "%";
    card.classList.toggle("done", shown(t) >= 100);
    pendingProg.set(t.id, true); card.querySelector(".save-prog").hidden = false;
    // Recalcule le cercle global
    const key = periodKey(ui.period, fromISO(ui.selected));
    const list = state.tasks.filter((x) => x.period === ui.period && x.key === key && passes(x));
    const avg = Math.round(list.reduce((s, x) => s + shown(x), 0) / list.length);
    $("#ring").style.setProperty("--p", avg);
    $("#ringTxt").textContent = avg + "%";
  }
  if (el.dataset.pname) { const p = prof(el.dataset.pname); if (p) p.name = el.value.trim() || p.name; }
});
document.addEventListener("change", (ev) => {
  if (ev.target.dataset.pname) { save(); push("rename_profile", { p_id: ev.target.dataset.pname, p_name: prof(ev.target.dataset.pname).name }); }
  if (ev.target.id === "importFile") importData(ev.target.files[0]);
});

// Ferme la feuille en touchant le fond
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

// Bascule de profil (clic sur un personnage ou une pastille)
const toastEl = document.createElement("div");
toastEl.className = "toast"; toastEl.setAttribute("role", "status");
document.body.appendChild(toastEl);
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}
function setMe(id) {
  if (!prof(id)) return;
  if (cloud) { // en ligne, on ne change pas de profil : toucher l'autre personnage = lui ajouter un événement
    if (id === me) toast(`Calendrier de ${prof(id).name}`);
    else if (isPair(me) && isPair(id)) openEventSheet(id);
    return;
  }
  me = id; ui.filter = "perso";
  try { localStorage.setItem(SESSION, me); } catch (e) {}
  render();
  toast(`Calendrier de ${prof(id).name}`);
}

// ---------------------------------------------------------------
// 7. EXPORT / IMPORT
// ---------------------------------------------------------------
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `iwi2me-${toISO(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!Array.isArray(data.events) || !Array.isArray(data.tasks)) throw new Error("format");
      const ok = Array.isArray(data.profiles) ? data : migrate(data); // ancien export v1 accepté
      localStorage.setItem(KEY, JSON.stringify(Object.assign({}, defaultState, ok)));
      location.reload();
    } catch (e) { alert("Fichier invalide."); }
  };
  r.readAsText(file);
}

// ---------------------------------------------------------------
// 8. BANDEAU PHOTO ANIMÉ
// ---------------------------------------------------------------
(function setupHero() {
  // Cliquer sur Nelson ou Sophie = ouvrir leur calendrier (zones posées sur l'illustration)
  document.querySelectorAll(".spot").forEach((s) => s.addEventListener("click", () => {
    setMe(s.dataset.id);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!cloud || s.dataset.id === me) $("#view").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }));
  // Fermer l'affiche en grand en la touchant
  $("#photo").addEventListener("click", () => $("#photo").close());
})();

// ---------------------------------------------------------------
// 9. DÉMARRAGE
// ---------------------------------------------------------------
render();

// Charge les données du profil, puis rafraîchit régulièrement (pour voir ce que l'autre ajoute)
let lastSnap = "";
async function pull() {
  try {
    const d = await rpc("get_data", { p_token: token });
    const snap = JSON.stringify(d);
    me = d.me.id; isAdmin = !!d.me.admin; gShared = !!d.me.gcal_shared;
    const first = !loaded;
    if (snap !== lastSnap) {
      lastSnap = snap;
      const typing = sheet.open || document.activeElement?.matches?.("input, select"); // ne pas casser une saisie en cours
      const loc = new Map(state.tasks.filter((t) => pendingProg.has(t.id)).map((t) => [t.id, t]));
      state.profiles = d.profiles; state.events = d.events; state.gcalShared = d.gcal || [];
      // un % pas encore sauvegardé garde SA valeur locale (ma part), le reste vient de la base
      state.tasks = d.tasks.map((t) => { const l = loc.get(t.id); return l ? Object.assign({}, t, { [myField(t)]: l[myField(t)] }) : t; });
      fixColors(state.profiles);
      try { localStorage.setItem(CACHE_KEY, snap); } catch (e) {}
      loaded = true;
      if (first || !typing) render();
    }
    if (first) maybeImportLocal(d);
  } catch (e) {
    if (String(e.message).includes("lien invalide")) { // lien révoqué ou invalide
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CACHE_KEY);
      alert("Session expirée : reconnecte-toi avec ton e-mail et ton code."); location.reload(); return;
    }
    if (!loaded) { // hors connexion : dernière version connue
      try { const d = JSON.parse(localStorage.getItem(CACHE_KEY)); if (d) { me = d.me.id; isAdmin = !!d.me.admin; gShared = !!d.me.gcal_shared; state.gcalShared = d.gcal || []; state.profiles = d.profiles; state.events = d.events; state.tasks = d.tasks; loaded = true; render(); toast("Hors connexion : dernière version affichée"); } } catch (x) {}
    }
  }
}
function startCloud() {
  pull();
  setInterval(() => { if (!document.hidden) pull(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
}

// Première connexion de Nelson : propose d'envoyer en ligne ce qui était déjà sur le téléphone
function maybeImportLocal(d) {
  if (d.me.id !== "nelson") return;
  try {
    if (localStorage.getItem("iwi2me-import-asked")) return;
    const raw = localStorage.getItem(KEY); if (!raw) return;
    const old = JSON.parse(raw);
    if (!old.events?.length && !old.tasks?.length) return;
    localStorage.setItem("iwi2me-import-asked", "1");
    if (!confirm(`Envoyer en ligne les ${old.events.length} événements et ${old.tasks.length} tâches de ce téléphone ?`)) return;
    old.events.forEach((e) => { state.events.push(e); push("upsert_event", evArgs(e)); });
    old.tasks.forEach((t) => { state.tasks.push(t); push("upsert_task", tkArgs(t)); });
    localStorage.removeItem(KEY); render(); toast("Données envoyées en ligne");
  } catch (e) {}
}

if (cloud) startCloud();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
