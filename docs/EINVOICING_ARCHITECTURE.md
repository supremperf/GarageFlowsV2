# Facturation électronique — architecture & état d'avancement

> Intégration d'une rubrique complète de facturation électronique, multi‑garage,
> compatible PWA/Electron, **entièrement désactivée par défaut**, et **compatible
> avec `scripts/RESET-GARAGEFLOW.cmd`** (voir `EINVOICING_RESET_COMPATIBILITY.md`).

## Statut honnête

Cette fonctionnalité est une **plateforme réglementée** (PDP/PPF) : elle exige des
adaptateurs API **réels et certifiés**, des flux OAuth réels, la génération
Factur‑X/UBL/CII, des webhooks signés, et une validation sur Windows du script de
reset. Elle est livrée **par phases**. Ce commit livre la **Phase 1 — Fondation**,
sûre, additive et testée. Les phases suivantes nécessitent les **spécifications
API réelles** des plateformes agréées et un **poste Windows** pour prouver le
reset. **Rien n'est simulé** : aucune plateforme n'est présentée comme
« connectable » sans adaptateur réel, aucun envoi n'est feint.

## Phase 1 — Fondation (livrée, testée)

Répertoire `src/lib/einvoicing/` :

- **`flags.ts`** — indicateurs de fonctionnalité. Tout **OFF** par défaut ;
  `sandboxOnly` **force** l'environnement sandbox ; les sous‑fonctions n'ont
  d'effet que si le drapeau maître est vrai. Aucun secret.
- **`catalog.ts`** — `ApprovedEInvoicePlatform` (registre centralisé,
  actualisable, **distinct** des connecteurs) + `normalizePlatformSearch`
  (insensible casse/accents) + `searchPlatforms` (préfixe d'abord, tri alpha) +
  `isPlatformConnectable` (vrai **uniquement** si un adaptateur réel existe). Le
  seed est un **placeholder** à remplacer par le registre officiel — **aucun
  numéro d'agrément fabriqué**, tout en `coming_soon`.
- **`adapter.ts`** — interface `EInvoiceProviderAdapter` + `EInvoiceAdapterRegistry`.
  Le registre global `einvoiceAdapterRegistry` est **VIDE** : aucun connecteur réel
  n'est encore livré. On n'y enregistre **jamais** un stub qui simulerait un envoi.
- **`credentials-cipher.ts`** — chiffrement **AES‑256‑GCM** des identifiants
  (`GF_EINVOICE_CREDENTIALS_KEY`, serveur uniquement), enveloppe versionnée
  `gfeic1.<version>.<iv>.<tag>.<ct>`, détection d'altération (tag GCM), rotation
  contrôlée par version de clé. La clé n'est **jamais** rotée par le reset.

Manifeste (`scripts/garageflow-env-manifest.json`) : **10 variables** ajoutées
(schéma existant), `autoManage:false` (jamais forcées), la clé en `autoGenerate:false`
+ `autoManage:false` + `rotationRisk:critical` (précédent `GF_SMTP_CIPHER_KEY`).
`.env.example` documenté. Tests : `src/lib/einvoicing/__tests__/`.

## Phases suivantes (planifiées, non livrées)

2. **Modèles de données** (additifs, non destructifs, **côté serveur PostgreSQL**
   pour les secrets ; jamais d'identifiants déchiffrables en SQLite/desktop) :
   `EInvoiceProvider`, `GarageEInvoiceConnection`, `EInvoiceTransmission`,
   `EInvoiceEvent`, `EInvoiceWebhookReceipt`, `IncomingEInvoice`,
   `EInvoicePaymentReport`, `EInvoiceAuditEvent`. Migration additive, `prisma
   validate` + `generate`, **jamais** déclenchée par le reset.
3. **Connexions par garage** — routes serveur (`requireSession`, filtre `garageId`,
   rôles OWNER/ADMIN/COMPTABLE ; mécanicien **bloqué**), identifiants chiffrés via
   `credentials-cipher`, méthode d'auth adaptée à chaque plateforme (OAuth2 réel,
   clé API, client_credentials, certificat…), **bouton « Tester la connexion »**
   effectuant un **vrai** appel non destructif avec diagnostic clair.
4. **Adaptateurs réels** — un par plateforme certifiée, à partir de ses specs API,
   enregistrés dans le registre **uniquement une fois testés**.
5. **Envoi électronique** — génération Factur‑X/UBL/CII, hash SHA‑256, clé
   d'**idempotence** `garage:<id>:invoice:<id>:version:<v>` + contrainte unique +
   transaction + état `submission_pending` (anti double‑envoi), suivi de statuts,
   webhooks signés, chronologie.
6. **Rubrique UI** « Paramètres › Facturation électronique » (combobox recherchable
   accessible, état de connexion, transmissions, journal d'audit) et bouton
   « Envoyer électroniquement » **conditionné** (feature ON, plateforme connectée,
   test valide, facture finalisée non déjà envoyée, permission).

## Sécurité (transverse)

- Multi‑tenant strict : `garageId` **de la session serveur**, jamais du client ;
  isolation prouvée par tests ; un garage ne voit/teste/envoie jamais pour un autre.
- Secrets : chiffrés au repos (AES‑256‑GCM), **jamais** en `localStorage`,
  `sessionStorage`, frontend, Electron, logs, erreurs, ni dans Git.
- Environnement **sandbox** par défaut ; production seulement après levée explicite
  de `EINVOICING_SANDBOX_ONLY`.
- Un PDF envoyé par e‑mail **n'est pas** une facture électronique réglementaire.

## Activation

1. Générer et déployer `GF_EINVOICE_CREDENTIALS_KEY` (serveur), `…_VERSION=1`.
2. `EINVOICING_ENABLED=true`, garder `EINVOICING_SANDBOX_ONLY=true` d'abord.
3. Activer les sous‑fonctions au besoin, connecter une plateforme (adaptateur réel),
   **tester**, puis lever `SANDBOX_ONLY` pour la production.
