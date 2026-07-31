# Environnement de démonstration — GarageFlow

> Document data room. Décrit comment lancer, réinitialiser et cadrer un environnement de
> démonstration **honnête** : ce qui est réel, ce qui est **factice mais explicitement
> étiqueté**, et ce qui n'est pas démontrable sans actifs externes (clés privées, backend,
> domaines). Toutes les données de démo proviennent du seed `prisma/seed.ts` — aucune
> donnée client réelle, aucun chiffre d'affaires réel, aucune preuve marché réelle.

## 1. Ce que crée le seed (vérifié)

Le seed `prisma/seed.ts` crée un garage de démo réaliste et **idempotent** (il s'arrête si
le garage `demo-garage` existe déjà). Contenu vérifié firsthand cette session
(`prisma db push` exit 0 + `npm run db:seed` exit 0 sur une base SQLite jetable) :

| Élément | Détail (source `prisma/seed.ts`) |
|---|---|
| Garage | « Garage Demo », slug `demo-garage`, 12 rue de la Mécanique 75001 Paris, plan `PRO`, onboarding complet |
| Compte propriétaire | `admingarageflow@admin.fr` (rôle `OWNER`), mot de passe haché bcrypt |
| Mécaniciens | **5** : Thomas B., Marco R., Luc P., Karim D., Sofia M. (couleurs + spécialités) |
| Interventions du jour | **13** interventions (`Job`) réparties sur les 5 mécaniciens, statuts variés (`completed` / `in_progress` / `scheduled`), une urgente |

> Chiffres vérifiés : **5 mécaniciens et 13 interventions**. Le message de fin de seed
> confirme : « Seeded garage "Garage Demo" with 5 mechanics and 13 jobs ».

### Identifiant de démo — étiqueté comme tel

- Email : `admingarageflow@admin.fr`
- Mot de passe : `AdminMDPgarageFlow2026..Flow` (défini en clair dans `prisma/seed.ts:32`,
  puis haché bcrypt avant stockage).

**C'est un identifiant de démonstration, pas un secret du dépôt.** L'authentification
recherche l'email en minuscules ; le seed stocke donc l'email en minuscules pour que le
compte soit connectable (voir commentaire `prisma/seed.ts:29-31`). Ne pas le confondre
avec un compte de production.

## 2. Lancer l'environnement de démo (poste de travail)

Prérequis : Node.js (aucune version épinglée — pas de champ `engines` dans `package.json` :
utiliser une LTS récente pour reproductibilité) et npm.

```bash
cd GarageFlowsV2
npm install

# 1) Créer/mettre à jour le schéma de la base de démo (SQLite)
npm run db:push          # prisma db push

# 2) Peupler la base avec le garage de démo
npm run db:seed          # ts-node prisma/seed.ts

# 3) Lancer l'application web (Next.js)
npm run dev              # next dev  (port 3000)
# ou, pour reproduire le port embarqué Electron :
npm run dev:electron     # next dev -p 4028
```

Puis se connecter avec l'identifiant de démo ci-dessus via `src/app/login/page.tsx`.

