# Guide de migration des données

> Document de data room — diligence technique M&A. Rédigé pour un acquéreur.
> Distinction stricte : **EXISTANT** (codé et opérationnel) vs **CONCEPTION / PROPOSITION** (non construit, feuille de route).

## 1. Résumé honnête de l'état actuel

**Il n'existe aujourd'hui AUCUN assistant d'import généraliste** (CSV / Excel / JSON) dans GarageFlow.
La seule fonction d'import en lot présente dans le code est **très étroite** :

- `POST /api/labor-operations/bulk-import` — insertion transactionnelle d'un lot d'**opérations de main-d'œuvre** uniquement (`name`, `category`, `durationMin`, `unitPrice`, `description`), validées puis créées dans une seule `prisma.$transaction`.
  Fichier : `src/app/api/labor-operations/bulk-import/route.ts`.
- Il n'y a **pas** de mapping de colonnes, **pas** de détection de doublons, **pas** de dry-run, **pas** de format CSV/Excel, **pas** d'import de clients / véhicules / factures / devis / stock.

Par ailleurs, un **export** comptable existe (`src/app/api/export/fec/route.ts`, format FEC), mais l'export n'est pas un chemin de migration entrant.

En conséquence : pour un acquéreur, **la reprise de données depuis un logiciel de garage tiers est aujourd'hui une opération manuelle** (voir §3), et un importeur professionnel reste **à construire** (voir §4, marqué CONCEPTION).

| Capacité | Statut |
|---|---|
| Import en lot d'opérations de main-d'œuvre (API) | EXISTANT (opérationnel, périmètre étroit) |
| Export FEC (comptabilité) | EXISTANT (sortant, non migration entrante) |
| Assistant d'import CSV/Excel/JSON multi-entités | NON CONSTRUIT — CONCEPTION ci-dessous |
| Mapping de colonnes, dry-run, dédoublonnage, rollback | NON CONSTRUIT — CONCEPTION ci-dessous |
| Modèles/templates d'import téléchargeables | NON CONSTRUIT — CONCEPTION ci-dessous |

## 2. Contexte modèle de données (pour cadrer une migration)

- Persistance de production : **SQLite/Prisma embarqué** dans l'application desktop (37 modèles). Une installation = **un garage** (`garageId`), pas de hiérarchie multi-garage au niveau opérationnel.
- Numérotation documentaire (factures/devis/OR/BC) **séquentielle et transactionnelle** (compteur incrémenté dans la même transaction que la création). Toute reprise de données doit respecter cette contrainte : **ne pas réinjecter des numéros en conflit** avec `@@unique([garageId, number])`.
- Immutabilité : une facture dont le statut n'est plus `draft` **ne peut plus être modifiée ni supprimée** (`src/app/api/invoices/[id]/route.ts`). Une migration doit donc importer les factures historiques **dans le bon état** dès l'insertion.
- Cohérence des montants en centimes entiers (`src/lib/billing.ts`, `src/lib/money.ts`).

Ces règles rendent une migration « brute » risquée : d'où la nécessité de l'importeur transactionnel décrit au §4.

## 3. Procédure de migration manuelle utilisable AUJOURD'HUI

Cette procédure est réalisable avec l'existant, sans développement supplémentaire. Elle convient à un garage de taille modérée (centaines de clients/véhicules).

