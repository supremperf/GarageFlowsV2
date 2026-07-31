# 06 — Infrastructure et coûts

> **Avertissement :** tous les montants de ce document sont des **ESTIMATIONS** fondées sur des prix catalogue publics. Les coûts réels dépendent de contrats fournisseurs et de volumes qui **n'ont pas été audités**. Le modèle de coût détaillé par palier (1/10/100/1000 garages) figure dans `INFRASTRUCTURE_COST_MODEL.md`.

## 1. Topologie d'infrastructure

| Composant | Rôle | Fournisseur pressenti (d'après le code) |
|---|---|---|
| Hébergement control-plane + PWA | Next.js serverless | Vercel |
| Base de données | Control-plane + PWA | PostgreSQL managé (ex. Vercel Postgres / Neon) |
| Rate limiting distribué | Fail-closed en prod | Upstash Redis |
| Stockage d'installeurs | Binaires de mise à jour | Vercel Blob |
| Domaines | Licence + téléchargement (allowlists codées en dur) | garageflows.fr (à transférer — P0) |
| E-mail | Notifications transactionnelles | nodemailer (SMTP, provider à confirmer) |
| SMS | **Non trouvé dans le code** | — (roadmap / inconnu) |
| Observabilité | Logging structuré + monitoring hôte/DB in-app ; **pas d'export Prometheus/OTel** | interne |

L'application **desktop** ne consomme pas d'infra cloud propre côté client (SQLite local) : les coûts cloud sont concentrés sur le **control-plane** et la **PWA**.

## 2. Nature des coûts (à séparer impérativement)

| Catégorie | Signification | Exemples |
|---|---|---|
| **Certain** | Coût structurel qui existe dès le 1er garage | Domaine garageflows.fr, plan Vercel de base |
| **Estimé** | Prix catalogue public appliqué à un volume supposé | Postgres, Redis, Blob, e-mail |
| **Dépendant fournisseur** | Fonction de contrats/paliers non audités | Remises volume, engagements annuels, SMS |
| **Inconnu** | Aucun code/preuve dans le dépôt | SMS, certificat de signature Windows (coût récurrent), coûts IA réels |

## 3. Postes de coût structurants

- **Certificat de signature de code Windows (OV/EV)** : **NON acheté** — aucun certificat n'est configuré. Coût récurrent annuel à budgéter (dépendant fournisseur). Voir `07_DEPLOYMENT_MODEL.md`.
- **Fonctions IA optionnelles** (`@anthropic-ai/sdk`) : coût **à l'usage**, uniquement si `ANTHROPIC_API_KEY` est configuré. Sans clé, les fonctions dégradent silencieusement → **coût nul si non activées**.
- **API tierce plaque** (api-immat.com) : API gratuite tierce sans SLA contractuel — repli avant Claude ; risque de fiabilité plus que de coût.
- **Domaines garageflows.fr** : coût de renouvellement faible mais **transfert de propriété P0** (voir `09_INTELLECTUAL_PROPERTY.md`).

## 4. Synthèse indicative (voir modèle détaillé)

Ordre de grandeur mensuel (ESTIMATIONS, prix catalogue) :

| Palier | Coût cloud mensuel estimé | Commentaire |
|---|---|---|
| 1 garage | ~0–20 € | Tiers gratuits Vercel/Upstash/Blob souvent suffisants ; domaine amorti |
| 10 garages | ~20–60 € | Toujours proche des tiers gratuits/Pro de base |
| 100 garages | ~60–250 € | Passage aux plans payants Postgres/Redis probable |
| 1000 garages | ~500–2 500 €+ | Fortement dépendant fournisseur ; +SMS/e-mail volumétrique |

Détail poste par poste, hypothèses et labels certain/estimé/dépendant/inconnu dans **`INFRASTRUCTURE_COST_MODEL.md`**.

## 5. Points d'attention pour l'acquéreur

- Le control-plane cible **Vercel serverless** ; certaines fonctions (SSE temps réel, rate-limit v1 en mémoire, store `/api/v1`) sont limitées par le modèle serverless (voir `03_FEATURE_INVENTORY.md`).
- L'auto-rollback nécessite un **cron** (ajouté cette session côté cloud) — sans planification il ne se déclenche pas seul.
- L'observabilité manque de **correlation/trace IDs** et d'export de métriques : un passage à l'échelle SaaS nécessite un investissement observabilité.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