> Note packaging : en production, l'application tourne **embarquée dans Electron** sur un
> serveur Next.js standalone lié à `127.0.0.1:4028` (loopback uniquement). Pour une simple
> démo fonctionnelle, `npm run dev` en navigateur suffit et évite l'étape de build Electron
> (voir §6 sur ce qui n'est **pas** démontrable sans actifs externes).

## 3. Réinitialiser / rejouer la démo

Un script dédié remet la base à zéro puis re-seed :

```bash
npm run db:reset   # prisma db push --force-reset && npm run db:seed
```

- `--force-reset` **efface** la base SQLite de démo (`file:./dev.db`) puis la recrée.
- Le seed étant idempotent, un `db:seed` sur une base déjà peuplée ne duplique rien
  (il s'arrête proprement).

> ⚠️ À n'exécuter que sur la base de **démo**. Sur une installation cliente réelle,
> `--force-reset` détruirait les données.

## 4. Variables d'environnement nécessaires

Le fichier `.env.example` (suivi dans le dépôt, **placeholders documentés uniquement**)
liste chaque variable avec objectif / environnement / caractère requis / exemple /
comportement si absente. Pour une démo poste de travail, le minimum utile :

| Variable | Rôle en démo | Requis ? |
|---|---|---|
| `DATABASE_URL` | Base SQLite locale (`file:./dev.db`) | Oui (défaut fourni) |
| `NEXTAUTH_URL` | URL de l'app (ex. `http://localhost:3000` en démo) | Oui |
| `NEXTAUTH_SECRET` | Secret de session — `setup-dev.js` peut en générer un | Oui |
| `GF_LICENSE_SERVER` | Serveur central de licences/MàJ | **Optionnel** — sans lui, les vérifs licence sont dégradées/inactives |
| `ANTHROPIC_API_KEY` | OCR plaque + fallback plate-lookup (IA) | **Optionnel** — absente → OCR renvoie 503, saisie manuelle |
| `GF_BRAND_*` | Surcharge white-label (nom, couleurs…) | Optionnel (effet quasi nul, voir §5) |
| SMTP (`EmailTab`) | Envoi réel des relances/e-mails | Optionnel — sans SMTP, relances préparées non expédiées |

> `.env` est **gitignoré** (non committé) et n'apparaît pas dans le dépôt ; seul
> `.env.example` est suivi. Aucun secret réel n'est présent dans le code.

## 5. Ce qui est « factice mais étiqueté » en démo

À énoncer explicitement à l'acquéreur pour éviter toute survente :

- **Données du garage de démo** : clients (Martin Dupont, Sophie Laurent…), plaques
  (`AB-123-CD`…), interventions — **entièrement fictives**, générées par le seed. Aucune
  donnée client réelle, aucun CA, aucun témoignage.
- **Identifiant admin de démo** : compte de démonstration (voir §1), pas un compte prod.
- **Jeton de licence** utilisé au scénario d'activation : jeton **pré-généré**. L'émission
  de nouveaux jetons exige la clé privée absente du dépôt (voir §6).
- **White-label** : modifier `GF_BRAND_*` n'a qu'un effet marginal (config non câblée,
  ~146 occurrences « GarageFlow » en dur) — présenter comme **DESIGN**, pas comme livré.
- **API publique v1** (`garagesite3/src/lib/api/*`) : bac à sable **en mémoire, non
  persistant** ; à ne jamais démontrer comme surface d'intégration de production.
- **Fonctions codées sans UI** : backups chiffrés (routes `/api/admin/backups/*` sans
  onglet de réglages) et dashboard monitoring (`/monitoring` sans lien de navigation) —
  atteignables uniquement par URL directe / API.

## 6. Ce qui n'est PAS démontrable sans actifs externes (marquer clairement)

Ces éléments dépendent d'actifs **hors dépôt** dont le transfert est un **bloquant P0** de
la transaction (voir `docs/ACQUISITION_READINESS_AUDIT.md`) :

- **Émission de licences** : nécessite la **clé privée ECC P-256** (`keys/private.pem`,
  gitignorée, côté serveur uniquement). Sans elle : démonstration d'activation avec jeton
  pré-généré uniquement.
- **Publication de mises à jour signées** : nécessite la **clé privée Ed25519** de signature
  des manifests (variable d'environnement serveur). Absente du dépôt.
- **Backend / plan de contrôle en production** (`api.garageflows.fr`) : activation,
  heartbeat, révocation, releases. Le poste de travail ne fonctionne pas end-to-end sans lui.
- **Domaines `garageflows.fr`** : codés en dur dans les allowlists de MàJ/téléchargement.
- **Build Windows signé** : le binaire n'est **pas** code-signé (aucun certificat configuré) ;
  une installation réelle déclenche l'avertissement SmartScreen « éditeur inconnu ».

Pour une démo end-to-end du cycle licence/MàJ, il faut donc soit disposer des actifs
transférés, soit se limiter à la démo applicative (navigateur/dev) + jetons pré-générés.

## 7. Environnement de démo du plan de contrôle cloud (garagesite3)

Le back-office `/admin/*` (dépôt `garagesite3`, Next.js 15 + PostgreSQL) requiert :
`DATABASE_URL` PostgreSQL, `LICENSE_ADMIN_API_KEY` (clé maître unique — pas de multi-compte),
et en production `DEVICE_TOKEN_SECRET`, `HWID_HMAC_SECRET`, `UPSTASH_REDIS_REST_URL/TOKEN`
(validation d'env fail-closed en prod). Pour une démo locale, ces secrets peuvent être des
valeurs de développement ; en prod, l'application **refuse de démarrer** si les secrets sont
manquants/faibles.

---

*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit complet, les bloquants P0 et les mises en garde d'honnêteté.*
