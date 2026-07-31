# Modèle de coût d'infrastructure — 1 / 10 / 100 / 1000 garages

> **AVERTISSEMENT — TOUS LES MONTANTS SONT DES ESTIMATIONS.** Ils s'appuient sur des **prix catalogue publics** connus au moment de la rédaction et sur des hypothèses de volume **non auditées**. Ils ne constituent ni un devis ni un engagement. Les coûts réels dépendent de contrats fournisseurs, de paliers de remise, de la région et des volumes effectifs. Chaque poste est étiqueté :
>
> - **[CERTAIN]** — coût structurel qui existe dès le premier garage.
> - **[ESTIMÉ]** — prix catalogue public appliqué à un volume supposé.
> - **[DÉPENDANT-FOURNISSEUR]** — fonction de contrats/paliers non audités.
> - **[INCONNU]** — aucun code/preuve dans le dépôt ; non chiffrable.

## 1. Modèle de charge

- L'application **desktop** stocke ses données en **SQLite local** → elle ne génère **aucun coût cloud par garage** hormis les appels au control-plane (activation, heartbeat, crash reports, checks d'update) qui sont **peu fréquents et de faible poids**.
- Les coûts cloud sont donc portés par : le **control-plane** (licences/releases/crash), l'éventuelle **PWA** (PostgreSQL), et les services managés associés.
- Hypothèse de heartbeat : poll adaptatif ~2 min en fonctionnement normal, 20 s si bloqué (source : code desktop). Le trafic control-plane par garage reste modeste.

## 2. Postes de coût et leur nature

| Poste | Fournisseur pressenti | Nature | Preuve dans le code |
|---|---|---|---|
| Hébergement serverless | Vercel | [ESTIMÉ] / [DÉPENDANT-FOURNISSEUR] | Cible Vercel (next.config, config serverless) |
| PostgreSQL managé | Vercel Postgres / Neon | [ESTIMÉ] | Provider Prisma postgresql (cloud + PWA) |
| Redis distribué | Upstash | [ESTIMÉ] | rate-limit-distributed.ts, env requis |
| Blob storage (installeurs) | Vercel Blob | [ESTIMÉ] | blob-upload/route.ts |
| E-mail transactionnel | SMTP via nodemailer | [ESTIMÉ] / [DÉPENDANT-FOURNISSEUR] | dépendance nodemailer (cloud) |
| SMS | — | [INCONNU] | **Aucun code SMS trouvé** |
| Observabilité (export) | — | [INCONNU] | Logging in-app seulement ; **pas d'export Prometheus/OTel** |
| Domaine garageflows.fr | Registrar | [CERTAIN] | Domaines codés en dur (allowlists) |
| Certificat signature Windows (OV/EV) | Autorité de certification | [CERTAIN] / [DÉPENDANT-FOURNISSEUR] | **Non configuré** — à procurer |
| API IA (Anthropic) | Anthropic | [DÉPENDANT-FOURNISSEUR] | Optionnel, à l'usage, nul si non activé |
| API plaque tierce | api-immat.com | [ESTIMÉ] (gratuit, sans SLA) | plate-lookup/route.ts |

## 3. Estimations par palier (mensuel, prix catalogue publics, ESTIMATIONS)

Les fourchettes reflètent l'incertitude ; le haut de fourchette suppose des plans payants et une volumétrie active.

### Palier 1 garage
| Poste | Nature | Estimation /mois |
|---|---|---|
| Vercel (Hobby/Pro de base) | [ESTIMÉ] | 0 – 20 € |
| PostgreSQL | [ESTIMÉ] | 0 – 15 € (tier gratuit possible) |
| Upstash Redis | [ESTIMÉ] | 0 € (tier gratuit) |
| Vercel Blob | [ESTIMÉ] | 0 € (tier gratuit) |
| E-mail | [ESTIMÉ] | 0 – 5 € |
| Domaine (amorti) | [CERTAIN] | ~1 – 2 € |
| **Total cloud indicatif** | | **~1 – 40 €** |

