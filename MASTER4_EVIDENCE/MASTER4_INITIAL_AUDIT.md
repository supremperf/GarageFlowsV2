---
doc-numbers: journal
---

# MASTER 4 — Audit initial obligatoire

**Date : 22 octobre 2026, 20:50 (Europe/Paris) / 18:50 UTC.**  
**Statut : audit terminé avant toute correction MASTER 4 ; la production reste bloquée.**

## 1. État du dépôt et protection

| Élément | Constat | Preuve |
|---|---|---|
| Dépôt réel | `/home/user/GarageFlowsV2` | `logs/00-initial-safety-inventory.txt` |
| Branche | `arena/388085e0-garageflowsv2` | même preuve |
| HEAD | `150654535ca0b3b417e96be057ba674a119c512f` | même preuve |
| Branche distante demandée | Même commit `1506545…` | même preuve |
| Modifications | Working tree sale : correctifs MASTER 2/3 et rapports non commités ; inventaire complet conservé | même preuve |
| Non-suivis | Rapports, preuves et nouveau dossier `MASTER4_EVIDENCE/` ; aucun nettoyage destructif | même preuve |
| Intégrité MASTER 3 | **57/57** empreintes valides | même preuve |
| Intégrité MASTER 2 | **41/41** empreintes valides | même preuve |
| HWID/licences/clés | `git diff` vide sur `electron`, `src/lib/license`, `keys` | même preuve |
| Données locales | `.env` présent en mode 600 ; `prisma/dev.db` présent, 909 312 octets ; valeurs non journalisées | même preuve |

Aucun commit, push, reset, nettoyage, remplacement de base ou modification HWID/licence n’a été effectué.

## 2. Architecture réelle

Le dépôt est **GarageFlows 1.1.0**, logiciel de gestion d’atelier automobile, et non une application identifiée dans son code comme « Vosegus Management ».

- **Desktop :** Electron 44.9.3, serveur Next lié localement, SQLite/Prisma, migrations et sauvegardes avant migration, données utilisateur conservées à la désinstallation.
- **Web/PWA :** Next.js 15.5.28 / React 18, PostgreSQL via un client Prisma serveur distinct, authentification NextAuth.
- **Redis :** Upstash Redis par API REST et script Lua pour le rate-limit distribué ; mémoire locale seulement en Electron/dev/test. Aucun paquet `redis` n’est requis par cette architecture.
- **Packaging :** Electron Builder 26.15.3, NSIS Windows x64, `dist/GarageFlows-Setup.exe`, `deleteAppDataOnUninstall=false`.
- **Tests :** Vitest 4.1.12 ; Playwright 1.62.1, six projets Chromium, 144 scénarios dans trois fichiers.
- **Base :** 43 modèles desktop et 47 serveur. Clients, interventions, devis, factures, stock et dashboard existent.

Le schéma ne contient **aucun modèle `Subscription`/`Abonnement` ni `Payment`/`Paiement`**, et la recherche métier n’a pas identifié d’implémentation d’abonnements Vosegus. La cause — nouveau périmètre demandé ou confusion de produit — n’est **pas déterminée**. Ces fonctions ne seront pas déclarées validées ni inventées.

## 3. Versions et cohérence des dépendances

| Dépendance | Spécification/lock/installé | Constat |
|---|---|---|
| Next.js | 15.5.28 / 15.5.28 / 15.5.28 | Cohérent, audit MASTER 3 vert à revérifier |
| `eslint-config-next` | 15.5.27 | Décalage d’un patch avec Next ; risque de compatibilité à corriger prudemment |
| Prisma / Client | Spec `^5.16.1`, lock et installé 5.22.0 | Versions mutuellement cohérentes |
| Moteur Prisma | Commit `605197351a3c8bdd595af2d2a9bc3025bca48ea2` | Aucun fichier natif présent |
| Electron / Builder | 44.9.3 / 26.15.3 | Cible NSIS x64 définie |
| Playwright | 1.62.1 | Chromium v1234 attendu, absent |
| TypeScript / Vitest | 5.9.3 / 4.1.12 | Configuration stricte |
| npm / Node | npm projet 11.16.0 ; Node 22.22.3 | Contrat Node 22 respecté |

Preuves : `logs/00-initial-safety-inventory.txt` et `logs/01-architecture-and-config-inventory.txt`.

## 4. Blocages confirmés et causes démontrées

