# GarageFlows

Application de gestion et de planning d'atelier automobile — bureau Windows (Electron + Next.js).

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 22.x |
| npm | 9 |
| Python | 3.10 |
| `cryptography` (pip) | 41 |
| Electron Builder | inclus via `devDependencies` |

---

## Installation

```bash
npm install
npm run db:push       # Crée la base SQLite via Prisma
npm run db:seed       # Insère les données de démo
```

---

## Configuration assistée (desktop / Neon / Vercel)

```bash
npm run config
```

Ou double-cliquer sur `config.cmd` sous Windows. `config` lance maintenant le
**plan complet automatique** : dépendances, accès Neon/Vercel/Upstash, secrets,
licences/keygen, profils desktop/cloud, bases, migrations, déploiement et signature
locale des mises à jour. Saisir `AUTORISER` pour lancer le plan ; les demandes
suivantes concernent des accès, une cible ambiguë ou une opération risquée.
Il conserve les clés existantes et n'affiche jamais les secrets.

Sur une **première installation** (base vide, aucune ligne métier), **toutes les
clés absentes sont générées automatiquement** — secrets 256 bits, paire de
licence P-256, clé Ed25519 de publication — puis écrites aux endroits réellement
lus : `.env`, `.env.server.local`, `keys/private.pem`, `keys/public.pem`,
`keys/server_config.json` (keygen), coffre hors dépôt, ancrages publics et
**Vercel production** (ajouts en Sensitive, jamais de remplacement). Une base
contenant de vraies **données métier** (les registres `_gf_migrations` /
`_prisma_migrations` ne comptent pas) exige l'original du coffre : `GENERER` y
reste une décision explicite et confirmée.

**Analyse et couverture des 118 variables : [CONFIG_REPOSITORY_AUDIT.md](docs/CONFIG_REPOSITORY_AUDIT.md).**

**Guide et limites d'automatisation : [docs/CONFIG.md](docs/CONFIG.md).**
Le serveur utilise `.env.server.local` (isolé du build Electron) ; le desktop
conserve `.env`. Les accès non récupérables doivent être fournis localement. Le rapport distingue
les étapes réussies des fonctions exigeant encore un accès ou une adaptation
(notamment stockage durable sur Vercel et service de publication externe).

---

## Développement

```bash
npm run dev           # Serveur Next.js seul (port 3000)
# Desktop en développement — deux terminaux :
npm run dev:electron  # Terminal 1 : Next.js sur le port 4028 (celui d'Electron)
npm run electron:dev  # Terminal 2 : Electron en mode dev (pointe vers :4028)
```

---

## Architecture

```
GarageFlows/ (racine du depot)
├── electron/
│   ├── main.js        # Processus principal Electron (IPC, backup, export)
│   └── preload.js     # Pont sécurisé contextBridge ↔ renderer
├── src/
│   ├── app/           # Routes Next.js App Router
│   │   ├── api/       # API REST (jobs, clients, invoices, license…)
│   │   └── admin/     # Interface administrateur licences
│   ├── components/    # Composants React (Dashboard, Header, Modals…)
│   └── lib/
│       ├── license/   # Vérification ECDSA, HWID, record-MAC, appareils (devices.ts)
│       ├── security/  # Rate limiting centralisé (distribué en PWA, mémoire en Electron)
│       ├── ai-engine.ts # Moteur de suggestions IA (conflits, surcharges…)
│       ├── i18n.tsx   # Internationalisation (14 langues)
│       └── utils.ts   # Utilitaires planning (timeToMinutes, jobsOverlap…)
├── prisma/
│   ├── schema.prisma  # Schéma DESKTOP — SQLite (Electron mono-poste)
│   └── server/
│       ├── schema.prisma  # Schéma SERVEUR — PostgreSQL (PWA multi-instance)
│       └── migrations/    # Migrations PostgreSQL reproductibles (CI)
├── scripts/
│   ├── keygen_core.py # Crypto ECC P-256 + HWID
│   ├── keygen_db.py   # Base de données locale des licences (JSON)
│   ├── keygen_ui.py   # Interface tkinter (génération, gestion, révocation)
│   └── keygen.py  # Point d'entrée GUI keygen
└── keys/              # private.pem + public.pem (jamais committé)
```

