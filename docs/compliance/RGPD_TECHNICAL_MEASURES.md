# Mesures techniques RGPD (art. 32) — état factuel

Ce document décrit les mesures TECHNIQUES en place, testées ou documentées.
Il ne constitue PAS une déclaration de conformité juridique : registre art. 30
(projet : `docs/legal/RGPD_REGISTRE_TRAITEMENTS.md`), DPA, politiques et
qualification des bases légales = **conseil/DPO** (validation externe).

## En place et vérifié (tests/gardes cités)

| Mesure | Preuve |
|---|---|
| Cloisonnement strict par garage (multi-tenant) | matrice de permutation 63 tests + audit statique 141 routes (0 faille) |
| Contrôle d'accès par rôles, deny-by-default | matrice 128 cellules testée (`authz-full-matrix`) |
| Mots de passe hachés (bcrypt, coût 12) | code + seed ; jamais en clair |
| Sessions signées, secret fail-closed | démarrage refusé sans secret fort (observé V13) |
| Chiffrement des identifiants tiers (e-invoicing) | AES-256-GCM versionné (`credentials-cipher`, testé) |
| Sauvegardes chiffrées + restauration prouvée | `restore-roundtrip.test.ts` |
| Logs sans données sensibles (redaction) | `logger.ts`/`redact.ts` (testés) |
| Minimisation des flux (aucun tiers analytique) | CSP `connect-src 'self'` (testée) |
| Liens portail à capacité signée, expiration | tests portail (cloisonnement, expiration) |
| Journal d'audit acteur/action/cible | `AuditLog` + `logAudit` sur les routes sensibles |
| Rate limiting distribué fail-closed (anti-abus) | preuve multi-instance Redis réel |
| Intégrité des documents signés (sceau HMAC) | tests signature (auto-invalidation) |

## Droits des personnes — état technique

| Droit | État |
|---|---|
| Accès / portabilité | exports garage existants (données métier) ; export « par personne » à assembler (procédure documentée, outillage partiel) |
| Rectification | CRUD complet côté staff |
| Effacement | suppression client/portail possible ; **conflit conservation comptable géré par principe** : les documents (devis/factures, snapshots) sont conservés la durée légale, le dossier client est supprimable/anonymisable — l'ANONYMISATION AUTOMATISÉE reste à implémenter |
| Limitation / opposition | organisationnel (pas d'outillage dédié) |

## Rétention

- Documents comptables : durée légale (≥ 10 ans) — jamais supprimés par l'app.
- `AuditLog` / `NotificationLog` / logs : **durées à paramétrer** (recommandation :
  12 mois audit, 6 mois notifications, à faire valider par le DPO).

## Violations de données

Dossier technique préparé par `INCIDENT_RESPONSE.md` (chronologie, preuves,
périmètre) ; la notification CNIL/personnes (72 h) est une décision
juridique (DPO).
