---
doc-numbers: journal
---

# AUDIT COMPLET GARAGEFLOWS — MASTER 5

Audit technique et fonctionnel du dépôt réel, exécuté sur le poste Windows de build. Tout ce qui figure ici a été **mesuré** ; ce qui n'a pas pu l'être est nommé comme tel.

---

## A. Dépôt, branche, commit — et un défaut majeur trouvé puis corrigé

### Ce qui a été constaté au démarrage

| Fait | Mesure |
|---|---|
| dossier de travail | `C:\Users\Mathys\Desktop\GarageFlowsV2-arena-388085e0-garageflowsv2` |
| racine du dépôt Git englobant | **`C:/Users/Mathys`** — le dossier utilisateur |
| fichiers GarageFlows suivis par ce dépôt | **0** sur 16 535 |
| ce que ce dépôt suivait réellement | un autre projet (`Desktop/3DMAKER-arena-600e877f-3dmaker`) et un `README.md` |
| commits | 3, aucun concernant GarageFlows |
| remotes | **0** |
| dépôt amont de référence (désigné dans les sources) | **`supremperf/GarageFlowsV2`** — absent du poste |

Le projet était donc une **copie de travail sans contrôle de version**. Quatre conséquences, toutes mesurées, toutes dues à cette seule cause :

1. le contrôle de sécurité **GF-DUR-044** était **inerte** : il s'appuie sur `git ls-files`, qui renvoyait 0 fichier — il n'inspectait rien tout en passant ses assertions de contenu ;
2. **Gitleaks** n'avait aucun historique GarageFlows à scanner ;
3. `scripts/post-build.js` produisait `release-manifest.json` **sans `buildId`** → artefact non rattachable à une révision, et `verify:installer` refusait l'installateur (« Missing or stale build identity ») ;
4. `readiness:final` exige un **`baseCommit` SHA-1** que le projet n'avait pas.

### Action, après autorisation

`git init -b main` dans le dossier du projet, puis **deux commits locaux, sans aucun remote et sans push**. Exclusions vérifiées **avant** l'ajout : `node_modules`, `.next`, `dist`, `.env`, `.env.local`, `keys/*.pem`, `src/generated`, `prisma/*.db` — tous ignorés.

| | |
|---|---|
| commit initial | `7c93676cd904b80793ba642b3b46291354b6ac97` — 2 862 fichiers |
| branche | `main` |
| remotes | 0 |

Les quatre conséquences sont levées. Effet de bord : Vercel transmet désormais l'auteur du commit, et son contrôle d'auteur en plan Hobby bloque les déploiements — voir `VERCEL_DEPLOYMENT_FINAL.md §5`.

### Le défaut `.gitignore`

`.env.example` — 28 ko de contrat d'environnement documenté, **sans aucune valeur** — n'était pas suivi. `git check-ignore -v` le prouve :

```
.gitignore:193:.env*    .env.example
```

Le fichier déclare `!.env.example` à la ligne 157, mais **quatre** motifs `.env*` apparaissent plus bas (119, 137, 184, 193) ; dans un `.gitignore`, le dernier motif correspondant décide. `vercel link` en ajoute un à chaque exécution, avec `.vercel`. Corrigé par un bloc final qui réaffirme les négations après tous les `.env*`.

### Continuité des preuves MASTER 4

```
$ sha256sum -c MASTER4_EVIDENCE/SHA256SUMS
69 OK, 0 FAILED
```

Les preuves MASTER 4 sont **intactes** et n'ont pas été modifiées. Les preuves MASTER 5 vivent dans un dossier distinct.

---

## B. Les neuf blocages du mandat

