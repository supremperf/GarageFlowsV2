# Licences mécanicien (clés MECHANIC)

Ce document décrit le système de licences **MECHANIC** ajouté à GarageFlow : des
clés secondaires, subordonnées à une licence Garage, qui ouvrent un espace
mécanicien strictement restreint.

## Principe

- Une licence **GARAGE** (types `trial | premium | enterprise | admin`) fonctionne
  comme avant. La création de clés mécanicien est **facultative**.
- Une licence **MECHANIC** :
  - est **obligatoirement** rattachée à une licence Garage parente (champ `plid`
    signé dans le token) et à un `garageId` ;
  - ne peut **jamais** fonctionner comme une licence Garage ;
  - n'ouvre que l'espace `/mechanic` (planning + interventions **attribuées**) ;
  - est indépendante et **révocable individuellement** sans impacter les autres
    clés ni la licence Garage.

Une licence Garage peut donc exister seule, avec une clé mécanicien, avec
plusieurs, générées en même temps ou ajoutées plus tard.

## Format du token

`GF2.<header>.<payload>.<signature>` — inchangé (ECDSA P-256 / SHA-256, ES256).
Payload MECHANIC :

```json
{ "lid": "...", "cid": "...", "typ": "mechanic", "iss": 0, "exp": 0,
  "seats": 1, "wm": "...", "ver": "2.1",
  "plid": "<lid de la licence Garage parente>",   // OBLIGATOIRE
  "mn": "<nom du mécanicien>" }                    // OPTIONNEL (indice)
```

Règle de vérification (`src/lib/license/verify.ts`, `garagesite3/src/lib/licenses/verify.ts`,
`electron/main.js`, keygen) : `typ === 'mechanic'` ⇒ `plid` non vide requis,
`isAdmin` toujours faux. Les anciens vérificateurs rejettent le type inconnu
`mechanic` (fail-closed, aucune régression).

## Génération (Keygen)

CLI :

```bash
# Licence Garage seule (inchangé)
python scripts/keygen.py --gen --customer CUST-001 --type premium

# Ajouter N clés mécanicien à une licence Garage existante (base locale)
python scripts/keygen.py --gen-mechanic --parent-lid <LID_GARAGE> --count 3 \
    --names "Alice,Bob,Chloé" --years 1
```

GUI (`scripts/keygen_ui.py`, `python scripts/keygen_ui.py`) — onglet **Générer** :
- « Licence Garage seule » ;
- « Garage + clés mécanicien » (nombre + noms optionnels) ;
- « Clés mécanicien pour un garage existant » (sélecteur de licence parente).

Validation : nombre entier ≥ 1 et ≤ `GF_KEYGEN_MAX_MECHANIC` (défaut 20), parent
existant et de type garage. Récapitulatif + export `.txt`/`.json`, anti double-clic,
journal d'audit `keys/keygen_audit.log` (jamais de token complet, `lid` tronqué).

La clé privée reste dans `keys/` uniquement — jamais dans le PWA, l'EXE ou le
navigateur.

## Association à un mécanicien (propriétaire)

Interface : **Paramètres → Accès mécaniciens** (OWNER/MANAGER).

1. **Enregistrer une clé** : coller le token mécanicien (OWNER). Il doit
   référencer une licence Garage de **ce** garage ; plafond `GF_MAX_MECHANIC_KEYS`
   (défaut 20).
2. **Associer** la clé à un mécanicien du garage (OWNER). Une **réattribution**
   trace l'historique (`MechanicLicenseAssignment`), coupe les appareils de
   l'ancien titulaire (sessions invalidées) et recalcule l'intégrité (`recordMac`).
3. **Suspendre / réactiver / révoquer** individuellement, **déconnecter** les
   appareils, **copier** la clé (OWNER, tracé).

API : `GET/POST /api/mechanic-licenses`, `POST /api/mechanic-licenses/[lid]/assign`,
`/status`, `/disconnect`, `GET /api/mechanic-licenses/[lid]/token`.

## Activation & session (PWA + EXE)

`POST /api/license/activate` détecte le type mechanic et, après vérification de la
chaîne complète (clé attribuée + licence parente valide + mécanicien du garage +
appareil), émet un cookie `gf_session` signé
`{ typ:'mechanic', lid, gid, mid, did }` et redirige vers `/mechanic`.

Toute requête de l'espace mécanicien est revalidée en base
(`src/lib/license/mechanic-session.ts`) — **y compris sous Electron**. Le
`garageId` et le `mechanicId` de confiance viennent **toujours** de la base,
jamais du client.

## Permissions (deny by default)

`src/lib/authz.ts` centralise la matrice. Le rôle `MECHANIC` ne possède que :
`job:read_assigned`, `schedule:read_self`, `photo:create_assigned`,
`comment/note/observation/issue:create_assigned`, `checklist:update_assigned`,
`timer:update_assigned`, `profile:read_self`, `session:logout`. Tout le reste est
refusé.

## Espace mécanicien

Pages `/mechanic` (planning personnel) et `/mechanic/jobs/[id]` (détail). Actions
autorisées uniquement : consulter ses interventions, ajouter photo (append-only,
type réel vérifié par magic bytes, ≤ 8 Mo), commentaire/note/observation/
signalement, compléter la checklist, démarrer/terminer le chrono. **Aucune**
modification/suppression, **aucune** donnée financière (sélections de champs
strictes côté API). Déconnexion : purge des cookies + du stockage local
(`localStorage`/`sessionStorage`/Cache API).

## Base de données (additif)

Champs ajoutés à `LicenseKey` : `parentLicenseId`, `mechanicId`, `mechanicHint`,
`assignedAt`, `assignedBy`, `suspendedAt` (+ `mechanicName`/`parentLicenseId` côté
`garagesite3`). `JobPhoto.mechanicId`. Nouvelles tables :
`MechanicLicenseAssignment`, `JobMechanicNote`, `MechanicActionAudit`.

Migrations :
- Serveur PWA : `prisma/server/migrations/20260804000000_mechanic_licenses/`.
- Desktop SQLite : `src/lib/migrations.ts` (migrations runtime 120→138).
- Vitrine/contrôle : `garagesite3/prisma/migrations/20260804000000_mechanic_licenses/`.

Toutes additives (aucune suppression). Rollback = `DROP` des colonnes/tables
ajoutées, sans perte pour l'existant.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `GF_MAX_MECHANIC_KEYS` | 20 | Plafond de clés mécanicien par garage (API propriétaire) |
| `GF_KEYGEN_MAX_MECHANIC` | 20 | Plafond par génération (Keygen) |
