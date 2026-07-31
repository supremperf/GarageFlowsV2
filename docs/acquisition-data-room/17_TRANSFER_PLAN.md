# 17 — Plan de transfert (synthèse data room)

_Document de data room M&A. Vérifié de première main le 2026-07-31. Synthèse du [Playbook de transfert complet](../TRANSFER_PLAYBOOK.md)._

> Message clé : **le code source est nécessaire mais non suffisant.** Les blocages de reprise ne sont pas du code — ce sont **quatre transferts d'actifs externes** absents du dépôt, à traiter en **conditions suspensives écrites et vérifiées** avant paiement. Le playbook détaillé donne les commandes, la recréation d'infra et le plan 30/60/90 jours.

## 1. Les 4 blocages P0 (conditions de closing)

| P0 | Actif à transférer | Pourquoi bloquant | Action |
|---|---|---|---|
| P0-1 | **Les 2 clés privées de signature** — licence ECC/ECDSA P-256 (`keys/private.pem`, gitignored) + update Ed25519 (env serveur) | Sans elles : aucune licence émise, aucune update signée publiable (le client refuse un manifeste non signé) | Séquestre au closing **ou** re-keying (§3) ; vérifier correspondance clé publique embarquée ↔ clé privée reçue |
| P0-2 | **Backend control-plane + base PostgreSQL** (garagesite3 déployé) | Activation/heartbeat/révocation/crash/release y transitent | Transférer le projet Vercel ou re-déployer ; export/import Postgres ; rebasculer les secrets |
| P0-3 | **Domaines garageflows.fr** (DNS + hébergement) | Codés en dur dans allowlists update/download et endpoints licence | Transfert registrar + DNS ; à défaut, rebrand domaine → **rebuild + re-signer** les clients |
| P0-4 | **Cession de PI écrite** (chain-of-title) | Aucune cession in-repo inspectable | Cession couvrant les 2 bases de code **et** tous les assets `public/`, en condition de closing |

Un `LICENSE` et un `SECURITY.md` ont été ajoutés cette session dans les deux dépôts, mais la **cession contractuelle** reste à établir.

## 2. Recréation d'infrastructure (résumé)

| Composant | Source de vérité | Note |
|---|---|---|
| Control-plane cloud | `garagesite3` (Next.js 15) / Vercel | `vercel.json` planifie le cron d'auto-rollback horaire (fail-closed `CRON_SECRET`) |
| Base cloud | PostgreSQL | **Reproductible** : `prisma/server/migrations` (4 migrations + `migration_lock.toml`) |
| Redis | Upstash | **Requis en prod** ; rate limiting fail-closed 503 si indisponible |
| Blob installeurs | Vercel Blob | `BLOB_READ_WRITE_TOKEN` requis sinon 501 |
| Base desktop | SQLite (template committé) | ⚠️ **Non reproductible depuis migrations** — repose sur `db push` + template. À baseliner |

Validation d'env prod : le boot **refuse de démarrer** si secrets manquants/faibles (`src/lib/env.ts`).

## 3. Option de re-keying (recommandée si séquestre incertain)

Générer de nouvelles paires ECC P-256 (licence) + Ed25519 (update) → remplacer les clés **publiques** embarquées → rebuild + re-signer le client → déployer les clés **privées** côté control-plane. Coupe toute dépendance au vendeur pour la signature (au prix d'un rebuild et d'une ré-émission des licences existantes).

## 4. Validation E2E — prouver la reprise **sans le vendeur**

L'acquéreur doit prouver indépendamment :
1. **Émettre une licence** (admin → token `GF2.*` valide, nécessite `keys/private.pem`).
2. **Activer un device** (vérif ECDSA contre clé publique embarquée, sièges appliqués).
3. **Signer une update** (manifeste Ed25519 ; desktop vérifie signature + SHA-256 **avant** exécution).
4. **Heartbeat + révocation** (device révoqué → bloqué en ~20 s, sans verrouiller un offline légitime).
5. **Rollback** (crashs > seuil → cron horaire déclenche l'auto-rollback).

Si ces 5 étapes passent sans le vendeur, la reprise opérationnelle est **prouvée**.

## 5. Plan 30 / 60 / 90 jours (résumé)

- **0–30 j — Opérabilité (P0)** : exécuter les 4 transferts (ou re-keying) ; recréer l'infra ; valider le boot fail-closed ; **réaliser la validation E2E §4 sans le vendeur** ; établir accès admin + rotation secrets + backup Postgres.
- **31–60 j — Risques P1** : baseliner les migrations desktop ; certificat de signature de code Windows ; rendre bloquant l'audit deps garagesite3 ; câbler les UI manquantes (backup/monitoring) ; décider du sort de l'API `/api/v1`.
- **61–90 j — Valeur** : cadrer/chiffrer l'e-invoicing (obligation B2B 2026-2027) ; ré-architecturer le verrou 72 h ; bâtir l'E2E (Playwright) ; IAM admin réel ; câbler le white-label ; outil d'import.

## 6. Caveats de transfert

Existence/validité/propriété des clés privées et du backend **non vérifiées** ; propriété des domaines **non vérifiée** ; état de déploiement prod réel **non observé** ; fondamentaux business **hors périmètre**.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md) et le [Playbook de transfert complet](../TRANSFER_PLAYBOOK.md)._
