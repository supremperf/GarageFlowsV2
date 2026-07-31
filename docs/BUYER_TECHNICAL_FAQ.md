# FAQ technique acquéreur — GarageFlow

_Document de data room M&A. Vérifié de première main le 2026-07-31. Questions franches d'un acheteur technique, réponses honnêtes avec pointeurs._

Étiquettes de statut utilisées : **[OPÉRATIONNEL]** (câblé et fonctionnel), **[PARTIEL]**, **[CODE SEUL / SANS UI]**, **[NON CONSTRUIT / ROADMAP]**, **[PROPOSITION/DESIGN]**.

---

### 1. Peut-on exploiter le produit sans le vendeur ?
**Pas immédiatement.** Le code seul ne suffit pas. Quatre transferts d'actifs **externes** sont nécessaires : (1) les deux clés privées de signature (licence ECC P-256 + update Ed25519), (2) le backend control-plane + base PostgreSQL, (3) les domaines garageflows.fr, (4) la cession de PI écrite. Une fois ces éléments transférés — ou après re-keying — l'exploitation autonome est prouvable via la validation E2E de `docs/TRANSFER_PLAYBOOK.md` §5. C'est le plus gros point de diligence.

### 2. Les clés privées de signature sont-elles dans le dépôt ?
**Non.** `keys/private.pem` est gitignorée et absente ; la clé d'update est une variable d'environnement serveur. Seules les clés **publiques** sont embarquées (`electron/main.js:98-104`, `electron/update-verify.js:20-33`). Sans les privées, on ne peut ni émettre de licence ni signer d'update. Option : re-générer les paires et rebuild (playbook §1-bis).

### 3. Le produit est-il prêt pour la facturation électronique (e-invoicing) ?
**[NON CONSTRUIT / ROADMAP].** Aucun code Factur-X / UBL / CII / ZUGFeRD, aucune transmission Chorus Pro / PDP, aucun e-reporting. Le modèle ne gère qu'**un seul taux de TVA au niveau de l'en-tête** (pas de ventilation par ligne exigée par EN16931), ne fige pas de snapshot HT/TTC/TVA, stocke les dates en `String`, ne capture pas le SIRET acheteur/vendeur sur la facture, et n'a **ni modèle Avoir (CreditNote) ni modèle Paiement** — alors que l'UI renvoie « créez un avoir » (`src/app/api/invoices/[id]/route.ts:37`). Un chantier de plusieurs mois est requis avant conformité à l'obligation B2B française 2026-2027. C'est un risque légal sur le marché cible exact (garages français). Voir `prisma/schema.prisma:337-384`.

### 4. Existe-t-il un export FEC ?
**[OPÉRATIONNEL]** partiel : une route `export/fec` existe. Mais elle ne remplace pas l'e-invoicing structuré.

### 5. La facturation de base est-elle fiable ?
**Oui, [OPÉRATIONNEL]** sur les fondamentaux : numérotation séquentielle sans trou (compteur réservé et document créé dans une même transaction, `@@unique([garageId, number])`, gestion P2002), immuabilité de la facture émise (édition bloquée si statut ≠ draft), et arithmétique TVA en **centimes entiers** (`src/lib/billing.ts`, tests `tva.test.ts`). Réserve : les totaux sont **recalculés** à chaque lecture, pas figés à l'émission — un changement d'arrondi pourrait altérer un total déjà émis.

### 6. L'API publique `/api/v1` est-elle réelle ?
**Non — [NON CONSTRUIT pour la production].** Toutes les ressources v1 (clients, véhicules, factures, devis, pièces…) sont adossées à un **`Map` en mémoire non persistant** (`garagesite3/src/lib/api/store.ts`), documenté comme bac à sable. Sur Vercel serverless, les écritures sont perdues à chaque cold start et non partagées entre lambdas. Son rate limiter est aussi en mémoire par instance. Il existe une doc OpenAPI (`v1/openapi.json`) mais **ne pas valoriser cette API comme une plateforme d'intégration en production**. La rendre réelle = câbler `store.ts` à la base + autorisation par clé + rate limiting distribué.

