// =====================================================================
// Onglet Astro : signes, lune du jour, lecture du jour, compatibilité.
// Tout est calculé ici, sans service externe. Les dates de naissance ne sont
// PAS stockées dans le code (le dépôt est public) : seuls les signes le sont.
// =====================================================================
(function () {
  // Signes occidentaux : élément (feu/terre/air/eau) et mode (cardinal/fixe/mutable)
  const SIGNES = {
    taureau:   { nom: "Taureau",   sym: "♉", el: "terre", mode: "fixe",     mots: "stabilité, sensualité, persévérance" },
    sagittaire:{ nom: "Sagittaire",sym: "♐", el: "feu",   mode: "mutable",  mots: "liberté, optimisme, élan" },
  };
  // Signes chinois : branche (0 = Rat … 11 = Cochon)
  const ANIMAUX = ["Rat", "Bœuf", "Tigre", "Lapin", "Dragon", "Serpent", "Cheval", "Chèvre", "Singe", "Coq", "Chien", "Cochon"];
  const EMOJI = ["🐀", "🐂", "🐅", "🐇", "🐉", "🐍", "🐎", "🐐", "🐒", "🐓", "🐕", "🐖"];

  // Données des deux profils (signe calculé à partir de la date de naissance, qui n'est pas conservée)
  const PROFILS = {
    nelson: { sign: "taureau",    animal: 1, element: "Feu" },
    sophie: { sign: "sagittaire", animal: 2, element: "Terre" },
  };

  // ---- Lune du jour (formules astronomiques simplifiées, précision ~1°) ----
  const ZODIAQUE = ["Bélier", "Taureau", "Gémeaux", "Cancer", "Lion", "Vierge", "Balance", "Scorpion", "Sagittaire", "Capricorne", "Verseau", "Poissons"];
  const ZEL = ["feu", "terre", "air", "eau", "feu", "terre", "air", "eau", "feu", "terre", "air", "eau"];
  const rad = (x) => (x * Math.PI) / 180;
  function lune(date) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // jours depuis J2000
    const M = rad(134.963 + 13.064993 * d);
    const lon = (((218.316 + 13.176396 * d + 6.289 * Math.sin(M)) % 360) + 360) % 360;
    const sun = (((280.46 + 0.9856474 * d) % 360) + 360) % 360;
    const age = (((lon - sun) % 360) + 360) % 360;       // élongation 0-360
    const illum = Math.round((1 - Math.cos(rad(age))) * 50);
    const phases = ["Nouvelle lune", "Premier croissant", "Premier quartier", "Gibbeuse croissante", "Pleine lune", "Gibbeuse décroissante", "Dernier quartier", "Dernier croissant"];
    const emo = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
    const i = Math.round(age / 45) % 8;
    const s = Math.floor(lon / 30);
    return { phase: phases[i], emo: emo[i], illum, signe: ZODIAQUE[s], el: ZEL[s] };
  }

  // ---- Lecture du jour : texte composé (soit signe + élément de la lune + date) ----
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (arr, seed) => arr[seed % arr.length];
  const TON = {
    feu:   ["Ton énergie est haute : lance ce que tu repoussais.", "Une envie d'agir te traverse, canalise-la sur une chose précise.", "L'enthousiasme est contagieux aujourd'hui, partage-le."],
    terre: ["Reste concret : un petit pas régulier vaut mieux qu'un grand élan.", "Le corps et le quotidien réclament de l'attention, soigne les bases.", "Bonne journée pour finir, ranger et consolider."],
    air:   ["Les échanges sont favorisés : écris, appelle, discute.", "Ton esprit va vite, note tes idées avant qu'elles s'envolent.", "Prends du recul avant de trancher, une autre vue t'aidera."],
    eau:   ["Écoute ce que tu ressens avant de décider.", "Journée plus intérieure : prends du temps calme pour toi.", "L'émotion guide, mais laisse-la retomber avant de répondre."],
  };
  const COUPLE = [
    "Un geste attentionné vaut plus qu'un grand discours.",
    "Prenez dix minutes sans écran à deux.",
    "Dis un merci précis à l'autre aujourd'hui.",
    "Planifiez quelque chose à attendre ensemble.",
  ];
  const lecture = (id, date, lu) => {
    const p = PROFILS[id], sg = SIGNES[p.sign];
    const ymd = date.toISOString().slice(0, 10);
    const seed = hash(id + ymd);
    return {
      a: pick(TON[sg.el], seed),
      b: pick(TON[lu.el], seed >>> 3),
      c: pick(COUPLE, seed >>> 5),
    };
  };

  // ---- Compatibilité ----
  const EL_REL = {
    "feu-feu": ["Complicité intense", "Deux flammes : beaucoup d'énergie, attention aux étincelles."],
    "terre-terre": ["Solide", "Même rythme et mêmes bases, la confiance se construit durablement."],
    "air-air": ["Légère", "Beaucoup de dialogue et de curiosité mutuelle."],
    "eau-eau": ["Profonde", "Compréhension émotionnelle quasi instinctive."],
    "feu-air": ["Stimulante", "L'air attise le feu : dynamique et créatif."],
    "eau-terre": ["Nourrissante", "L'eau fait pousser ce que la terre structure."],
    "feu-terre": ["Complémentaire, avec des contrastes", "Feu = élan, Terre = ancrage. Vous vous équilibrez si chacun respecte le rythme de l'autre."],
    "air-terre": ["À apprivoiser", "Idées contre concret : vous apprenez beaucoup l'un de l'autre."],
    "eau-feu": ["Intense", "Passion et sensibilité, à doser pour éviter les tensions."],
    "air-eau": ["Contrastée", "Raison et émotion : l'écoute fait la différence."],
  };
  const elRel = (a, b) => EL_REL[`${a}-${b}`] || EL_REL[`${b}-${a}`];
  // Chinois : triades d'affinité, "six harmonies", oppositions (conflit)
  const TRIADES = [[0, 4, 8], [1, 5, 9], [2, 6, 10], [3, 7, 11]];
  const HARMONIES = [[0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7]];
  const chineseRel = (a, b) => {
    if (a === b) return ["Miroir", "Même animal : vous vous comprenez, mais vous partagez aussi les mêmes travers."];
    if (HARMONIES.some((h) => h.includes(a) && h.includes(b))) return ["Harmonie", "Une des meilleures associations traditionnelles."];
    if (TRIADES.some((t) => t.includes(a) && t.includes(b))) return ["Affinité", "Même triade : valeurs et tempérament proches."];
    if ((a + 6) % 12 === b) return ["Opposition", "Animaux opposés : attirance et frictions, à travailler avec patience."];
    return ["Neutre", "Ni facilité particulière ni blocage : tout dépend de vous deux."];
  };

  const dateFr = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  // ---- Rendu ----
  function card(id, name, color, date) {
    const p = PROFILS[id];
    if (!p) return `<div class="card"><p class="muted">Pas de signe renseigné pour ce profil.</p></div>`;
    const sg = SIGNES[p.sign], lu = lune(date), l = lecture(id, date, lu);
    return `
      <div class="card astro-card">
        <div class="astro-top">
          <div class="astro-sym" style="color:${color}">${sg.sym}</div>
          <div><h3 style="margin:0">${name} · ${sg.nom}</h3>
          <small class="muted">${sg.el[0].toUpperCase() + sg.el.slice(1)} · ${sg.mode} · ${sg.mots}</small></div>
        </div>
        <div class="astro-row"><span>${EMOJI[p.animal]}</span><div><b>${ANIMAUX[p.animal]} de ${p.element}</b><small class="muted"> · signe chinois</small></div></div>
      </div>
      <div class="card">
        <h3>Aujourd'hui</h3>
        <small class="muted">${dateFr(date)} · ${lu.emo} ${lu.phase} en ${lu.signe} (${lu.illum}%)</small>
        <p class="astro-p">${l.a}</p>
        <p class="astro-p">${l.b}</p>
        <p class="astro-p">💞 ${l.c}</p>
        <small class="muted">Lecture composée par l'appli à partir du signe et de la lune du jour. Ce n'est pas The Pattern.</small>
      </div>`;
  }

  function commun(date, nameOf, colorOf) {
    const a = PROFILS.nelson, b = PROFILS.sophie, sa = SIGNES[a.sign], sb = SIGNES[b.sign];
    const [t1, d1] = elRel(sa.el, sb.el), [t2, d2] = chineseRel(a.animal, b.animal);
    const modeTxt = sa.mode === sb.mode ? `Même mode (${sa.mode}) : mêmes réflexes face aux changements.` : `Modes différents (${sa.mode} / ${sb.mode}) : l'un stabilise, l'autre fait bouger.`;
    return `
      <div class="card astro-card">
        <div class="astro-duo">
          <div><div class="astro-sym" style="color:${colorOf("nelson")}">${sa.sym}</div><b>${nameOf("nelson")}</b><br><small class="muted">${sa.nom}</small><br>${EMOJI[a.animal]} <small class="muted">${ANIMAUX[a.animal]}</small></div>
          <div class="astro-heart">♡</div>
          <div><div class="astro-sym" style="color:${colorOf("sophie")}">${sb.sym}</div><b>${nameOf("sophie")}</b><br><small class="muted">${sb.nom}</small><br>${EMOJI[b.animal]} <small class="muted">${ANIMAUX[b.animal]}</small></div>
        </div>
      </div>
      <div class="card"><h3>Astrologie occidentale</h3>
        <p class="astro-p"><b>${t1}</b> — ${sa.nom} (${sa.el}) et ${sb.nom} (${sb.el}).</p>
        <p class="astro-p">${d1}</p><p class="astro-p">${modeTxt}</p></div>
      <div class="card"><h3>Astrologie chinoise</h3>
        <p class="astro-p"><b>${t2}</b> — ${ANIMAUX[a.animal]} et ${ANIMAUX[b.animal]}.</p>
        <p class="astro-p">${d2}</p></div>
      <div class="card"><h3>Pour vous deux aujourd'hui</h3>
        <p class="astro-p">💞 ${pick(COUPLE, hash("duo" + date.toISOString().slice(0, 10)))}</p></div>
      <small class="muted">Lecture indicative basée sur les signes uniquement, à prendre comme un jeu.</small>`;
  }

  window.AstroView = function (sub, ctx) {
    const date = new Date();
    const tabs = [["nelson", ctx.nameOf("nelson")], ["sophie", ctx.nameOf("sophie")], ["commun", "Commun"]];
    const body = sub === "commun" ? commun(date, ctx.nameOf, ctx.colorOf) : card(sub, ctx.nameOf(sub), ctx.colorOf(sub), date);
    return `
      <div class="head"><div><h1>Astro</h1><div class="sub">${dateFr(date)}</div></div></div>
      <div class="seg three">${tabs.map(([k, n]) => `<button class="${k === sub ? "on" : ""}" data-act="astro-sub" data-s="${k}">${n}</button>`).join("")}</div>
      ${body}
      <a class="btn small" href="https://apps.apple.com/app/the-pattern/id1071085727" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px">Ouvrir The Pattern (App Store)</a>`;
  };
})();