---

## Système de licences

### Diagnostic keygen → activation (à lire avant toute initialisation)

**Le GUI utilise `keys/private.pem`, pas `GF_PRIVATE_KEY`. Cette clé privée doit
appartenir à la même paire que l’ancre publique de l’instance cible. Ne jamais
régénérer une paire pour corriger « Licence invalide ou modifiée ».**

```sh
python scripts/keygen_ui.py --verify-key-match
# Ajouter --ask-passphrase pour un PEM chiffré ; aucun secret en argument.
node scripts/diagnose-license.mjs --print-public-fingerprint
```

Contrôle automatique bloquant des ancres locales avant toute signature GUI ;
aucune preuve du serveur distant sans provenance/PEM public attesté. Voir la
[procédure immédiate et les diagnostics](docs/KEYGEN.md), puis la
[preuve de reproduction et ses limites](docs/audit/2026-10-17/07-DIAGNOSTIC-KEYGEN.md).

### Initialisation (première fois)

```bash
python scripts/keygen.py
```

Conserver les clés existantes. Ne jamais réinitialiser la paire sur un parc actif.
Après une initialisation explicitement approuvée, utiliser `npm run keys:sync`,
puis `npm run keys:check` (pas de copie manuelle des tableaux embarqués).

### Types de licence

| Type | Accès |
|------|-------|
| `trial` | Standard — fonctions de base |
| `premium` | Premium — toutes les fonctions |
| `enterprise` | Pro / Entreprise — multi-postes |
| `admin` | Accès panneau d'administration |

### Sécurité

- **ECDSA P-256** : la clé privée ne quitte jamais `keys/private.pem`
- **HWID** : empreinte matérielle SHA-256 (CPU + MAC + OS + hostname + disque Windows)
- **Record-MAC** : intégrité de la base SQLite (HMAC-SHA256)
- **Session JWT HS256** : cookie `gf_session` signé avec `NEXTAUTH_SECRET`, vérifié en middleware Edge
- **Rate limiting** : 5 tentatives / 15 min sur `/api/license/activate`, 10 / 15 min sur l'auth

---

## Thèmes

| Identifiant | Description |
|-------------|-------------|
| `dark` | Mode Sombre (défaut) |
| `light` | Mode Clair |
| `night-shift` | Tons ambrés chauds, repose les yeux le soir |
| `true-tone` | Bleu doux à fort contraste |

Sélection dans **Paramètres → Thèmes**.

---

## Export automatique

Chaque soir à **20 h**, l'application crée un dossier horodaté sur le Bureau :

```
Bureau/GarageFlows_Export_AAAA-MM-JJ/
├── clients.csv
├── vehicules.csv
├── interventions.csv
├── factures.csv
├── devis.csv
├── stock.csv
├── mecaniciens.csv
└── rappels.csv
```

Export manuel disponible dans **Paramètres → Thèmes → Exporter maintenant**.

---

## Tests

```bash
npm test              # Vitest (run once)
npm run test:watch    # Mode watch
npm run test:coverage # Rapport de couverture HTML
```

Couverture : utilitaires planning, calculs TVA, rate limiter, format des tokens de licence.

---

## Distribution (Windows)

```bash
npm run dist          # Build Next.js + packaging Electron Builder (.exe)
```

L'installateur est généré dans `dist/`. Le hook `afterPack`
(`scripts/afterPack.js`) écrit automatiquement le **manifeste d'intégrité**
signé (voir Sécurité ci-dessous).

---

## Mises à jour automatiques

Le serveur central (`app.garageflows.fr`, dépôt `garagesite3`) publie les
versions. Le client les vérifie **au démarrage puis toutes les heures** et
propose l'installation en un clic (fenêtre `UpdateModal`) :

- `electron/main.js` interroge `GET /api/update/latest` (`GF_UPDATE_SERVER`,
  défaut = `GF_LICENSE_SERVER`) ;
- téléchargement **HTTPS reprenable** (Range) avec barre de progression ;
- **vérification SHA-256** avant installation — un fichier altéré est refusé ;
- l'app se ferme, l'installateur NSIS remplace les fichiers, les **données
  utilisateur** (`%APPDATA%\GarageFlow`) sont conservées.

