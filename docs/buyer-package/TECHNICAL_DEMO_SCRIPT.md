# GarageFlow — Script de démonstration technique

*Public : équipe technique / CTO de l'acquéreur. Objectif : prouver la qualité du socle, pas survendre. Chaque affirmation est démontrable dans le code ou la CI. Durée cible : 45-60 min.*

Environnement de démo vérifié : `prisma db push` + `npm run db:seed` créent un « Garage Demo » avec **5 mécaniciens et 13 jobs** (`prisma/seed.ts`). Identifiant de démo étiqueté comme tel (`admingarageflow@admin.fr`) — ce n'est pas un secret du dépôt. `npm run db:reset` réinitialise.

---

## 0. Cadrage (3 min)

Annoncer le périmètre honnête d'emblée : « Je vais démontrer le socle sécurité/licensing/tests, qui est l'actif réel. Je signalerai explicitement ce qui est démo, façade ou à construire. » Poser les scores : technique 60, sécurité 70, transférabilité 45, global 54.

---

## 1. Lancer la suite de tests (8 min)

- `npm test` côté GarageFlowsV2 → montrer **678 tests passés / 0 échec** (sous-ensemble non-intégration), `tsc --noEmit` exit 0.
- `npm test` côté garagesite3 → **140 tests passés / 0 échec**, `tsc --noEmit` exit 0.
- Expliquer : ~857 cas au total, faible taux de mock, tests d'intégration réels sur SQLite via un template DB committé.
- Ouvrir `.github/workflows/ci.yml` (les deux dépôts) : typecheck + lint + build + migrations sur Postgres vierge + tests sur **Postgres 16 + Redis 7 réels** + gitleaks + audit de dépendances.
- Signaler honnêtement : **pas de tests E2E/UI** — toute la couche présentation est validée manuellement.

---

## 2. Isolation multi-tenant prouvée (7 min)

- Ouvrir `src/lib/__tests__/require-session-enforcement.test.ts` : montrer les assertions **401 sans session**, **403 pour la licence d'un autre garage**, **403 pour un device révoqué même avec cookie signé**.
- Montrer `src/lib/tenant.ts` (garde de relation 2nd-order IDOR) et un exemple de scoping inline `where:{ id, garageId }` dans `src/app/api/jobs/[id]/route.ts`.
- Message : l'isolation est en profondeur (middleware + requireSession + scoping requête + garde de relation), pas déclarative.

---

## 3. Licensing & control-plane (10 min)

- `src/lib/license/verify.ts` : vérification **ECDSA P-256** contre clé publique embarquée ; clé privée **côté serveur uniquement** — le dire clairement (bloquant P0).
- garagesite3 `src/lib/licenses/service.ts` : contrôle de sièges **transactionnel** (`SELECT … FOR UPDATE` + recomptage de contrôle) — TOCTOU-safe.
- `src/lib/server/rate-limit-distributed.ts` : rate-limiting **distribué fail-closed** (503 si Redis indisponible en prod).
- `src/lib/env.ts` + `instrumentation.ts` : refus de démarrer en prod si secrets manquants/faibles.

---

## 4. Sécurité desktop & mises à jour (10 min)

- `electron/main.js` : `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false` ; serveur Next lié à **127.0.0.1** ; navigation confinée au loopback.
- `electron/update-verify.js` : vérification **Ed25519** du manifeste, anti-downgrade, allowlist d'hôtes HTTPS.
- `electron/main.js` (chemin d'update) : **SHA-256 calculé et comparé timing-safe AVANT** de lancer l'installeur ; refus d'exécuter un binaire non vérifié.
- Honnêteté : intégrité anti-tamper **JS uniquement** (contournable par un reverser, auto-documenté) ; **binaire Windows non signé** (SmartScreen) ; enforcement licence **fail-open** hors-ligne ; **verrou dur à 72 h** (`app.quit()`).

---

## 5. Sauvegardes chiffrées (5 min)

- `src/lib/backup/crypto.ts` : **AES-256-GCM** authentifié, KDF scrypt ; snapshot/restore/verify/download côté service + routes admin.
- Honnêteté : **aucune UI** ne déclenche ces routes aujourd'hui (fonction « code-only ») — petit chantier UI à prévoir.

---

## 6. Ce qui est explicitement démo / non construit (5 min)

Montrer soi-même les limites (crédibilité) :
- `garagesite3/src/lib/api/store.ts` : commentaire « bac à sable … non persisté » — **API /api/v1 in-memory**, perd les données au cold start.
- Absence de code Factur-X/UBL/CII/Chorus/PDP (grep) → **zéro facturation électronique**.
- Absence de dépendance CSV/XLSX d'import → **pas d'assistant d'import**.
- Schéma `prisma/schema.prisma` : `Garage` comme tenant racine, **pas d'entité Organisation/Réseau**.

---

## 7. Vérification de bout en bout recommandée (à faire côté acquéreur)

Proposer, en condition suspensive : que l'acquéreur, une fois les clés privées et le backend transférés, **émette lui-même une licence** et **signe lui-même une mise à jour** de bout en bout. C'est le vrai test d'exploitabilité.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