### 3.1 Préparation
1. **Sauvegarde** de la base cible avant toute opération (l'app effectue déjà des backups horaires/quotidiens/hebdomadaires ; en faire un manuel supplémentaire).
2. Export depuis l'ancien logiciel vers CSV/Excel (clients, véhicules, historique).
3. Nettoyage hors-ligne (tableur) : normalisation des plaques (`MAJUSCULES`, séparateur `-`), dates au format `YYYY-MM-DD`, dédoublonnage manuel sur email/téléphone/plaque.

### 3.2 Saisie / injection
- **Voie assistée par l'UI** : créer les fiches clients puis véhicules via l'interface. Les champs VIN/plaque bénéficient du décodage VIN et de la recherche par plaque (voir INTEGRATION_ARCHITECTURE.md) pour accélérer la saisie.
- **Voie technique (accès base requis)** : pour un volume important, un prestataire peut écrire un script Prisma ponctuel s'appuyant sur les modèles existants (`Client`, `Vehicle`, `Invoice`, …) en respectant : tenant `garageId`, numérotation, statuts de facture, montants en centimes. **Ceci nécessite un accès direct au fichier SQLite / à l'environnement de build** — à marquer comme dépendance externe dans un plan de transfert.

### 3.3 Historique de facturation
- Importer les factures **déjà émises** directement en statut `sent`/`paid` (pas `draft`) pour respecter l'immutabilité.
- **Limite connue** : pas de modèle Avoir (`CreditNote`) ni Paiement (`Payment`) — l'historique des avoirs et des règlements partiels **ne peut pas être fidèlement repris** aujourd'hui (voir audit e-invoicing). À signaler au vendeur.

### 3.4 Vérification
- Contrôler les totaux HT/TTC/TVA sur un échantillon.
- Vérifier l'unicité des numéros de documents.
- Conserver le fichier source comme piste d'audit.

## 4. CONCEPTION — Importeur professionnel (NON CONSTRUIT — feuille de route)

> Tout ce qui suit est une **proposition d'architecture**, pas une fonctionnalité existante. Aucun code ci-dessous n'est présent dans le dépôt.

### 4.1 Objectifs
Un assistant d'import robuste, multi-entités (clients, véhicules, opérations, pièces/stock, devis, factures historiques), sûr pour un utilisateur non technique.

### 4.2 Formats d'entrée
- **CSV** (délimiteur auto-détecté `,`/`;`/tab, encodage UTF-8/Latin-1).
- **Excel** (`.xlsx`, première feuille ou feuille sélectionnable).
- **JSON** (tableau d'objets), pour intégrations programmatiques.

### 4.3 Pipeline proposé
1. **Upload + détection de schéma** : lecture des en-têtes, échantillon des 20 premières lignes.
2. **Mapping de colonnes** : interface glisser-déposer associant chaque colonne source à un champ cible ; mappings sauvegardables et réutilisables (« profils d'import » par logiciel d'origine).
3. **Validation ligne à ligne** : types, champs requis, formats (plaque, VIN, dates, email), avec rapport d'erreurs exportable.
4. **Dry-run (simulation)** : exécution complète **sans écriture**, produisant un rapport « X créés / Y mis à jour / Z ignorés / N erreurs » — obligatoire avant l'import réel.
5. **Dédoublonnage** : clés de rapprochement configurables (email, téléphone, plaque, VIN) ; stratégie par ligne : *créer* / *fusionner* / *ignorer*.
6. **Import transactionnel** : chaque lot enveloppé dans une transaction Prisma ; respect de la numérotation séquentielle et des statuts d'immutabilité.
7. **Rollback** : point de restauration (snapshot du fichier SQLite) pris avant l'import ; en cas d'échec partiel, restauration atomique. Journalisation dans l'`AuditLog`.
8. **Modèles téléchargeables** : un fichier gabarit CSV/Excel par entité, avec colonnes attendues et exemples.

### 4.4 Interface d'abstraction proposée (illustrative, non implémentée)
```ts
// CONCEPTION — n'existe pas dans le code
interface ImportSource { readRows(): AsyncIterable<Record<string, unknown>> } // CSV | XLSX | JSON
interface FieldMapping { source: string; target: string; transform?: (v: unknown) => unknown }
interface ImportPlan { entity: 'client'|'vehicle'|'invoice'|'part'|'labor_operation'
  mapping: FieldMapping[]; dedupeKeys: string[]; onConflict: 'create'|'merge'|'skip' }
interface ImportRunner {
  dryRun(source: ImportSource, plan: ImportPlan): Promise<ImportReport>
  commit(source: ImportSource, plan: ImportPlan): Promise<ImportReport> // transactionnel + rollback
}
```
Cet importeur pourrait **réutiliser** l'endpoint transactionnel existant `labor-operations/bulk-import` comme brique de référence pour les autres entités.

### 4.5 Estimation d'effort (indicative)
Développement d'un importeur complet multi-entités avec dry-run, dédoublonnage, mapping persistant et rollback : **effort de plusieurs semaines-personnes**, principalement UI + validation métier + tests. Aucune dépendance externe bloquante (contrairement aux clés de signature).

## 5. Points de vigilance acquéreur
- L'import multi-entités est un **manque** ; le matériel commercial ne doit pas le présenter comme livré.
- La reprise fidèle d'un historique comptable est **limitée** tant qu'Avoir/Paiement ne sont pas modélisés.
- Toute migration technique de volume requiert un **accès à l'environnement** (fichier SQLite / build) — dépendance de transfert externe.

---
*Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
