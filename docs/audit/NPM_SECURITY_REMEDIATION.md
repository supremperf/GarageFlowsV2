<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# NPM SECURITY REMEDIATION — classification & plan (Phase 13-23)

> Journal point-dans-le-temps. Commit : `5934ac2`. Méthode : `npm audit`,
> `npm audit --omit=dev`, inspection des chemins de dépendance et de l'usage réel
> dans GarageFlows. **Aucun `npm audit fix --force` aveugle** (règle 14).

## Résumé

| Vue | Avant | Après correctifs NON cassants | Reste |
|---|---|---|---|
| Tous (`npm audit`) | 30 (1 crit, 24 high, 4 mod, 1 low) | **20** (1 crit, 16 high, 3 mod) | majeurs/build |
| **Runtime distribué** (`--omit=dev`) | 7 (0 crit, 3 high, 4 mod) | **6** (0 crit, 3 high, 3 mod) | 3 high + 3 mod |

**Vulnérabilités CRITICAL exploitables en runtime : 0** (la seule critique, `tar`,
est un outil de **build** — electron-builder — jamais embarqué dans l'app livrée).

Correctifs non cassants APPLIQUÉS (`npm audit fix`, package-lock uniquement,
0 changement de version majeure) : `dompurify` (→ patch), `tmp`, `vite`,
`@xmldom/xmldom`, `js-yaml`, `lodash`, `form-data`, `flatted`, `brace-expansion`,
`picomatch`, `electron-publish`. tsc/lint/tests/build re-vérifiés verts.

## Classification par paquet

Légende exposition : **A** exploitable runtime · **B** paquet runtime mais voie
vulnérable non utilisée · **C** build/dev uniquement · **D** transitif · **E** à
retirer.

| Paquet | Sévérité | Direct/transitif | Runtime/dev | Classe | Exploitable ici ? | Correctif | Cassant ? | Action |
|---|---|---|---|---|---|---|---|---|
| `tar` | critical | transitif (electron-builder) | **dev/build** | C | **Non** — jamais embarqué dans l'app livrée | electron-builder 26.x | Oui (majeur) | STAGÉ (voir electron-builder) |
| `next` | high | direct | runtime (PWA) | A (PWA) / B (Electron localhost) | PWA internet-exposée : oui (DoS/SSRF/cache) ; Electron : voie localhost, faible | Next 15.5.21+ | Oui (majeur 14→15) | **STAGÉ** — migration Next 15 + tests + build Windows |
| `postcss` | high | transitif (next) | **build** | C | **Non** — PostCSS transforme le CSS au BUILD ; absent du bundle livré | via Next 15 | Oui (via next) | Résolu avec Next 15 |
| `nodemailer` | high | direct | runtime | B | **Non en pratique** — voies vulnérables = options `name`/`envelope`/`list`/`raw` NON utilisées ; l'app n'envoie que from/to/subject/text/html/attachments (encodés) | nodemailer 8.0.8+/9.x | Oui (majeur) | STAGÉ + mitigation code (ci-dessous) |
| `@anthropic-ai/sdk` | moderate | direct | runtime | B | **Non** — l'app utilise le SDK pour la reformulation LLM (texte), PAS le Memory Tool / filesystem visé par l'avis | 0.91.1+ | Oui (majeur) | STAGÉ (faible priorité) |
| `uuid` | moderate | direct | runtime | B | **Non** — l'app utilise v4/`randomUUID` sans passer `buf` ; l'avis vise v3/v5/v6 avec `buf` | uuid 11.1.1+ | Oui (majeur 10→14) | STAGÉ (faible priorité) |
| `next-auth` | moderate | direct | runtime | A/B | à confirmer selon l'avis (flux d'auth) | v5 | Oui (majeur, beta) | STAGÉ — ne pas passer en beta sans tests |
| `dompurify` | moderate | transitif | runtime | D | patché | ≥3.4.13 | Non | **FAIT** (`npm audit fix`) |
| `electron` | high | direct | runtime | A | durci (contextIsolation/sandbox/CSP/fuses) réduit la surface ; avis à trier | Electron 41 | Oui (majeur 31→41) | **STAGÉ** — migration Electron + build Windows |
| `electron-builder` + chaîne (`app-builder-lib`, `builder-util*`, `dmg-builder`, `tar`, `tmp`…) | high/crit | direct (dev) | **dev/build** | C | **Non** — outillage de packaging, jamais livré | electron-builder 26.15.3 | Oui (majeur) | STAGÉ — à tester APRÈS avec l'intégrité Windows |
| `sharp` | high | transitif (next) | **build** | C | **Non** — optimisation d'images au build | via next | Oui | Résolu avec Next |
| `glob` / `eslint-config-next` / `@next/eslint-plugin-next` | high | dev (lint) | **dev** | C | **Non** — lint | eslint-config-next majeur | Oui | STAGÉ (dev) |
| `vite`, `tmp`, `js-yaml`, `lodash`, `form-data`, `flatted`, `brace-expansion`, `picomatch`, `@xmldom/xmldom` | high/mod | transitifs | dev + qq runtime | C/D | corrigés sans casse | patch | Non | **FAIT** (`npm audit fix`) |
| `uglify-js` (via `dist`) | — | — | — | E | **Absent** de l'arbre actuel (aucun `npm ls uglify-js`/`dist` positif) | — | — | Rien à retirer (voir note) |

