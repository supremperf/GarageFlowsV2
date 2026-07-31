# Réponse aux incidents — GarageFlow

> Document de data room (due diligence M&A). Décrit un processus **proposé**,
> aligné sur les mécanismes réellement présents dans le code. À ce jour il
> n'existe pas d'astreinte formalisée ni d'outillage d'alerting déployé : ce
> document en pose le cadre pour l'acquéreur.

## 1. Niveaux de sévérité

| Niveau | Définition | Exemples GarageFlow | Cible de prise en charge |
|---|---|---|---|
| **SEV-1 — Critique** | Panne globale ou perte de données ; impact commercial direct | Postgres cloud down (activation licence impossible, routes fail-closed 503) ; fuite de secret ; clés de signature compromises | Immédiate, 24/7 |
| **SEV-2 — Majeur** | Fonction clé dégradée, contournement possible | Vague de crashs sur une version publiée ; blob installeur indisponible ; SSE admin instable | < 4 h ouvrées |
| **SEV-3 — Mineur** | Impact limité, un poste / un client | Corruption SQLite d'un poste isolé ; bug UI non bloquant | < 2 jours ouvrés |
| **SEV-4 — Cosmétique** | Sans impact fonctionnel | Faute de libellé, log bruyant | Backlog |

Règle d'escalade : toute suspicion de **compromission de secret ou de clé
privée** est traitée **SEV-1 par défaut**, quel que soit l'impact apparent.

## 2. Astreinte et rôles (à formaliser)

| Rôle | Responsabilité |
|---|---|
| **Incident Commander (IC)** | Coordonne, décide, tient le fil de communication |
| **Opérateur technique** | Applique les runbooks (rollback, PITR, révocation) |
| **Communication** | Informe clients/parties prenantes selon §4 |

En structure réduite, une même personne peut cumuler IC + technique ; l'important
est de **nommer explicitement l'IC** au début de chaque incident. Pré-requis
d'astreinte à provisionner : accès au dashboard admin (`x-gf-key`), accès au
fournisseur Postgres (PITR), accès au registrar/DNS, accès au vault des secrets.

## 3. Cycle de vie d'un incident

1. **Détection** — via crash reports, health checks, remontée client, ou le
   dashboard admin temps réel (`/admin`, stats + SSE).
2. **Déclaration** — attribuer une sévérité, nommer l'IC, ouvrir un fil dédié.
3. **Confinement** — limiter l'impact (rollback release, mode maintenance,
   révocation d'appareil, rotation de secret).
4. **Éradication / correction** — appliquer le runbook adéquat.
5. **Rétablissement** — vérifier le retour à la normale sur un poste/parcours
   test.
6. **Post-mortem** — sans blâme, sous 5 jours ouvrés : chronologie, cause
   racine, actions correctives, mise à jour des runbooks.

## 4. Communication

| Sévérité | Interne | Externe (clients) |
|---|---|---|
| SEV-1 | Immédiate, IC + direction | Notification proactive ; ETA de rétablissement |
| SEV-2 | Fil incident | Si perceptible : message via le centre de notifications in-app |
| SEV-3/4 | Ticket | À la demande |

Levier produit : le plan de contrôle dispose d'un **centre de notifications
ciblées** (`notifications/service.ts`, `/api/notifications`,
`/admin/notifications`, avec accusés de réception) — utilisable pour informer les
postes clients d'un incident ou d'une maintenance. C'est un canal opérationnel
existant, pas à construire.

## 5. Triage des rapports de crash

Le pipeline de crash est **opérationnel** et alimente aussi le rollback (voir §6).

### Côté client (desktop)
- Reporting **opt-in, désactivé par défaut** (conformité RGPD).
- **Rédaction/minimisation** avant envoi : secrets, tokens, JWT, tokens de
  licence, URLs de base de données et noms d'utilisateur locaux sont expurgés
  (`electron/control-plane.js:104-157`). File d'attente hors-ligne.

