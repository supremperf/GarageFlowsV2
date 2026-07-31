# Plan de reprise après sinistre (DRP) — GarageFlow

> Document de data room (due diligence M&A). Les cibles RTO/RPO ci-dessous sont
> des **propositions** conçues à partir de l'architecture réelle, non des SLA
> contractuels existants. Aucun engagement client de disponibilité n'est en
> vigueur à ce jour ; ce document sert de base à en définir.

## 1. Périmètre et hypothèses

GarageFlow se compose de deux systèmes indépendants dont les modes de sinistre
diffèrent :

- **Poste desktop** (Electron + Next.js standalone + **SQLite local**) : une base
  par installation, mono-garage. Un sinistre y est **local** (un poste, un
  garage).
- **Plan de contrôle cloud** (`garagesite3`, Next.js 15 + **PostgreSQL**) :
  licences, appareils, releases, crashs. Un sinistre y est **global** (tous les
  clients). C'est le point de défaillance le plus critique commercialement.

Actifs hors code, dont la perte est un sinistre à part entière (transfert au
closing, P0 de l'audit) : **clés privées de signature** (licence ECC P-256 +
update Ed25519), **domaines** `garageflows.fr` / `api.garageflows.fr`, **accès
au projet Postgres géré**.

## 2. Cibles RTO / RPO proposées

| Scénario | RTO proposé | RPO proposé | Justification |
|---|---|---|---|
| Corruption SQLite d'un poste | ≤ 1 h | ≤ 1 h | Sauvegardes horaires locales (24 conservées) ; restauration = copie de fichier |
| Perte totale d'un poste (matériel volé/HS) | ≤ 4 h | ≤ 24 h | Réinstallation + restauration dernier `.db` quotidien off-site s'il existe ; sinon perte locale |
| Perte/corruption base Postgres cloud | ≤ 2 h | ≤ 5 min | PITR fournisseur (Neon/Supabase) si activé |
| Perte des secrets d'environnement cloud | ≤ 2 h | 0 (si coffre) | Restauration depuis vault ; rotation si compromission |
| Perte des clés privées de signature | **Non récupérable sans copie** | — | Voir §6 : impose ré-émission de clés et redéploiement client |
| Perte des domaines / DNS | ≤ 24-72 h | — | Dépend du registrar ; voir §7 |

> Ces valeurs supposent que le niveau off-site (Postgres PITR, export off-site du
> `.db`) est **effectivement configuré**. En l'état du dépôt, seul le niveau
> local horaire est câblé automatiquement (voir `docs/BACKUP_AND_RESTORE.md`).

## 3. Runbook — Corruption de la base SQLite (poste)

Symptômes : l'app refuse de démarrer ; log indiquant `isDbValid: bad header` ou
`too small` ; dialogue « Base de données manquante ».

1. **Ne pas réinstaller immédiatement.** GarageFlow met déjà en quarantaine une
   base corrompue au démarrage (`DB_PATH.bad-<timestamp>`) plutôt que de
   l'écraser (`electron/main.js:836-889`). Vérifier la présence de ce fichier.
2. Fermer l'application.
3. Ouvrir le dossier de sauvegardes (menu app → IPC `app:open-backups`, ou
   `APP_DATA/backups`).
4. Choisir la copie la plus récente **valide** : d'abord `hourly/`, sinon
   `daily/`, sinon `weekly/`.
5. Copier ce `.db` vers `DB_PATH`. Conserver l'ancien fichier `.bad-*`.
6. Relancer. `setupDatabase()` revalide l'en-tête SQLite ; si la copie choisie
   est elle aussi invalide, revenir à l'étape 4 avec un palier plus ancien.
7. Si aucune sauvegarde n'est valide : réinitialiser depuis le **template
   embarqué** (`garageflow-template.db`) — l'app le fait automatiquement — ce qui
   redonne une base vide **au prix de la perte des données locales**. C'est le
   pire cas ; il illustre l'intérêt d'un export off-site (niveau B/C).
8. Post-mortem : joindre le fichier `.bad-*` et les logs à un ticket pour
   analyser la cause (disque, coupure pendant écriture, antivirus).

## 4. Runbook — Perte / corruption Postgres (cloud)

Symptômes : routes `/api/license/*`, `/admin/*` renvoient des erreurs ; les
health checks échouent. Rappel : les routes licence sont **fail-closed** (503 sur
erreur infra, jamais `allowed:true`) — c'est voulu, mais cela **bloque
l'activation** pendant l'incident.

1. **Contenir** : basculer le service en maintenance si possible ; communiquer
   (voir `docs/INCIDENT_RESPONSE.md`).
2. **Diagnostiquer** : distinguer indisponibilité (fournisseur down) de perte de
   données (corruption/suppression).