### Palier 10 garages
| Poste | Nature | Estimation /mois |
|---|---|---|
| Vercel Pro | [ESTIMÉ] | ~20 € |
| PostgreSQL | [ESTIMÉ] | 0 – 25 € |
| Upstash Redis | [ESTIMÉ] | 0 – 10 € |
| Vercel Blob | [ESTIMÉ] | ~0 – 5 € |
| E-mail | [ESTIMÉ] | ~5 € |
| Domaine (amorti) | [CERTAIN] | ~1 – 2 € |
| **Total cloud indicatif** | | **~25 – 65 €** |

### Palier 100 garages
| Poste | Nature | Estimation /mois |
|---|---|---|
| Vercel Pro (+ usage) | [ESTIMÉ] / [DÉPENDANT-FOURNISSEUR] | ~20 – 60 € |
| PostgreSQL (plan payant) | [ESTIMÉ] | ~25 – 100 € |
| Upstash Redis (plan payant) | [ESTIMÉ] | ~10 – 40 € |
| Vercel Blob | [ESTIMÉ] | ~5 – 20 € |
| E-mail (volume) | [ESTIMÉ] / [DÉPENDANT-FOURNISSEUR] | ~10 – 30 € |
| Domaine | [CERTAIN] | ~1 – 2 € |
| **Total cloud indicatif** | | **~70 – 250 €** |

### Palier 1000 garages
| Poste | Nature | Estimation /mois |
|---|---|---|
| Vercel (Pro/Enterprise + usage) | [DÉPENDANT-FOURNISSEUR] | ~100 – 800 €+ |
| PostgreSQL (haute dispo) | [ESTIMÉ] / [DÉPENDANT-FOURNISSEUR] | ~150 – 800 € |
| Upstash Redis (volume) | [ESTIMÉ] / [DÉPENDANT-FOURNISSEUR] | ~50 – 300 € |
| Vercel Blob | [ESTIMÉ] | ~20 – 100 € |
| E-mail (volume) | [DÉPENDANT-FOURNISSEUR] | ~30 – 200 € |
| SMS (si activé) | [INCONNU] | non chiffrable — dépend d'un provider non présent dans le code |
| Observabilité (si externalisée) | [INCONNU] | non chiffrable — pas d'export aujourd'hui |
| Domaine | [CERTAIN] | ~1 – 2 € |
| **Total cloud indicatif** | | **~500 – 2 500 €+** |

## 4. Coûts hors « à la charge » cloud récurrent

| Poste | Nature | Commentaire |
|---|---|---|
| Certificat de signature de code Windows | [CERTAIN] / [DÉPENDANT-FOURNISSEUR] | Récurrent annuel ; **non acheté** aujourd'hui. Nécessaire pour lever les avertissements SmartScreen (voir `07_DEPLOYMENT_MODEL.md`) |
| API IA Anthropic | [DÉPENDANT-FOURNISSEUR] | À l'usage ; **coût nul si les fonctions IA ne sont pas activées** (dégradation gracieuse sans clé) |
| API plaque api-immat.com | [ESTIMÉ] | Gratuite aujourd'hui, **sans SLA** — risque de fiabilité |

## 5. Facteurs de coût non capturés (à diligencer)

- **SMS** : aucun code — [INCONNU]. Si une capacité SMS est attendue, elle est **à construire** et son coût dépendra d'un provider (Twilio, etc.) non présent.
- **Export d'observabilité** (Prometheus/OTel) : absent — [INCONNU]. Un passage à l'échelle SaaS nécessitera cet investissement.
- **Remises de volume / engagements annuels** : [DÉPENDANT-FOURNISSEUR] — peuvent réduire significativement les totaux ci-dessus.
- **Trafic/egress, cold starts, durée d'exécution serverless** : variables réelles non mesurées ici.

## 6. Lecture synthétique

Le modèle **mono-garage/SQLite local** maintient les coûts cloud **bas et sous-linéaires** aux petits paliers (les tiers gratuits couvrent souvent 1–10 garages). La montée vers 1000 garages est **fortement dépendante fournisseur** et sensible aux fonctions non encore construites (SMS, observabilité externalisée), qui restent **inconnues** et non chiffrables depuis le code.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
