# Rapport final — Préparation à une acquisition ~200 000 – 250 000 € (GarageFlow)

_Mission code-first. Chaque affirmation est soutenue par un fichier, un test ou
une commande réellement exécutée. Date : 2026-08-01. Aucun force-push, aucune
réécriture d'historique._

> **Cadre d'honnêteté.** Ce rapport distingue systématiquement : **réellement
> implémenté & testé** · **partiel** · **design/documenté uniquement** ·
> **dépend d'un tiers** · **nécessite une action humaine** · **non testé ici**.
> Aucune valorisation n'est garantie. Aucune preuve commerciale n'est inventée.

---

## 1. Résumé exécutif
Cette mission a été **centrée sur le code**, pas sur la documentation. Le résultat
principal : la branche de travail avait **réintroduit des régressions de sécurité**
(vs `production-audit`) côté application desktop ; elles ont été **identifiées,
restaurées et vérifiées par tests**, puis **renforcées au-delà** de l'état
antérieur (validation des magic bytes, atomicité de stock supplémentaire). Le
control-plane cloud n'avait **aucune** régression.

État après mission : cœur produit **stable, sécurisé et testé** (694 tests verts
desktop, 140 cloud, `tsc` propre, builds OK). Les **leviers de valeur P2**
(multi-garage hiérarchique, facturation électronique connectée, assistant
d'import) restent au stade **design/documenté** — non implémentés. Il n'existe
**aucune preuve de marché** (clients, pilotes, LOI). **La valeur défendable
aujourd'hui reste le plancher-milieu de la fourchette (≈150–200 k€) ; 200–250 k€
exige que les conditions listées en §39 soient réellement remplies.**

## 2. État initial
Voir `docs/ACQUISITION_READINESS_AUDIT.md`. Deux dépôts matures (desktop
Electron/Next14/SQLite ; cloud Next15/PostgreSQL) avec un socle sécurité/licences
fort, mais la branche `acquisition-prep` avait perdu des durcissements desktop.

## 3. Branches comparées
`claude/garageflow-production-audit-0qp9ui` ↔ `claude/garageflow-acquisition-prep-914inr`,
sur les **deux** dépôts. Méthode et détail complet : `docs/BRANCH_RECONCILIATION_REPORT.md`.
- **Cloud** : `prod-audit` est ancêtre de HEAD → aucune régression.
- **Desktop** : ancêtre commun `e90b165` ; la consolidation vers `main` n'avait
  pas repris 16 fichiers de durcissement postérieurs.

## 4. Régressions détectées (desktop) — RÉSOLU
Validation d'origine Electron par `startsWith()` (contournable par
`…:PORT@evil.com`) ; **absence** de contrôle HWID à la saisie manuelle de
licence ; upload photo sans limite de taille / MIME dérivé du client / sans
anti-traversée ; IDOR 2nd ordre sur `vehicles/[id]` ; injection d'opérateur
Prisma sur `parts` ; calculs monétaires **flottants** sur `work-orders` ;
décrément de stock non atomique (`suppliers`) ; bypass `NaN` sur `bulk-import` ;
`GF_SIGNATURE_SECRET` faible accepté ; **open redirect** login ; `.env` embarqué
dans le bundle Windows ; métriques hôte visibles inter-tenant ; **117 lignes de
tests supprimées**.

## 5. Régressions corrigées — PREUVES
16 fichiers restaurés à l'identique depuis `prod-audit` (commit
`fix(security): restaure les durcissements…`) + durcissements **nouveaux** :
- **magic bytes** des photos (anti-usurpation de contenu) — `photo-store.ts` ;
- **incrément atomique** de la ligne `jobPart` — `jobs/[id]/parts`.
Preuves : `tsc` exit 0 ; `security-hardening.test.ts` 16/16 ; suite complète
**694/694** (mono-thread). Détail : `docs/BRANCH_RECONCILIATION_REPORT.md`.

## 6. Architecture finale
Inchangée dans sa structure (voir `docs/ARCHITECTURE_OVERVIEW.md`,
`DESKTOP_ARCHITECTURE.md`, `CLOUD_ARCHITECTURE.md`). Desktop Electron + serveur
Next standalone loopback + SQLite ; cloud control-plane Next15 + PostgreSQL.
Compatibilité desktop↔cloud **préservée** (contrats licence/MàJ/crash inchangés).