| Blocage | Cause démontrée à ce stade | Catégorie |
|---|---|---|
| Prisma | Téléchargement officiel interrompu avant TLS ; aucun moteur, client desktop stub et client serveur absent | Dépendance réseau indisponible |
| Vitest | Point de départ vérifié : 3 517 réussis, 3 échoués, 869 ignorés ; 84 fichiers rouges, dont 79 amorçages DB et 5 imports du client serveur | Conséquence Prisma ; pas un défaut métier démontré |
| Playwright | Chromium v1234 absent ; point de départ 54 échecs de lancement, 90 skips, aucun scénario applicatif | Navigateur indisponible + accès authentifié manquant |
| Build/standalone | Build arrêté à la première génération Prisma ; `BUILD_ID` et standalone absents | Conséquence Prisma |
| Windows | Aucun Setup.exe, aucun hôte Windows/Wine | Prérequis et accès externe manquants |
| SBOM/notices | 35 absents, 3 extras, 3 divergences dans l’arbre MASTER 3 ; sources d’inventaire non réconciliées avec la cible | Défaut de génération/réconciliation ; cible Windows absente |
| Gitleaks | Binaire officiel indisponible ; scans working tree/historique non exécutés | Outil indisponible |
| Services réels | `TEST_POSTGRES_URL`, `TEST_REDIS_URL`, Upstash, SMTP, staging et identifiants E2E absents | Accès externe manquant |
| Performance | Aucun build de production ; budget obligatoire non exécuté | Prérequis absent |

## 5. Causes non déterminées — ne pas inventer

1. Le composant réseau précis qui coupe `binaries.prisma.sh` et `cdn.playwright.dev` avant TLS n’est pas identifiable depuis le seul code `ECONNRESET`. Le symptôme est démontré ; l’équipement fautif ne l’est pas.
2. Le périmètre « Vosegus Management » et ses abonnements/paiements n’est pas rattaché à une implémentation du dépôt.
3. La classification exacte de chaque dépendance dans le futur paquet Windows ne peut pas être déduite de l’arbre Linux.
4. L’état du certificat de signature Windows n’est pas démontré tant qu’un artefact et une configuration de signature réels ne sont pas examinés.

## 6. Risques de régression identifiés

- Modifier les types ou mocks pour masquer l’absence des clients Prisma au lieu de restaurer les moteurs.
- Exécuter les tests contre `dev.db` plutôt que contre des copies isolées.
- Exécuter Playwright sans base, licence et compte de test isolés, ou confondre skips et réussites.
- Régénérer les notices depuis Linux en omettant des composants Windows ou en mélangeant dépendances de développement et de production.
- Mettre Next à jour sans aligner `eslint-config-next` et sans rejouer lint/audit.
- **Risque destructif explicite :** `scripts/gate-fresh-postgres.mjs` utilise `DROP DATABASE IF EXISTS gf_gate_check`. Il ne sera pas lancé avec un accès réel avant correction pour empêcher la suppression d’une base préexistante.
- Toucher aux chemins historiques `userData`, à HWID V1, aux clés ou aux règles de conservation des données.

## 7. Plan et ordre exact d’intervention

1. **Protection :** conserver l’inventaire et les empreintes ; ne rien réinitialiser.
2. **Prisma/P0 :** revérifier versions, URL, DNS/TLS et canaux officiels ; obtenir uniquement les moteurs exacts vérifiables.
3. **Bases isolées/P0 :** générer les deux clients natifs, tester lecture/écriture SQLite et PostgreSQL si un accès non destructif est disponible.
4. **Vitest/P0 :** reproduire les trois échecs, inventorier skips et dépendances, relancer la suite complète sans filtre de dissimulation.
5. **Playwright/P0 :** installer uniquement Chromium officiel attendu, vérifier cache/processus/ports/workers, puis exécuter sur données isolées.
6. **Cohérence/build/P0 :** aligner prudemment `eslint-config-next`, vérifier TypeScript/ESLint, produire le build officiel et le standalone.
7. **Standalone/P0 :** démarrer le vrai serveur et tester routes, ressources et erreurs réelles.
8. **Windows/P0 :** produire et inspecter NSIS x64 ; tester installation/persistance/désinstallation uniquement sur Windows réel.
9. **SBOM et sécurité/P1 :** corriger les inventaires sans inventer de licence, exécuter Gitleaks working tree/historique si l’outil officiel devient disponible.
10. **Services/P1 :** sécuriser d’abord la création de bases de test contre tout `DROP` préalable, puis valider PostgreSQL/Redis/SMTP/staging avec accès autorisés.
11. **Métier/P0 :** valider les fonctions GarageFlows réellement présentes et distinguer les exigences Vosegus absentes.
12. **Performance, non-régression et portes :** mesures sur build réel, revue HWID/données/preuves, puis `release:gate` et `readiness:final`.
13. **Rapport final A–Q :** statuts PASS/FAIL/BLOCKED/NOT RUN, commandes, dates, preuves et actions restantes.

Si Prisma ou Chromium reste inaccessible, les phases indépendantes — cohérence npm, sécurisation PostgreSQL, SBOM source, analyse métier et protections — continueront sans être déclarées validations de production.
