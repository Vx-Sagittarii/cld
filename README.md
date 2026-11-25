# iwi2me — PWA couple (étape 1)

Fichiers : index.html, style.css, app.js, sw.js, manifest.webmanifest, icons/.
Pas de build : c'est du HTML/CSS/JS pur.

## Tester sur ton ordinateur
    python3 -m http.server 8000      # puis ouvre http://localhost:8000

## Mettre en ligne gratuitement (GitHub Pages)
1. Crée un dépôt GitHub public, ex. `cld`, et mets-y tous ces fichiers à la racine.
2. Settings > Pages > Source : "Deploy from a branch" > application / (root).
3. Ton lien : https://TON-PSEUDO.github.io/cld/
4. Envoie-le à ta partenaire. iPhone : Safari > Partager > Sur l'écran d'accueil.
   Android/Samsung : Chrome > Installer l'application.

## Mettre à jour
Modifie les fichiers, puis change `CACHE = "iwi2me-v1"` en v2 dans sw.js.
