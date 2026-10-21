# GarageFlows — EXTERNAL_BLOCKERS

Éléments du programme V21 qui NE PEUVENT PAS être réalisés ou validés dans
l'environnement de cette mission (conteneur Linux headless, sans Windows, sans
certificat de signature, sans services de production ni identifiants de
plateformes tierces). Ils sont listés honnêtement — jamais simulés ni marqués
« validés » sans preuve (§3, §84 du prompt V21).

Statuts : `BLOQUÉ PAR ENVIRONNEMENT` · `BLOQUÉ PAR DÉPENDANCE EXTERNE` ·
`NÉCESSITE VALIDATION EXTERNE` · `PARTIELLEMENT LEVÉ` (preuve citée).

**Mise à jour du 21/10/2026 (PR #34).** Les n° 3 à 6 sont partiellement levés
par des exécutions réelles, preuves citées ; les n° 12 à 14 sont nouveaux. La
liste ordonnée de ce qui reste à faire avant la production est dans
`docs/audit/2026-10-21/PRODUCTION_READINESS.md` §4.

| # | Élément | Statut | Pourquoi bloqué ici | Ce qu'il faut pour lever le blocage |
|---|---|---|---|---|
| 1 | Test Windows réel : install propre, MàJ Vn→Vn+1, réinstall même version (AUD-056), réparation, désinstall, app ouverte pendant update, reboot | BLOQUÉ PAR ENVIRONNEMENT | Pas de Windows/wine ; `electron-builder --win` échoue (« wine is required ») | Machine Windows 10/11 réelle + exécution de la matrice `WINDOWS_INSTALL_UPDATE_MATRIX` |
| 2 | Signature Authenticode de l'installateur et de l'exe | BLOQUÉ PAR DÉPENDANCE EXTERNE | Aucun certificat de signature de code disponible | Certificat EV/OV + timestamp + vérification en CI de la signature des artefacts |
| 3 | Migration MAJEURE Electron (31 → branche courante) | PARTIELLEMENT LEVÉ | Montée faite : Electron 41.10.6. La CI `windows-latest` de la PR #34 empaquette, installe, lance jusqu'à la fenêtre d'activation, réinstalle et désinstalle le vrai Setup | Rejouer preload, IPC, auto-updater et fenêtres sur un poste Windows réel, avec l'exe signé (n° 1, 2) |
| 4 | Migration MAJEURE Next.js (14 → 15+) | PARTIELLEMENT LEVÉ | Montée faite : Next.js 15.5.27. Build, suite complète avec PostgreSQL et Redis réels, et E2E publics verts (PR #34, `docs/audit/2026-10-21/TEST_RESULTS.md`) | E2E authentifiés (n° 11, 12) |
| 5 | Migrations PostgreSQL sur base réelle (vierge + données V20) + concurrence numérotation/stock/licences | PARTIELLEMENT LEVÉ | PostgreSQL 16 réel (PR #34) : 22 migrations sur base vierge, contraintes et cascade, activations concurrentes, 50 numérotations parallèles | Base Neon réelle avec données de production (sauvegarde, `migrate deploy`, contrôle) |
| 6 | Rate-limit distribué / idempotence sous Redis réel + panne Redis | PARTIELLEMENT LEVÉ | Redis réel (PR #34) : limiteur partagé entre instances | Upstash réel et test de panne Redis |
| 7 | Intégrations e-invoicing RÉELLES (Chorus Pro / PDP, envoi Factur-X, webhooks) | BLOQUÉ PAR DÉPENDANCE EXTERNE | Aucun identifiant de plateforme ; une plateforme ne peut être marquée AVAILABLE sans intégration réellement implémentée ET testée (§14) | Comptes/API de test + implémentation adaptateur par plateforme + validation XSD/Schematron sur fichiers réels |
| 8 | Control-plane admin : identités individuelles + MFA + RBAC fin (remplacer/renforcer la clé statique) | NÉCESSITE VALIDATION EXTERNE | Refonte architecturale + décisions produit ; risque élevé de conflit sur une branche en cours d'édition parallèle | Conception validée + implémentation + tests ; mitigation immédiate DÉJÀ livrée : révocation admin effective en base (`isAdminSession`) |
| 8bis | Clé mécanicien : ré-émission cryptographique à la réattribution (résiduel P2 OUVERT) | NÉCESSITE VALIDATION EXTERNE | La clé mécanicien est un jeton PORTEUR signé (ECDSA vendeur). Re-signer un NOUVEAU jeton exige la **clé privée du control-plane** (jamais dans l'app/le dépôt — même nature externe que le certificat Authenticode / les accès prod). L'app seule ne peut donc pas « rendre l'ancien jeton cryptographiquement mort ». Fermeture airtight = ré-émission (control-plane) OU secret d'activation rotatif présenté par le client (changement de protocole client, non validable en conteneur) | Mitigation livrée ET PROUVÉE PAR TEST : révocation PERMANENTE de TOUS les appareils (actifs **et** déconnectés) à la réattribution + plafond `seats=1` — `src/app/api/mechanic-licenses/__tests__/assign-route.test.ts`. Fix complet : ré-émission de clé côté control-plane + test d'impersonation sur poste réel |
| 9 | `RESET-GARAGEFLOW.cmd` de bout en bout (double-clic, PowerShell, Vercel/Neon/Upstash, rotation secrets) | BLOQUÉ PAR ENVIRONNEMENT | Nécessite Windows + identifiants de prod ; rotation = opération sensible sur infra réelle | Poste Windows + accès infra + exécution contrôlée (dry-run puis réel) |
| 10 | Rotation des secrets de prod exposés historiquement (DATABASE_URL Neon, NEXTAUTH_SECRET, GARAGEFLOW_API_KEY) | NÉCESSITE VALIDATION EXTERNE | Les secrets étaient livrés en clair dans d'anciens installateurs (`resources/standalone/.env`, désormais retiré au post-build) → à considérer COMPROMIS | Rotation par le propriétaire sur Vercel/Neon/Upstash ; ne peut être faite sans droits infra |
| 11 | Vérification live de `https://app.garageflows.fr` (PWA en prod) | NÉCESSITE VALIDATION EXTERNE | Logs Vercel montrent le WEB fonctionnel (login 200, licence 200) mais aucune session E2E authentifiée exécutée ici | E2E authentifié CI (garage/mécanicien/portail jetables) contre l'URL de prod |
| 12 | Environnement GitHub `e2e-staging` non configuré | BLOQUÉ PAR DÉPENDANCE EXTERNE | Secrets `E2E_STAGING_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_LICENSE` et variable `E2E_NON_PRODUCTION` vides : le job « Authenticated browser validation » échoue avant le checkout (`MISSING_INPUT:BASE_URL`), donc « Required validation » est rouge sur toutes les PR | Settings → Environments → `e2e-staging` : recette HTTPS hors production, compte et licence synthétiques, `E2E_NON_PRODUCTION=true` |
| 13 | Clé privée de l'autorité de licences (production) | NÉCESSITE VALIDATION EXTERNE | Absente du dépôt par conception : 7 tests ignorés (résistance à la falsification, jeton réel accepté puis altéré) ; aucune licence réelle émise ni révoquée dans la session (cycle complet prouvé avec une autorité de TEST) | Sur le poste de build, restaurer `keys/private.pem` depuis sa sauvegarde, puis `GF_TEST_LICENSE` et rejouer les 7 tests |
| 14 | Clé de signature des mises à jour (Ed25519) | NÉCESSITE VALIDATION EXTERNE | `GF_UPDATE_SIGNING_KEY` absente : aucun vrai installeur signé ni vérifié sur un poste (refus d'une clé étrangère et d'un binaire modifié déjà prouvés) | Signer le manifeste de la version candidate, vérifier son acceptation sur un poste Windows |

## Mitigations déjà livrées (réduisant l'exposition en attendant le blocage externe)

- **Écran blanc desktop** : résolu (origine `localhost` unifiée + host-resolver).
- **Révocation admin** : rendue effective en base à chaque requête (`isAdminSession`) — ne dépend plus de l'expiration du cookie.
- **Immutabilité devis/OR** : races TOCTOU fermées.
- **Restauration** : cycle interactif réparé + validation d'archive + rollback.
- **Fuite `.env`** : retirée du standalone empaqueté au post-build.
