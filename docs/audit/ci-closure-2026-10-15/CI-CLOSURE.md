# Addendum CI de clôture — observation terminée, pas validation globale

**PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Cette nouvelle version complète, sans les modifier, `../copilot-phase6/CI-POST-PUBLICATION.md` et son observation historique. Toutes les lignes ci-dessous sont attachées à leur propre SHA. Un commit documentaire publié après cette observation aura sa propre CI : aucune transmission automatique de PASS.

## Candidats et résultats

### `fccac810be4ce6589831dfc2dadb9bd3f0f51128`

Observation : `2026-10-15T15:08:26.190072+00:00` ; source officielle projetée : [fcc-completed-ci.json](fcc-completed-ci.json). Tous les checks de cet instant sont terminés.

| Check/job ID | Exécution Actions | Nom | Conclusion | head_sha officiel |
|---|---|---|---|---|
| [116498597388](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116498597388) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Required validation | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116498049596](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116498049596) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Required validation | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116497363865](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116497363865) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Authenticated browser validation (approved staging only) | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116497363633](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116497363633) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Windows candidate packaging and inspection (not publication) | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116497277885](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116497277885) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Authenticated browser validation (approved staging only) | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116497277719](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116497277719) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Windows candidate packaging and inspection (not publication) | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116495987398](https://github.com/supremperf/GarageFlowsV2/runs/116495987398) | Résultat GitHub, pas un job Actions | CodeQL | **failure** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494860924](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116494860924) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Final release gate (full) | **skipped** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494859246](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116494859246) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Native base (TypeScript, standard build, fixed JS budget) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494858919](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116494858919) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Secret scan (Gitleaks) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494858722](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116494858722) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494858699](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116494858699) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | E2E (Playwright — responsive, auto-démarrage) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494858481](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852/job/116494858481) | [38756112852](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756112852) | Full dependency tree — zero vulnerabilities | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494857493](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756113028/job/116494857493) | [38756113028](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756113028) | Analyze (javascript-typescript) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494814076](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116494814076) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Final release gate (full) | **skipped** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494812443](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116494812443) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | E2E (Playwright — responsive, auto-démarrage) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494812351](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116494812351) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Native base (TypeScript, standard build, fixed JS budget) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494812252](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116494812252) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Full dependency tree — zero vulnerabilities | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494812167](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116494812167) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |
| [116494812009](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926/job/116494812009) | [38756099926](https://github.com/supremperf/GarageFlowsV2/actions/runs/38756099926) | Secret scan (Gitleaks) | **success** | `fccac810be4ce6589831dfc2dadb9bd3f0f51128` |

### `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b`

Observation : `2026-10-15T17:29:20.315069+02:00` ; source officielle projetée : [befc-completed-ci.json](befc-completed-ci.json). Tous les checks de cet instant sont terminés.

| Check/job ID | Exécution Actions | Nom | Conclusion | head_sha officiel |
|---|---|---|---|---|
| [116506258305](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116506258305) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Windows candidate packaging and inspection (not publication) | **skipped** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116506258104](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116506258104) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Authenticated browser validation (approved staging only) | **skipped** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116506257082](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116506257082) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Required validation | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116505576149](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116505576149) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Windows candidate packaging and inspection (not publication) | **skipped** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116505574919](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116505574919) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Authenticated browser validation (approved staging only) | **skipped** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116505574236](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116505574236) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Required validation | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116505011802](https://github.com/supremperf/GarageFlowsV2/runs/116505011802) | Résultat GitHub, pas un job Actions | CodeQL | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503951416](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116503951416) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Final release gate (full) | **skipped** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503949979](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116503949979) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Native base (TypeScript, standard build, fixed JS budget) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503949731](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713329/job/116503949731) | [38758713329](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713329) | Analyze (javascript-typescript) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503949202](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116503949202) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503949179](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116503949179) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Secret scan (Gitleaks) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503948963](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116503948963) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | Full dependency tree — zero vulnerabilities | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503948861](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173/job/116503948861) | [38758713173](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758713173) | E2E (Playwright — responsive, auto-démarrage) | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503917609](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116503917609) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Final release gate (full) | **skipped** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503915896](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116503915896) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | E2E (Playwright — responsive, auto-démarrage) | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503915660](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116503915660) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Full dependency tree — zero vulnerabilities | **failure** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503915598](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116503915598) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503915459](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116503915459) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Secret scan (Gitleaks) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |
| [116503915207](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077/job/116503915207) | [38758703077](https://github.com/supremperf/GarageFlowsV2/actions/runs/38758703077) | Native base (TypeScript, standard build, fixed JS budget) | **success** | `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` |

### `df66ebb2a92263091a60206725f1fed8c9e3b87c`

Observation : `2026-10-15T17:25:51.639139+02:00` ; source officielle projetée : [df66-completed-push-observation-ci.json](df66-completed-push-observation-ci.json). Tous les checks de cet instant sont terminés.

| Check/job ID | Exécution Actions | Nom | Conclusion | head_sha officiel |
|---|---|---|---|---|
| [116508982443](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116508982443) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Required validation | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116508789948](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116508789948) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Required validation | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116507945231](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116507945231) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Windows candidate packaging and inspection (not publication) | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116507944698](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116507944698) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Authenticated browser validation (approved staging only) | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116507743486](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116507743486) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Authenticated browser validation (approved staging only) | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116507743106](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116507743106) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Windows candidate packaging and inspection (not publication) | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116506483787](https://github.com/supremperf/GarageFlowsV2/runs/116506483787) | Résultat GitHub, pas un job Actions | CodeQL | **failure** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505424151](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116505424151) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Final release gate (full) | **skipped** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505422238](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116505422238) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Full dependency tree — zero vulnerabilities | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505422142](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116505422142) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | E2E (Playwright — responsive, auto-démarrage) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505421878](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116505421878) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Native base (TypeScript, standard build, fixed JS budget) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505421830](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116505421830) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505421487](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140/job/116505421487) | [38759135140](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135140) | Secret scan (Gitleaks) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505421070](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135102/job/116505421070) | [38759135102](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759135102) | Analyze (javascript-typescript) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505385543](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116505385543) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Final release gate (full) | **skipped** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505383497](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116505383497) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Native base (TypeScript, standard build, fixed JS budget) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505383362](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116505383362) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Secret scan (Gitleaks) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505383085](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116505383085) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | E2E (Playwright — responsive, auto-démarrage) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505383050](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116505383050) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |
| [116505382701](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969/job/116505382701) | [38759124969](https://github.com/supremperf/GarageFlowsV2/actions/runs/38759124969) | Full dependency tree — zero vulnerabilities | **success** | `df66ebb2a92263091a60206725f1fed8c9e3b87c` |

## Provenance du checkout et frontière des preuves

Les API `check-runs` et `actions/jobs` exposent leur `head_sha` dans les JSON, sans supposer qu’un SHA de tête de PR soit le commit de merge réellement checkouté. Le producteur Gitleaks enregistre le SHA de son checkout :

| Tête candidate | Run CI push / checkout observé | Run CI PR / checkout merge observé | Arbre complet égal à la tête |
|---|---|---|---|
| `fccac810be4ce6589831dfc2dadb9bd3f0f51128` | 38756099926 / `fccac810be4ce6589831dfc2dadb9bd3f0f51128` | 38756112852 / `12763537152191eda056afd0af27f69633fc2de1` | oui, comparaison des tree SHA officiels |
| `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` | 38758703077 / `befc31e5551b6e0e61b8d1acb383e01e5a9fb39b` | 38758713173 / `c2fab79925175909b79f8d2ff2c9f83f8767ed39` | oui, comparaison des tree SHA officiels |
| `df66ebb2a92263091a60206725f1fed8c9e3b87c` | 38759124969 / `df66ebb2a92263091a60206725f1fed8c9e3b87c` | 38759135140 / `e1ce72a94845d1f60eba101b44aac2d39064903e` | oui, comparaison des tree SHA officiels |

Détails/parents/tree SHA dans [checkout-tree-provenance.json](checkout-tree-provenance.json). Cela atteste le checkout Gitleaks et l’égalité d’arbre du merge pour chaque candidat ; ce n’est pas un `git rev-parse` indépendant dans chacun des autres jobs. Le contexte du run et le checkout par défaut du workflow sont distingués de cette observation directe.

## Lecture des échecs — ne pas les requalifier en vert

- **fcc** : les suites complètes étaient finalement vertes avant notre correction DNS. Deux Windows rouges à `npm run dist` ; staging rouge au préflight ; CodeQL résultats rouge. L’ancien état « en cours » de la publication précédente reste un instantané historique, pas l’état final.
- **befc** : la première instrumentation a remplacé la ligne littérale `run: npm run dist`. L’assertion de graphe existante a justement échoué (C06 : release-safety 57/58), faisant échouer le job dépendances **avant** `audit:strict` (non exécuté dans ces jobs). Les deux E2E publics échouent à leur étape navigateur : cause non établie ici, pas assimilée à npm ou DNS. Windows/staging sont skipped sur ce candidat. Les deux suites unitaires/intégration et bases natives passent. Aucun ancien résultat n’efface ces échecs.
- **df66** : correction du workflow, pas de l’assertion : `run: npm run dist` reste littéral et le shell de diagnostic ne peut exécuter que cette commande, sinon il refuse. Tests du graphe initiaux inchangés ; six tests supplémentaires de commande/expurgation/exit. Les deux jobs dépendances atteignent cette fois l’audit et passent ; les deux E2E publics passent. Aucune causalité rétroactive affirmée pour les E2E befc.
- **df66 Windows** : les deux commandes officielles sont exécutées en `win32`, Node `v22.23.3`, et rendent **1**. Les deux générations Prisma 5.22.0 réussissent, puis `next build` échoue sur `EPERM/scandir` dans un répertoire de profil Windows hors dépôt. L’origine exacte de ce parcours de glob reste à établir. Aucun changement de droits, exclusion ou suppression d’erreur n’a été ajouté pour contourner ce défaut.
- **df66 staging** : préflight échoué, navigateur non lancé. Les cas A01–A17 sont non exécutés.
- **df66 CodeQL** : analyse Actions réussie, contrôle des résultats échoué ; 14 résultats SARIF projetés, dont 7 de security-severity numérique >=7. Ce n’est ni 14 numéros officiels ni une résolution des 17 revues initiales.
- **Final release gate** : skipped par la condition `workflow_dispatch`, pas PASS. Aucun déclenchement manuel de release, merge ou déploiement.

## Logs Windows et limites du diagnostic

Les tentatives initiales `gh api repos/supremperf/GarageFlowsV2/actions/jobs/116497277719/logs` et `/116497363633/logs` ont échoué (exit 1, zéro octet téléchargé) sur la redirection de blob inaccessible. Les fichiers vides ne constituent pas des logs. Aucune URL signée n’est publiée.

L’instrumentation conserve la commande et son statut. Elle capture stdout puis stderr, les expurge **avant** transport, publie des pages compressées et annonce explicitement une éventuelle troncature. Le champ `rawSha256` est l’empreinte du texte stdout + séparateur + stderr capturé, **pas** celle d’un téléchargement de log GitHub brut ni une chronologie intercalée des deux flux. Les deux diagnostics observés sont complets pour ce texte expurgé : 1825 et 1748 caractères, sans erreur de spawn. Le cap de capture et les tests d’expurgation ne prouvent pas une absence universelle de secret.

- [Diagnostic push, job 116507743106](df66-completed-push-observation-windows-116507743106.json) : `EPERM`, `C:\Users\runneradmin\Application Data`.
- [Diagnostic PR, job 116507945231](df66-completed-push-observation-windows-116507945231.json) : `EPERM`, `C:\Users\runneradmin\Cookies`.

Le post-build, Electron Builder, les scans/fuses d’artefact, le budget Windows, l’intégrité du paquet, `release:verify-artifact` et le lancement de l’exécutable ne sont **pas atteints**. Aucun paquet n’est déclaré intègre ou démarrable. Les preuves Linux ne sont pas des preuves Windows.

## Reproduction des observations

```sh
gh api repos/supremperf/GarageFlowsV2/commits/<SHA_EXACT>/check-runs?per_page=100
gh api repos/supremperf/GarageFlowsV2/actions/jobs/<JOB_ID>
gh api repos/supremperf/GarageFlowsV2/check-runs/<CHECK_ID>/annotations?per_page=100
gh api repos/supremperf/GarageFlowsV2/git/commits/<SHA_EXACT>
```

Les JSON conservent étapes/status/dates/runner labels et les notices explicitement projetées. Ni texte SARIF sensible, ni `Secret`/`Match` scanner, ni environnement complet n’est exporté. Les commandes de collecteur des reçus C11/C12/C15/C16 résident dans le sandbox privé : les endpoints officiels ci-dessus permettent la reproduction du relevé, sans prétendre que le collecteur privé soit livré comme outil produit.