## 7. Sécurité — PASS (avec réserves documentées)
Restaurée et **renforcée** (voir §4-5). Réserves connues **non corrigées**
(honnêtes, `docs/VULNERABILITY_MANAGEMENT.md`) : TOTP portail en clair au repos ;
clé admin unique (pas d'IAM/MFA/RBAC) ; anti-tamper local JS-only ; avis de
dépendances transitives (`sharp`/libvips, `postcss`). **Aucun audit externe réel
n'a été réalisé** — le produit est *préparé* pour un pentest
(`docs/PENTEST_SCOPE.md` prévu ; voir §19).

## 8. Application Windows — PARTIAL / NON TESTÉ ici
Build web + sortie `standalone` OK. Le **packaging NSIS** (`electron-builder --win`)
et l'installateur **ne sont pas testables** dans cet environnement Linux (exigent
Windows/wine + `keys/public.pem`). **Signature de code : non configurée** — à faire
(certificat OV/EV). `post-build.js` retire désormais les `.env` du bundle.
🪟 Test réel sous Windows requis.

## 9. PWA — PASS (build) / mobile non testé ici
Build cloud OK (exit 0, 19/19 pages). Parcours mobiles réels (iOS/Android) non
exécutés dans cet environnement.

## 10. Base de données — PASS
SQLite desktop / PostgreSQL cloud séparés (variables distinctes). Validation d'env
fail-closed existante. Seed démo vérifié (Garage Demo, 5 mécaniciens, 13 OR).
Migrations desktop non baselinées (limite documentée).

## 11. Multi-garage — DESIGN uniquement
Le modèle opérationnel reste **mono-garage** (un `garageId` par session ; garde FK
`tenant.ts`). **Aucune** hiérarchie Organisation/Réseau n'a été implémentée cette
mission. Architecture cible documentée ; implémentation = chantier non réalisé.
Statut : **NON IMPLÉMENTÉ** (documenté).

## 12. Marque blanche — PARTIAL
Socle typé/validé `brand.ts` (desktop, 8 tests) + `site.ts`/`domains.ts` (cloud).
**Non câblé** dans l'ensemble de l'UI (~146 chaînes littérales restantes). Deux
marques de démo distinctes : **non réalisées**. Statut : socle réel, câblage
incomplet (`docs/WHITE_LABEL_GUIDE.md`).

## 13. Facturation électronique — DESIGN uniquement
**Aucun code** Factur-X/UBL/CII/PDP. Architecture proposée + interface fournisseur
+ limites : `docs/E_INVOICING_ARCHITECTURE.md`, `…LIMITATIONS.md`,
`…PROVIDER_INTEGRATION.md`. **Non connecté**, non testé. Statut : **NON IMPLÉMENTÉ**.

## 14. Imports — DESIGN uniquement
Aucun assistant CSV/XLSX (seul `labor-operations/bulk-import` existe, désormais
borné/validé). Design : `docs/DATA_MIGRATION_GUIDE.md`. Jeu de données massif de
test : non produit. Statut : **NON IMPLÉMENTÉ**.

## 15. API — PARTIAL / démo
`/api/v1` (cloud) reste une **démo en mémoire non persistante**. OpenAPI servi en
direct (`v1/openapi.json`). Persistance DB, webhooks, quotas : **non implémentés**.

## 16. Intégrations — PARTIAL
Intégrations réelles bien abstraites (OCR/plaque/VIN, Copilot agnostique,
e-mail/SMS). Interfaces fournisseur génériques pour comptabilité/catalogue/
e-invoicing : partiellement documentées, non toutes implémentées.

## 17. Licences — PASS (durci)
ECC P-256, HWID (activation **et** saisie manuelle désormais), révocation, sièges
TOCTOU-safe (cloud). Émission = clé privée hors dépôt (P0 transfert).

## 18. Mises à jour — PASS
Manifeste Ed25519, SHA-256 avant exécution, anti-downgrade, allowlist hôtes,
rollback auto planifié (Vercel Cron, `CRON_SECRET` fail-closed, 5 tests). Binaire
Windows non signé (§8).

## 19. Sauvegardes — PARTIAL
Sauvegardes locales 3 niveaux + service chiffré (code) **sans UI**. Test de
restauration réel automatisé : non exécuté cette mission (procédure :
`docs/BACKUP_VERIFICATION.md`). Statut : code présent, restauration non
re-prouvée ce tour.

