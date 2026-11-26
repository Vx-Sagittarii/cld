# iwi2me

PWA gratuite pour un couple : calendrier partagé, tâches, sport, astro. HTML/CSS/JS pur, sans build.
Voir `CLAUDE.md` pour l'organisation du code, le déploiement et la base Supabase.

## Tester en local
    python3 -m http.server 8000      # puis http://localhost:8000

## Mettre en ligne (GitHub Pages)
Dépôt public, Settings > Pages > « Deploy from a branch » > branche `application` / (root).
Installation : iPhone Safari > Partager > Sur l'écran d'accueil ; Android Chrome > Installer l'application.

## Mettre à jour
Modifier les fichiers, **changer `CACHE` dans `sw.js`**, commit + push.
