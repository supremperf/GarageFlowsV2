# Registre des actifs de propriété intellectuelle — GarageFlow

**Objet :** inventaire des actifs de propriété intellectuelle (PI) inclus dans la cession GarageFlow, avec pour chaque actif l'état de démontrabilité de sa propriété **à partir du dépôt lui-même**. Ce registre distingue explicitement ce qui est **présent et vérifiable dans les dépôts** de ce qui est un **actif externe** (clés privées, domaines, infrastructure, contrats) devant faire l'objet d'un **transfert séparé**.

**Établi le :** 2026-07-31 — dépôt desktop `GarageFlowsV2` @ commit `7280b3c78a10`.

> **Avertissement de chaîne de titularité.** Le fichier `LICENSE` (racine desktop) affirme le caractère propriétaire du logiciel mais **n'établit ni ne transfère la propriété** à lui seul. Toute acquisition doit être accompagnée d'un **accord écrit de cession de PI** couvrant le code, les marques/actifs de marque et les clés cryptographiques. Ce point est un **bloqueur P0** de la transaction (voir §6).

---

## 1. Codebases (logiciels)

| Actif | Emplacement | Nature | Propriété démontrable depuis le dépôt ? |
|---|---|---|---|
| Application desktop GarageFlow | `GarageFlowsV2/` (Electron + Next.js 14 + SQLite/Prisma) | Code source propriétaire ; `LICENSE` propriétaire en racine | **Partiellement.** Le code et la licence propriétaire sont présents ; l'auteur déclaré est « GarageFlow » (personne morale/physique non identifiée dans le dépôt). **À compléter par une cession écrite.** |
| Control-plane cloud | `garagesite3/` (Next.js 15 + PostgreSQL/Prisma) | Code source propriétaire (licences, releases, crash, modules, vitrine) | **Partiellement** — même réserve : pas de fichier `LICENSE`/en-têtes de copyright systématiques constatés côté cloud à la date de l'audit. **À confirmer / uniformiser.** |
| Schémas de base de données | `prisma/schema.prisma` (37 modèles), `prisma/server/schema.prisma` (37), `garagesite3/prisma/schema.prisma` (13) | Modèle de données propriétaire | Oui (présents dans les dépôts). |
| Outillage de build & scripts | `scripts/` (post-build, afterPack, keygen, icons, audit-ci…) | Code propriétaire | Oui. |

**Réserve commune :** l'« auteur » figurant dans les `package.json` est la chaîne `"GarageFlow"`, sans entité juridique nommée ni contributeurs identifiés. L'historique Git et d'éventuels contrats de contribution (CLA/contrats de prestation) doivent être fournis pour établir la **chaîne de titularité** complète. → **Actif à documenter hors dépôt.**

---

## 2. Actifs de marque

| Actif | Emplacement | Nature | Propriété démontrable ? |
|---|---|---|---|
| Nom commercial « GarageFlow » | Transverse (code, docs, `productName`) | Marque verbale | **Non démontrable depuis le dépôt.** Aucun dépôt de marque (INPI/EUIPO) présent. → **À vérifier hors dépôt.** |
| Logo (marque figurative) | `src/components/brand/logo-mark.png` | Actif graphique | Présent dans le dépôt ; **origine/paternité non documentée** (création interne vs prestataire ?). → cession + preuve de création à fournir. |
| Icônes applicatives / PWA | `icon.ico`, `public/icons/*` (`icon-192`, `icon-512`, `maskable-*`, `apple-touch-icon`), `public/manifest.webmanifest`, `public/site.webmanifest` | Actifs graphiques | Présents ; même réserve de paternité. |
| Système de white-label | `src/config/brand.ts` (desktop, validé Zod) + `NEXT_PUBLIC_PRODUCT_NAME` (cloud) | Code de personnalisation de marque | Oui (présent, ajouté récemment). Permet le rebranding par l'acquéreur. |
| Domaines de marque `garageflows.fr` / `api.garageflows.fr` | Codés dans les allowlists (`electron/update-verify.js`, `electron/main.js`) | Noms de domaine | **Actif EXTERNE** — voir §4. |

> Les actifs graphiques sont **physiquement présents** dans le dépôt, mais leur **titularité/licence n'est pas démontrable** à partir du seul dépôt (pas de fichier de provenance, pas de facture de cession de droits d'auteur du graphiste). À **flaguer** pour la data-room.

---

## 3. Clés cryptographiques (paires de clés)

