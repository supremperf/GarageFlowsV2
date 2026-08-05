# Facturation électronique — compatibilité avec `RESET-GARAGEFLOW.cmd`

> Document **obligatoire**. Il prouve que l'intégration de la facturation
> électronique **ne casse pas** l'outil de réinitialisation/rotation et explique
> exactement comment les nouvelles variables sont gérées.

## 1. Principe : compatibilité **par le manifeste**, sans toucher aux scripts

`scripts/RESET-GARAGEFLOW.cmd` est un wrapper Windows qui :

1. se place dans son propre dossier via `%~dp0` (fonctionne par double-clic, depuis
   `cmd`, PowerShell ou Windows Terminal), force l'UTF‑8 (`chcp 65001`) ;
2. vérifie la présence de `reset-garageflow.ps1`, `configurer-api-garageflow.ps1`
   et **`garageflow-env-manifest.json`** ;
3. choisit `pwsh.exe` s'il existe, sinon `powershell.exe` (**Windows PowerShell 5.1
   compatible**) ;
4. **valide la syntaxe** des deux `.ps1` (`[Parser]::ParseFile`) puis exécute
   `reset-garageflow.ps1` ;
5. `pause` avant de rendre la main (la fenêtre ne se ferme pas en cas d'erreur au
   double‑clic) et propage le code de sortie PowerShell.

Le PowerShell lit **`scripts/garageflow-env-manifest.json`** (`Get-EnvironmentManifest`)
pour savoir quelles variables il connaît et comment les traiter. **Aucun `.cmd`
ni `.ps1` n'a été modifié.** Les variables de facturation électronique ont été
**ajoutées au manifeste**, dans le format existant (`schemaVersion` 2) — c'est la
voie la plus sûre : rien à réécrire dans le PowerShell fragile.

> Le chemin officiel est **`scripts/RESET-GARAGEFLOW.cmd`**. Aucune occurrence du
> chemin erroné `cripts/RESET-GARAGEFLOW.cmd` n'existe dans le dépôt (vérifié).

## 2. Comment le reset traite les nouvelles variables

Deux champs du manifeste pilotent le comportement, et ils sont déjà respectés par
le PowerShell existant :

- **`autoManage: false`** → `configurer-api-garageflow.ps1` **ignore** la variable
  pour l'auto‑gestion (ligne ~1754 : `if (-not autoManage) { continue }`). Le reset
  **ne la crée pas, ne la rote pas, ne l'écrase pas**.
- **`classification: "configuration"`** → une valeur déjà présente est **préservée**
  depuis la sauvegarde (`reset-garageflow.ps1` ~ligne 2284).
- Étant **dans le manifeste**, ces variables sont **reconnues** (jamais signalées
  comme « inconnues/rogue »).

| Variable | classification | autoManage | autoGenerate | Effet au reset |
|---|---|---|---|---|
| `EINVOICING_ENABLED` | configuration | false | false | reconnue, **préservée**, jamais forcée → **jamais activée automatiquement** |
| `EINVOICING_PROVIDER_CATALOG_ENABLED` | configuration | false | false | idem (défaut applicatif `true`, catalogue lecture seule) |
| `EINVOICING_CONNECTIONS_ENABLED` | configuration | false | false | idem |
| `EINVOICING_OUTGOING_ENABLED` | configuration | false | false | idem |
| `EINVOICING_INCOMING_ENABLED` | configuration | false | false | idem |
| `EINVOICING_PAYMENT_REPORTING_ENABLED` | configuration | false | false | idem |
| `EINVOICING_SANDBOX_ONLY` | configuration | false | false | idem (défaut applicatif `true`) |
| `EINVOICING_DEFAULT_ENVIRONMENT` | configuration | false | false | idem |
| `GF_EINVOICE_CREDENTIALS_KEY` | **dangerous** | **false** | **false** | **jamais générée ni rotée automatiquement**, **préservée** — même convention que `GF_SMTP_CIPHER_KEY` |
| `GF_EINVOICE_CREDENTIALS_KEY_VERSION` | configuration | false | false | reconnue, préservée |