### 7. Y a-t-il un système de webhooks / événements sortants ?
**[NON CONSTRUIT].** Aucun système de webhook malgré le cadrage « intégrations » ; le seul callback est le `onUploadCompleted` inactif de Vercel Blob.

### 8. Que se passe-t-il hors-ligne ?
Le desktop fonctionne hors-ligne sur SQLite locale, mais **il existe un verrou hard** : 48 h d'avertissement (grâce) puis **72 h → `app.quit()`** (`electron/main.js:298-299,1193-1206`), déclenché aussi sur détection de recul d'horloge. Un garage sans internet 3 jours voit l'app se fermer. Cela contredit un positionnement « offline-first » et constitue un risque de churn. À ré-architecturer (grâce configurable / mode lecture seule).

### 9. L'application se verrouille-t-elle si la vérification de licence échoue en réseau ?
**Non — fail-open réseau.** L'enforcement de licence est fail-open sur erreur réseau (`electron/main.js:1042,1054`) : un utilisateur légitime hors-ligne n'est jamais verrouillé par une panne réseau (dans la fenêtre de grâce). Le verrouillage vient uniquement du dépassement du seuil 72 h (Q8).

### 10. L'installeur Windows est-il signé ?
**Non — [NON CONSTRUIT].** Aucun certificat de signature de code dans le bloc electron-builder (`package.json`). Chaque installation déclenche l'avertissement SmartScreen « éditeur inconnu ». Procurer un certificat OV/EV et le câbler avant go-to-market. Cela affaiblit aussi le récit anti-tamper.

### 11. Quelles plateformes sont supportées ?
**Windows x64 (NSIS) uniquement.** Pas d'arm64, macOS ni Linux buildé, bien que le code d'update référence `.dmg/.deb/.AppImage`. Cible unique.

### 12. Quel est l'effort de rebranding (white-label) ?
**Plus important qu'il n'y paraît — [PARTIEL].** Une config typée Zod bien conçue existe (`src/config/brand.ts`, override 3 couches env → JSON → défauts), mais **seulement ~2 consommateurs `BRAND.*`** hors du fichier de config. Le nom produit, le titre de page, l'alt du logo et les couleurs sont **codés en dur dans ~40+ endroits** (~146 occurrences littérales « GarageFlow », 8 hex de marque). Rebrander en éditant un seul fichier **n'aura presque aucun effet** sur l'UI. Budgéter un vrai chantier d'ingénierie. Voir `src/app/layout.tsx:7`, `GarageFlowLogo.tsx:45`.

### 13. Peut-on gérer plusieurs garages / un réseau / une franchise ?
**Non — [NON CONSTRUIT].** Le schéma plafonne à un **Garage** unique comme locataire de tête ; tous les modèles pendent de `garageId`. Il n'y a **aucune entité Organisation/Réseau au-dessus** (`prisma/schema.prisma:24`). L'isolation par garage fonctionne, mais un roll-up/franchise exige une refonte de schéma + contrôle d'accès cross-garage + reporting consolidé. La « multi-garage » actuelle est une capacité de licensing/déploiement, **pas** une hiérarchie opérationnelle.

### 14. Peut-on importer les données d'un concurrent (migration client) ?
**Non — [NON CONSTRUIT].** Aucun assistant d'import CSV/Excel : pas de dépendance de parsing (papaparse/exceljs/xlsx/csv-parse tous absents), pas de route/UI d'import, pas de mapping de champs, pas de dry-run. Le CSV existant est **export uniquement** (`src/lib/reports/csv.ts`). Il existe un `labor-operations/bulk-import` ciblé, mais pas d'importeur généraliste. Chaque nouveau client doit être onboardé manuellement ou par script custom.

