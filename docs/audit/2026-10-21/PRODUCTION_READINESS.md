# PRODUCTION_READINESS — 2026-10-21

## 1. Verdict

**NO-GO pour une mise en production certifiée**, inchangé depuis le
2026-10-17. Le code est dans un état nettement mieux prouvé : suite complète
sans échec (comptes dans `TEST_RESULTS.md`), PostgreSQL et Redis réels, OCR
réel, interface du keygen rendue.
Mais les preuves exigées pour la production ne peuvent pas être produites dans
ce conteneur : installateur Windows, rotation des secrets exposés, licences de
l'autorité réelle, e-facturation interconnectée.

## 2. Domaines

| Domaine | État | Preuve |
|---|---|---|
| Code source (tsc, ESLint) | VALIDÉ | 0 / 0 |
| Dépendances | VALIDÉ | `npm audit` : 0 |
| Backend et API | VALIDÉ | suites vertes ; balayage des 169 routes sans session |
| Base de données | VALIDÉ | 22 migrations sur PostgreSQL vierge ; concurrence réelle |
| Relations métier (client, véhicule, intervention, devis, facture, stock) | VALIDÉ (API) | `scenario-maitre`, `business-workflow-e2e` |
| Stock | VALIDÉ | défaut de concurrence SQLite **corrigé** |
| Facturation (calculs, numérotation, immutabilité) | VALIDÉ | tests au centime, 50 numéros parallèles |
| Paiements | **NON APPLICABLE** | aucun module de paiement dans le produit |
| Facturation électronique | NON VALIDÉ | aucune interconnexion, conformité non vérifiée |
| Licences et HWID | VALIDÉ (clés de test) / BLOQUÉ (autorité réelle) | — |
| Cryptographie des mises à jour | VALIDÉ (clés de test) | — |
| Scan des captures | VALIDÉ | défaut OCR **corrigé** |
| Build Next | VALIDÉ | build d'empaquetage + `verify:standalone` |
| Serveur empaqueté (composant) | VALIDÉ | démarrage, auth, persistance sous Linux |
| Setup.exe, installation Windows | BLOQUÉ | pas de Windows, Electron non téléchargeable |
| Frontend navigateur authentifié | BLOQUÉ | licence signée requise |
| Rotation des secrets, Vercel, Neon, Upstash | BLOQUÉ | aucun accès |
| Performances | VALIDÉ (budget bundle) / NON TESTÉ (charge) | — |

## 3. Tests

- Réussis : 4 376 vitest, 483 Node, 171 Python (20 + 10 + 88 + 39 + 14),
  54 Playwright, plus les contrôles de `TEST_RESULTS.md` §3 et le rejeu des
  étapes de la CI (§4), Gitleaks compris.
- Échoués à la fin de la session : **0**. Trois défauts réels ont échoué puis
  été corrigés (GF-1021-01, GF-1021-02, et GF-1021-07 révélé par la CI).
- Ignorés ou bloqués : 7 vitest (clé privée, build Windows), 90 Playwright
  (session licenciée), packaging et installation Windows.

## 4. Actions obligatoires avant déploiement

1. Sur Windows : `npm install`, `npm run dist`, puis la matrice
   d'installation, de mise à jour et de désinstallation (`EXTERNAL_BLOCKERS.md`
   n° 1), avec signature Authenticode (n° 2).
2. Rejouer les 7 tests ignorés avec la clé de l'autorité :
   `keys/private.pem` sur le poste de build et `GF_TEST_LICENSE`.
3. Rotation des secrets exposés historiquement, selon `docs/ROTATION_SECRETS.md`
   (Vercel, Neon, Upstash), migration `GF_SMTP_CIPHER_KEY` comprise.
4. E2E authentifié contre la PWA de production avec un compte jetable.
5. Facturation électronique : comptes de test de plateforme, validation
   XSD / Schematron officielle, avis d'un spécialiste de la conformité.
6. Décision produit sur les paiements : ne pas annoncer de suivi des paiements
   tant qu'il se résume à un statut de facture.

## 5. Risques résiduels

Voir `AUDIT_SECURITY.md` §6 et `EXTERNAL_BLOCKERS.md`.