## 3. La clé de chiffrement n'est **jamais** rotée automatiquement

`GF_EINVOICE_CREDENTIALS_KEY` chiffre des **identifiants persistants** de
plateformes. Une rotation naïve rendrait **tous** les identifiants existants
indéchiffrables. Elle suit donc **exactement** le précédent éprouvé
`GF_SMTP_CIPHER_KEY` : `autoGenerate:false`, `autoManage:false`,
`rotationRisk:critical`.

- **Génération initiale** (une seule fois, si absente) : hors reset, via
  `openssl rand -base64 32` (ou l'outil dédié), puis ajout en variable serveur.
- **Rotation contrôlée** (jamais dans le reset) : lire l'ancienne clé → générer la
  nouvelle → déchiffrer/rechiffrer chaque identifiant transactionnellement →
  vérifier → incrémenter `GF_EINVOICE_CREDENTIALS_KEY_VERSION` → sauvegarde +
  rollback → ne supprimer l'ancienne qu'après validation. L'enveloppe stocke la
  version de clé (`gfeic1.<version>.…`) pour piloter la migration.

## 4. Dry‑run, sauvegardes, rollback, Vercel

Inchangés : le reset conserve son mode `dry‑run`, ses sauvegardes, son rollback et
sa synchronisation Vercel. Comme les variables de facturation sont `autoManage:false`,
elles **ne participent pas** aux mutations Vercel du reset — donc aucun risque de
`.env` partiel ni d'échec Vercel les concernant.

## 5. Données métier jamais supprimées

Le reset **ne touche pas** aux données de facturation électronique (connexions,
transmissions, statuts, factures, journaux). Cette phase n'introduit d'ailleurs
encore **aucun modèle Prisma** (voir `EINVOICING_ARCHITECTURE.md`, phases
suivantes) : aucune migration n'est déclenchée par le reset.

## 6. Vérification manuelle (Windows requis)

> ⚠️ Cette compatibilité **n'a pas pu être exécutée** dans l'environnement CI/Linux
> de développement (pas de Windows/PowerShell/Vercel). À valider sur un poste
> Windows avant mise en production, **avant/après** :

```bat
:: 1) Sauvegarde du manifeste et du .env
copy scripts\garageflow-env-manifest.json scripts\garageflow-env-manifest.json.bak

:: 2) Contrôle de syntaxe (ce que fait déjà le .cmd) — doit afficher "Syntaxe OK"
powershell -NoProfile -Command "$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('scripts\reset-garageflow.ps1',[ref]$null,[ref]$e); if(@($e).Count){$e|%%{$_.Message}}else{'Syntaxe OK'}"

:: 3) Manifeste JSON valide + variables reconnues
powershell -NoProfile -Command "(Get-Content scripts\garageflow-env-manifest.json -Raw | ConvertFrom-Json).variables.Count"

:: 4) Lancer le reset en DRY-RUN et vérifier qu'il NE propose PAS de générer/roter
::    GF_EINVOICE_CREDENTIALS_KEY et n'active aucun flag.
scripts\RESET-GARAGEFLOW.cmd   (choisir le mode simulation / -DryRun)
```

Attendu : le script se lance, valide la syntaxe, lit 105 variables, **préserve**
toute valeur `EINVOICING_*`/`GF_EINVOICE_*` existante, **ne génère ni ne rote**
`GF_EINVOICE_CREDENTIALS_KEY`, et se termine avec le **même** code de sortie
qu'avant l'ajout.

## 7. Erreurs possibles & actions manuelles

- **Clé absente alors que la facturation est activée** : la génération est
  volontairement **manuelle** (§3). Générer la clé, l'ajouter aux variables
  serveur, puis (re)tester une connexion de plateforme.
- **JSON manifeste invalide** après édition manuelle : restaurer
  `scripts/garageflow-env-manifest.json.bak`. (Le fichier livré est validé.)
- **Rotation nécessaire** : n'utilisez **pas** le reset ; utilisez le processus de
  rotation contrôlée dédié (à venir, phase « connexions »).
