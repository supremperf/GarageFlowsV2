# FINAL VERIFICATION BASELINE — source de vérité unique (V13)

> **Tout document du dépôt qui cite un chiffre d'état (tests, versions,
> statuts) pointe ici.** Chaque valeur provient d'une commande exécutée le
> 2026-08-07 sur le commit indiqué — rien n'est recopié ni estimé. Ce qui n'a
> pas été vérifié est listé en §8.

## 1. Identité

- Product : **GarageFlows** · Version : 1.1.0
- Commit des mesures : `af73de3` (branche `claude/garageflow-final-unified-merge-ub0l67`)
- Date UTC : 2026-08-07 (10:40 → 12:00)
- Node v22.22.2 · npm 10.9.7 · Next.js 14.2.35 · Electron 31.7.7 ·
  Prisma 5.22.0 · TypeScript 5.9.3
- PostgreSQL d'audit : 16.13 (cluster local jetable) · Redis d'audit : 7 (local)
- Dépôt compagnon : garagesite3 `3405bcd` (arbre propre)

## 2. Build

- TypeScript : **0 erreur** (`tsc --noEmit`)
- Lint : **0 avertissement / 0 erreur** (`next lint`)
- Build production : **OK** (16 pages) — CSP de production vérifiée AU RUNTIME
  (sans `unsafe-eval`), page de connexion rendue 200
- Build Electron/Windows : **NON EXÉCUTÉ** (conteneur Linux — §8)
- PWA : gardes `check:pwa` vertes ; suite Playwright **3× 12/12 verte** contre
  le build de production

## 3. Tests (exécutés, 0 échec)

- Suite standard : **119 fichiers (114 verts + 5 conditionnels), 1351 tests —
  1323 verts, 28 conditionnels** (vitest, SQLite réel)
- Suites conditionnelles EXÉCUTÉES en plus : PostgreSQL réel **21 tests verts**
  (numérotation 50 requêtes parallèles, stock, licences/sièges, sessions) ;
  Redis réel **5 tests verts** (rate-limit multi-instance)
- **Total exécuté vert : 1349 / 1351** ; les 2 restants exigent un jeton de
  licence réel (poste opérateur)
- E2E : parcours métier complet 13 étapes via vrais handlers (persistance
  vérifiée en base) ; Playwright responsive contre build de production
- Release gate final : **10/10 OK** (preuve négative : PG injoignable → exit 1)

## 4. Sécurité (état vérifié)

- Secrets : 0 fuite fichiers suivis (gitleaks 8.24.3, 2 dépôts) ; historique =
  uniquement les secrets DÉJÀ recensés compromis (registre + rotation outillée)
- Auth/sessions : NextAuth, secret fail-closed (démarrage refusé sans — observé)
- Authorization : deny-by-default, matrice 128 cellules testée
- Tenant isolation : matrice de permutation **63 tests** + audit statique 141
  routes (0 faille) + refus inter-garages dans l'E2E métier
- Rate limiting : distribué fail-closed, prouvé multi-instance (Redis réel)
- HWID/licences : plafond d'appareils atomique prouvé sous concurrence PG ;
  révocation irréversible testée ; clé publique ECDSA cohérente (test)
- CSP : production sans `unsafe-eval` (runtime vérifié) ; `'unsafe-inline'`
  scripts = exception verrouillée par test (nonce = reste à faire)
- Electron : `contextIsolation/sandbox/webSecurity` actifs (3 fenêtres,
  fichier:ligne dans `ELECTRON_SECURITY_BASELINE.md`), fuses au packaging
- Dépendances : 0 high/critical de production non dérogée (1 dérogation datée)

## 5. Finance

- Représentation : **entiers exacts** (centimes / dix-millièmes) ; champs
  monétaires Float : **0** (garde CI ; les 8 `taxRate Float` sont des TAUX)
- TVA : formule UNIQUE du dépôt (`taxCentsFromBasis`, chemin 100 % entier),
  arrondi fiscal demi-éloigné-de-zéro sur l'assiette — testée y compris taux
  exotiques et bornes BigInt
- Facturation : immuabilité prouvée (409), numérotation transactionnelle
  contiguë prouvée sous concurrence réelle, FEC testé (libellés, nommage)
- Migrations monétaires : appliquées et vérifiées colonne par colonne (gardes)

## 6. E-invoicing (état réel)

- Modèle canonique EN 16931 (sous-ensemble) : **fait, testé**
- Validation : Luhn SIREN/SIRET, clé TVA FR, recalcul intégral fail-closed
- CII Factur-X MINIMUM : généré et **validé contre le XSD officiel 1.09**
  (xmllint, 1 passage)
- Mapping documenté : `docs/einvoicing/EN16931_MAPPING.md`
- **Statut réel : préparation avancée, PAS de conformité revendiquée** — sans
  PDF/A-3, sans Schematron, sans raccordement à une plateforme agréée
  (architecture d'adaptateurs prête, registre volontairement vide)

## 7. Production (infrastructure)

- Neon / Vercel / Upstash de production : **AUCUN accès — rien de validé** ;
  équivalents locaux réels utilisés (PG 16.13, Redis 7)
- Validation d'environnement : fail-closed **prouvée** (démarrage refusé)
- Windows/Authenticode : **non exécuté** (protocole + pipeline documentés)
- Monitoring : sondes + seuils codés et testés ; alerting non câblé
- Backups : restauration desktop prouvée par test ; exercice serveur réel à
  faire (RPO/RTO = objectifs)

## 8. Restrictions — NON vérifié dans cet environnement

Build/installation/upgrade Windows réels ; signature Authenticode ;
SmartScreen ; rendu WebKit/Safari réel ; déploiement Neon/Vercel/Upstash ;
test de charge sur infrastructure réelle (scripts fournis) ; exercice de
restauration serveur chronométré ; rotation effective des secrets compromis
(outil fourni, action opérateur) ; validations juridiques/comptables/
réglementaires (voir `docs/data-room/09-risks/EXTERNAL_VALIDATIONS.md`).
