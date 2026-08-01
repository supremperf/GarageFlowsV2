# Tests E2E (Playwright) — guide (état réel)

_Décrit une suite E2E **réellement exécutée et VERTE** (10/10) contre
l'application en fonctionnement (navigateur Chromium + serveur Next + base
SQLite semée). Données 100 % fictives._

## Résultat vérifié
`npx playwright test` → **10 passed** (≈ 54 s), Chromium réel, serveur Next dev
réel, base E2E semée avec **deux garages** (A et B) pour éprouver l'isolation.

## Parcours couverts (8 journeys)
1. Connexion réussie du propriétaire (UI réelle).
2. Échec de connexion (mauvais mot de passe) → message d'erreur.
3. Route protégée sans session → redirection vers `/login`.
4. **Isolation multi-tenant A** : A ne voit que ses clients (aucune fuite de B).
5. **Isolation multi-tenant B** : B ne voit que ses clients.
6. Tableau de bord accessible après connexion.
7. Création d'un client (persistée, visible dans la liste).
8. Import CSV de clients (dry-run puis exécution) ; décision d'abonnement
   serveur ; liste des employés réservée au propriétaire.

## Comment ça marche
- `playwright.config.ts` démarre `next dev` sur le port 3100 avec une base
  SQLite E2E dédiée et un secret de test, et utilise le **Chromium
  pré-installé** (`/opt/pw-browsers`, aucun téléchargement).
- `e2e/global-setup.ts` pousse le schéma, sème deux garages + propriétaires +
  clients, puis **mint un cookie `gf_session` de TEST** (JWT signé avec le secret
  de test) injecté via `storageState` pour franchir le middleware de licence.
  L'enforcement de licence côté API est neutralisé pour les tests
  (`LICENSE_ENFORCEMENT=off`). **Ce sont des contournements de TEST, jamais de
  production.**
- Les parcours combinent l'**UI réelle** (connexion via le formulaire) et les
  **endpoints API réels** (via le contexte navigateur authentifié), ce qui rend
  l'isolation multi-tenant vérifiée de bout en bout.

## Lancer
```bash
npm run test:e2e        # démarre le serveur, sème, exécute les 8 parcours
```
En cas de première compilation lente (dev), l'assistant de connexion retente la
soumission (voir `e2e/helpers.ts`).

## Réserves (honnêteté)
- Exécutés en mode **dev** (`next dev`). En CI, prévoir un runner avec Chromium
  (le workflow `.github/workflows/e2e.yml` installe Playwright et lance la suite).
- Le contournement de licence est **strictement réservé aux tests** ; en
  production réelle, le portail de licence reste actif.
