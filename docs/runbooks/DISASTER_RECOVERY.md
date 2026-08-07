# Runbook — Disaster Recovery (GarageFlows)

## 1. Objectifs (CIBLES, non encore validées par exercice réel)

| Métrique | Cible | Statut |
|---|---|---|
| RPO (perte de données max.) | ≤ 24 h (intervalle de sauvegarde) — ≤ 5 min si le fournisseur PG gère le PITR | **objectif** |
| RTO (durée de reprise) | ≤ 1 h (restauration + bascule) | **objectif** |

Ces valeurs deviennent des engagements **uniquement après un exercice de
restauration chronométré sur l'infrastructure réelle** (validation externe).

## 2. Quoi sauvegarder

| Actif | Mécanisme | Où c'est outillé |
|---|---|---|
| PostgreSQL serveur | `pg_dump -Fc` quotidien + PITR fournisseur si dispo | procédure §3 ; runbook migration §1 |
| SQLite desktop (par garage) | sauvegardes chiffrées intégrées + vérification | module backup (`src/lib/backup/`) — **restauration prouvée par test** (round-trip réel, AUD-017) |
| Photos/actifs (`GF_PHOTOS_DIR`) | copie fichier (rsync/snapshot) alignée sur la base | à câbler sur l'hébergement |
| Secrets/config | manifeste d'env (`garageflow-env-manifest.json`) + coffre opérateur | jamais dans les sauvegardes applicatives |
| Redis (rate-limit) | AUCUNE sauvegarde nécessaire (données éphémères ; fail-closed si absent) | — |

## 3. Restauration PostgreSQL (procédure)

```bash
pg_restore --list backup.dump | head                # 1. la sauvegarde se lit
createdb -T template0 gf_restore                    # 2. base de reprise NEUVE
pg_restore -d "$RESTORE_URL" backup.dump            # 3. restaurer HORS production
node scripts/validate-server-db.js                  # 4. intégrité (env pointé sur gf_restore)
# 5. contrôles métier : comptes par table, dernière facture, compteurs
# 6. bascule DNS/env vers la base restaurée ; l'ancienne reste en lecture
```

Ne jamais restaurer PAR-DESSUS la base vivante ; toujours dans une base de
reprise, puis basculer.

## 4. Reprise desktop (garage isolé)

L'app Electron restaure depuis ses sauvegardes chiffrées locales (interface
admin → sauvegardes → vérifier puis restaurer). Preuve automatisée :
`restore-roundtrip.test.ts` (backup → corruption → restauration exacte).

## 5. Scénarios de perte totale

1. **Base serveur perdue** : §3, RPO = dernière sauvegarde.
2. **Hébergeur indisponible** : redéploiement (Vercel/équivalent) depuis le
   dépôt + env recréé depuis le manifeste + restauration §3.
3. **Poste garage perdu** : réinstallation + restauration de la sauvegarde
   locale (ou du serveur si mode connecté).

## 6. Exercices

Un exercice de restauration complet (chronométré, documenté) doit être exécuté
sur l'infrastructure réelle **avant** tout engagement contractuel de RPO/RTO —
voir `EXTERNAL_VALIDATIONS`.