3. **Indisponibilité** : attendre le rétablissement fournisseur. Les postes
   clients **continuent de fonctionner hors-ligne** (fail-open côté desktop sur
   erreur réseau) tant qu'ils ne dépassent pas la fenêtre de grâce (48 h avertissement /
   72 h verrouillage — voir §5, limite produit).
4. **Perte de données** : lancer un **PITR** vers un point antérieur au sinistre
   (Neon restore point / Supabase PITR). RPO cible ≤ 5 min si activé.
5. **Reconstruction from-scratch** (dernier recours) : provisionner une base
   neuve, appliquer les migrations (`prisma migrate deploy`,
   `prisma/server/migrations`, 4 migrations ordonnées), restaurer le dernier
   `pg_dump`, réinjecter les secrets depuis le vault.
6. **Après rétablissement** : vérifier `env.ts` (validation fail-closed au boot :
   refuse de démarrer si `DEVICE_TOKEN_SECRET`/`HWID_HMAC_SECRET`/Upstash
   manquants), puis contrôler activation licence et heartbeat sur un poste test.

> **Attention seat-limits / device tokens** : après un PITR, l'état
> `tokenVersion` des appareils revient à sa valeur au point de restauration. Des
> révocations postérieures au point de restauration seraient annulées — à
> re-appliquer manuellement (voir `docs/OPERATIONAL_RUNBOOK.md`).

## 5. Interaction avec le verrou hors-ligne (risque produit à connaître)

Le desktop applique une grâce hors-ligne de **48 h (avertissement)** puis un
**verrou dur à 72 h qui appelle `app.quit()`** (`electron/main.js:298-299,
1179-1219`). Conséquence DRP : **un incident cloud prolongé (>72 h) peut
provoquer l'arrêt des postes clients**, transformant un sinistre serveur en panne
client généralisée. C'est un risque d'audit classé « high » ; le DRP cloud doit
viser un RTO bien inférieur à 72 h, ou la politique de grâce doit être
assouplie. À traiter en priorité post-acquisition.

## 6. Runbook — Perte des clés privées de signature

Ce sont les actifs les plus critiques et **non régénérables à l'identique** :

- **Clé privée licence (ECC P-256)** : `keys/private.pem`, gitignorée, absente du
  dépôt. Sans elle, impossible d'émettre de nouvelles licences.
- **Clé privée update (Ed25519)** : variable d'environnement serveur. Sans elle,
  impossible de **signer** les manifestes de mise à jour ; le client refuse tout
  update non signé valide (`electron/main.js:1999-2020`).

Si ces clés sont perdues **sans copie de secours** :

1. Générer de **nouvelles** paires de clés.
2. La **clé publique** licence est embarquée dans le binaire desktop
   (`electron/main.js:98-104`) et la clé publique update aussi
   (`electron/update-verify.js:20-25`) : changer les clés impose donc de
   **publier une nouvelle version desktop** contenant les nouvelles clés
   publiques, puis de la déployer à tout le parc.
3. Les **licences déjà émises** (signées par l'ancienne clé) deviennent
   invérifiables → **ré-émission de toutes les licences** clients requise.

> Conclusion : perdre les clés privées sans sauvegarde équivaut à un événement de
> continuité majeur. **Mesure préventive obligatoire** : conserver les clés
> privées dans un coffre matériel/HSM ou un vault chiffré, avec au moins deux
> copies géographiquement séparées, sous contrôle d'accès strict. Documenter leur
> emplacement dans le transfert au closing.

## 7. Runbook — Perte des domaines / DNS

Le desktop route vers `api.garageflows.fr` (allowlist de hosts de téléchargement
codée en dur : `electron/update-verify.js:29-33`, `electron/main.js:145,982,1016`).

1. Maintenir le **contrôle du registrar** et activer le verrou de transfert
   (registrar lock) + renouvellement automatique.
2. En cas de perte DNS : restaurer les enregistrements depuis la configuration
   documentée (à consigner : A/AAAA/CNAME, TXT de vérification).
3. En cas de perte du domaine lui-même : le parc desktop existant, avec ses hosts
   codés en dur, ne pourrait plus joindre le backend → impose une nouvelle
   version desktop pointant vers un nouveau domaine. **RTO élevé et douloureux** :
   traiter la propriété des domaines comme un actif P0 à transférer et sécuriser.

## 8. Registre des dépendances de reprise (à compléter au closing)

| Élément | Détenteur actuel | Localisation | Transfert requis |
|---|---|---|---|
| Clé privée licence P-256 | Serveur / hors dépôt | À préciser | Oui (P0) |
| Clé privée update Ed25519 | Env serveur | À préciser | Oui (P0) |
| Domaines garageflows.fr | Registrar | À préciser | Oui (P0) |
| Projet Postgres + PITR | Fournisseur cloud | Neon/Supabase | Oui |
| Secrets env cloud | Vault / env | À préciser | Oui |
| Compte Vercel Blob (installeurs) | Vercel | À préciser | Oui |

---

_Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`._