### Côté serveur (garagesite3)
- `crashes/service.ts` : empreinte/regroupement (fingerprinting), statistiques,
  triage. Routes `/api/crash` (publique) et `/admin/crashes`.
- Marquage manuel « traité » : `setCrashHandled(id, handled)`.

### Procédure de triage
1. Ouvrir `/admin/crashes`, trier par groupe/fréquence.
2. Corréler avec `appVersion` : un pic concentré sur une version récente est un
   signal de rollback (§6).
3. Vérifier la sévérité (crash au démarrage vs. non bloquant) et l'étendue
   (nombre de **machines distinctes**, pas de rapports bruts — voir §6).
4. Marquer traité une fois la cause identifiée / le correctif publié.

## 6. Rollback automatique en cas de crashs (désormais câblé)

### Ce qui est vrai aujourd'hui
- La logique `autoRollbackIfUnhealthy` (`src/lib/releases/service.ts:206-228`)
  bascule en rollback les versions dont le nombre de **machines distinctes en
  crash** dépasse un seuil sur une fenêtre.
- **Anti-abus** : seules comptent les machines dont le HWID correspond à un
  **appareil enregistré** (`Device.hwidHash` = HMAC serveur). Les rapports
  anonymes ou aux HWID inventés ne pèsent pas — un attaquant devrait connaître N
  HWID réellement activés (`crashes/service.ts:crashCountForVersion`).
- **Déclenchement automatique désormais opérationnel** : une tâche planifiée
  Vercel Cron appelle `GET /api/cron/rollback-check` **toutes les heures**
  (`vercel.json` → `"schedule": "0 * * * *"`). L'endpoint est **fail-closed** :
  authentification par bearer `CRON_SECRET`, refus sinon
  (`src/app/api/cron/rollback-check/route.ts`, `verifyCronRequest`). Chaque
  rollback effectif est journalisé dans l'audit (`action: "auto_rollback"`).
- Seuils par défaut paramétrables : `ROLLBACK_CRASH_THRESHOLD` (10 machines) sur
  `ROLLBACK_WINDOW_MINUTES` (60 min).
- Un endpoint admin manuel équivalent existe aussi
  (`POST /api/admin/update/rollback-check`, auth `x-gf-key`) pour forcer un
  contrôle.

### Nuance d'honnêteté
Le cron est **horaire** : le délai de réaction maximal au pire cas est donc de
l'ordre d'une heure. Pour un rollback plus réactif, réduire la période du cron ou
déclencher aussi le contrôle depuis l'ingestion de crash. À noter que le cron
suppose l'environnement Vercel avec `CRON_SECRET` configuré ; sur un autre
hébergeur, il faut recréer un planificateur équivalent appelant la route.

## 7. Runbooks d'incident (renvois)

| Incident | Runbook |
|---|---|
| Corruption SQLite / perte poste | `docs/DISASTER_RECOVERY_PLAN.md` §3 |
| Perte / corruption Postgres | `docs/DISASTER_RECOVERY_PLAN.md` §4 |
| Compromission de secret | `docs/OPERATIONAL_RUNBOOK.md` §1 + `docs/SECRETS_ROTATION.md` |
| Révocation licence / appareil | `docs/OPERATIONAL_RUNBOOK.md` §2 |
| Rollback d'une release | `docs/OPERATIONAL_RUNBOOK.md` §3 |
| Perte clés de signature / domaines | `docs/DISASTER_RECOVERY_PLAN.md` §6-7 |

## 8. Lacunes connues (à provisionner)

- **Pas d'alerting automatisé** déployé (pas de PagerDuty/Opsgenie câblé) : la
  détection repose sur consultation du dashboard et remontées clients.
- **Admin mono-clé partagée** (`LICENSE_ADMIN_API_KEY` en `sessionStorage`) : pas
  de comptes par utilisateur ni de RBAC → l'audit ne trace pas « qui » a agi
  au-delà de `actor: "admin"`. À renforcer avant montée en gamme.

---

_Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`._