| Blocage | État MASTER 4 | État MASTER 5 | Référence |
|---|---|---|---|
| **A — Prisma** | FAIL/BLOCKED, `ECONNRESET` avant TLS | **RÉSOLU** — moteurs Windows + Linux, 2 clients générés, 10/10 opérations réelles sur chaque plateforme | `PRISMA_FINAL.md` |
| **B — Vitest** | 84 fichiers rouges, 3 échecs, 869 ignorés | **RÉSOLU** — 0 fichier rouge, 4 390 réussis, **0 échec**, 34 ignorés tous justifiés | `VITEST_FINAL.md` |
| **C — Playwright/Chromium** | 0 réussi, 54 échecs de lancement | **RÉSOLU pour l'exécutable** — Chromium officiel v1234, **54 réussis**, 0 échec ; 90 tests authentifiés BLOQUÉS faute de licence signable | `PLAYWRIGHT_FINAL.md` |
| **D — TypeScript** | 247 lignes d'erreurs | **RÉSOLU** — 0 erreur sur 957 fichiers, `strict` intact | `TYPESCRIPT_FINAL.md` |
| **E — Build / standalone** | FAIL, `BUILD_ID` absent | **RÉSOLU** — build complet, standalone vérifié, **serveur démarré et requêtes HTTP réelles** | `BUILD_NEXTJS_FINAL.md` |
| **F — Windows / Setup.exe** | FAIL, aucun artefact | **ARTEFACT PRODUIT ET VÉRIFIÉ** — 234,0 Mo, SHA-256 relevé, 9 fusibles, 540 fichiers d'intégrité, démarrage réel ; **non signé**, installation non jouée | `BUILD_WINDOWS_FINAL.md` |
| **G — Deux textes de licence** | FAIL résiduel | **RÉSOLU** — 133 sections, **0 texte manquant**, provenance et SHA-256 par entrée | `CORRECTIONS_MASTER5.md §3` |
| **H — Gitleaks** | BLOCKED / NOT RUN | **EXÉCUTÉ** — working tree et historique ; 0 secret exploitable | `GITLEAKS_FINAL.md` |
| **I — Services externes** | BLOCKED, accès manquants | **PostgreSQL PASS, Redis PASS, SMTP PASS (local), staging BLOQUÉ, performance PASS** | `DATABASE_FINAL.md`, `PERFORMANCE_FINAL.md` |

---

## C. Audit fonctionnel — par les API HTTP réelles

Méthode : session **réellement ouverte** par le formulaire de connexion dans un navigateur Chromium, puis appels aux API depuis le contexte de la page — exactement comme le fait l'application (middleware, session NextAuth et session de licence traversés). Instance dédiée : `prisma/e2e.db`, port 3100, 5 mécaniciens et 13 interventions seedés. Les charges utiles respectent les **schémas réels** du produit.

**Résultat : 39 contrôles sur 40 réussis**, le seul non-passant étant un refus d'intégrité correct (voir plus bas), plus **3 constats d'architecture** à arbitrer.

### Clients — 7/7

| Contrôle | Mesure |
|---|---|
| liste paginée | HTTP 200, forme `{ data, total, page, totalPages, limit }` |
| création | **HTTP 201**, identifiant retourné |
| modification | HTTP 200 |
| persistance relue | adresse modifiée effectivement relue |
| recherche par nom (`?q=`) | HTTP 200, 1 résultat pertinent |
| validation : nom vide | **HTTP 400** refusé |
| isolation : identifiant d'un autre tenant | **HTTP 404** — aucune fuite |

### Véhicules — 4/4

Liste, création rattachée au client (HTTP 201), modification du kilométrage, persistance **et** concordance du `clientId` vérifiées.

### Planning — 5/5

| Contrôle | Mesure |
|---|---|
| liste des mécaniciens | HTTP 200, **5 mécaniciens** |
| journée d'atelier (`?date=`) | HTTP 200 |
| création de rendez-vous | **HTTP 201** |
| déplacement (autre mécanicien + autre heure) | HTTP 200, **déplacement relu et confirmé** |
| statut hors canon | **HTTP 400** refusé |

### Facturation — 7/7 — le module le plus sensible

| Contrôle | Mesure |
|---|---|
| liste | HTTP 200 |
| création | **HTTP 201** |
| **numérotation séquentielle** attribuée par le serveur | **`FAC-2026-001`** |
| **totaux et TVA calculés côté serveur** | `{"taxRate":20,"totalHT":135.5,"totalTTC":162.6}` |
| changement de statut (brouillon → envoyée) | HTTP 200 |
| statut inconnu | **HTTP 400** refusé |
| **intégrité comptable** : facture émise non supprimable | **HTTP 409** — la série séquentielle est préservée |
| annulation possible (`cancelled`, stock restitué) | HTTP 200 |

