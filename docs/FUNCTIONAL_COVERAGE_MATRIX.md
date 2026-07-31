# Matrice de couverture fonctionnelle — GarageFlow

Portée : `GarageFlowsV2` (app Desktop + serveur/PWA) et `garagesite3`
(control-plane / vitrine / PWA). Légende :

- **Desktop** = disponible dans l'app Electron (SQLite locale).
- **Web/PWA** = disponible en déploiement serveur PostgreSQL.
- **API** = route(s) `src/app/api/**` présentes.
- **DB** = modèle(s) Prisma.
- **Tests** = suite unitaire et/ou d'intégration présente.
- **Statut** : ✅ vérifié (exécuté pendant l'audit) · 🟢 implémenté + testé ·
  🟡 implémenté, tests partiels · ⚪ démo/hors-scope.

> Les colonnes « UI » ne sont pas dans ce tableau car l'interface Desktop est une
> SPA (12 `page.tsx`, navigation interne via store Zustand) : sa **visibilité
> réelle** par rôle n'a pas pu être parcourue à l'exécution (pas d'affichage
> graphique headless). Voir `docs/REMAINING_RISKS.md` (R-UI).

## GarageFlowsV2 — métier atelier

| Fonctionnalité | Desktop | Web/PWA | API | DB | Tests | Statut |
|---|---|---|---|---|---|---|
| Authentification (NextAuth, bcrypt) | ✓ | ✓ | `auth/[...nextauth]` | User | oui | ✅ 401 vérifié à l'exécution |
| Garages (multi-tenant, compteurs) | ✓ | ✓ | `garages` | Garage | oui | 🟢 |
| Rôles & permissions (serveur) | ✓ | ✓ | (transversal) | User | oui | 🟢 |
| Clients | ✓ | ✓ | `clients` | Client | oui | 🟢 |
| Véhicules (+ timeline, alertes CT) | ✓ | ✓ | `vehicles/**` | Vehicle | oui | 🟢 |
| Rendez-vous | ✓ | ✓ | `appointments/**` | Appointment | oui | 🟢 |
| Ordres de réparation / interventions | ✓ | ✓ | `jobs/**`, `work-orders/**` | Job | oui | 🟢 |
| Planning atelier | ✓ | ✓ | `scheduling` | Job/Mechanic | oui | 🟢 |
| Devis (+ signature, conversion) | ✓ | ✓ | `quotes/**` | Quote | oui | 🟢 |
| Factures (numérotation atomique) | ✓ | ✓ | `invoices/**` | Invoice | oui | ✅ transaction+unique vérifiée (lecture) |
| Paiements / soldes | ✓ | ✓ | `invoices/[id]` | Payment | oui (`money`) | ✅ calculs centimes testés |
| Stock / pièces / bas-stock | ✓ | ✓ | `parts/**` | Part | oui | 🟢 |
| Fournisseurs | ✓ | ✓ | `suppliers` | Supplier | oui | 🟢 |
| Commandes & réception (TOCTOU) | ✓ | ✓ | `purchase-orders/**` | PurchaseOrder | oui | 🟢 transaction |
| Véhicules de prêt | ✓ | ✓ | `loaner-vehicles/**`, `loaner-reservations/**` | LoanerVehicle | oui | 🟢 |
| Garanties (+ alertes) | ✓ | ✓ | `warranties/**` | Warranty | oui | 🟢 |
| Main-d'œuvre / catalogue | ✓ | ✓ | `labor-operations/**`, `catalog` | LaborOperation | oui | 🟢 |
| Photos / documents / signatures | ✓ | ✓ | `photos/**`, `signatures`, `jobs/[id]/photos` | Photo | oui | 🟢 |
| Génération PDF (devis/factures) | ✓ | ✓ | (client jsPDF) | — | oui | 🟢 |
| Tableau de bord & stats | ✓ | ✓ | `dashboard`, `stats`, `reports` | — | oui | 🟢 |
| Export FEC | ✓ | ✓ | `export/fec` | — | oui | 🟢 |
| Profitabilité / prévisions / stock-forecast | ✓ | ✓ | `profitability`, `forecast`, `stock-forecast` | — | oui | 🟢 |
| Copilot IA (Anthropic) | ✓ | ✓ | `copilot/**` | — | oui | 🟡 dépend d'`ANTHROPIC_API_KEY` |
| OCR / plaque / VIN | ✓ | ✓ | `ocr`, `plate-*`, `vin` | — | oui | 🟢 |
| Portail client (auth, 2FA, tickets) | ✓ | ✓ | `portal/**` | PortalUser | oui | 🟢 scoping vérifié (lecture) |
| Notifications / rappels | ✓ | ✓ | `notifications/**`, `reminders/**` | Notification | oui | 🟢 |
| Sauvegardes (chiffrées) | ✓ | ✓ | `admin/backups/**` | — | oui | 🟢 |
| Licences (activation/statut/appareils) | ✓ | ✓ | `license/**`, `admin/licenses/**` | LicenseKey/Device | oui | ✅ session licenciée vérifiée (PG réel) |
| Migrations internes | ✓ | ✓ | `internal/migrate` | `_gf_migrations` | oui | ✅ 401 sans clé vérifié |

## GarageFlowsV2 — Desktop / Electron

| Fonctionnalité | API/module | Tests | Statut |
|---|---|---|---|
| Fenêtres durcies (isolation/sandbox/webSecurity) | `electron/main.js` | — | ✅ vérifié (lecture : toutes fenêtres) |
| Pont IPC (contextBridge, invoke-only) | `electron/preload.js` | — | ✅ vérifié (lecture) |
| Base SQLite locale + template | `electron/main.js`, `prisma/` | oui | ✅ boot standalone `db:connected` |
| Mise à jour signée (SHA-256 + signature) | `electron/update-verify.js` | oui | 🟢 (packaging Windows non exécuté) |
| Crash reporting (avec consentement) | `electron/*`, `admin/crashes` | oui | 🟢 |

## garagesite3 — control-plane / vitrine / PWA

| Fonctionnalité | Web | API | DB | Tests | Statut |
|---|---|---|---|---|---|
| Serveur de licences (source de vérité) | ✓ | `license/**`, `admin/licenses/**` | LicenseKey | oui | ✅ `license/check` fail-closed testé |
| Sièges & appareils (TOCTOU) | ✓ | `admin/devices/**` | Device | oui | ✅ **9 tests concurrence PG réel** |
| Modules / entitlements | ✓ | `admin/modules/**` | LicenseModule | oui | 🟢 |
| Mises à jour signées (publish/rollback) | ✓ | `admin/update/**`, `update/**` | AppRelease | oui | 🟢 |
| Crash intake | ✓ | `crash`, `admin/crashes/**` | Crash | oui | 🟢 |
| Notifications admin (SSE cookie) | ✓ | `admin/stream`, `admin/stream-token` | Notification | oui | ✅ clé hors URL (cookie `gf_sse`) |
| Rate limiting distribué | ✓ | (middleware) | — | oui | ✅ **4 tests Redis réel** |
| Vitrine (blog, RGPD, sécurité, downloads) | ✓ | — | — | — | 🟢 |
| Leads / newsletter / contact | ✓ | `newsletter/**`, `contact` | Lead | oui | 🟢 |
| API v1 (démonstration) | ✓ | `v1/**` | (in-memory) | oui | ⚪ **bac à sable, non persisté** |

---

### Fonctionnalités « présentes dans le code » — visibilité UI

Toutes les fonctionnalités ci-dessus disposent d'une route/module. La
**vérification de leur exposition dans la navigation Desktop par rôle** (Phase
4.3 du cahier des charges — « fonctionnalités invisibles ») requiert l'exécution
de l'interface graphique, non réalisable dans cet environnement headless. C'est
un **risque résiduel documenté** (`REMAINING_RISKS.md` → R-UI) à lever par un
passage E2E (Playwright) sur l'app packagée.
