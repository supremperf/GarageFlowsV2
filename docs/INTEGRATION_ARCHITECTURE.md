# Architecture d'intégration

> Document de data room — diligence technique M&A.
> Distinction stricte : **EXISTANT** (points d'intégration réellement abstraits dans le code) vs **PROPOSITION** (abstractions suggérées, non construites).

## 1. Synthèse

GarageFlow est conçu **offline-first** : ses fonctions d'enrichissement fonctionnent **sans réseau** grâce à des moteurs déterministes, tout en exposant des **frontières d'intégration bien abstraites** où brancher un fournisseur externe. C'est un vrai point fort de qualité d'ingénierie : les interfaces (`Provider`) isolent le cœur métier des dépendances tierces, et les tests injectent des implémentations factices. En contrepartie, **la plupart des fournisseurs réels ne sont pas livrés** (par choix : clé d'API + politique réseau requises) — l'abstraction existe, le branchement reste à faire.

| Point d'intégration | Abstraction | Fournisseur réel livré ? |
|---|---|---|
| Copilot LLM | EXISTANT (`src/lib/copilot-llm`) | Non — déterministe par défaut, provider optionnel |
| Notifications (email/SMS/in-app) | EXISTANT (`src/lib/notifications`) | Partiel — in-app livré ; email/SMS = interface, transport à injecter |
| Décodage VIN | EXISTANT (`src/lib/vin`) | Oui (offline) + NHTSA optionnel non branché par défaut |
| Recherche par plaque | EXISTANT (`/api/plate-lookup`) | Oui — SIV externe + repli IA Claude |
| OCR | EXISTANT (`src/lib/ocr`) | Partiel — passthrough/mock livrés ; moteur réel à brancher |
| Comptabilité / PDP e-invoicing / catalogue pièces / stockage | PROPOSITION | Non construit |

---

## 2. Points d'intégration EXISTANTS (abstraits dans le code)

### 2.1 Copilot — couche LLM agnostique du fournisseur
Fichiers : `src/lib/copilot-llm/` (`provider.ts`, `types.ts`, `prompts.ts`, `classify.ts`, `phrase.ts`, `ground.ts`).

- **Architecture safety-first** : l'assistant fonctionne **sans aucun provider** (classification déterministe + restitution verbatim des faits). Un `LlmProvider` optionnel peut améliorer la compréhension d'intention et reformuler les réponses.
- **Garde de grounding** : toute reformulation LLM passe par un contrôle qui **rejette tout chiffre absent des faits fournis**, avec repli sur le texte déterministe (`types.ts` documente ce contrat ; `ground.ts`).
- **Interface** (`types.ts:70-76`) :
  ```ts
  interface LlmProvider { readonly id: string; readonly name: string
    classify?(query, intents): Promise<LlmClassification | null>
    phrase?(input): Promise<string | null>
    complete?(messages, opts?): Promise<LlmCompletion> }
  ```
- **Résolution du provider** (`provider.ts:27-32`) : par défaut `resolveLlmProvider()` renvoie `null` → Copilot 100 % déterministe. Le code documente précisément comment brancher un provider (ex. Anthropic via `process.env.GARAGEFLOW_LLM`) — mais **rien n'est bundlé** (nécessite clé + politique réseau). Hook de test `__setLlmProvider`.
- **Statut** : abstraction opérationnelle et testée ; provider réel = branchement à réaliser.

### 2.2 Notifications — moteur multi-canal transport-agnostique
Fichiers : `src/lib/notifications/` (`channels.ts`, `engine.ts`, `triggers.ts`, `templates.ts`, `types.ts`).

- Chaque canal implémente l'interface `ChannelProvider` ; le moteur les traite uniformément (`channels.ts`).
- **`FunctionProvider`** (`channels.ts:15-27`) : provider générique construit avec une **fonction `send` injectée** et un drapeau `configured` — la couche API branche les transports réels (nodemailer pour l'email, une passerelle pour le SMS) **sans que le code de notifications ne détienne de credentials**.
- **`InternalProvider`** (`channels.ts:30-38`) : notifications in-app, **toujours disponibles** (livré).
- **`MockProvider`** (`channels.ts:41-59`) : enregistre les envois, simule échecs transitoires — pour tests et dry-runs.
- **Statut** : moteur + canal in-app opérationnels ; email/SMS = **interface prête, transport réel à injecter** (aucune passerelle SMS ni SMTP livrée par défaut).

### 2.3 Décodage VIN — chaîne de providers offline-first
Fichiers : `src/lib/vin/` (`providers.ts`, `decode.ts`, `engine.ts`, `validate.ts`) ; route `GET /api/vin`.

- **`OfflineProvider`** (`providers.ts:16-22`) : décodage **déterministe, hors-ligne**, base toujours disponible de la chaîne.
- **`NhtsaProvider`** (`providers.ts:31-53`) : provider externe optionnel adossé à l'API gratuite **NHTSA vPIC** (sans clé), avec timeout et **dégradation gracieuse** (retour `null` → la base offline s'applique). **Non inclus dans la chaîne par défaut** (offline-first, tests sans réseau) — à ajouter explicitement.
- **Interface** `VinProvider.decode(vin): Promise<Partial<VinInfo> | null>` — chaîne extensible.
- **Statut** : opérationnel offline ; enrichissement externe branchable en une ligne.

### 2.4 Recherche par plaque — SIV externe + repli IA
Fichier : `src/app/api/plate-lookup/route.ts`.

- Route **authentifiée** (`requireSession`) et **rate-limitée** (20/min par garage) car elle déclenche des appels sortants potentiellement facturés.
- **Validation de format AVANT tout appel** (`/^[A-Z0-9-]{4,12}$/`) : anti-injection et anti-gaspillage.
- Chaîne : (1) API SIV française `api-immat.com` (gratuite, timeout 4s) → si succès, source `siv` ; (2) **repli IA** via Claude (`claude-haiku-4-5`) **uniquement si `ANTHROPIC_API_KEY` présent**, sinon source `unknown` sans erreur bloquante.
- **Statut** : opérationnel ; dépend d'un service externe + d'une clé API optionnelle (dépendance externe à documenter).

### 2.5 OCR — frontière pluggable
Fichiers : `src/lib/ocr/` (`providers.ts`, `engine.ts`, `extract.ts`, `classify.ts`, `plate-scan.ts`, `vin-scan.ts`).

- **`TextOcrProvider`** (`providers.ts:13-22`) : passthrough — le texte reconnu est fourni en amont (`{ text }`), blocs à pleine confiance.
- **`MockOcrProvider`** (`providers.ts:28-46`) : map fixe pour tests/démos.
- Interface `OcrProvider.recognize(input): Promise<OcrResult>` — un moteur réel (Tesseract, API vision cloud) implémente la même interface.
- Le pipeline aval (classification, extraction, normalisation, scan plaque/VIN) reste **entièrement testable** sans moteur réel.
- **Statut** : pipeline opérationnel ; **moteur OCR réel non livré** (passthrough/mock uniquement).

### 2.6 Frontière réseau / déploiement
- Serveur Next.js standalone lié **strictement à `127.0.0.1:4028`** dans Electron ; navigation verrouillée sur loopback ; allowlist d'hôtes HTTPS pour l'ouverture externe (`electron/main.js`). Toute intégration sortante passe par ces gardes.

---

## 3. Abstractions PROPOSÉES (non construites — feuille de route)

> Rien de cette section n'existe dans le code. Ce sont des **propositions** cohérentes avec le style d'abstraction ci-dessus.

### 3.1 Comptabilité
Interface `AccountingProvider` pour exporter/synchroniser vers un logiciel comptable.
- Existant réutilisable : export **FEC** (`src/app/api/export/fec/route.ts`).
- Proposition : `export(period): FecDocument` déjà couvert ; ajouter `push(entries)` vers Sage/EBP/QuickBooks via connecteurs. **Non construit.**

### 3.2 E-invoicing / PDP (réforme facturation électronique FR)
Interface `EInvoiceProvider` (Factur-X/UBL/CII + transmission via PDP/Chorus Pro).
- **Rappel honnête** : il n'existe **aucun** code Factur-X/UBL/CII/Chorus/PDP/e-reporting aujourd'hui ; le modèle de données ne supporte qu'un **taux de TVA unique par facture**, sans SIRET acheteur ni statuts de cycle de vie e-reporting (voir audit e-invoicing).
- Proposition : `serialize(invoice): FacturX`, `transmit(doc): TransmissionReceipt`, `pollStatus(id)`. **Non construit — chantier majeur (multi-mois)**, prérequis à la conformité au mandat français 2026-2027.

### 3.3 Catalogue de pièces
Interface `PartsCatalogProvider` pour interroger des catalogues fournisseurs (référence, disponibilité, prix).
- Proposition : `search(query)`, `availability(sku)`, `price(sku)`. **Non construit.**

### 3.4 Stockage
Interface `StorageProvider` pour les pièces jointes/documents (local vs objet cloud).
- Existant partiel côté cloud : upload d'installeurs via **Vercel Blob** (`blob-upload/route.ts`, plan de contrôle) — spécifique aux releases, pas un stockage documentaire générique.
- Proposition : `put/get/delete/signedUrl`. **Non construit** pour les documents métier.

---

## 4. Points de vigilance acquéreur
- Les **abstractions** sont un actif de qualité (faible couplage, testabilité) — mais **abstraction ≠ fournisseur livré**. Ne pas présenter email/SMS, OCR réel, LLM, enrichissement externe comme opérationnels par défaut.
- Les intégrations sortantes réelles (plaque SIV, IA, NHTSA) dépendent de **services/ clés externes** — dépendances de transfert à recenser.
- E-invoicing/PDP est **non construit** et **critique** pour le marché français réglementé.

---
*Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
