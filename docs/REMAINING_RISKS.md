# Registre des risques résiduels — GarageFlow

État après l'audit de production (`AUDIT_PRODUCTION_FINAL.md`). Chaque risque :
description, impact, probabilité, bloquant ?, solution, effort, preuve manquante.

---

## R-1 — Intégrité du fichier de grâce hors-ligne (`last_online.json`)

- **Description** : le verrou anti-hors-ligne (72 h) du desktop lit
  `<APP_DATA>/last_online.json` en clair (`electron/main.js` `readLastOnline`).
  Un utilisateur peut éditer le champ `ts` pour prolonger sa période de grâce et
  retarder la propagation d'une révocation/expiration.
- **Impact** : MOYEN. Une licence révoquée/expirée peut rester utilisable
  hors-ligne au-delà des 72 h prévues. **N'affecte pas** la signature de licence
  (ECDSA vérifiée localement) ni la révocation **à la reconnexion** (contrôle
  serveur, qui reste effectif). L'attaquant vise sa **propre** licence.
- **Probabilité** : faible (nécessite une action manuelle locale répétée).
- **Bloquant production** : non.
- **Solution recommandée** : sceller le fichier par HMAC-SHA256 avec un secret
  dérivé du HWID (`deriveDbMacSecret`, déjà disponible) ; à la lecture, un HMAC
  invalide/absent ⇒ traiter comme « reconnexion requise ». *Note de migration* :
  gérer les installations existantes (fichier legacy sans HMAC) pour ne pas
  verrouiller un client légitime hors-ligne juste après la mise à jour.
- **Effort** : ~0,5 j (code) + validation Windows.
- **Preuve manquante** : non corrigé ici car **non validable dans cet
  environnement** (pas de Windows/GUI ni de banc licence) et le risque d'un
  correctif mal calibré (verrouiller des clients payants) dépasse le bénéfice ;
  à implémenter + tester sur poste Windows réel.

## R-2 — Réponse d'autorité de licence non signée + `GF_LICENSE_SERVER` redéfinissable

- **Description** : `periodicLicenseCheck` (`electron/main.js`) fait confiance
  à la réponse JSON de `${GF_LICENSE_SERVER}/api/license/check` sans signature
  applicative, et `GF_LICENSE_SERVER` peut être redéfini par variable
  d'environnement OS (priorité sur la valeur packagée).
- **Impact** : MOYEN. Un utilisateur maîtrisant sa machine peut pointer vers un
  serveur renvoyant `{allowed:true}` et neutraliser la propagation des
  révocations par heartbeat. Limitation **inhérente** au licensing côté client.
- **Probabilité** : faible-moyenne (utilisateur technique sur sa propre machine).
- **Bloquant production** : non.
- **Solution recommandée** : (a) **signer** les réponses de heartbeat côté
  control-plane (`garagesite3`) et **vérifier la signature** côté desktop avec la
  clé publique déjà embarquée ; (b) **épingler** `GF_LICENSE_SERVER` en
  production (ignorer tout override OS hors mode dev).
- **Effort** : ~1–2 j (control-plane + desktop) + banc de test.
- **Preuve manquante** : changement de **protocole coordonné** (serveur+client)
  non validable ici (pas de control-plane réel ni de desktop packagé). À
  implémenter et valider bout-en-bout avant release.

## R-3 — Rate-limiting du crash intake en mémoire (control-plane multi-instance)

- **Description** : `POST /api/crash` (garagesite3) est limité par un compteur
  **en mémoire** (20/min/IP), non distribué. Sur plusieurs instances Vercel, la
  limite est par-instance et contournable par rotation d'IP.
- **Impact** : FAIBLE désormais — le vecteur grave (déclencher un rollback auto)
  est **corrigé** (A-02 : seuls les appareils enregistrés comptent). Reste un
  risque de volume de stockage/bruit.
- **Bloquant production** : non.
- **Solution recommandée** : basculer le crash intake sur le limiteur distribué
  Upstash déjà utilisé pour les routes sensibles.
