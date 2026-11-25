/* iwi2me — calendrier + tâches pour un couple.
   Étape 1 : les données sont stockées dans le téléphone (localStorage).
   Étape suivante : on remplacera load()/save() par Supabase pour partager à deux. */

"use strict";

// ---------------------------------------------------------------
// 1. DONNÉES
// ---------------------------------------------------------------
const KEY = "iwi2me-v2", LEGACY = "iwi2me-v1", SESSION = "iwi2me-session";
const COMMUN_COLOR = "#E8478C";
const EXTRA_COLORS = ["#1FB5A8", "#3D8BFF", "#F2B705", "#7BC043", "#C05CF0", "#FF5C5C"];
const PAIR = ["nelson", "sophie"]; // seuls ces deux profils partagent le calendrier commun

const defaultState = {
  profiles: [
    { id: "nelson", name: "Nelson", admin: true, color: "#8B45D9" },
    { id: "sophie", name: "Sophie", color: "#FF8A3D" }
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
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

const state = load();
const uid = () => Math.random().toString(36).slice(2, 10);

// Profil actif sur cet appareil (par défaut Nelson, l'admin)
let me = (() => { try { return localStorage.getItem(SESSION); } catch (e) { return null; } })();
if (!state.profiles.some((p) => p.id === me)) me = "nelson";
const prof = (id) => state.profiles.find((p) => p.id === id);
const isPair = (id) => PAIR.includes(id);

// Règles de visibilité : le commun n'est vu que par Nelson et Sophie ; le reste que par son propriétaire
const canSee = (it) => it.scope === "commun" ? isPair(me) : it.owner === me;
const passes = (it) => canSee(it) && (ui.filter === "all" || (ui.filter === "commun") === (it.scope === "commun"));
const colorOf = (it) => it.scope === "commun" ? COMMUN_COLOR : (prof(it.owner)?.color || "#8B45D9");
const labelOf = (it) => it.scope === "commun" ? "Commun" : (prof(it.owner)?.name || "?");

// État de l'interface (non sauvegardé)
const ui = {
  tab: "cal",
  selected: toISO(new Date()),
  month: startOfMonth(new Date()),
  period: "day",
  filter: "all" // all | perso | commun
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
function render(animate = false) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === ui.tab));
  renderHero();
  if (ui.tab === "cal") view.innerHTML = viewCalendar();
  else if (ui.tab === "tasks") view.innerHTML = viewTasks();
  else view.innerHTML = viewSettings();
  view.classList.toggle("enter", animate);        // cascade d'apparition seulement au changement d'onglet
  hero.classList.toggle("off", ui.tab !== "cal"); // le bandeau photo n'apparaît que sur le calendrier
}


// ----- Barre profils + filtre perso/commun -----
function profileBar() {
  const chips = state.profiles.map((p) => `<button class="pchip ${p.id === me ? "on" : ""}" style="--c:${p.color}" data-act="profile" data-id="${p.id}"><i></i>${esc(p.name)}</button>`).join("");
  return `<div class="pbar">${chips}<button class="pchip add" data-act="new-profile" aria-label="Ajouter un profil">+</button></div>`;
}
function filterBar() {
  if (!isPair(me)) return "";
  const f = [["all", "Tout"], ["perso", "Perso"], ["commun", "Commun"]];
  return `<div class="seg three">${f.map(([k, l]) => `<button class="${k === ui.filter ? "on" : ""}" data-act="filter" data-f="${k}">${l}</button>`).join("")}</div>`;
}
function renderHero() {
  document.querySelectorAll(".spot").forEach((s) => s.classList.toggle("active", s.dataset.id === me));
}

