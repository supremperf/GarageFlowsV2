# Rapports de crash & confidentialité (RGPD)

## Principe : OPT-IN explicite

- Par défaut, les rapports de crash sont **DÉSACTIVÉS** (`crashConsent()` renvoie
  `false` tant qu'aucun choix n'a été fait). Aucun rapport ne part sans accord.
- Au **premier lancement**, un écran clair (`CrashConsentModal`) propose
  « Autoriser » / « Refuser » / « Voir les détails ». Rien n'est précoché.
- Le choix est **enregistré** (`gf_settings.json`) et **modifiable** ensuite dans
  les paramètres (IPC `app:set-crash-consent`).

## Minimisation & redaction (avant tout envoi)

`control-plane.js › sanitizeCrashReport()` applique une **liste blanche** de champs
puis `redactSensitive()` sur message/stack/logs/breadcrumbs :

| Retiré / masqué | Comment |
|---|---|
| Mots de passe, tokens, clés API, secrets, `client_secret`, `NEXTAUTH_SECRET` | `clé=valeur` → `clé=<redacted>` |
| En-têtes `Authorization`, `Cookie`, `Bearer …` | valeur → `<redacted>` |
| URLs de base de données (`postgres://user:pass@…`) | identifiants → `<redacted>` |
| Nom d'utilisateur dans les chemins (`C:\Users\X`, `/home/X`) | → `<user>` |
| Tokens de licence `GF2.…` et JWT `eyJ…` | → `<redacted>` |
| **HWID brut** | jamais transmis : seul un **hash court** (16 hex) l'est |
| Données métier du garage (clients, factures…) | jamais collectées |

Tailles bornées : message 2 000, stack 20 000, breadcrumbs 10 000, logs 4 000.

## Côté serveur (garagesite3)

`POST /api/crash` : rate-limité par IP, **validé par schéma Zod** (tailles
plafonnées), exige `consent:true`, journalisé (audit), aucune donnée métier.
Regroupement par `fingerprint` (hash message+frame+version). Accès admin uniquement.

## Ce qui n'est PAS garanti

Ceci décrit les **mesures techniques** en place. Ce document n'est pas un avis
juridique : l'exploitant reste responsable de sa politique de confidentialité,
de la durée de conservation et de l'information des personnes concernées.

## Tests

`src/lib/__tests__/crash-redaction.test.ts` : masquage mots de passe/tokens/
cookies/Authorization/DB URL/chemins utilisateur/GF2/JWT, HWID haché, liste
blanche, tailles bornées.
