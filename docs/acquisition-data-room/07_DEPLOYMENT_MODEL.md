# 07 — Modèle de déploiement

## 1. Deux chaînes de déploiement distinctes

| Artefact | Cible | Chaîne |
|---|---|---|
| Application desktop | Poste Windows du garage | Build electron-builder → installeur NSIS x64 → distribution + auto-update signé |
| Control-plane / PWA | Cloud serverless | Déploiement Vercel (Next.js) + Postgres + Upstash + Blob |

## 2. Build & distribution desktop

- **Cible unique** : Windows `nsis` **x64**. Aucune cible arm64/macOS/Linux, bien que le code d'update référence `.dmg/.deb/.AppImage`.
- **Packaging** correctement câblé : `output:'standalone'`, `post-build.js` copie les assets, le moteur Prisma et le template DB ; `asarUnpack` pour le query engine Windows.
- **Étape de keygen requise** : le build a besoin de `keys/public.pem`. Le répertoire `keys/` est gitignored ; `post-build.js` **avertit seulement** (n'échoue pas) si `public.pem` est absent → un build naïf peut livrer une vérification de licence dégradée.
- **Auto-update** : manifeste signé Ed25519 servi par le control-plane, vérification SHA-256 avant exécution, anti-downgrade, allowlist d'hôtes (voir `04_TECHNICAL_ARCHITECTURE.md` §5).

### Signature de code — NON configurée (P1)
Le bloc electron-builder définit `requestedExecutionLevel` et des options NSIS mais **aucun certificat** de signature (`certificateFile`/`cscLink`/`signtool`/`publisherName`). Conséquence : chaque installation déclenche des avertissements SmartScreen/Defender « éditeur inconnu ». À procurer (OV/EV) et câbler avant go-to-market.

## 3. Déploiement cloud (control-plane / PWA)

- Cible **Vercel serverless**. Validation d'environnement **fail-closed** en prod (refus de démarrer sans les secrets requis).
- Dépendances managées : PostgreSQL, Upstash Redis (rate limit fail-closed), Vercel Blob (installeurs).
- **Cron auto-rollback** : ajouté cette session (Vercel Cron + auth `CRON_SECRET` fail-closed). Sans lui, l'auto-rollback ne se déclenche pas automatiquement.
- Limitations serverless connues : durée SSE limitée (fallback polling), rate-limit `/api/v1` en mémoire par-instance, store `/api/v1` non persistant.

## 4. Bloqueurs P0 — transferts d'actifs EXTERNES (pas du code)

Le déploiement de bout en bout est **impossible pour l'acquéreur sans transfert d'actifs externes absents du dépôt** :

1. **Clés privées de signature** — licence ECC/ECDSA P-256 **et** update Ed25519. Server-side uniquement (`keys/private.pem` gitignored ; clé update = variable d'env serveur). **Sans elles, aucune licence ne peut être émise et aucune mise à jour signée publiée.**
2. **Backend control-plane + base de données** — activation, heartbeat, révocation, crash reporting, publication de releases, service des manifestes signés y transitent (`api.garageflows.fr`).
3. **Domaines garageflows.fr + DNS + hébergement** — codés en dur dans les allowlists d'update/téléchargement et les endpoints de licence.

> Ces trois éléments sont des **transferts d'actifs**, pas des tâches de code. Ils doivent être des **conditions suspensives de closing**, vérifiées avant la cession. **Test d'acceptation recommandé :** l'acquéreur doit pouvoir, de façon indépendante, (a) émettre une licence et (b) signer une mise à jour de bout en bout.

## 5. État de la production — NON vérifiable

L'état de déploiement réel sur Vercel (planification cron, configuration d'environnement, présence des clés de signature côté serveur) **n'a pas pu être observé** — seuls la source et l'absence de `vercel.json` d'origine ont été confirmés. Diligence complémentaire requise auprès du vendeur.

## 6. Reproductibilité

- **Desktop** : schéma **non reproductible depuis les migrations** (pas de baseline init). Repose sur `db push` + template DB committé → à baseliner post-acquisition.
- **Cloud + miroir serveur** : migrations ordonnées + `migration_lock.toml` présents → reproductibles.
- Pas de champ `engines` (version Node non contrainte) dans les deux `package.json` → risque de reproductibilité de build à corriger.

## 7. Checklist de transfert de déploiement (résumé)

- [ ] Clés privées licence + update remises et vérifiées.
- [ ] Backend control-plane + DB transférés / réhébergés.
- [ ] Domaines garageflows.fr + DNS transférés.
- [ ] Certificat de signature de code Windows procuré et câblé.
- [ ] Keygen `keys/public.pem` documenté et exécuté.
- [ ] Cron auto-rollback configuré avec `CRON_SECRET`.
- [ ] Test d'acceptation : émission de licence + signature d'update de bout en bout par l'acquéreur.

Voir aussi `docs/TRANSFER_PLAYBOOK.md`.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