## 20. Observabilité — PARTIAL
Logger redacting, monitoring hôte/DB, health, audit, crash. Tableau de santé
global consolidé : partiel. Voir `docs/OBSERVABILITY.md`.

## 21. Tests — PASS (périmètre unitaire/intégration)
Desktop **694/694** (mono-thread ; en parallèle, 3 suites d'intégration en *hook
timeout* infra, vertes en isolation). Cloud **140/140**. **Aucun E2E/Playwright**
(non implémenté). Tests de sécurité restaurés + étendus (magic bytes, IDOR,
injection, atomicité, open redirect, HWID, origine Electron).

## 22. Performance — NON MESURÉ
Aucun test de charge exécuté. Analyse + cibles proposées : `docs/PERFORMANCE_REPORT.md`.

## 23. Propriété intellectuelle — PARTIAL
`LICENSE` (2 dépôts) + `THIRD_PARTY_NOTICES` + `IP_ASSET_REGISTER` + `SBOM` +
`OPEN_SOURCE_LICENSE_AUDIT`. Deps directes permissives, aucun GPL/AGPL.
**Assignation de PI = contractuelle** (non établie par le dépôt) — P0.

## 24. Documentation
Data room (22) + buyer package (10) + ~40 docs techniques (tours précédents),
plus `BRANCH_RECONCILIATION_REPORT.md` (ce tour).

## 25. Transférabilité — PARTIAL → améliorée
Runbooks + `TRANSFER_PLAYBOOK.md`. Test de reprise par une **autre équipe** :
**non réalisé** (humain). P0 externes (clés/backend/domaines/PI) = conditions de
closing.

## 26. Data room
Complète et cohérente avec le code (voir §24). Valorisation conditionnelle :
`acquisition-data-room/21_VALUATION_RATIONALE.md`.

## 27. Preuves de marché — AUCUNE (outils préparés)
Aucun client/pilote/LOI. Outils honnêtes préparés :
`docs/MARKET_VALIDATION_PLAN.md`. **Rien n'est inventé.**

## 28. Risques restants
Multi-garage/e-invoicing/import non construits ; API démo ; TOTP clair ; clé admin
unique ; binaire non signé ; pas d'E2E ; migrations desktop non baselinées ; avis
de dépendances transitives ; opérabilité dépendante d'actifs externes.

## 29. Dépendances externes (hors code)
Clés privées de signature ; backend control-plane + base ; domaines `garageflows.fr` ;
cession de PI ; comptes Vercel/Postgres/Redis/Blob/e-mail/SMS ; PDP e-invoicing ;
certificat de signature Windows ; auditeur pentest ; pilotes réels.

## 30. Éléments non testés ici
Packaging/installateur Windows ; comportement HWID/offline réel ; parcours PWA
mobiles ; tests de charge ; restauration de sauvegarde réelle ce tour ; CI
Postgres/Redis (intégration).

## 31. Commandes exécutées (principales, ce tour)
`git fetch/merge-base/diff/checkout` (réconciliation) · `npx tsc --noEmit`
(exit 0) · `npx vitest run` ciblés + complet **mono-thread (694/694)** +
parallèle · `npm run build` (desktop) · `git commit`.

## 32. Résultats exacts
Desktop : **694 tests passés / 0 échec (65 suites)** mono-thread ; `tsc` exit 0 ;
build web exit 0 (voir §7-8 rapport). Cloud (inchangé ce tour) : 140/140, `tsc` 0,
build exit 0 (tour précédent). `security-hardening.test.ts` 16/16.

## 33. Commits créés (ce tour, desktop)
- `fix(security): restaure les durcissements perdus…` (16 fichiers)
- `docs: rapport de réconciliation des branches…`
- `feat(security): validation des magic bytes des photos…`
- `fix(stock): incrément atomique de la ligne jobPart…`
(Tours précédents : marque blanche, verrou 2FA, cron rollback, LICENSE/SECURITY,
data room, rapports.)

## 34. Score de maturité — 60/100
Cœur stable/testé ; leviers P2 non construits ; dette (Electron 31, Next 14/15).