Le numéro est réservé **dans la même transaction** que l'incrément du compteur : si la création échoue, l'incrément est annulé — pas de trou de séquence. La contrainte `@@unique([garageId, number])` protège en plus contre tout doublon. Prouvé sous concurrence : 50 créations parallèles → 50 numéros distincts et contigus.

### Stock — 5/5 + 1 constat

Liste, création (HTTP 201), modification du seuil d'alerte et du prix, alertes de stock bas (HTTP 200). **Intégrité** : une pièce engagée sur une facture n'est **pas supprimable** (HTTP 409).

**Constat** : la quantité n'est pas modifiable directement par `PATCH /api/parts/:id` (HTTP 400) — les mouvements passent par les bons de commande et les pièces d'intervention. Comportement vraisemblablement voulu ; à confirmer qu'un **inventaire physique** dispose d'un chemin.

### Utilisateurs et permissions

5 comptes atelier listés. La **matrice de droits est appliquée côté serveur**, pas seulement déclarée : `invoice:manage` est exigé pour la facturation et `stock:manage` pour le stock — un `RECEPTIONIST` est refusé en 403. Les routes revérifient que `clientId`, `vehicleId`, `jobId` et chaque `partId` appartiennent au garage de la session **avant toute écriture** (anti-IDOR).

Le modèle `Mechanic` porte `archivedAt` : un mécanicien archivé sort du planning.

### Paramètres — 3/3

Lecture des paramètres du garage (HTTP 200, **48 champs**), modification, persistance relue puis valeur restaurée. Le modèle `Garage` couvre identité d'entreprise, légal/fiscal (SIRET, TVA, taux), bancaire (IBAN/BIC), préférences de facturation (préfixes et compteurs facture/devis, conditions de paiement, pied de facture), langue, horaires d'ouverture à la demi-heure, et la configuration SMTP chiffrée.

### Copilote IA — 2/2, avec un constat important

| Contrôle | Mesure |
|---|---|
| `POST /api/copilot {query, history}` | **HTTP 200**, réponse réelle du moteur local |
| requête hors contrat (501 caractères) | **HTTP 400** refusé |

Réponse réellement obtenue :

> « Je ne peux pas répondre avec certitude. Donnez le module, la période ou une référence. Je peux expliquer le logiciel, consulter ses indicateurs disponibles et retrouver une intervention, mais pas modifier ou supprimer… »

**Ce n'est pas une réponse simulée** : c'est un moteur **local et déterministe**, prudent par construction, qui annonce ses propres limites. Le contrat d'entrée est `{ query ≤ 500, history ≤ 6 }`, strict.

**Constat à arbitrer** : aucune sortie externe ne part, **même avec une clé valide**. `AnthropicClassifier.request()` court-circuite toute entrée/sortie hors environnement de test, et le code en donne le motif :

```ts
// There is currently NO independently verified monetary enforcement service.
// Keep all production IO closed, even with valid server key/model/opt-in.
if (!this.simulatedTransport) { this.attempt = { outcome: 'budget_blocked', … }; return null }
```

`GARAGEFLOW_LLM` et `ANTHROPIC_API_KEY` sont d'ailleurs absentes des variables de Production — cohérent avec cet état. `providerHealth()` rapporte honnêtement `unavailable`. Voir `ACTIONS_MANUELLES_RESTANTES.md §11`.

### Deux constats d'architecture — défauts fonctionnels à arbitrer

```
DELETE /api/clients/:id   → HTTP 405
DELETE /api/vehicles/:id  → HTTP 405
```