### Note `uglify-js` / `dist` (Phase 15)

Le rapport initial du prompt mentionnait `uglify-js <= 2.5.0 via dist, no fix`.
`npm ls uglify-js` et `npm ls dist` ne remontent **aucune** occurrence dans
l'arbre courant → cette entrée n'existe plus dans ce dépôt (déjà nettoyée ou
propre au rapport d'origine). Rien à retirer aujourd'hui ; à re-vérifier si une
future dépendance la réintroduit.

## Mitigation code déjà en place (Phase 19 — nodemailer)

Les avis nodemailer exploitables ciblent des options **précises** : `name` du
transport (EHLO), `envelope`, en-têtes `List-*`, `raw`, `jsonTransport`.
GarageFlows ne les utilise **pas** : les envois (`/api/email`, reminders,
notifications) construisent uniquement `{from, to, subject, text/html,
attachments}`, encodés par nodemailer. La voie d'injection n'est donc pas
atteignable en usage normal. La montée en 8.0.8+/9.x reste recommandée et est
**stagée** (API à revalider + régression email).

## Majeurs STAGÉS — pourquoi pas maintenant

Conformément aux règles 7, 11 et 14 : les montées majeures (Next 15, Electron 41,
electron-builder 26, nodemailer 9, uuid 14, anthropic, next-auth 5) **ne sont pas
appliquées à l'aveugle** ici car leur validation exige un **build + installation
+ E2E Windows** impossibles dans ce conteneur Linux. Les appliquer sans cette
validation introduirait un risque de régression non détectable — l'inverse de
l'objectif. Chacune est un lot atomique à mener **une dépendance à la fois**, sur
une machine Windows, avec la matrice de tests Phase 26-28.

Ordre recommandé (impact runtime décroissant, risque maîtrisé) :
1. **Next 14 → 15** (ferme la majorité des high runtime `next`/`postcss`/`sharp`
   côté PWA) — App Router déjà en place ; revalider middleware, next-auth,
   Server Actions, images, build.
2. **nodemailer → 9** + revalidation envoi devis/factures/relances.
3. **electron-builder → 26.15.3** puis **Electron 31 → 41** (par paliers), avec
   re-test OBLIGATOIRE de l'intégrité Windows (le manifeste dépend du packaging).
4. `uuid`, `@anthropic-ai/sdk`, `next-auth` (faible expo runtime) — quand le reste
   est stable.

Chaque lot : `npm install <dep>@<ver>` ciblé → tsc/lint/tests/build → (Windows)
installateur + E2E → commit atomique. **Jamais** `--force` global.