Publication et administration : voir le README de `garagesite3` et la page
`/admin/updates`. **Configuration complète** (variables serveur/client,
endpoints, procédure de publication) : **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**.

---

## Sécurité & durcissement (post-compilation)

Chiffrement des ressources, clé fragmentée, vérification d'intégrité
(SHA-256/HMAC), anti-altération, signature numérique, obfuscation et permissions
d'installation : voir **[docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md)**.

---

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_SECRET` | Secret de signature JWT (obligatoire en prod) |
| `DATABASE_URL` | `file:…` = SQLite desktop (Electron) · `postgresql://…` = serveur/PWA |
| `DIRECT_URL` | PostgreSQL direct (migrations serveur) |
| `DEVICE_TOKEN_PEPPER` | HMAC des jetons/HWID d'appareils (obligatoire en prod PWA) |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Rate limiting distribué (obligatoire en prod PWA) |
| `GF_INTERNAL_EXPORT_KEY` | Clé interne pour l'API d'export (générée par Electron) |
| `GF_LICENSE_SERVER` | Serveur central (licences + mises à jour) |
| `GF_UPDATE_SERVER` | Serveur de mises à jour (défaut : `GF_LICENSE_SERVER`) |
| `GF_UPDATE_CHANNEL` | Canal de mises à jour (`stable` / `beta`) |
| `GF_INTEGRITY_MODE` | Intégrité au démarrage : `audit` (défaut) / `enforce` / `off` |

Liste complète et comportements : [`.env.example`](.env.example).

### Bases de données & déploiement

- **[`docs/DATABASE_ARCHITECTURE.md`](docs/DATABASE_ARCHITECTURE.md)** —
  séparation SQLite desktop / PostgreSQL serveur, commandes Prisma, migrations.
- **[`docs/LICENSE_DEVICE_SECURITY.md`](docs/LICENSE_DEVICE_SECURITY.md)** —
  appareils par licence, deviceToken (haché), plafond `seats` atomique,
  révocation, politiques fail-open/fail-closed.
- **[`docs/PWA_MULTITENANT_LICENSING.md`](docs/PWA_MULTITENANT_LICENSING.md)** —
  licences multi-tenant PWA : installations PWA (install id) comptées comme
  appareils, liaison licence↔garage (anti cross-tenant), enforcement serveur
  par requête, révocation immédiate, politique de version, plan FREE.
- **[`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md)** —
  déploiement Vercel, PostgreSQL/Redis, rollback, test machine propre.

---

## Plan de contrôle distant (modules, notifications, crashs, horloge)

Le client est administrable à distance via le serveur officiel
(`GF_LICENSE_SERVER`) :

- **Modules / droits** reçus au heartbeat (`/api/license/check`), mis en cache
  chiffré (HWID) et exposés au renderer via `useModule()` — ajout/retrait sans
  réinstallation.
- **Centre de notifications** in-app (bannières ciblées, notifications
  obligatoires bloquantes).
- **Crash reporting** avec consentement (file offline-first, empreinte de
  regroupement partagée avec le serveur).
- **Anti-recul d'horloge** : le mode hors ligne se verrouille si la date système
  est reculée (impossible de contourner le délai).

Détails : **[`docs/CONTROL_PLANE_CLIENT.md`](docs/CONTROL_PLANE_CLIENT.md)**.
Côté serveur : voir le dépôt `garagesite3`, `docs/CONTROL_PLANE.md`.

---

## Langues supportées

Français · English · Español · Deutsch · Italiano · Português · Nederlands · Polski · Русский · العربية · 中文 · 日本語 · Türkçe · 한국어

### Contrat des entrées fournisseur

`.env.example` décrit le runtime ; `.env.storage.example` contient uniquement les
noms canoniques des saisies fournisseur. `node config` accepte les exports de
dashboard à une frontière de normalisation : un alias direct est retiré de la
sortie, une contradiction avec `DIRECT_URL` bloque avant toute écriture. Les
variables d’outillage (dont le token Blob) ne deviennent pas une dépendance
applicative implicite. Voir [configuration](docs/CONFIG.md) et
[registre d’environnement](ENVIRONMENT-VARIABLES.md).