### 15. Le sauvegarde/restauration existe-t-il ?
**[CODE SEUL / SANS UI].** Le sous-système de backup est de qualité production dans le code (AES-256-GCM, KDF scrypt, snapshot/restore/verify/download, historique `BackupRecord`, routes API), mais **aucune UI ne l'invoque** — pas de `BackupTab` dans les réglages. Un propriétaire non-technique ne peut pas créer/restaurer une sauvegarde. Effort UI faible mais exposition actuelle à la perte de données.

### 16. Le monitoring est-il réel ?
**[PARTIEL / OPÉRATIONNEL].** Collecte réelle CPU/mémoire/disque/latence DB avec seuils (`src/lib/monitoring/metrics.ts`), dashboard câblé sur endpoint réel. Réserves : **pas de lien de navigation** vers `/monitoring` (accessible par URL directe seulement), pas de corrélation-ID de requête, pas d'export métriques (Prometheus/OTel).

### 17. Quelle est la posture de sécurité globale ?
**Forte — c'est le meilleur atout.** Isolation renderer Electron textbook (`contextIsolation`/`sandbox`/`webSecurity`), serveur bouclé sur loopback, vérification de licence ECDSA P-256 (clé publique seule embarquée), updates signés Ed25519 avec SHA-256 **avant** exécution + anti-downgrade + allowlist d'hôtes, backups AES-256-GCM authentifiés, tokens device HMAC, comparaisons timing-safe, enforcement de sièges TOCTOU-safe (`SELECT FOR UPDATE`), isolation multi-tenant en profondeur **prouvée par tests** (401/403/403). Bien au-dessus d'un SaaS solo typique.

### 18. Quelles sont les faiblesses de sécurité résiduelles ?
Des durcissements, pas des failles structurelles : (a) clé admin **unique partagée** pour tout le backend de licences, sans identité par opérateur/MFA/RBAC, stockée en `sessionStorage` navigateur ; (b) rate-limit portail login/2FA contournable via `X-Forwarded-For` forgé + pas de compteur d'échecs 2FA par compte (brute-force TOTP possible avec mot de passe connu) ; (c) secrets TOTP portail stockés **en clair** ; (d) anti-tamper local **JS uniquement**, auto-documenté comme contournable. Toutes remédiables. _Note : une limite de rate 2FA par compte a été ajoutée côté desktop cette session._

### 19. L'anti-tamper protège-t-il vraiment les revenus (DRM) ?
**Non, best-effort.** Le manifeste d'intégrité est vérifié en JavaScript avec une clé HMAC dérivée d'un « secret fragmenté » compilé dans le binaire — le code lui-même admet que check et secret sont extractibles/patchables par un reverse-engineer. Combiné au binaire non signé, la résistance au contournement est **douce**. Ne pas présenter comme du DRM fort.

