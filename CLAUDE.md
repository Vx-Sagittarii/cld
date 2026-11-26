# iwi2me : PWA de couple (guide pour Claude Code)

Appli installable pour deux personnes : calendrier partagé, tâches avec avancement, suivi sport (Hevy / Strava / Garmin), astro.
HTML/CSS/JS pur, **sans build**. Hébergée sur GitHub Pages, données dans Supabase (plan gratuit).

## Fichiers
- `index.html`, `style.css`, `app.js` (toute la logique), `astro.js`, `sw.js` (cache hors-ligne), `config.js` (URL + clé publique Supabase), `manifest.webmanifest`
- `supabase/schema.sql` : schéma + migrations numérotées, à rejouer dans l'éditeur SQL de Supabase (les fonctions sont en `create or replace`)
- `supabase/functions/hevy-sync.ts` : synchro sport (Edge Function)

## Règles de travail
- Répondre en français. Code commenté, simple, sans dépendance ni build.
- **À chaque mise en ligne, changer `CACHE` dans `sw.js`** (`iwi2me-vNN` → `vNN+1`), sinon les téléphones gardent l'ancienne version.
- Déploiement : commit + push sur la branche `application` (GitHub Pages). Prévoir ~1 à 10 min avant que ce soit visible.
- Toute évolution de la base = nouvelle migration **ajoutée à la fin** de `supabase/schema.sql`, numérotée, et à lancer à la main dans Supabase.
- Ne jamais écrire de mot de passe, clé API, token ou secret dans le dépôt (il est public). La clé `publishable` de `config.js` est faite pour être publique.

## Sécurité
- RLS activée, aucune politique : tout passe par des fonctions `SECURITY DEFINER` qui vérifient le jeton du profil.
- Le mode admin est réservé à un seul profil, avec son propre mot de passe (jamais dans le dépôt).
- L'accès d'un profil peut être limité par l'admin (tâches / sport / astro / intégrations).

## Modèle de données utile
- Événement : `date`, `time` (`HH:MM`, `HH:MM-HH:MM`, vide = journée, suffixe `>AAAA-MM-JJ` = date de fin), `meta` JSON (`w` = pour qui, `rep`, `rem`, `cd`).
- « Qui » : Moi privé = `perso` ; Moi/Sophie/Nous partagés = `commun` (+ `meta.w`). Nous = `commun` sans `w`.
- Tâche : `period` + `key`. Une tâche « du … au … » = `period "day"` et `key "AAAA-MM-JJ+N"` (N jours après le début). Anciennes clés `AAAA-Www`, `AAAA-MM`, `AAAA` toujours lues.
- Tâche commune : un seul curseur partagé (`progress` recopié dans `progress_b`). `meta` JSON : `n` (note), `rd`/`rt` (rappel).
- Tâche fréquente : `meta.f` = jours de la semaine (0 = lundi … 6 = dimanche), `meta.dn` = dates faites ; avancement = jours faits ÷ jours prévus dans la période affichée. Pas de rappel pour ces tâches.
- Rappel de tâche = événement lié `r<idTâche>` titré « ⏰ … » (réutilise les notifications des événements).
- Objectif sport : réglé par semaine ; affiché sur la période choisie = objectif × jours ÷ 7.

## Tester sans le vrai compte
Pas de navigateur connecté : copier `index.html` en `zz-test.html` sans la balise CSP, y mettre `localStorage "iwi2me-token"="mock"` et un `fetch` simulé (`get_data`, `get_sport`, …), puis
`google-chrome --headless --no-sandbox --disable-gpu --window-size=500,900 --virtual-time-budget=15000 --dump-dom http://localhost:8077/zz-test.html`
(serveur : `python3 -m http.server 8077`). Supprimer les `zz-*` ensuite. Éviter l'onglet Astro dans ce simulateur.
Pièges CSS : ne pas réutiliser les noms de classe `.allday`, `.who`, `.dot`, `.sheet`, `.grid` pour autre chose.
