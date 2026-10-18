# Responsive GarageFlow — portrait, paysage, tablette, desktop, PWA

Refonte responsive de `app.garageflows.fr` : l'application n'est plus une version
desktop compressée sur mobile. Chaque orientation dispose d'une vraie mise en page,
sans perte de fonctionnalité ni régression desktop / Electron.

## 1. Causes réelles des problèmes (avant)

| Symptôme signalé | Cause dans le code |
|---|---|
| L'« Assistant IA » prend presque toute la largeur, planning inutilisable derrière | `page.tsx` : `<aside class="w-72">` **fixe à 288 px**, toujours ouvert, à côté du planning → sur 375 px il ne reste ~87 px pour le planning |
| Boutons du menu supérieur coupés / inaccessibles | `Header` : 2 lignes d'outils (~15 boutons) en `overflow-x-auto`, pensées pour desktop — **et défilant verticalement** (voir §10, 16/10/2026) |
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

Une référence unique de breakpoints : les mêmes valeurs sont exposées à JS via `src/hooks/useMediaQuery.ts` (`BP`).

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

## 10. Correctifs du 16/10/2026 (barre d'outils, page unique, brouillons, fermeture)

Quatre défauts signalés en atelier, traités à la CAUSE et verrouillés par des
tests (`src/lib/__tests__/ui-navigation-et-demarrage.test.ts`).

### 10.1 La barre d'outils se déplaçait VERTICALEMENT

`overflow-x-auto` ne limite pas l'axe vertical : la spécification CSS impose
qu'un axe `visible` devienne `auto` dès que l'autre ne l'est plus. Les rangées de
la barre acceptaient donc un défilement vertical — molette, pavé tactile, et
`scrollIntoView` des navigations clavier faisaient glisser les libellés hors du
bandeau (« Tableau de bord » tronqué sur la capture du 16/10).

Correctif : la classe `.gf-hscroll` (`globals.css`) verrouille les deux axes
(`overflow-x: auto` + `overflow-y: hidden` + `flex-wrap: nowrap` +
`overscroll-behavior`). Elle est appliquée à la rangée d'outils du `Header` et à
la bande des mécaniciens du `ScheduleBoard`. Le défilement horizontal, lui,
reste disponible : sur une fenêtre étroite, la barre glisse latéralement — elle
ne passe jamais à la ligne et ne bouge jamais verticalement.

### 10.2 Une seule page à l'écran

`page.tsx` montait chaque panneau depuis un booléen indépendant
(`isClientsOpen`, `isBillingOpen`, …), seize au total : ouvrir « Réception » puis
« Clients » laissait deux pages plein écran (`fixed inset-0 z-50`) superposées.
Une variable unique `surface` les remplace : ouvrir une page ferme la
précédente, par construction. Le tableau de bord (piloté par le magasin d'état)
est recalé sur le même état, et le volet « Stock » est refermé par `ouvrirPage`.

### 10.3 Les brouillons survivent au changement de page

Remplacer une page DÉMONTE ses composants : React jetait la saisie en cours
(fiche client à moitié corrigée, réponse en cours de rédaction, texte OCR non
appliqué). `src/lib/ui/brouillon.ts` (`useBrouillonPersistant`) conserve ces
saisies en mémoire pour la session. Elles ne sont écrites nulle part : un
brouillon n'est pas un enregistrement. Fermer la page par ✕ ou Échap est un
ABANDON — `viderBrouillons(préfixe)` efface alors les brouillons de LA page.

### 10.4 Boutons de fermeture

`globals.css` : `.gf-close` porte une vraie boîte de 40 px (44 px sur pointeur
grossier) et son pseudo-élément élargi ne capture plus les clics
(`pointer-events: none`) — il recouvrait les boutons voisins et leur volait leur
clic, d'où les clics « sans effet » et l'obligation de viser au pixel. Les 17
boutons de fermeture qui n'avaient qu'une icône portent désormais
`aria-label="Fermer"` (vérifié par test).
