# Responsive GarageFlow — portrait, paysage, tablette, desktop, PWA

Refonte responsive de `app.garageflows.fr` : l'application n'est plus une version
desktop compressée sur mobile. Chaque orientation dispose d'une vraie mise en page,
sans perte de fonctionnalité ni régression desktop / Electron.

## 1. Causes réelles des problèmes (avant)

| Symptôme signalé | Cause dans le code |
|---|---|
| L'« Assistant IA » prend presque toute la largeur, planning inutilisable derrière | `page.tsx` : `<aside class="w-72">` **fixe à 288 px**, toujours ouvert, à côté du planning → sur 375 px il ne reste ~87 px pour le planning |
| Boutons du menu supérieur coupés / inaccessibles | `Header` : 2 lignes d'outils (~15 boutons) en `overflow-x-auto`, pensées pour desktop |
| 4 colonnes de mécaniciens illisibles sur téléphone | `ScheduleBoard` : colonnes `flex-1` côte à côte, sans mode mobile |
| Interface qui dépasse / scroll horizontal | largeurs fixes des drawers (`w-[480px]`, `w-[520px]`…) supérieures au viewport |
| Contenu coupé sous l'encoche / la barre d'accueil iOS | pas de `viewport-fit=cover` ni de gestion `env(safe-area-inset-*)` |
| Bas de page masqué par les barres Safari | hauteurs basées sur `100vh` (viewport large) au lieu de `100dvh` |
| « 376min », « 600min » collés | interpolation brute dans `ai-engine.ts` |

## 2. Stratégie de breakpoints (centralisée dans `tailwind.config.ts`)

| Nom | Largeur | Cible | Comportement clé |
|---|---|---|---|
| `xs` | ≥ 480 px | Mobile large | Affiche le nom du logiciel dans le header |
| `sm` | ≥ 640 px | Mobile large / petit paysage | Rétablit pastilles de stats + nom du garage |
| `md` | ≥ 768 px | Tablette portrait / paysage téléphone | **Bascule majeure** : barre d'outils desktop + assistant en colonne + fin de la nav mobile |
| `lg` | ≥ 1024 px | Tablette paysage / petit ordinateur | Libellés des boutons d'outils, assistant plus large |
| `xl` | ≥ 1280 px | Desktop | Pleine densité |

Une seule source de vérité : les mêmes valeurs sont exposées à JS via `src/hooks/useMediaQuery.ts` (`BP`).

## 3. Différences portrait / paysage / tablette / desktop

- **Mobile portrait (< md)** : header compact ; planning pleine largeur, **un mécanicien à la fois** (onglets + flèches) ; assistant IA en **bottom-sheet** ; **barre de navigation inférieure** (Planning · Atelier · Ajouter · Assistant · Plus) ; menu « Plus » = tous les modules.
- **Paysage téléphone / tablette (≥ md, < lg)** : barre d'outils compacte + **assistant en colonne** à droite (~60/40) repliable ; planning multi-colonnes.
- **Tablette paysage / desktop (≥ lg)** : libellés complets, densité maximale, comportement historique préservé.

## 4. Composants créés / réutilisables

- `hooks/useMediaQuery.ts` — `useMediaQuery`, `useIsMobile`, `useIsBelowLg`, `useIsShortLandscape` (SSR-safe).
- `components/GfDrawer.tsx` — bottom-sheet / drawer latéral générique : fond bloqué, Échap, restauration du focus, bouton ✕ toujours visible, zones sûres iOS, `role="dialog"`.
- `components/MobileNav.tsx` — barre inférieure + menu « Plus » (accès à **tous** les modules, thème, langue, déconnexion).

## 5. Zones sûres iOS & viewport

- `layout.tsx` : `viewport-fit=cover`, zoom autorisé (accessibilité).
- `globals.css` : utilitaires `.h-app` / `.max-h-modal` (`100vh → 100svh → 100dvh` avec repli), `.pt-safe` / `.pb-safe` / … (`env(safe-area-inset-*)`), verrou de défilement, cibles tactiles 44 px sur pointeur grossier.
- Toutes les barres fixes (header, nav inférieure, drawers, panneaux plein écran) intègrent les zones sûres.

## 6. Suppression des débordements (sans les masquer)

Chaque cause traitée à la source : drawers `w-[Npx]` → `w-full max-w-[Npx]` ; coupure des longues chaînes (`overflow-wrap`) ; grilles Tailwind déjà en `minmax(0,1fr)` ; table de réception en scroll horizontal maîtrisé. Le seul garde-fou global (`max-width:100%` sur `html,body`) est un filet de sécurité, pas un cache-misère.

## 7. Tests

- **Unitaires** (`vitest`) : formateurs de durée (plus aucune forme « Xmin »).
- **E2E responsive** (`Playwright`, `e2e/responsive.spec.ts`, `playwright.config.ts`) : absence de débordement horizontal à toutes les résolutions, visibilité de la nav mobile et du bouton principal, ouverture/fermeture de l'assistant, accès aux autres mécaniciens, menu « Plus », adaptation à la rotation, non-régression desktop.
  Gabarits testés : 320×568, iPhone 12 (portrait/paysage), iPad Mini (portrait/paysage), 1440×900.

```bash
npm test           # unitaires
BASE_URL=http://localhost:3000 npm run test:e2e   # E2E (app en cours d'exécution requise)
```

## 8. Résultats

- `next build` : ✅ succès (15 pages).
- `vitest` : suite verte. Le **compte de tests faisant foi** (unique, daté,
  rattaché à un commit) est tenu dans `docs/PRODUCTION-READINESS.md` §3 — ne pas
  dupliquer de chiffre ici pour éviter toute divergence (AUD-042).

## 9. Limites restantes

- La suite Playwright **authentifiée** nécessite une instance en fonctionnement + une base de données PostgreSQL amorcée (indisponible dans l'environnement CI de ce commit) ; les tests de la page de connexion, eux, s'exécutent sans authentification. Les captures avant/après nécessitent donc un déploiement.
- Le passage un-mécanicien ↔ multi-colonnes s'appuie sur `matchMedia` (JS) car il change la *logique* d'affichage : une très brève transition de mise en page peut apparaître à l'hydratation sur mobile.