| Actif | Rôle | Présence dans le dépôt | Statut |
|---|---|---|---|
| Clé publique licence (ECC P-256 / ES256) | Vérification des jetons de licence côté client | **Clé publique embarquée** (`electron/main.js`, `src/lib/license/public-key.ts`, `garagesite3` `public-key.ts`) | Publique présente. |
| **Clé privée licence (ECC P-256)** | **Émission/signature des licences** | **ABSENTE** — `keys/private.pem` est `.gitignored` ; répertoire `keys/` absent du dépôt | **BLOQUEUR P0 — actif externe.** Sans elle, l'acquéreur **ne peut pas émettre de licences**. |
| Clé publique de mise à jour (Ed25519) | Vérification des manifestes de mise à jour | **Clé publique embarquée** (`electron/update-verify.js`) | Publique présente. |
| **Clé privée de mise à jour (Ed25519)** | **Signature des manifestes de mise à jour** | **ABSENTE** — variable d'environnement serveur (`UPDATE_SIGNING_PRIVATE_KEY`), hors dépôt | **BLOQUEUR P0 — actif externe.** Sans elle, l'acquéreur **ne peut pas publier de mises à jour signées**. |
| Secrets serveur (`DEVICE_TOKEN_SECRET`, `HWID_HMAC_SECRET`, `CRON_SECRET`, Upstash Redis…) | Fonctionnement du control-plane | Absents (placeholders documentés dans `.env.example`) | Actifs externes à transférer/régénérer. |

> Les clés **publiques** sont embarquées dans le code et donc transférées avec lui. Les clés **privées** correspondantes vivent **exclusivement côté serveur** et **ne figurent pas** dans les dépôts (bonne hygiène de secrets). Leur **transfert est un livrable contractuel obligatoire** : sans elles, le produit est **non exploitable et non monétisable** (cf. audit desktop, risque « critical »).

---

## 4. Domaines & infrastructure (actifs externes)

| Actif | Référence dans le code | Statut |
|---|---|---|
| Domaine `garageflows.fr` (+ sous-domaines, `api.garageflows.fr`) | Allowlists de navigation/téléchargement, serveur de licence | **EXTERNE** — la propriété du/des domaine(s) et la gestion DNS doivent être transférées. Non démontrable depuis le dépôt. |
| Hébergement du control-plane (déploiement type Vercel) | `garagesite3` | **EXTERNE** — comptes d'hébergement, base PostgreSQL, Upstash Redis, Vercel Blob à transférer. |
| Compte/clé API Anthropic (Copilot) | `@anthropic-ai/sdk`, clé via env | **EXTERNE** — dépendance à un service tiers payant ; contrat/clé à transférer ou re-provisionner. |
| Base de données de production (licences, devices, releases…) | control-plane | **EXTERNE** — données d'exploitation, hors dépôt. |

---

## 5. Documentation

| Actif | Emplacement | Statut |
|---|---|---|
| Documentation technique (~70 fichiers) | `docs/*.md` (architecture, sécurité, licensing, déploiement, runbooks…) | Présente dans le dépôt ; propriété liée à celle du code (réserve chaîne de titularité §1). |
| Audit d'acquisition & data-room | `docs/ACQUISITION_READINESS_AUDIT.md`, `docs/acquisition-data-room/` | Présents. |
| Le présent registre + notices/licences/SBOM | `docs/IP_ASSET_REGISTER.md`, `../THIRD_PARTY_NOTICES.md`, `docs/OPEN_SOURCE_LICENSE_AUDIT.md`, `docs/SBOM.md` | Présents. |

---

## 6. Synthèse — actifs à transférer hors dépôt (bloqueurs P0 & flags)

| Priorité | Actif | Pourquoi |
|---|---|---|
| **P0** | Clé privée de licence (ECC P-256) | Sans elle : impossible d'émettre des licences → produit non monétisable. |
| **P0** | Clé privée de signature des mises à jour (Ed25519) | Sans elle : impossible de publier des mises à jour signées. |
| **P0** | Domaine(s) `garageflows.fr` + DNS + backend/hébergement | Le produit route vers ces domaines/serveur ; inopérant sans transfert. |
| **P0** | Accord écrit de cession de PI (code + marque + clés) | La `LICENSE` n'établit pas la propriété ; la cession doit être formalisée. |
| **Flag** | Titularité des actifs de marque (logo, icônes) & marque verbale « GarageFlow » | Présents dans le dépôt mais **paternité/dépôt de marque non démontrables**. |
| **Flag** | Chaîne de titularité du code (auteur = chaîne « GarageFlow », contributeurs non identifiés) | Fournir historique Git + contrats de contribution/prestation. |
| **Flag** | Secrets serveur & comptes tiers (Anthropic, Upstash, Vercel Blob) | À re-provisionner ou transférer contractuellement. |

**Tout actif marqué « EXTERNE » ou « Flag » ci-dessus n'est pas démontrable depuis le seul dépôt et doit être couvert par des documents/transferts spécifiques dans la data-room.**

---
Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`.
