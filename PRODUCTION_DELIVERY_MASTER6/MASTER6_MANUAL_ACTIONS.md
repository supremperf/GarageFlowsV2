---
doc-numbers: journal
---

# ACTIONS MANUELLES RESTANTES — MASTER 6

Ordonnées par urgence. Chaque entrée dit **ce qui est déjà prouvé**, **ce qui manque exactement**, et **la preuve attendue**.

---

## P0 — sécurité, à traiter en priorité

### 1. Roter les secrets exposés dans l'historique du dépôt PUBLIC

**Mesuré.** `supremperf/GarageFlowsV2` est **public**. Trois fichiers ne figurent dans aucune branche actuelle mais existent dans d'anciens commits de son historique :

```
.env.storage.local          3 findings generic-api-key
keys/licenses_db.json       1 finding jwt — base des licences émises
keys/server_config.json     1 finding generic-api-key
```

**Action.** Identifier les valeurs que ces fichiers contenaient et les **roter toutes** : jetons de stockage, configuration serveur, et tout jeton de licence présent dans `licenses_db.json`. Les considérer comme publiques à jamais — c'est la doctrine que le projet applique déjà à ses trois secrets historiquement exposés.

**À ne pas faire.** Réécrire l'historique pour les faire disparaître : sur un dépôt public déjà cloné et indexé, cela ne retire rien et masque la trace.

**Alternative à évaluer.** Si l'historique complet n'a pas de valeur propre, rendre le dépôt **privé** limiterait l'exposition future sans effacer le passé.

**Preuve attendue.** Liste des secrets rotés avec leur date, sans aucune valeur.

---

### 2. Retrouver ou roter la clé privée de licence

**Mesuré.** La privée de `b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d` est introuvable dans tous les emplacements autorisés. `GF_PRIVATE_KEY` était configurée en production le 2026-08-10 et a disparu lors du reset que documente le nom de la sauvegarde.

**Conséquence.** Le système de licences **vérifie mais n'émet plus**. Aucune licence client ne peut être créée ni renouvelée.

**Action.** Trois options chiffrées dans `MASTER6_ECC_KEY_REPORT.md §6` :

- **A** — rotation simple, ce que le projet a déjà fait onze fois : invalide les licences existantes ;
- **B** — vérificateur multi-clés : compatibilité ascendante, mais modifie un composant de sécurité central (sept points de travail listés) ;
- **C** — réutiliser la paire `78e2626b…` trouvée sur le Bureau : **déconseillé**, elle est en clair hors coffre.

**Information manquante pour trancher.** Le nombre de licences réellement en circulation **en production**. Le staging en contient 0 ; la base de production n'a pas été interrogée, hors périmètre autorisé.

→ **Autorisez-moi une lecture seule (`SELECT count(*)`) sur la base de production** et je chiffre l'impact exact de l'option A.

**À ne jamais faire.** Exécuter `keys:sync` pour débloquer un test : cela remplacerait l'autorité que vérifient les clients déployés.

---

## P1 — livraison

### 3. Acquérir un certificat de signature de code Windows

**Mesuré.** `NotSigned` sur `GarageFlows-Setup.exe` et sur `GarageFlows.exe`. Aucun certificat sur le poste, aucune variable `CSC_LINK` / `CSC_KEY_PASSWORD`, aucune entrée dans `build.win`.