// ----- Calendrier -----
function viewCalendar() {
  const m = ui.month, today = toISO(new Date());
  const first = mondayOf(m); // on commence à la semaine qui contient le 1er du mois
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(first, i), iso = toISO(d);
    if (i >= 35 && d.getMonth() !== m.getMonth()) break; // pas de 6e ligne inutile
    // Pastilles de couleur : qui a quelque chose ce jour-là ?
    const cols = new Set([
      ...state.events.filter((e) => e.date === iso && passes(e)).map(colorOf),
      ...state.tasks.filter((t) => t.period === "day" && t.key === iso && passes(t)).map(colorOf)
    ]);
    const dots = [...cols].slice(0, 3).map((c) => `<i class="dot" style="background:${c}"></i>`).join("");
    const cls = ["day", d.getMonth() !== m.getMonth() ? "out" : "", iso === today ? "today" : "", iso === ui.selected ? "sel" : ""].join(" ");
    cells += `<button class="${cls}" data-act="pick" data-date="${iso}">${d.getDate()}<span class="dots">${dots}</span></button>`;
  }

  const sel = fromISO(ui.selected);
  const evs = state.events.filter((e) => e.date === ui.selected && passes(e)).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const tks = state.tasks.filter((t) => t.period === "day" && t.key === ui.selected && passes(t));

  return `
    <div class="head">
      <div><h1>${MOIS_LONG[m.getMonth()]} ${m.getFullYear()}</h1><div class="sub">Calendrier de ${esc(prof(me).name)}</div></div>
      <div class="nav">
        <button class="icon-btn" data-act="month" data-dir="-1">‹</button>
        <button class="icon-btn" data-act="today">•</button>
        <button class="icon-btn" data-act="month" data-dir="1">›</button>
      </div>
    </div>
    ${profileBar()}${filterBar()}
    <div class="card">
      <div class="dow"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="grid">${cells}</div>
    </div>

    <div class="card">
      <h3>${JOURS_LONG[sel.getDay()]} ${sel.getDate()} ${MOIS_LONG[sel.getMonth()]}</h3>
      ${evs.length ? evs.map((e) => `
        <div class="row">
          <div class="bar-owner" style="background:${colorOf(e)}"></div>
          <div class="t"><b>${esc(e.title)}</b><small>${esc(labelOf(e))}</small></div>
          <div class="time">${e.time || ""}</div>
          <button class="del" data-act="del-event" data-id="${e.id}" aria-label="Supprimer">×</button>
        </div>`).join("") : `<div class="empty">Rien de prévu ce jour-là.</div>`}
      <button class="add-btn" data-act="new-event">+ Ajouter un événement</button>
    </div>

    ${tks.length ? `<div class="card"><h3>Tâches du jour</h3>${tks.map((t) => `
      <div class="row">
        <div class="bar-owner" style="background:${colorOf(t)}"></div>
        <div class="t"><b>${esc(t.title)}</b><small>${esc(labelOf(t))}</small></div>
        <div class="time">${t.progress}%</div>
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
  const avg = list.length ? Math.round(list.reduce((s, t) => s + t.progress, 0) / list.length) : 0;
  const labels = { day: "Jour", week: "Semaine", month: "Mois", year: "Année" };

  return `
    <div class="head">
      <div><h1>Tâches</h1><div class="sub">${periodLabel(ui.period, ref)}</div></div>
      <div class="nav">
        <button class="icon-btn" data-act="shift" data-dir="-1">‹</button>
        <button class="icon-btn" data-act="shift" data-dir="1">›</button>
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
      ${list.map((t) => `
        <div class="task ${t.progress >= 100 ? "done" : ""}" data-id="${t.id}">
          <div class="task-top">
            <i class="chip" style="background:${colorOf(t)}"></i>
            <b>${esc(t.title)}</b>
            <span class="pct">${t.progress}%</span>
            <button class="del" data-act="del-task" data-id="${t.id}" aria-label="Supprimer">×</button>
          </div>
          <input type="range" min="0" max="100" step="5" value="${t.progress}" data-act="slide" data-id="${t.id}"
                 style="--v:${t.progress};--c:${colorOf(t)}">
        </div>`).join("") || `<div class="empty">Ajoute une première tâche.</div>`}
      <button class="add-btn" data-act="new-task">+ Ajouter une tâche</button>
    </div>`;
}

// ----- Réglages -----
function viewSettings() {
  const rows = state.profiles.map((p) => `
      <div class="set-row"><i class="dot-lg" style="background:${p.color}"></i>
        <input data-pname="${p.id}" value="${esc(p.name)}" maxlength="24">
        ${p.id === "nelson" ? `<span class="tag-admin">admin</span>` : p.id === "sophie" ? "" : `<button class="del" data-act="del-profile" data-id="${p.id}" aria-label="Supprimer">×</button>`}
      </div>`).join("");
  return `
    <div class="head"><div><h1>Réglages</h1><div class="sub">Personnalise ton espace</div></div></div>
    <div class="card">
      <h3>Profils</h3>
      ${rows}
      <button class="add-btn" data-act="new-profile">+ Ajouter un profil</button>
      <p class="muted">Nelson et Sophie ont chacun leur calendrier et partagent le calendrier « Commun ». Les autres profils sont de simples noms avec leur propre calendrier privé.</p>
    </div>
    <div class="card">
      <h3>Liens personnels</h3>
      <p class="muted">Bientôt : un lien unique pour Nelson (le tien) et un pour Sophie à lui envoyer. Elle seule aura le profil Sophie. Cela demande une petite base en ligne, étape suivante.</p>
    </div>
    <div class="card">
      <h3>Sauvegarde</h3>
      <p class="muted">Pour l'instant, les données restent sur ce téléphone. Exporte-les pour les garder en sécurité ou les transférer.</p>
      <div class="btn-line">
        <button class="btn small" data-act="export">Exporter</button>
        <button class="btn small" data-act="import">Importer</button>
      </div>
      <div class="btn-line"><button class="btn small danger" data-act="reset">Tout effacer</button></div>
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
const scopeField = () => isPair(me)
  ? `<div class="field"><label>Pour</label><select id="fScope">
      <option value="nelson" ${me === "nelson" && ui.filter !== "commun" ? "selected" : ""}>${esc(prof("nelson").name)}</option>
      <option value="sophie" ${me === "sophie" && ui.filter !== "commun" ? "selected" : ""}>${esc(prof("sophie").name)}</option>
      <option value="commun" ${ui.filter === "commun" ? "selected" : ""}>Commun (${esc(prof("nelson").name)} + ${esc(prof("sophie").name)})</option>
    </select></div>`
  : "";
// Renvoie { owner, scope } selon le choix du champ « Pour »
function readFor() {
  const v = $("#fScope") ? $("#fScope").value : me;
  return v === "commun" ? { owner: me, scope: "commun" } : { owner: v, scope: "perso" };
}
function notifyFor(f) {
  if (f.scope === "perso" && f.owner !== me) toast(`Ajouté au calendrier de ${prof(f.owner).name}`);
}

function openEventSheet() {
  sheetForm.innerHTML = `<div class="sheet">
    <h2>Nouvel événement</h2>
    <div class="field"><label>Titre</label><input type="text" id="fTitle" placeholder="Dîner chez les parents" autocomplete="off"></div>
    <div class="two">
      <div class="field"><label>Date</label><input type="date" id="fDate" value="${ui.selected}"></div>
      <div class="field"><label>Heure</label><input type="time" id="fTime"></div>
    </div>
    ${scopeField()}
    <div class="actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="button" class="btn primary" data-act="save-event">Ajouter</button></div>
  </div>`;
  sheet.showModal();
  setTimeout(() => $("#fTitle").focus(), 50);
}

function openTaskSheet() {
  const labels = { day: "Jour", week: "Semaine", month: "Mois", year: "Année" };
  sheetForm.innerHTML = `<div class="sheet">
    <h2>Nouvelle tâche</h2>
    <div class="field"><label>Titre</label><input type="text" id="fTitle" placeholder="Réviser le code de la route" autocomplete="off"></div>
    <div class="two">
      <div class="field"><label>Période</label><select id="fPeriod">${Object.keys(labels).map((p) => `<option value="${p}" ${p === ui.period ? "selected" : ""}>${labels[p]}</option>`).join("")}</select></div>
    </div>
    ${scopeField()}
    <div class="actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="button" class="btn primary" data-act="save-task">Ajouter</button></div>
  </div>`;
  sheet.showModal();
  setTimeout(() => $("#fTitle").focus(), 50);
}

// ---------------------------------------------------------------
// 6. ACTIONS (un seul écouteur de clics pour toute l'appli)
// ---------------------------------------------------------------
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
    case "period": ui.period = el.dataset.p; render(); break;
    case "new-event": openEventSheet(); break;
    case "new-task": openTaskSheet(); break;
    case "close": sheet.close(); break;
    case "save-event": {
      const title = $("#fTitle").value.trim();
      if (!title) { $("#fTitle").focus(); return; }
      const date = $("#fDate").value || ui.selected;
      const f = readFor();
      state.events.push({ id: uid(), title, date, time: $("#fTime").value, ...f });
      save(); sheet.close(); ui.selected = date; ui.month = startOfMonth(fromISO(date)); render(); notifyFor(f); break;
    }
    case "save-task": {
      const title = $("#fTitle").value.trim();
      if (!title) { $("#fTitle").focus(); return; }
      const period = $("#fPeriod").value;
      const f = readFor();
      state.tasks.push({ id: uid(), title, period, key: periodKey(period, fromISO(ui.selected)), ...f, progress: 0 });
      save(); sheet.close(); ui.period = period; render(); notifyFor(f); break;
    }
    case "del-event": state.events = state.events.filter((e) => e.id !== el.dataset.id); save(); render(); break;
    case "del-task": state.tasks = state.tasks.filter((t) => t.id !== el.dataset.id); save(); render(); break;
    case "profile": setMe(el.dataset.id); break;
    case "filter": ui.filter = el.dataset.f; render(); break;
    case "new-profile": {
      const name = (prompt("Nom du nouveau profil ?") || "").trim().slice(0, 24);
      if (!name) break;
      const color = EXTRA_COLORS[(state.profiles.length - 2) % EXTRA_COLORS.length];
      const id = "p" + uid();
      state.profiles.push({ id, name, color });
      save(); setMe(id); break;
    }
    case "del-profile": {
      const p = prof(el.dataset.id);
      if (p && confirm(`Supprimer le profil « ${p.name} » et ses événements ?`)) {
        state.profiles = state.profiles.filter((x) => x.id !== p.id);
        state.events = state.events.filter((x) => x.owner !== p.id || x.scope === "commun");
        state.tasks = state.tasks.filter((x) => x.owner !== p.id || x.scope === "commun");
        if (me === p.id) me = "nelson";
        save(); render();
      }
      break;
    }
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
    t.progress = Number(el.value);
    el.style.setProperty("--v", t.progress);
    const card = el.closest(".task");
    card.querySelector(".pct").textContent = t.progress + "%";
    card.classList.toggle("done", t.progress >= 100);
    // Recalcule le cercle global
    const key = periodKey(ui.period, fromISO(ui.selected));
    const list = state.tasks.filter((x) => x.period === ui.period && x.key === key && passes(x));
    const avg = Math.round(list.reduce((s, x) => s + x.progress, 0) / list.length);
    $("#ring").style.setProperty("--p", avg);
    $("#ringTxt").textContent = avg + "%";
  }
  if (el.dataset.pname) { const p = prof(el.dataset.pname); if (p) p.name = el.value.trim() || p.name; }
});
document.addEventListener("change", (ev) => {
  if (ev.target.dataset.act === "slide" || ev.target.dataset.pname) save();
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
  me = id; ui.filter = "all";
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
    $("#view").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }));
  // Fermer l'affiche en grand en la touchant
  $("#photo").addEventListener("click", () => $("#photo").close());
})();

// ---------------------------------------------------------------
// 9. DÉMARRAGE
// ---------------------------------------------------------------
render();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
