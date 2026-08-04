# GarageFlow — Matrice de décision de la fusion finale

Méthode : **base = hardening**, `mechanic` traitée comme branche de fonctionnalité,
fusion 3-way depuis l'ancêtre commun `main`. Chaque fichier est **comparé et fusionné**,
jamais copié en bloc. Règle absolue : ne jamais rétrograder une protection hardening.

Légende « Version finale » : **H** = version hardening conservée ; **M** = version mechanic
portée ; **F** = fusion (les deux combinées) ; **F+C** = fusion puis correction.

## A. Fichiers modifiés dans les DEUX branches (fusion ligne-à-ligne)

| Fichier | Hardening | Mechanic | Version finale | Justification | Tests |
|---|---|---|---|---|---|
| `src/middleware.ts` | Ordre **NextAuth-first** (boucles /login corrigées) | Ordre licence-avant-auth (régressif) + confinement `typ=mechanic` | **F** | On garde l'ordre hardening ; on greffe UNIQUEMENT la classe de session mécanicien (auto-portante, sans NextAuth) confinée à `/mechanic`, insérée après lecture NextAuth mais avant l'exigence d'auth. Jamais de retour à « licence avant NextAuth ». | `src/__tests__/middleware.test.ts` (+ tests confinement à ajouter) |
| `electron/main.js` | IS_DEV packagé, intégrité, fuses, nav-guard, endpoint licence, état signé, clé publique canonique | +52 lignes : `createGfSessionJwt(extra)`, `establishMechanicSession()` | **F** | Auto-merge purement **additif** (revendications gid/mid/did + session mécanicien mono-poste, fail-closed). Toutes les protections hardening intactes (vérifié byte-à-byte). | `public-key-consistency.test.ts` |
| `prisma/schema.prisma` (SQLite) | modèles durcis | `JobPhoto.mechanicId`, champs mechanic `LicenseKey`, 3 modèles mechanic | **F+C** | Auto-merge additif ; audit corrigé (§6) ; relations FK ajoutées (§5). | `prisma validate` |
| `prisma/server/schema.prisma` (PG) | idem serveur | idem | **F+C** | Synchronisé avec le schéma desktop. | `prisma validate --schema` |
| `src/lib/migrations.ts` | migrations 120-129 (index UNIQUE, RepairTypePart, Part/JobPart) | migrations mechanic 120-138 | **F+C** | Les deux ensembles conservés ; mechanic **renumérotée 130-149** pour éviter la collision d'`id`. Aucune migration hardening supprimée. | `prisma validate` + migration base vide/existante |
| `scripts/keygen_db.py` | `chmod 0o600` sur la config serveur | `audit_log()` local | **F** | Les deux ajouts conservés (durcissement permissions ET journal d'audit). | `scripts/test_keygen.py` |
| `scripts/keygen_ui.py` | `main()` robuste (superset de `App().mainloop()`) + `import sys` | `App().mainloop()` + `import os` | **F** | On garde le point d'entrée hardening (superset : lance bien `App().mainloop()` avec gestion Tk indisponible) + les deux imports. | `scripts/test_keygen.py` |
| `scripts/keygen.py` | (durcissements) | (ajouts mechanic) | **F** | Auto-merge additif (aucune ligne retirée). | `scripts/test_keygen.py` |

## B. Fichiers UNIQUEMENT dans hardening → **conservés par défaut (H)**

Toutes les protections hardening (104 fichiers touchés) sont conservées telles quelles.
Points clés vérifiés non-régressés : `electron/license-endpoint.js`,
`electron/signed-state.js`, `electron/nav-guard.js`, `electron/integrity.js`,
`scripts/fuse-config.js`, `src/lib/security/secret-cipher.ts`,
`scripts/encrypt-smtp-secrets.js`, `src/lib/license/public-key.ts`,
`src/lib/auth.ts`, `src/lib/security/rate-limit.ts`, `src/app/api/garages/route.ts`
(exclut `smtpPass`). → voir `FINAL_UNIFIED_GARAGEFLOW_REPORT.md §5`.

## C. Fichiers UNIQUEMENT dans mechanic → **portés (M), puis corrigés (C)**

| Fichier / groupe | Version finale | Corrections appliquées |
|---|---|---|
| `src/lib/license/mechanic-session.ts` | M | Déjà deny-by-default ; F1 (rejet MAC absent) présent — conservé. |
| `src/lib/license/record-mac.ts` | M | Couvre `mechanicId`/`parentLicenseId` ; conservé. |
| `src/lib/license/mechanic-admin.ts` | M+C | Ajout `getMaxMechanicKeys()` (Zod), `MechanicKeyCapError`, `MechanicConfigError` (§4). |
| `src/app/api/mechanic-licenses/route.ts` | M+C | Plafond **atomique** (transaction + verrou consultatif PG) + validation env (§4). |
| `src/app/api/mechanic-licenses/[lid]/status/route.ts` | M+C | **Révocation irréversible** (§2) + audit acteur/cible (§6). |
| `src/app/api/mechanic-licenses/[lid]/disconnect/route.ts` | M+C | Audit acteur/cible (§6) ; déconnexion ≠ révocation (déjà correct — conservé §3). |
| `src/app/api/mechanic-licenses/[lid]/assign/route.ts` | M+C | Audit acteur/cible (§6) ; déjà transactionnel. |
| `src/app/api/mechanic-licenses/[lid]/token/route.ts` | M+C | **GET→POST + réauthentification + no-store** (§9) + audit acteur/cible (§6). |
| `src/app/api/mechanic/jobs/[id]/timer/route.ts` | M+C | Écriture **atomique** re-scopée + garde optimiste (§7) ; **pas d'auto-clôture** (§8). |
| `src/app/api/mechanic/jobs/[id]/notes/route.ts` | M+C | Re-vérif de propriété atomique à l'écriture (§7). |
| `src/app/api/mechanic/jobs/[id]/checklist/[itemId]/route.ts` | M+C | Re-vérif de propriété atomique à l'écriture (§7). |
| `src/lib/mechanic-api.ts` | M+C | `logMechanicAction` → colonnes acteur/cible (§6). |
| `src/app/api/license/activate/route.ts` | M+C | Audit d'activation mécanicien → acteur/cible (§6). |
| `src/app/api/mechanic/logout/route.ts` | M+C | Audit de déconnexion → acteur/cible (§6). |
| `src/lib/authz.ts`, `src/lib/mechanic-photo.ts`, pages `src/app/mechanic/**`, `src/components/settings/MechanicAccessTab.tsx` | M | Portés ; `MechanicAccessTab` mis à jour pour le token POST (§9). |

## D. Nouveaux fichiers hors-mechanic touchés par une correction

`src/lib/types.ts`, `src/lib/utils.ts`, `src/lib/schemas/index.ts`,
`src/components/ReceptionBoard.tsx`, `src/components/job-modal/JobScheduleSection.tsx`,
`src/lib/i18n/ui.ts`, `src/lib/i18n/labels.ts`, `src/lib/portal/repair-timeline.ts` :
enregistrement du statut intermédiaire `awaiting_validation` (§8) dans TOUS les
consommateurs de statut afin de garantir **aucune régression** (aucune intervention
masquée d'un tableau, aucun libellé/couleur indéfini, aucun 400 Zod).