**Action.** Certificat **OV** (validation d'organisation, moins coûteux, réputation SmartScreen à construire) ou **EV** (clé en HSM, réputation immédiate). Puis le déclarer dans la cible `win` d'electron-builder et reconstruire.

**Preuve attendue.** `Status: Valid`, sujet et émetteur du certificat, et `authenticodeVerified: true` dans le reçu de livraison.

---

### 4. Jouer le parcours Windows sur machine jetable

**Déjà prouvé, sans rien installer** : démarrage de l'exécutable empaqueté avec PATH réduit à Windows et répertoire courant vide, validation d'intégrité ASAR de **540 fichiers**, écran d'activation (porte *fail-closed*), sauvegarde pré-migration automatique, arrêt propre deux fois sans processus résiduel, base métier de l'utilisateur **inchangée au bit près**.

**Restant** : exécution de l'installeur NSIS, raccourcis, entrée de désinstallation, **mise à niveau**, **désinstallation avec conservation des données**, activation et HWID sur poste vierge.

**Pourquoi pas ici** : ce poste héberge une installation réelle et **411 fichiers / 285 Mo** de données. La procédure officielle du projet refuse de s'y exécuter, et l'`appId` partagé rendrait votre installation non désinstallable.

**Action.** Sur une machine virtuelle Windows propre :

```powershell
Get-FileHash .\GarageFlows-Setup.exe -Algorithm SHA256   # verifier avant d'executer
$env:GITHUB_ACTIONS = "true"
$env:RUNNER_OS = "Windows"
$env:GF_WINDOWS_SMOKE_ISOLATED = "1"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-windows-setup.ps1
```

Ajouter, avec une licence de test : activation, HWID, création d'un client et d'une facture, export PDF, paramètres, comportement hors ligne.

**Preuve attendue.** Le JSON de résultat avec `success: true`.

---

### 5. Compléter les notices du paquet Windows — six composants

**Mesuré.** Distribués dans l'installateur sans section de notice :

| Composant | Licence | Taille |
|---|---|---:|
| `typescript@5.9.3` | Apache-2.0 | 8 904 Ko |
| `source-map@0.6.1` | BSD-3-Clause | 129 Ko |
| `source-map-support@0.5.21` | MIT | 24 Ko |
| `buffer-from@1.1.2` | MIT | 5 Ko |
| `@img/sharp-win32-x64@0.35.5` | Apache-2.0 | — |
| `@next/swc-win32-x64-msvc@15.5.28` | MIT | — |

**Action.** Publier des notices **par plateforme** et les embarquer (`build.files` / `extraResources`), puis reconstruire. Accessoirement, les 8,9 Mo de TypeScript n'ont aucun usage à l'exécution : les exclure de la sortie tracée allégerait l'installateur d'autant.

**Preuve attendue.** `scripts/reconcile-windows-artifact-sbom.mjs` avec « empaquetés SANS notice disponible : 0 ».

---

### 6. Relecture juridique de la notice `client-only@0.0.1`

**Mesuré.** Le paquet déclare `"license": "MIT"` sans publier ni fichier de licence, ni dépôt amont, ni ligne de copyright. La notice reproduit le **texte de référence SPDX**, en indiquant explicitement qu'aucun titulaire n'est affirmé.

**Action.** Valider ce choix. Faire relire dans le même mouvement les obligations **LGPL** (`@img/sharp-libvips-*`) et les éventuels contenus **CC-BY**.

---

## P2 — exploitation

### 7. Supprimer les cinq bases de contrôle sur Neon Preview

**Mesuré** en fin de mission :

```sql
DROP DATABASE "gf_gate_check_4932ccf019deb8b9";   -- porte PostgreSQL
DROP DATABASE "gf_gate_check_789d376ab66ea6d5";   -- porte PostgreSQL, 2e execution
DROP DATABASE "gf_numbering_f071193b";            -- suite de concurrence
DROP DATABASE "gf_it_mvkcjkmv_tat3";              -- suite d'integration
DROP DATABASE "gf_sess_mvkcjkq9_uz9t";            -- sessions licenciees
```

Elles ne contiennent que des données de contrôle. **Aucune n'est la base applicative de Preview (`neondb`)**, qui n'a pas été modifiée au-delà de ses migrations.

**Non fait ici** : un `DROP DATABASE` sur une instance partagée sort du mandat sans autorisation explicite, et le projet a précisément durci cette porte pour interdire toute suppression automatique.

Les bases équivalentes du PostgreSQL local ont disparu avec leurs conteneurs, déjà supprimés.

---

### 8. Connecter le projet Vercel au dépôt GitHub — si vous voulez le déploiement automatique

**Mesuré.** Toutes les variables `VERCEL_GIT_*` sont vides et `vercel project inspect` ne montre aucune section Git. **Un push sur `main` ne déclenche donc aucun déploiement.**

**Action, si souhaité.** `vercel git connect`, ou Settings → Git dans l'interface, puis désigner `main` comme branche de production.

**Non fait** : c'est une modification de configuration de votre projet, et elle changerait le comportement de tous les futurs push.

---

### 9. Décider des trois arbitrages métier

| Sujet | Proposition prête |
|---|---|
| **archivage clients et véhicules** | migration **additive** `archivedAt` + filtrage des lectures + protections — détail dans `MASTER6_FUNCTIONAL_AUDIT.md §2` |
| **auteur des mouvements de stock** | `actorUserId` et `actorRole` sur `StockMovement`, renseignés depuis la session dans les six routes concernées |
| **copilote IA** | assumer le mode local et retirer `GARAGEFLOW_LLM` / `ANTHROPIC_API_KEY` de la documentation d'environnement, **ou** mettre en service le contrôle de plafond monétaire que le code attend |

Aucune migration n'a été lancée : le mandat exige une validation préalable.

---

### 10. Acheminement SMTP externe

**Déjà prouvé** contre un serveur SMTP local, **5/5** : chiffrement au repos, authentification présentée avec le secret déchiffré, message transmis, refus serveur jamais présenté comme un succès, clé modifiée bloquant l'envoi.

**Restant** : SPF, DKIM, DMARC, réputation d'expéditeur, réception dans une boîte réelle. Exige un serveur SMTP de test et une adresse destinataire autorisée. **Aucun courriel commercial ou client n'a été envoyé.**

---

### 11. Facturation électronique en bac à sable réel

**Déjà couvert par tests** : 206 assertions vertes. **Restant** : file, webhook et reprise d'erreur contre le bac à sable du fournisseur, plus une mise à jour signée de bout en bout contre une URL de distribution publique.

```
npm run release:sign -- --file release/GarageFlows-Setup.exe --version 1.1.0 --download-url <URL_HTTPS>
```

---

### 12. Dépendances obsolètes

Aucune dépendance mise à jour pendant MASTER 5 ni MASTER 6 : `package.json` et `package-lock.json` inchangés, audit de vulnérabilités vert à tous les niveaux. Le tri des dépendances directes obsolètes reste à mener par petits lots avec tests, sans `npm audit fix --force` ni montée de majeures groupées.
