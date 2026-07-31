# 13 — Capacités de marque blanche (white-label)

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> Message central : **la fondation white-label est réelle et bien conçue, mais le câblage à travers l'UI est largement absent.** Un acquéreur qui compte « rebrander en éditant un fichier » se trompe : l'ossature existe, le fil-à-travers reste à faire. Ce document donne la fondation réelle ET l'écart honnête, avec une estimation d'effort.

## 1. La fondation réelle (constatée dans le code)

### Desktop — `src/config/brand.ts`
Configuration typée, **validée par Zod**, avec un modèle d'override à **3 couches** (priorité décroissante) :
1. Variables d'environnement `GF_BRAND_*` (CI/CD-friendly, sans édition de fichier).
2. Fichier `brand.config.json` à la racine (ou chemin `GF_BRAND_CONFIG`), deep-merge partiel.
3. Défauts typés (identité GarageFlow actuelle).

Couvre : `productName`, `shortName`, `companyName`, `companyLegalName`, `tagline`, `wordmark` (primary/secondary), `colors` (primary/primaryDark/accent), domaines, e-mail, mentions légales, packaging. **Fallback sûr** : un override malformé logge un avertissement et retombe sur les défauts — **ne jette jamais**, ne casse jamais un build. Vérifié : **8 tests verts** (`brand.test.ts`).

`src/config/app.ts` : `APP_CONFIG.name = BRAND.productName` — l'un des rares vrais consommateurs.

### Cloud — `src/lib/site.ts` + `src/lib/domains.ts`
- `site.ts` : `name = process.env.NEXT_PUBLIC_PRODUCT_NAME || "GarageFlow"` — **une seule variable** renomme la vitrine, les e-mails et le JSON-LD. Coordonnées/social pilotés par env, **vides masqués** (aucune valeur inventée).
- `domains.ts` : **source unique** des 3 sous-domaines + e-mail, **tous surchargables** par `NEXT_PUBLIC_*` (`site`/`api`/`app`/`email`). Une ligne à changer pour rebrander la couche domaine côté vitrine.

**Verdict fondation** : c'est une base de qualité, honnêtement auto-documentée, qui **réduit** le coût futur de white-labeling. Côté vitrine cloud, le rebranding par env est largement fonctionnel.

## 2. L'écart honnête — le câblage manque (desktop UI)

L'audit `value-gap-analysis` est sans ambiguïté :

- Seulement **~2 références `BRAND.*`** existent **hors** de `brand.ts` lui-même.
- L'identité produit est **codée en dur** dans ~40+ endroits :
  - `src/app/layout.tsx:7` — titre `'GarageFlow — Planning Atelier Intelligent'`, `applicationName 'GarageFlow'` (`:11`).
  - `src/components/GarageFlowLogo.tsx:45` — `alt="GarageFlow"`.
  - `src/components/Dashboard.tsx:87` — littéral `'GarageFlow'` + couleurs hex codées en dur.
- **~146 occurrences littérales « GarageFlow »** dans le code TS/TSX.
- **8 hex de marque codés en dur** (`#2563eb` / `#1d4ed8`).

**Conséquence** : éditer `brand.ts` n'a **quasiment aucun effet** sur l'UI desktop tournante aujourd'hui. La thèse « rebrand-and-resell » exige de toucher des dizaines de fichiers, pas un.

## 3. Surface de rebranding — état par élément

| Élément | Fondation | Câblé à l'UI ? | Note |
|---|---|---|---|
| Nom produit (vitrine cloud) | `site.ts` + env | **Oui** | `NEXT_PUBLIC_PRODUCT_NAME` fonctionne |
| Domaines (cloud) | `domains.ts` + env | **Oui** | Surchargables par env |
| Nom produit (desktop UI) | `brand.ts` | **Non** | Codé en dur (~146 littéraux) |
| Logo / wordmark (desktop) | `brand.ts.wordmark` | **Non** | `GarageFlowLogo.tsx` alt codé en dur |
| Couleurs de thème (desktop) | `brand.ts.colors` | **Non** | 8 hex codés en dur ; pas de variables CSS pilotées par la config |
| Titres/métadonnées (desktop) | `brand.ts` | **Non** | `layout.tsx` en dur |
| E-mails / légal | `brand.ts` legal | **Partiel** | Config présente ; consommation à vérifier au cas par cas |
| Assets (logos, icônes PWA) | `public/` | Manuel | Remplacement de fichiers |

## 4. Estimation d'effort pour un white-label complet (desktop)

**ESTIMATION** (non contractuelle) pour rendre le desktop réellement rebrandable via `brand.ts` :

| Chantier | Effort estimé |
|---|---|
| Remplacer ~146 littéraux « GarageFlow » par `BRAND.*` | 3 – 5 jours |
| Piloter les 8 couleurs par variables CSS depuis `brand.colors` | 2 – 4 jours |
| Câbler logo/wordmark (`GarageFlowLogo.tsx`, headers) | 1 – 2 jours |
| Titres/métadonnées/PWA manifest depuis la config | 1 – 2 jours |
| Métadonnées de packaging Electron (nom d'app, éditeur) | 1 – 2 jours |
| Tests de non-régression white-label (snapshot rebrandé) | 2 – 3 jours |
| **Total** | **~10 – 18 jours-personne** (≈ 2 – 3.5 semaines) |

C'est un effort **modéré et borné** — précisément parce que la fondation `brand.ts` existe déjà. Sans elle, ce serait plusieurs fois plus.

## 5. Recommandation

Le white-label est un **atout de valeur potentiel réel mais non réalisé**. À valoriser comme *fondation* (coût de reconstruction évité), **pas** comme fonctionnalité opérationnelle. Si la thèse rebrand-and-resell est centrale, budgéter les ~2–3.5 semaines ci-dessus comme coût post-acquisition.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
