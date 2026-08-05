# Récupération après la rotation totale des secrets Production

> À lire AVANT tout redéploiement réussi. La rotation du 2026‑08‑04 a remplacé,
> dans Vercel Production, des clés « au repos » **sans procédure de migration**.
> Tant qu'aucun build n'a réussi, la production tourne encore sur l'ancien build
> (les variables Vercel sont figées au build) — donc **rien n'est cassé pour
> l'instant**, mais un redéploiement direct casserait les données ci‑dessous.

## 1. Impact par clé (source : `docs/ROTATION_SECRETS.md` + code)

| Clé rotée | Casse | Réparable ? |
|---|---|---|
| `GF_DB_MAC_SECRET` | Tous les `recordMac` invalides → `license/check` & `license/activate` bloquent **toutes** les licences (`tampered`) | **OUI** — re‑MAC (script ci‑dessous) |
| `DEVICE_TOKEN_PEPPER` | Tous les hachages d'appareil invalides → ré‑activation forcée + inflation de sièges | **OUI** — reset appareils (`--reset-devices`) |
| `GF_SMTP_CIPHER_KEY` | `smtpPass` chiffrés illisibles | Partiel — voir §4 |
| `GF_TOTP_ENC_KEY` | Secrets 2FA du portail illisibles | Non — ré‑inscription 2FA |
| `GF_BACKUP_KEY` | Anciennes sauvegardes irrécupérables | Non (si l'ancienne clé est perdue) |
| Paire ECDSA de licence (`GF_PRIVATE_KEY` + `keys/`) **nouvelle**, mais `public-key.ts` **remis à l'ancienne** | Incohérence signature/vérification | Décision — voir §3 |

## 2. Réparation `recordMac` + appareils (automatisable, sûre)

Exécuter UNE fois, localement, contre la base Neon de production, avec les
**nouvelles** valeurs en variables d'environnement :

```bash
# 1) Vérifier (dry-run, n'écrit rien)
DATABASE_URL="postgresql://…neon…" GF_DB_MAC_SECRET="<nouvelle>" \
  node scripts/repair-after-secret-rotation.js

# 2) Appliquer (re-MAC de toutes les licences)
DATABASE_URL="postgresql://…neon…" GF_DB_MAC_SECRET="<nouvelle>" \
  node scripts/repair-after-secret-rotation.js --yes

# 3) Si DEVICE_TOKEN_PEPPER a aussi été roté : réinitialiser les appareils
DATABASE_URL="postgresql://…neon…" GF_DB_MAC_SECRET="<nouvelle>" \
  node scripts/repair-after-secret-rotation.js --yes --reset-devices
```

- Le re‑MAC recalcule chaque `LicenseKey.recordMac` avec le `GF_DB_MAC_SECRET`
  courant → les licences repassent valides. **Idempotent**, n'écrit aucun secret.
- `--reset-devices` passe les appareils `active` → `deactivated` (sièges libérés) ;
  chaque machine se ré‑active proprement (nouveau hachage avec le nouveau pepper).
- Le calcul du MAC est **prouvé identique** à `src/lib/license/record-mac.ts` par
  `src/lib/__tests__/remac-script-parity.test.ts` (échec CI si divergence).

Ordre recommandé : lancer le re‑MAC **juste après** un redéploiement réussi (bref
créneau où les licences sont bloquées), ou **avant** en pointant sur la même base.

## 3. Paire de clés de licence (ECDSA) — DÉCISION requise

Roter la paire de licence est la plus destructrice : la signature est **dans le
jeton** de chaque licence émise ; une nouvelle clé publique **n'accepte plus les
anciens jetons** (aucun re‑MAC possible). Deux états cohérents :

- **(Recommandé) Revenir à l'ANCIENNE paire** — préserve toutes les licences déjà
  émises. `public-key.ts` et `electron/main.js` sont **déjà** sur l'ancienne clé
  (empreinte `7bed3cb7…478`) suite au rollback ; il faut **remettre `GF_PRIVATE_KEY`
  (Vercel) et `keys/private.pem` + `keys/public.pem` à l'ANCIENNE valeur** (dossier
  de rapport `…\API générées\…` ou votre ancienne sauvegarde `keys/`).
- **Adopter la NOUVELLE paire** — uniquement si vous voulez **invalider et ré‑émettre
  TOUTES** les licences clients. Alors : réappliquer la **nouvelle** clé publique à
  `public-key.ts` + `electron/main.js`, mettre à jour l'empreinte attendue dans
  `scripts/check-critical-files.js` et `public-key-consistency.test.ts`, redéployer,
  puis ré‑émettre chaque licence.

Le garde `scripts/check-critical-files.js` bloquera un redéploiement dont la clé
publique ne serait pas l'empreinte canonique — c'est voulu.

## 4. SMTP / 2FA / Sauvegardes

- **SMTP** : si vous disposez de l'ANCIENNE `GF_SMTP_CIPHER_KEY`, définissez
  `GF_SMTP_CIPHER_KEY_OLD=<ancienne>` (rotation supportée par
  `src/lib/security/secret-cipher.ts`) puis lancez `node scripts/encrypt-smtp-secrets.js --rotate`
  pour ré‑chiffrer avec la nouvelle. Sinon, chaque garage devra re‑saisir son mot de
  passe SMTP dans Paramètres › Email.
- **2FA portail** : les secrets TOTP chiffrés avec l'ancienne `GF_TOTP_ENC_KEY` sont
  perdus → demander aux utilisateurs concernés de **ré‑activer la 2FA**.
- **Sauvegardes** : les archives chiffrées avec l'ancienne `GF_BACKUP_KEY` ne sont
  restaurables **que** si vous conservez l'ancienne clé.

## 5. Rappel — le build échouait sur une injection locale

L'échec Vercel (`Cannot find name 'seats'` à `license/activate/route.ts:203`)
venait d'un `console.info(… seats …)` **injecté par le script de rotation** dans le
bloc mécanicien, où `seats` n'existe pas (la valeur littérale `seats: 1` est passée
à `activateDevice`). La branche committée **compile proprement**. Correctif local :
remplacer `seats` par `seats: 1` dans ce `console.info`, ou
`git restore src/app/api/license/activate/route.ts`.
