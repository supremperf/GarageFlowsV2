---
doc-numbers: journal
---

# ACTIONS MANUELLES RESTANTES — MASTER 5

Ordonnées par dépendance. Chaque entrée précise **ce qui est déjà prouvé**, **ce qui manque exactement**, et **la preuve attendue**. Aucune action ne doit être menée sur la production sans autorisation explicite.

---

## P0 — débloque le reste

### 1. Rattacher l'auteur du commit au compte Vercel

**Pourquoi.** Deux déploiements Preview ont été créés puis **refusés** : « the commit author doesn't have permission to create deployments for this project ». L'équipe `garage-flows` est en plan **Hobby**, qui exige que l'auteur du commit Git soit rattaché au compte. Le déploiement de production antérieur avait réussi parce que le dossier n'était alors sous aucun dépôt Git.

**Action.** Settings → Account → Emails : ajouter **`molliardmathys@gmail.com`** aux adresses du compte Vercel, ou y connecter le compte GitHub correspondant. Alternative : passer l'équipe sur un plan qui n'applique pas ce contrôle.

**Ce que cela débloque.** Le déploiement Preview, puis les vérifications HTTP sur l'URL de Preview, puis — après autorisation séparée — la promotion en production.

**Preuve attendue.** `vercel inspect <url>` avec `status ● Ready`, puis `/api/health` en 200 sur l'URL de Preview.

**À ne pas faire.** Déployer depuis une copie sans `.git` pour échapper au contrôle : cela fonctionne, mais produit un artefact non rattachable à un commit — le défaut de traçabilité corrigé pendant cette mission.

---

### 2. Localiser ou restaurer la clé privée d'émission de licences

**Pourquoi.** La clé publique vérifiée par le produit a l'empreinte **`b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d`** (EC `prime256v1`). La clé privée correspondante est introuvable : ni `keys/private.pem` sur ce poste, ni `GF_PRIVATE_KEY` dans les variables Vercel de **Production** (16 variables listées).

**Conséquences mesurées.**
- `/api/admin/licenses/generate` est **inopérante** côté serveur — elle renverra « Clé privée d'émission introuvable ».
- 90 tests Playwright authentifiés et 6 tests Vitest restent BLOQUÉS (ils exigent un jeton GF2 réellement signé).
- Le parcours « activation d'une licence de test » sur poste Windows ne peut pas être joué.

**Action.** Retrouver la clé privée autorisée dans son coffre, vérifier son empreinte SPKI, puis décider : soit la déposer en `GF_PRIVATE_KEY` (PEM en base64) pour autoriser l'émission serveur, soit confirmer que l'émission reste **exclusivement hors ligne** via `scripts/keygen.py` sur le poste qui la détient. Fournir en outre un **jeton GF2 de test** (`E2E_LICENSE` / `GF_TEST_LICENSE`) pour débloquer les tests.

**À ne jamais faire.** Générer une nouvelle paire et déplacer les ancrages (`keys:sync`) pour débloquer les tests : cela remplacerait l'autorité que vérifient les clients déjà déployés et **invaliderait toutes les licences en circulation**.

**Preuve attendue.** Empreinte SPKI de la clé privée égale à `b16d2e1b…`, puis `forgery-resistance.test.ts` sans aucun `skip` et `playwright test` sans les 90 `skipped`.

---

### 3. Obtenir un certificat de signature de code Windows

**Pourquoi.** `Get-AuthenticodeSignature` renvoie **`NotSigned`** sur `GarageFlows-Setup.exe` **et** sur `GarageFlows.exe`. Le reçu de livraison l'enregistre : `authenticodeVerified: false`. Aucun certificat n'est configuré dans le bloc `build` de `package.json`, et aucun n'est présent sur le poste.

**Conséquence.** SmartScreen affichera « éditeur inconnu » à chaque installation client.