### 20. Le rollback automatique fonctionne-t-il ?
**Oui désormais — [OPÉRATIONNEL].** `autoRollbackIfUnhealthy` existe (durci contre l'abus via correspondance HWID de devices enregistrés), et un `vercel.json` planifie le cron horaire `/api/cron/rollback-check` (`0 * * * *`) avec auth fail-closed `CRON_SECRET` (ajouté cette session). L'audit initial notait l'absence de cron ; c'est remédié.

### 21. La couverture de test est-elle bonne ?
**Forte côté backend/logique, nulle côté UI.** ~87 fichiers de test, faible mocking. Vérifié cette session : **678 tests passés** (V2) et **140 passés** (site3) sur le sous-ensemble non-intégration ; `tsc --noEmit` exit 0 partout. La CI des deux dépôts fait typecheck + lint + build + tests sur Postgres/Redis réels + Gitleaks. **Mais** : aucun E2E (Playwright/Cypress), aucun test de composant `.tsx`, couverture mesurée mais **non gated**. Voir `docs/TEST_STRATEGY.md`.

### 22. Des tests de charge/performance ont-ils été faits ?
**Non — aucun.** Zéro benchmark, zéro test de charge. Les schémas sont bien indexés (`@@index([garageId, ...])`), le desktop est mono-garage par installation (pas de contention centrale), le control-plane cloud est le seul plan multi-tenant. Cibles et plan de test **proposés** (non mesurés) dans `docs/PERFORMANCE_REPORT.md`.

### 23. Y a-t-il des risques N+1 ?
**Non profilés.** Les handlers de listes (jobs/invoices/quotes avec relations) sont à auditer pour l'usage d'`include`/`select` plutôt que de requêtes en boucle. Signalé comme point de vérification, pas comme défaut constaté.

### 24. La posture de dépendances/licences est-elle propre pour une vente ?
**Oui.** Toutes les dépendances **directes** des deux dépôts sont permissives (MIT/ISC/Apache/BSD). **Aucun GPL/AGPL/SSPL**. Copyleft limité au transitif faible risque : LGPL-3.0 `@img/sharp-libvips` (natif, lié dynamiquement, outillage build), et MPL-2.0 file-level (axe-core, lightningcss, dompurify dual). `@anthropic-ai/sdk` (MIT) est optionnel et dégrade proprement sans clé API. Voir SBOM / THIRD_PARTY_NOTICES.

### 25. Dépend-on d'un fournisseur d'IA ?
**Non, pas de lock-in.** Deux fonctions optionnelles (OCR de plaque, lookup de plaque) utilisent Anthropic, mais sont gated sur `ANTHROPIC_API_KEY` optionnelle et dégradent silencieusement si absente. La couche LLM Copilot est agnostique derrière une interface `LlmProvider` et livrée déterministe par défaut (aucun fournisseur embarqué).

### 26. Le schéma desktop est-il reproductible depuis les migrations ?
**Non — [PARTIEL].** `prisma/migrations` ne contient que 2 patches incrémentaux, **sans baseline `init` ni `migration_lock.toml`** pour les ~30 modèles métier ; le desktop repose sur `db push` + une base template livrée. Le schéma **cloud**, lui, est reproductible (4 migrations ordonnées + lock postgresql). À baseliner côté desktop.

### 27. Quelles sont les dettes de maintenance connues ?
Electron épinglé **31.7.7** (en retard sur Chromium/Node), split **Next 14 (desktop) / 15 (cloud)**, next-auth **v4** (ligne dépréciée), pas de pin `engines` Node, fichiers `electron/*.js` embarqués = **copies non testées** de `src` (risque de divergence sur du code sécurité-critique), et audit de dépendances **non bloquant** côté garagesite3.

### 28. Combien de modèles de données et de routes ?
Desktop : **37 modèles** Prisma (+ miroir serveur 37), **125 routes** API. Cloud : **13 modèles**, **56 routes** (dont l'API v1 versionnée). Parité desktop ↔ miroir serveur excellente (dérive quasi nulle).

### 29. Y a-t-il des secrets committés dans le dépôt ?
**Non.** `.env` est gitignoré et absent ; `.env.example` est tracké et ne contient que des placeholders documentés. Gitleaks tourne en CI. L'identifiant démo (`admingarageflow@admin.fr`) est un credential démo étiqueté, pas un secret.

### 30. En résumé, qu'achète-t-on ?
Un **socle sécurité + licensing de qualité production** (desktop + backend) avec une **posture IP/dépendances propre** et un **socle de test backend substantiel** — c'est le vrai actif et il justifie le plancher de valorisation. Autour, beaucoup de features sont **facade-deep** (white-label non câblé, backup sans UI, monitoring sans nav), **non construites** (e-invoicing, API v1 persistante, webhooks, import, hiérarchie multi-garage), ou **externes** (clés/backend/domaines non vérifiables depuis le code). Ces éléments plaident contre le plafond. Scores de préparation de l'audit : technique 60, sécurité 70, transférabilité 45, démoabilité 57, global **54/100**.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md)._
