# GarageFlow

Application de gestion et de planning d'atelier automobile — bureau Windows (Electron + Next.js).

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 18 LTS |
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

## Développement

```bash
npm run dev           # Serveur Next.js (port 3000)
npm run electron:dev  # Lance Electron en mode dev (pointe vers :3000)
```

---

## Architecture

```
GarageFlow/
├── electron/
│   ├── main.js        # Processus principal Electron (IPC, backup, export)
│   └── preload.js     # Pont sécurisé contextBridge ↔ renderer
├── src/
│   ├── app/           # Routes Next.js App Router
│   │   ├── api/       # API REST (jobs, clients, invoices, license…)
│   │   └── admin/     # Interface administrateur licences
│   ├── components/    # Composants React (Dashboard, Header, Modals…)
│   └── lib/
│       ├── license/   # Vérification ECDSA, HWID, record-MAC
│       ├── ai-engine.ts # Moteur de suggestions IA (conflits, surcharges…)
│       ├── i18n.tsx   # Internationalisation (14 langues)
│       ├── rate-limit.ts # Limiteur de débit en mémoire
│       └── utils.ts   # Utilitaires planning (timeToMinutes, jobsOverlap…)
├── prisma/
│   └── schema.prisma  # Modèles SQLite (Garage, Job, Client, Invoice…)
├── scripts/
│   ├── keygen_core.py # Crypto ECC P-256 + HWID
│   ├── keygen_db.py   # Base de données locale des licences (JSON)
│   ├── keygen_ui.py   # Interface tkinter (génération, gestion, révocation)
│   └── keygen_gui.py  # Point d'entrée GUI keygen
└── keys/              # private.pem + public.pem (jamais committé)
```

---

## Système de licences

### Initialisation (première fois)

```bash
python scripts/keygen_gui.py
```

Dans l'onglet **Clés** : cliquer **Initialiser les clés** → copier la clé publique dans :
- `src/lib/license/public-key.ts` → tableau `_LINES`
- `electron/main.js` → tableau `_PK`

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
Bureau/GarageFlow_Export_AAAA-MM-JJ/
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

L'installateur est généré dans `dist/`.

---

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_SECRET` | Secret de signature JWT (obligatoire en prod) |
| `DATABASE_URL` | Chemin SQLite (géré automatiquement par Electron) |
| `GF_INTERNAL_EXPORT_KEY` | Clé interne pour l'API d'export (générée par Electron) |

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