- **Effort** : ~0,25 j. **Preuve manquante** : test multi-instance.

## R-4 — HWID factices « théoriques » sur le crash intake

- **Description** : après A-02, seuls les HWID d'appareils **enregistrés**
  comptent. Un attaquant connaissant N HWID de machines réellement activées
  pourrait encore peser sur la métrique — mais les HWID sont des SHA-256
  matériels non publics.
- **Impact** : FAIBLE (infaisable en pratique). **Bloquant** : non.
- **Solution** : exiger un jeton d'appareil signé sur `/api/crash` (défense en
  profondeur). **Effort** : ~0,5 j. **Preuve manquante** : n/a.

## R-5 — En-têtes CSP : `script-src 'unsafe-inline' 'unsafe-eval'`

- **Description** : les CSP des deux repos autorisent `unsafe-inline`/`unsafe-eval`
  pour les scripts (limitation connue de Next.js App Router sans nonce).
- **Impact** : FAIBLE-MOYEN (affaiblit la défense XSS s'il existait un point
  d'injection ; aucun `dangerouslySetInnerHTML` non échappé identifié).
- **Bloquant** : non. **Solution** : CSP par **nonce** (middleware) quand la
  stack le permettra. **Effort** : ~1 j. **Preuve manquante** : non-régression
  d'hydratation à valider.

## R-UI — Visibilité réelle des fonctionnalités dans l'interface (Phase 4.3)

- **Description** : l'UI Desktop est une SPA (12 `page.tsx`, navigation interne
  via store). La **présence** d'une route/module ne garantit pas son exposition
  correcte par rôle. Impossible à parcourir ici (environnement **headless**, pas
  d'affichage graphique).
- **Impact** : inconnu (potentiellement des fonctionnalités « invisibles »).
- **Bloquant** : non (le code et les API existent et sont testés).
- **Solution recommandée** : campagne **E2E Playwright** sur l'app packagée
  (parcours des 15 scénarios métier + portail + admin par rôle).
- **Effort** : ~2–3 j. **Preuve manquante** : exécution GUI/E2E.

---

## Validations externes non exécutables ici (procédure)

| Cible | Manque | Procédure exacte |
|---|---|---|
| **Packaging Windows** | Windows/Wine | `npm run dist` sur Windows 10 **et** 11 ; installer utilisateur standard ; vérifier création `<userData>/garageflow.db`, chemins avec espaces, nom d'utilisateur accentué, désinstallation, mise à jour. |
| **Neon (PostgreSQL managé)** | Base Neon réelle | `DATABASE_URL=<pooler> DIRECT_URL=<direct> npm run db:server:check` (GFV2) / `npm run db:migrate` (site3) ; vérifier saturation du pool, reconnexion. |
| **Vercel** | Compte Vercel | Déployer preview→prod ; renseigner **toutes** les variables (sinon démarrage refusé, fail-closed) ; `GET /api/health` ; migrations via `DIRECT_DATABASE_URL`. |
| **PWA iOS/Android/Desktop** | Navigateurs réels | Installer (A2HS), tester standalone, offline, mise à jour du service worker (pas de boucle), absence de fuite inter-utilisateur. Documenter les limites iOS. |
| **Banc licence Desktop** | Windows + control-plane | Activation, révocation immédiate, période de grâce, changement d'horloge, mise à jour signée (SHA-256 + signature) — dont R-1/R-2 ci-dessus. |

## Prochaine action réellement prioritaire

1. Implémenter **R-2** (signature de heartbeat + épinglage `GF_LICENSE_SERVER`)
   et **R-1** (HMAC `last_online.json`) sur un banc Windows + control-plane, puis
   valider bout-en-bout — ce sont les deux seuls défauts CONFIRMÉS non corrigés.
2. Campagne **E2E Playwright** (R-UI) sur l'app packagée pour lever le dernier
   risque Phase 30 (« fonctionnalités invisibles »).
