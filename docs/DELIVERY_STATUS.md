# GarageFlow — État de livraison (plateforme avancée)

Récapitulatif de la transformation de GarageFlow en plateforme de gestion de
garage avancée : modules Premium + Copilot IA, chacun livré en **qualité
entreprise** (cœur déterministe, tests, API cloisonnée, documentation), audité
en revue adversariale, et couvert par des tests d'intégration bout-en-bout.

## Modules livrés (`src/lib/<module>` + `src/app/api/<module>` + `docs/<MODULE>.md`)

| # | Module | Cœur déterministe | API | Doc |
|---|---|---|---|---|
| 1 | Décodage VIN | `vin/` | `/api/vin` | VIN_DECODER |
| 2 | Catalogue pièces (type TecDoc) | `catalog/` | `/api/catalog` | CATALOG |
| 3 | Commande automatique fournisseurs | `suppliers/` | `/api/suppliers` | SUPPLIERS |
| 4 | Signature électronique | `signature/` | `/api/signatures` | SIGNATURE |
| 5 | Notifications intelligentes | `notifications/` | `/api/notifications/dispatch` | NOTIFICATIONS |
| 6 | Génération de devis assistée | `quote-gen/` | `/api/quotes/generate` | QUOTE_GENERATION |
| 7 | Détection pièces oubliées | `forgotten-parts/` | `/api/forgotten-parts` | FORGOTTEN_PARTS |
| 8 | OCR automobile (multi-documents) | `ocr/` | `/api/ocr` | OCR |
| 9 | Tableau de bord décisionnel | `dashboard/` | `/api/dashboard` | DASHBOARD |
| 10 | Prévisions (forecasting) | `forecast/` | `/api/forecast` | FORECAST |
| 11 | Analyse de rentabilité | `profitability/` | `/api/profitability` | PROFITABILITY |
| 12 | Rapports personnalisables | `reports/` | `/api/reports` | REPORTS |

### GarageFlow AI Copilot & sous-modules

| Sous-module | Cœur | API |
|---|---|---|
| Copilot conversationnel (routeur d'intentions, actions confirmées) | `copilot/` | `/api/copilot` |
| Couche LLM + garde anti-hallucination | `copilot-llm/` | (intégrée à `/api/copilot`) |
| Diagnostic intelligent (OBD + base de connaissances) | `diagnostic/` | `/api/diagnostic` |
| Optimisation des prix | `pricing/` | `/api/pricing` |
| Planification intelligente | `scheduling/` | `/api/scheduling` |
| Stock prédictif | `stock-forecast/` | `/api/stock-forecast` |
| Mémoire du garage | `memory/` | `/api/memory` |
| Gamification | `gamification/` | `/api/gamification` |
| Assistant proactif | `proactive/` | `/api/proactive` |

## Qualité & méthode

- **Cœur pur & déterministe** par module (aucun mock en production ; les
  fournisseurs externes — TecDoc, OCR, LLM, connecteurs fournisseurs — se
  branchent derrière des **interfaces** avec repli déterministe hors-ligne).
- **Toute action impactante est confirmation-gated** (aperçu sans écriture, puis
  persistance sur `confirm: true`), auditée (`logAudit`).
- **TypeScript strict**, validation **Zod**, cloisonnement par `garageId`,
  rate-limiting, i18n FR.
- **Tests : 79 → 390** (unitaires colocalisés + **intégration API sur base
  SQLite réelle** pour les 6 routes premium), `tsc --noEmit` propre, `prisma
  validate` OK.

### Revue adversariale (par module)

Chaque module a été audité par un workflow de 12–15 agents (relecture
multi-dimensions → vérification sceptique « réfute-par-défaut » de chaque
finding). Défauts réels confirmés puis corrigés, dont notamment :

- **Sécurité** : 1 IDOR inter-locataire (`/api/quotes/generate`), 1 ReDoS
  polynomial (`/api/ocr`), 5 contournements de la garde anti-hallucination du
  Copilot (parsing de nombres, laundering via `res.data`).
- **Correction** : transitivité des références croisées, faux « critique » de
  marge sans données, double-comptage de types de réparation, incohérence
  d'arrondi ligne à ligne, statut KPI « bon » sur valeur NaN, etc.
- **Qualité des tests** : un audit « mutation-thinking » a éliminé 6 assertions
  qui passaient à tort (isolation/DoS non réellement exercées) — désormais
  **vérifiées par mutation** (défaire la protection fait échouer le test).

## Reste à faire (hors de portée de l'agent — action humaine requise)

Deux actions **bloquent le déploiement** et ne peuvent pas être réalisées ici :

1. **Rotation des secrets exposés** dans l'historique git (voir
   `docs/ENTERPRISE_AUDIT.md` §0). La remédiation code (résolveur fail-closed,
   génération de secret Electron) est en place ; il faut invalider/renouveler
   les valeurs historiquement committées côté infrastructure.
2. **`npm run db:push`** en production pour appliquer les nouveaux modèles
   Prisma (`VinSearch`, `Signature`, `NotificationLog`) et les index/contraintes
   ajoutés. Le schéma est valide (`prisma validate`).

## Extensions (architecture prête, brancher un fournisseur)

Interfaces déjà en place, à connecter avec des clés/API réelles :

- `CatalogProvider` → API catalogue réelle (TecDoc…).
- `SupplierConnector` → API fournisseurs réelles (envoi de bons de commande).
- `OcrProvider` → moteur OCR réel (Tesseract / API vision).
- `LlmProvider` → Claude/OpenAI derrière la garde d'ancrage (repli déterministe
  garanti).
