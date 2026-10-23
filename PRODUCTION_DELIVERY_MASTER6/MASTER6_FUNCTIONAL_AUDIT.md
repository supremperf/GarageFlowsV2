---
doc-numbers: journal
---

# AUDIT FONCTIONNEL — rapport MASTER 6

**Verdict : les trois points mis en arbitrage par MASTER 5 sont tranchés sur mesure.** L'un des trois constats de MASTER 5 était **erroné** et est corrigé ici. Deux relèvent d'une décision produit qui vous appartient.

Méthode : requêtes HTTP réelles depuis un navigateur dont la session a été ouverte par une **activation de licence authentique** — pas une session forgée. 8 contrôles sur 8 réussis, 12 constats relevés.
Preuve : `MASTER6_EVIDENCE/logs/14-arbitrage-metier.txt`.

---

## 1. Correction de stock — LE CONSTAT MASTER 5 ÉTAIT FAUX

### Ce que MASTER 5 affirmait

> « la quantité n'est PAS modifiable directement par `PATCH /api/parts/:id` — les mouvements passent par les bons de commande et les pièces d'intervention »

### Ce qui est réellement vrai

Une fonction de **correction d'inventaire** existe, et elle est soignée. `PATCH /api/parts/:id` accepte `{ quantity, expectedQuantity }` :

| Contrôle | Mesure |
|---|---|
| `{ quantity: 7 }` sans `expectedQuantity` | **400** `EXPECTED_QUANTITY_REQUIRED` |
| `{ quantity: 7, expectedQuantity: 10 }` | **200**, quantité relue = **7** |
| `{ quantity: 3, expectedQuantity: 10 }` (valeur périmée) | **409** `STOCK_CONFLICT` |

La correction écrit un mouvement `ADJUST` **dans la même transaction**, avec un motif généré : `« Correction d'inventaire (10 → 7) »`. L'écriture est **conditionnée** par `updateMany … where: { quantity: observee }` : si le stock a bougé depuis l'affichage, zéro ligne touchée — on ne réécrit pas par-dessus le travail d'un autre.

Le commentaire du code dit exactement pourquoi :

> « la correction manuelle, elle, ne laissait rien. L'origine d'un écart devenait irreconstituable. »

### Pourquoi je m'étais trompé

Mon sondage MASTER 5 envoyait `{ quantity: 4 }` seul, recevait **400**, et j'en ai conclu que le champ était refusé. En réalité le 400 **nommait le champ manquant** — je n'avais pas lu le code de la route avant de conclure. Le modèle `StockMovement` porte d'ailleurs `ADJUST` explicitement (« correction »), et un test d'intégration dédié (`src/integration/part-inventory-adjustment.test.ts`) l'atteste.

### La seule lacune réelle

Le mandat demande qu'un ajustement crée un mouvement traçable « avec motif, date, utilisateur et quantité ».

| Élément | État |
|---|---|
| motif | ✅ `reason` |
| date | ✅ `createdAt` |
| quantité | ✅ `quantityDelta` signé |
| **utilisateur** | ❌ **`StockMovement` ne porte aucun champ d'auteur** |

**Proposition** (non appliquée) : ajouter `actorUserId String?` + `actorRole String?` à `StockMovement`, les renseigner depuis `session.user` dans les six routes qui créent des mouvements, et indexer `[garageId, actorUserId]`. Migration **additive**, sans perte : les mouvements existants gardent un auteur nul, ce qui est honnête — on ne sait pas qui les a faits.

---

## 2. Suppression et archivage des clients et véhicules — CONSTAT CONFIRMÉ

### Mesures

| Contrôle | Résultat |
|---|---|
| `DELETE /api/clients/:id` — client **sans** historique | **405** |
| `DELETE /api/vehicles/:id` — véhicule **sans** historique | **405** |
| `DELETE /api/clients/:id` — client **avec** facture | **405** |
| `PATCH` avec `archivedAt`, `deletedAt`, `archived`, `isArchived` | **200**, mais **champ absent en relecture** |

Le 200 sur `PATCH` est trompeur : la route applique une **liste blanche** de champs et ignore silencieusement les inconnus. Aucune capacité d'archivage n'existe.

### Pourquoi la suppression ne peut pas fonctionner

`Client` est référencé par `Vehicle`, `Quote`, `Invoice`, `Reminder` et `PortalUser`. `Vehicle` l'est par `Job`, `Reminder`, `Quote`, `Invoice`, `Inspection` et `Warranty`. **Aucune** de ces relations ne déclare `onDelete` — Prisma applique donc `Restrict` : la base **refuserait** la suppression de tout client ayant le moindre historique.

L'absence de route `DELETE` est donc **cohérente avec le modèle de données**, pas un oubli.

### Ce qui manque vraiment

Un garage qui saisit un client par erreur, ou dont un client part définitivement, n'a **aucun moyen** de le retirer de ses listes. Or `Mechanic` porte déjà `archivedAt` avec la bonne sémantique :

> « NULL = actif. Un mécanicien archivé sort du planning et ne peut plus recevoir d'intervention, mais son historique reste intact et lisible. »

### Proposition de migration — ADDITIVE, réversible