**Action.** Acquérir un certificat **OV** (validation d'organisation) ou **EV** (clé en HSM, réputation SmartScreen immédiate), le configurer dans la cible `win` d'electron-builder, puis reconstruire.

**Preuve attendue.** `Status: Valid`, sujet et émetteur du certificat, et `authenticodeVerified: true` dans le reçu de livraison.

---

## P1 — valider le poste Windows et la conformité

### 4. Test d'installation Windows sur environnement JETABLE

**Déjà prouvé** (sans rien installer) : l'exécutable empaqueté démarre depuis l'arborescence que NSIS recopie, avec un PATH réduit à Windows et un répertoire courant vide ; l'intégrité ASAR est validée (**540 fichiers critiques**, `[integrity] OK`) ; l'écran d'activation s'affiche (porte de licence *fail-closed*) ; la sauvegarde pré-migration automatique est créée ; l'arrêt est propre deux fois de suite, **0 processus résiduel** ; la base métier de l'utilisateur est restée **identique au bit près** (SHA-256 relevé avant/après).

**Restant.** L'exécution de l'installeur NSIS lui-même, les raccourcis bureau et menu Démarrer, l'entrée de désinstallation, la **mise à niveau** d'une installation précédente, et la **désinstallation avec conservation des données**.

**Pourquoi non fait ici.** `scripts/test-windows-setup.ps1` exige — à raison — un runner Windows jetable approuvé, et refuse si un profil utilisateur existe déjà. Ce poste réunit les deux motifs de refus : installation réelle en `%LOCALAPPDATA%\Programs\GarageFlows` et profil `%APPDATA%\GarageFlow` de **410 fichiers / 285 Mo**. L'entrée de désinstallation étant partagée (même `appId`), installer ici risquait de rendre l'installation de l'utilisateur non désinstallable. L'isolation du userData est par ailleurs impossible sur ce poste : Electron résout `appData` par le dossier connu Windows, pas par la variable `APPDATA` (mesuré).

**Action.** Exécuter `scripts/test-windows-setup.ps1` sur un runner Windows jetable avec `GF_WINDOWS_SMOKE_ISOLATED=1`, ou sur une machine virtuelle propre.

**Preuve attendue.** Le JSON de résultat du script avec `success: true`, et en particulier `installExecuted`, `activationWindowOpened`, `sqliteSentinelWritten`, `reinstallPreservedData`, `uninstallPreservedData`.

---

### 5. Compléter les notices du paquet Windows — 6 composants

**Mesuré.** Six composants tiers sont **distribués dans l'installateur sans section de notice correspondante** :

| Composant | Licence | Taille | Origine |
|---|---|---:|---|
| `typescript@5.9.3` | Apache-2.0 | 8 904 Ko | tiré par `next/dist/lib/verify-typescript-setup.js` lors du traçage |
| `source-map@0.6.1` | BSD-3-Clause | 129 Ko | même traçage |
| `source-map-support@0.5.21` | MIT | 24 Ko | même traçage |
| `buffer-from@1.1.2` | MIT | 5 Ko | même traçage |
| `@img/sharp-win32-x64@0.35.5` | Apache-2.0 | — | binaire Windows, déclaré dans la clôture Windows mais absent des notices Linux |
| `@next/swc-win32-x64-msvc@15.5.28` | MIT | — | idem |

**Action.** Décider de publier des notices **par plateforme** et de les embarquer dans l'installateur (`build.files` / `extraResources`), puis reconstruire. Accessoirement : les 8,9 Mo de TypeScript n'ont aucun usage à l'exécution — leur exclusion de la sortie tracée allégerait l'installateur d'autant.

**Non fait ici** parce que cela modifie le contenu distribué et invaliderait l'artefact qui vient d'être vérifié. Le rapport chiffré complet est dans `artifacts/windows-delivery/sbom-reconciliation.json`.

**Preuve attendue.** `scripts/reconcile-windows-artifact-sbom.mjs` avec « empaquetés SANS notice disponible : 0 ».

---

### 6. Relecture juridique de la notice `client-only@0.0.1`

**Mesuré.** Le paquet déclare `"license": "MIT"` mais ne publie **ni fichier de licence, ni dépôt amont, ni ligne de copyright**. La notice reproduit le **texte de référence SPDX** de l'identifiant MIT, en indiquant explicitement qu'aucun titulaire de droits n'est affirmé.

**Action.** Faire valider ce choix par une relecture juridique : la reproduction du texte SPDX sans titulaire satisfait-elle l'obligation d'attribution pour ce paquet ? Faire relire dans le même mouvement les obligations **LGPL** (`@img/sharp-libvips-*`, côté Linux/Vercel) et les éventuels contenus **CC-BY**.

**Preuve attendue.** Avis écrit, consigné avec la version du paquet.

---

### 7. Scanner l'historique du dépôt amont

**Mesuré.** Le scan Gitleaks d'historique n'a porté que sur le commit de référence créé localement (1 commit, 124,38 Mo, 6 findings tous classés fixtures). L'historique complet du projet vit dans **`supremperf/GarageFlowsV2`** (dépôt désigné par `scripts/check-github-security.cjs` et `scripts/restore-public-anchors.cjs`), absent de ce poste.

**Action.** Sur un clone complet : `gitleaks git . --config .gitleaks.toml --redact --log-opts=--all`, puis trier les findings. Le commentaire d'en-tête de `secrets-jamais-distribues.test.ts` indique qu'un scan antérieur sur **377 commits** avait relevé trois valeurs exposées dans le premier commit historique, depuis rotées — à considérer comme publiques à jamais.

**À ne pas faire.** Réécrire l'historique pour masquer une fuite.

**Preuve attendue.** Nombre de commits scannés, octets analysés, findings triés avec classement, sans aucune valeur secrète.

---

### 8. Supprimer les bases de contrôle PostgreSQL laissées sur Neon

**Mesuré.** `scripts/gate-fresh-postgres.mjs` conserve volontairement sa base de contrôle (aucune suppression automatisée), et les suites d'intégration créent les leurs. Inventaire relevé sur l'instance Neon de **Preview** :

```
gf_gate_check_4932ccf019deb8b9      porte PostgreSQL (migrations sur base vierge)
gf_gate_check_789d376ab66ea6d5      porte PostgreSQL (seconde exécution)
gf_numbering_f071193b               suite de concurrence sur la numérotation
gf_it_mvkcjkmv_tat3                 suite d'intégration
gf_sess_mvkcjkq9_uz9t               suite de sessions licenciées
```

Soit **5 bases de contrôle** sur l'instance de Preview. Elles ne contiennent que des données de contrôle ; aucune n'est la base applicative de Preview (`neondb`), qui n'a pas été modifiée.

**Action.** Supprimer ces 5 bases sur l'instance Preview :

```sql
DROP DATABASE "gf_gate_check_4932ccf019deb8b9";
DROP DATABASE "gf_gate_check_789d376ab66ea6d5";
DROP DATABASE "gf_numbering_f071193b";
DROP DATABASE "gf_it_mvkcjkmv_tat3";
DROP DATABASE "gf_sess_mvkcjkq9_uz9t";
```

Elles n'ont pas été supprimées ici : un `DROP DATABASE` sur une instance partagée sort du mandat sans autorisation explicite, et le projet a précisément durci cette porte en MASTER 4 pour interdire toute suppression automatique.

Trois bases analogues subsistent par ailleurs sur le **PostgreSQL local jetable** (`gf_it_mvkcq7c9_zwwa`, `gf_sess_mvkcq7fm_6gky`, `gf_gate_check_955f68101bba4383`) : elles disparaîtront avec le conteneur, sans action.

---

## P2 — décisions produit, mesurées et à arbitrer

### 9. Suppression ou archivage des clients et des véhicules

**Mesuré par les API réelles.**

```
DELETE /api/clients/:id   → HTTP 405
DELETE /api/vehicles/:id  → HTTP 405
```

Les deux routes n'exportent que `GET` et `PATCH`. Aucun écran n'appelle de `DELETE` sur ces ressources. Les modèles `Client` et `Vehicle` ne portent **ni `deletedAt` ni `archivedAt`** — alors que `Mechanic` porte bien `archivedAt`.

**Conséquence.** Une fois créés, un client et un véhicule ne peuvent **plus être retirés ni archivés** par le produit. Le cahier des charges de la mission listait pourtant « Suppression » pour les deux modules.

**À arbitrer.** Est-ce voulu (intégrité comptable : un client porte des factures qu'il faut conserver) ? Si oui, documenter le choix. Sinon, l'option cohérente avec le reste du produit est l'**archivage** (`archivedAt`, comme `Mechanic`) plutôt qu'une suppression dure.

### 10. Modification directe des quantités de stock

**Mesuré.** `PATCH /api/parts/:id` avec `{ quantity }` → **HTTP 400**. Les champs modifiables sont `name`, `reference`, `description`, `minQuantity`, `location`, `supplierName`, `supplierRef`, `unitCost`, `unitPrice`. Les mouvements passent par les bons de commande et les pièces d'intervention.

**À arbitrer.** Comportement vraisemblablement voulu (traçabilité des mouvements). Confirmer qu'un **inventaire physique** — un ajustement manuel après comptage — dispose bien d'un chemin dans le produit.

### 11. Copilote IA : sorties externes volontairement fermées

**Mesuré dans le code.** Même avec `GARAGEFLOW_LLM=anthropic` et une `ANTHROPIC_API_KEY` valides, **aucun appel externe ne part** :

```ts
// There is currently NO independently verified monetary enforcement service.
// Keep all production IO closed, even with valid server key/model/opt-in.
if (!this.simulatedTransport) { this.attempt = { outcome: 'budget_blocked', … }; return null }
```

Le copilote répond exclusivement via son **moteur local déterministe** — vérifié par HTTP : `POST /api/copilot {query}` → **200** avec une réponse réelle et prudente. Ce n'est pas une réponse simulée ; `providerHealth()` rapporte honnêtement l'indisponibilité externe.

**À arbitrer.** Mettre en service le contrôle de plafond monétaire indépendant qui conditionne l'ouverture, ou assumer et documenter le mode local comme définitif. Les deux variables sont absentes de la Production, ce qui est cohérent avec cet état.

### 12. Capacité PostgreSQL sous pic de concurrence

**Mesuré.** 50 créations de factures en parallèle : **PASS** sur un PostgreSQL local, **ÉCHEC** sur l'URL directe d'une base Neon serverless (`Unable to start a transaction in the given time`). Ce n'est pas un défaut de la numérotation — le verrou de ligne sérialise correctement — mais une limite de capacité de l'instance de calcul.

**À arbitrer.** Si un pic de 50 créations simultanées sur un même garage est réaliste : augmenter le calibre du calcul Neon, ou relever `maxWait`/`timeout` de la transaction. Sinon, valider explicitement que le pic réel est très inférieur.

### 13. Acheminement SMTP externe

**Déjà prouvé** contre un serveur SMTP local jetable : chiffrement du mot de passe au repos, authentification réellement présentée avec le secret déchiffré, message réellement transmis, refus serveur jamais présenté comme un succès, clé de chiffrement modifiée bloquant l'envoi. **5/5.**

**Restant.** SPF, DKIM, DMARC, réputation d'expéditeur, réception dans une boîte réelle. Exige un serveur SMTP de test autorisé et une adresse destinataire autorisée.

### 14. Facturation électronique et mise à jour signée

**Partiellement couvert.** Le parcours « facturation électronique » compte **206 assertions vertes** et « installation Windows » 177. `npm run test:update-signing` fait partie des 190 tests release-safety verts.

**Restant.** Un essai en **bac à sable réel** du fournisseur de facturation électronique (file, webhook, reprise d'erreur), et une mise à jour signée de bout en bout (manifeste signé, téléchargement, rejet d'une signature invalide) contre une URL de distribution réelle. Le manifeste de release attend une URL HTTPS publique : `npm run release:sign -- --file release/GarageFlows-Setup.exe --version 1.1.0 --download-url <URL>`.

### 15. WebKit/Safari réel

La suite Playwright émule les gabarits iPhone/iPad **sous Chromium** — choix documenté dans `playwright.config.ts`. Le rendu du vrai moteur WebKit exige du matériel Apple.

### 16. Dépendances obsolètes

Aucune dépendance n'a été mise à jour pendant cette mission : `package.json` et `package-lock.json` sont inchangés, et l'audit de vulnérabilités est vert à tous les niveaux. Le tri des dépendances directes obsolètes reste à mener, par petits lots avec tests, sans `npm audit fix --force` ni majeures groupées.
