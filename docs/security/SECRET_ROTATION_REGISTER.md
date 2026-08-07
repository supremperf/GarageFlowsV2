# Registre de rotation des secrets — GarageFlows

Règle absolue : **un secret apparu dans l'historique git est compromis tant
qu'une preuve de rotation n'existe pas** (`npm run verify:rotation` compare les
empreintes SHA-256 des secrets ACTUELS au manifeste des valeurs compromises —
sans jamais afficher une valeur). Aucun secret n'est reproduit ici : formes
masquées uniquement.

## 1. Secrets compromis connus (historique git — scan gitleaks 8.24.3 complet du 2026-08-07)

| # | Secret | Où (historique) | Classement | État |
|---|---|---|---|---|
| 1 | `GARAGEFLOW_API_KEY` (44 car., `59ca…`) | anciens `.env.example`, `keys/server_config.json` (V2) | **vrai secret** | COMPROMIS — rotation opérateur requise + preuve `verify:rotation` |
| 2 | `NEXTAUTH_SECRET` (même valeur que #1) | idem | **vrai secret** | COMPROMIS — rotation distincte requise (invalide les sessions) |
| 3 | Jeton de licence JWT | `keys/licenses_db.json` (V2, commits `76fc6d86`, `0f519f04`) | **jeton signé historique** | la clé PRIVÉE ECDSA n'a jamais été dans le dépôt ; jetons concernés à révoquer côté control-plane s'ils correspondent à des licences réelles |
| 4 | Clés d'API vitrine | anciens `.env.local` (site3, 5 commits) | **vrais secrets** | COMPROMIS — rotation opérateur (admin key, SSE, Upstash…) |

Empreintes de référence : `scripts/compromised-secrets.json` (préfixes SHA-256,
jamais de valeurs). Sources détaillées : `docs/SECRETS_ROTATION.md` /
`ROTATION_SECRETS.md`.

## 2. État des fichiers suivis et de l'arbre courant (2026-08-07)

- `git archive HEAD` (fichiers suivis, 2 dépôts) : **0 fuite**.
- Arbre de travail : 14 alertes, toutes dans `.next/` (artefacts de build non
  suivis, clés preview aléatoires par build) → **faux positifs classés**.
- CI : scan gitleaks de l'arbre à chaque push (job `secrets`).

## 3. Procédure de rotation (par secret)

1. Générer la nouvelle valeur (`openssl rand -base64 32`) hors dépôt.
2. La poser dans l'environnement d'exécution (jamais dans git).
3. `npm run verify:rotation` → doit sortir **OK** (aucune empreinte compromise
   active). Archiver la sortie comme preuve.
4. Invalidations induites : sessions (NEXTAUTH_SECRET), liens portail
   (GF_PORTAL_SECRET), identifiants e-invoicing (ré-chiffrement contrôlé par
   version de clé — `credentials-cipher.ts`).

## 4. Purge de l'historique git

La réécriture d'historique (filter-repo/BFG) est **une décision du
propriétaire** (destructive, casse les clones) — préparée mais non exécutée par
l'audit (contrainte : aucune modification destructive non autorisée). Tant
qu'elle n'a pas eu lieu, les valeurs de §1 restent lisibles dans l'historique :
la rotation est donc le contrôle effectif, la purge un complément d'hygiène.

## 5. Inventaire des secrets d'exécution (où ils vivent)

Manifeste complet : `scripts/garageflow-env-manifest.json` (généré/contrôlé par
`env:configure` / `env:check`). Familles : session (NextAuth), portail (JWT),
SSE, admin control-plane, SMTP (chiffrés via `encrypt-smtp-secrets`), clé de
chiffrement des identifiants e-invoicing (`GF_EINVOICE_CREDENTIALS_KEY`,
AES-256-GCM, versionnée), sceau de signature (`GF_SIGNATURE_SECRET`), pepper
appareils (`DEVICE_TOKEN_PEPPER`), Upstash. Tous exigés/validés **fail-closed**
au démarrage en production PWA (preuve : démarrage refusé observé en V13 sans
ces variables).