## 35. Score de sécurité — 74/100
Régressions restaurées + durcissements nouveaux (+ vs 72 antérieur). Réserves
réelles (TOTP, IAM admin, DRM JS, avis deps) empêchent un score plus haut.

## 36. Score de transférabilité — 52/100
Réconciliation + runbooks + LICENSE ; mais opérabilité dépend d'actifs externes
non vérifiés et aucune reprise par une autre équipe testée.

## 37. Score de préparation commerciale — 45/100
Data room + buyer package complets ; **zéro** preuve de marché ; P2 non construits.

## 38. Valeur techniquement défendable
**Plancher-milieu ≈ 150–200 k€** aujourd'hui, mieux défendable qu'avant (sécurité
restaurée, transférabilité et lisibilité accrues). **200–250 k€ NON atteint** :
exige les conditions §39.

## 39. Conditions manquantes pour 200–250 k€
1. **Construire réellement** au moins un des grands leviers P2 (multi-garage
   opérationnel **ou** e-invoicing connecté en sandbox **ou** assistant d'import),
   testé de bout en bout.
2. **Signer** le binaire Windows (certificat OV/EV) et tester l'installateur.
3. **Prouver l'opérabilité** end-to-end sans le vendeur (transferts P0 exécutés).
4. **Audit externe** réel (pentest) avec correctifs.
5. **Preuve de marché** réelle (pilotes/LOI) — humaine, non fabriquée.
6. **Reprise testée** par une autre équipe (runbooks exécutés).

## 40. Prochaines actions par impact
1. Sécuriser contractuellement les 4 transferts P0 + démontrer l'opérabilité.
2. Choisir **un** levier P2 et le construire pour de vrai (recommandé :
   e-invoicing sandbox — plus grand risque légal levé, ou multi-garage — plus
   grande valeur roll-up).
3. Certificat de signature Windows + test installateur/MàJ/rollback réels.
4. Chiffrer les TOTP au repos ; IAM admin (MFA/RBAC) ; corriger les avis de
   dépendances puis rendre le gate CI bloquant.
5. E2E Playwright sur les parcours critiques ; baseline des migrations desktop.
6. Lancer le plan de validation marché (`MARKET_VALIDATION_PLAN.md`).

---

## Grille de validation finale (§31 de la mission)
| Élément | Statut |
|---|---|
| Faille critique connue | **PASS** (aucune non documentée ; régressions restaurées) |
| Accès inter-garage (IDOR) | **PASS** (garde FK + fix vehicles ; tests) |
| Secret embarqué | **PASS** (aucun commité ; `.env` retiré du bundle) |
| Licence contournable | **PARTIAL** (HWID activation+saisie ; DRM local JS = soft) |
| Mise à jour non vérifiée | **PASS** (Ed25519 + SHA-256) |
| Corruption de données | **PASS** (stock atomique, quarantaine DB, transactions) |
| Restauration impossible | **NOT TESTED** (ce tour ; procédure documentée) |
| Installateur inutilisable | **NOT TESTED** (🪟 Windows requis) |
| Build impossible | **PASS** (web/PWA exit 0) |
| Migration incohérente | **PARTIAL** (fonctionne ; baseline desktop à faire) |
| Calcul financier incorrect | **PASS** (centimes entiers ; work-orders corrigé) |
| **Niveau 100–150 k€** (stabilité, sécurité, tests, doc, install, transfert) | **PASS** technique (install/transfert = procédures) |
| **Niveau 150–200 k€** (multi-garage, marque blanche, import, API, sauvegarde prouvée, audit préparé) | **PARTIAL** (marque blanche socle ; multi-garage/import = design ; sauvegarde non re-prouvée) |
| **Niveau 200–250 k€** (audit externe réel, e-invoicing connecté, Windows signé, reprise testée, 5 pilotes réels, LOI, partenariat) | **FAIL / BLOCKED** (aucune preuve commerciale ; P2 non construits) |

**Le niveau 200–250 k€ n'est PAS atteint** : les preuves commerciales humaines et
les fonctionnalités P2 réelles n'existent pas. Ne jamais le présenter comme acquis.

---
_Voir aussi : `docs/BRANCH_RECONCILIATION_REPORT.md`,
`docs/ACQUISITION_READINESS_AUDIT.md`,
`docs/acquisition-data-room/21_VALUATION_RATIONALE.md`._