| Étape | Contenu |
|---|---|
| schéma | `archivedAt DateTime?` sur `Client` et `Vehicle`, + index `[garageId, archivedAt]` |
| API | `PATCH /api/clients/:id` et `/api/vehicles/:id` acceptent `archivedAt` (pose et retrait = restauration) |
| lectures | `GET /api/clients` et `/api/vehicles` filtrent `archivedAt: null` par défaut, avec `?includeArchived=1` |
| protections | un véhicule ne peut être archivé s'il porte une intervention en cours ; un client archivé n'apparaît plus à la création de devis ou facture |
| suppression définitive | **non proposée** — les factures doivent être conservées (obligation comptable), et le modèle l'interdit déjà |
| retour arrière | retirer la colonne ; aucune donnée existante n'est transformée |
| risques | faible — purement additif. Le seul point d'attention est de n'oublier **aucune** lecture, sinon un client archivé réapparaîtrait dans un écran |

**Rien n'a été appliqué** : le mandat exige une validation avant migration.

---

## 3. Copilote IA — local et déterministe, et le produit le dit

### Mesures

| Contrôle | Résultat |
|---|---|
| `POST /api/copilot { query, history }` | **200** |
| forme de la réponse | `type, intent, message, confidence, slots, understanding, planning` |
| **`understanding`** | **`"local"`** |
| deux appels identiques → même réponse | **oui** (déterministe) |
| `GET /api/copilot/report` | **200** |
| requête hors contrat (501 caractères) | **400** |

Réponse réellement obtenue sur une question d'inventaire :

> « Je ne peux pas répondre avec certitude. Donnez le module, la période ou une référence. Je peux expliquer le logiciel, consulter ses indicateurs disponibles et retrouver une intervention, mais pas modifier ou supprimer… »

### Ce qui fonctionne, ce qui est absent

| Élément | État |
|---|---|
| moteur local déterministe | **fonctionne** — répond, borne son périmètre, annonce ses limites |
| contrat d'entrée | **appliqué** — `{ query ≤ 500, history ≤ 6 }`, strict |
| transparence du moteur | **oui** — le champ `understanding` vaut `local`, pas `llm` |
| appel à un modèle externe | **jamais émis**, même avec une clé valide |
| `GARAGEFLOW_LLM` / `ANTHROPIC_API_KEY` en production | **absentes** — cohérent |

Le code explique pourquoi les sorties sont fermées :

```ts
// There is currently NO independently verified monetary enforcement service.
// Keep all production IO closed, even with valid server key/model/opt-in.
if (!this.simulatedTransport) { this.attempt = { outcome: 'budget_blocked', … }; return null }
```

**Ce n'est pas une réponse simulée** : c'est un autre moteur, et `providerHealth()` rapporte honnêtement `unavailable` pour le fournisseur externe. Aucune connexion n'est feinte, aucun appel n'est déclaré réussi sans réponse.

### Décision à prendre

Deux voies, aucune engagée (et **aucun crédit payant consommé**) :

1. **Assumer le mode local** — documenter que le copilote est un assistant déterministe sur données internes, et retirer `GARAGEFLOW_LLM`/`ANTHROPIC_API_KEY` de la documentation d'environnement pour éviter de laisser croire qu'un modèle distant est branché.
2. **Ouvrir la voie externe** — exige de mettre en service le contrôle de plafond monétaire indépendant que le code attend, puis de lever le court-circuit. Le reste de l'infrastructure (client, contrat JSON, bornage de réponse à 16 Ko, circuit ouvert 30 s, délai, journalisation sans données client) est **déjà écrit et testé**.

### Confidentialité et persistance

L'historique conversationnel est fourni **par l'appelant** à chaque requête (`history`, ≤ 6 tours) et n'est pas persisté côté serveur par cette route. Aucune donnée client ne part vers un tiers — puisque rien ne part. Les conversations existantes ne sont pas affectées.

---

## 4. Observation secondaire — ordre des contrôles sur une route interne

`POST /api/internal/einvoicing/queue` évalue le **drapeau de fonctionnalité avant l'autorisation** :

```
fonction désactivée, sans jeton  → 409 FEATURE_DISABLED
fonction activée,   sans jeton   → 401 UNAUTHORIZED
fonction activée,   mauvais jeton → 401 UNAUTHORIZED
```

L'autorisation est **correcte** (vérifié dans les deux cas). Mais un appelant non authentifié peut distinguer « fonction éteinte » de « fonction allumée » — divulgation mineure d'état de configuration. Inverser l'ordre serait un changement de comportement : signalé, non appliqué.

---

## 5. Modules vérifiés par ailleurs

Au-delà des trois arbitrages, la couverture fonctionnelle de MASTER 5 reste valide et a été rejouée : clients, véhicules, planning, facturation (numérotation `FAC-2026-001`, TVA calculée serveur, facture émise non supprimable → 409, annulation possible), stock, utilisateurs, paramètres (48 champs), santé. Les 135 tests Playwright y ajoutent les parcours d'interface sur 6 gabarits.

Voir `MASTER6_TEST_RESULTS.md` pour la synthèse chiffrée.