Les routes n'exportent que `GET` et `PATCH`. **Aucun écran n'appelle de `DELETE`** sur ces ressources (vérifié sur l'ensemble de `src/components` et `src/app`). Les modèles `Client` et `Vehicle` ne portent **ni `deletedAt` ni `archivedAt`**, alors que `Mechanic` porte `archivedAt`.

**Conséquence : un client et un véhicule, une fois créés, ne peuvent plus être retirés ni archivés par le produit.** Le mandat listait « Suppression » pour les deux modules. C'est défendable par l'intégrité comptable (un client porte des factures à conserver), mais ce n'est écrit nulle part et l'option cohérente avec le reste du produit serait l'archivage. Arbitrage demandé.

### Aucun « bouton sans action » détecté

Le mandat précise qu'un bouton sans action réelle est un bug. Les actions atteignables ont été exercées de deux côtés :

- par l'**interface**, sur 4 gabarits : changement de mécanicien, ouverture/fermeture de l'assistant, menu « Plus » (Réception, Stock, Rappels, Finance), création d'intervention (modale), ouverture d'une intervention (modale d'édition), rotation — **17/17** ;
- par les **API**, module par module — **39/40**.

Le test `purchase-order-receive-returned.test.ts` verrouille spécifiquement ce risque pour la réception de stock : « la route existait, mais aucun écran ne l'appelait ». Il passe, et son assertion a été rendue robuste sans en affaiblir la garantie.

### Modules présents non couverts par cet audit HTTP

L'arborescence `src/app/api` compte une quarantaine de domaines. N'ont pas été exercés par HTTP dans ce passage, faute d'accès externes : facturation électronique (bac à sable fournisseur), OCR de plaques (`/api/plate-ocr`, nécessite une clé serveur et un accès réseau), portail client authentifié de bout en bout avec 2FA, synchronisation desktop ↔ cloud, Google Business/Places. Ces domaines sont couverts par la suite Vitest (4 390 tests) et par le rapport des 10 parcours métier (**899 assertions vertes, 0 échec**) — mais pas par une requête HTTP réelle ici.

---

## D. Qualité et portabilité — défauts trouvés au-delà du mandat

Six défauts de portabilité ou d'obsolescence ont été trouvés et corrigés, tous constatés par une mesure et non supposés. Détail et motifs : `CORRECTIONS_MASTER5.md §1`.

1. `gen-production-sbom.mjs` — `spawnSync('npx')` inutilisable sous Windows (`ENOENT`) : toute la chaîne SBOM était cassée sur la plateforme cible.
2. `gen-production-sbom.mjs` — l'identité racine de la SBOM suivait le **nom du dossier de travail** : `sbom:verify` ne pouvait réussir que dans un dossier nommé exactement `GarageFlowsV2`.
3. `e2e/audit.mjs` — chemin de navigateur d'image CI Linux codé en dur.
4. `reproduce-keygen-roundtrip.mjs` — délai Python de 10 s, insuffisant au premier démarrage de l'interpréteur sous charge ; résolution d'interpréteur sans les formes Windows.
5. `rapport-10-parcours.mjs` — le rapport **exigeait** un environnement cassé pour réussir.
6. `tests/gitleaks-ci.test.cjs` — assertion de bits de permission POSIX sur NTFS.

Aucune de ces corrections n'affaiblit un contrôle : trois rétablissent un contrôle qui ne fonctionnait pas, deux lèvent une incompatibilité de plateforme, une cesse d'exiger une panne.

---

## E. Hors périmètre, et pourquoi

| Élément du mandat | État | Raison |
|---|---|---|
| installation / désinstallation Windows réelle | **BLOCKED** | environnement jetable requis ; ce poste a une installation et 285 Mo de données réelles |
| signature Authenticode | **BLOCKED** | aucun certificat de signature de code |
| 90 parcours Playwright authentifiés | **BLOCKED** | clé privée d'émission de licences introuvable |
| déploiement Preview et promotion | **BLOCKED** | contrôle d'auteur de commit en plan Hobby |
| acheminement SMTP externe (SPF/DKIM/DMARC) | **BLOCKED** | aucun serveur SMTP de test autorisé |
| bac à sable de facturation électronique | **BLOCKED** | aucun accès fournisseur |
| WebKit/Safari réel | **BLOCKED** | matériel Apple requis |
| « périmètre Vosegus » (blocage MASTER 4 §A) | **SANS OBJET** | le mandat MASTER 5 ne le mentionne pas ; le produit audité est GarageFlows 1.1.0, et aucun modèle d'abonnement ou de paiement récurrent n'existe dans ce dépôt (aucune dépendance Stripe, aucune route de paiement) |

Toutes ces entrées sont reprises avec leur action précise dans `ACTIONS_MANUELLES_RESTANTES.md`.
