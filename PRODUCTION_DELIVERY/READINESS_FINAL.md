---
doc-numbers: journal
---

# READINESS FINAL — MASTER 5

```
GarageFlows — contrôle final de production
Manifeste : artifacts/verification/production-readiness.json
Contrôles : 25 pass, 8 bloquant(s), 33 total
NON PRÊT POUR LA PRODUCTION
EXIT=1
```

**Aucune erreur de validation n'a été émise.** Le vérificateur a recalculé chaque empreinte de preuve, confirmé que chaque fichier déclaré est lisible et régulier, et vérifié que le marqueur de réussite de chaque contrôle `pass` figure **réellement** dans ses preuves. Le verdict négatif ne vient donc pas d'un manifeste mal formé : il vient des **8 contrôles qui restent honnêtement bloqués**.

| | MASTER 4 | MASTER 5 |
|---|---:|---:|
| `pass` | 11 | **25** |
| bloquants (`blocked` + `fail` + `not_executed`) | 22 | **8** |
| dont `fail` | 5 | **0** |
| dont `not_executed` | 3 | **0** |
| total | 33 | 33 |

Aucun contrôle n'a été retiré de `REQUIRED_CHECKS`. Aucun statut `blocked` n'a été converti en `pass`. `scripts/production-readiness.cjs` n'a pas été modifié.

---

## Les 25 contrôles PASS

### A — Dépôt
| Contrôle | Preuve déterminante |
|---|---|
| `repository.base` | dépôt dédié, branche `main`, 2 907 fichiers suivis, **0 remote** |
| `repository.clean_release` | `git diff --name-only HEAD` **vide** : aucune source suivie ne diffère du commit |

### B — Non-régression
| Contrôle | Preuve déterminante |
|---|---|
| `corrections.regressions` | release-safety **190/0/3**, audit 23/23, config 245/245, config auto 119/119 |

### C — Tests
| Contrôle | Preuve déterminante |
|---|---|
| `tests.vitest` | 365 fichiers, **0 rouge** ; 4 390 réussis, **0 échoué**, 34 ignorés inventoriés |
| `tests.node` | `# fail 0` |
| `tests.config` | 245/245 + 119/119 |
| `tests.keygen` | 39/39 Python + **19/19** sur la chaîne ECDSA P-256 |
| `tests.ocr_real` | `test_ocr_reel_tesseract … ok` — Tesseract 5.4.0 installé |
| `tests.static` | `check:consistency` OK, cohérence documentaire rejouée après baseline |
| `tests.supply_chain` | `SBOM_CHECK=PASS` sur la clôture Linux, 133 composants, tests 11/11 |

### D — Bases de données
| Contrôle | Preuve déterminante |
|---|---|
| `prisma.native_linux` | `debian-openssl-3.0.x`, 10/10 opérations réelles en conteneur |
| `prisma.native_windows` | cible `windows`, moteurs officiels sur disque, 2 clients générés |
| `database.sqlite_runtime` | 10/10 (CRUD, transaction, rollback, index emprunté, cascade) |
| `database.postgres_runtime` | 22 migrations sur base vierge + 4 suites de concurrence |
| `database.migrations_restore` | 48/48 sauvegarde/restauration + sauvegarde pré-migration **observée** |

### E — Build
| Contrôle | Preuve déterminante |
|---|---|
| `build.official` | `next build` OK, 18/18 pages, `BUILD_ID` présent |
| `build.standalone` | serveur démarré (**Ready in 399 ms**) et **requêtes HTTP réelles** |
| `build.performance` | 3,49 Mio pour un budget de 3,65 Mio, mesuré sur un vrai build |

### F — Navigateur
| Contrôle | Preuve déterminante |
|---|---|
| `playwright.chromium` | Chromium officiel v1234, **54 réussis, 0 échec** |

### G — Windows
| Contrôle | Preuve déterminante |
|---|---|
| `windows.installer` | `GarageFlows-Setup.exe` produit, vérifié, empreinte relevée |
| `windows.inspection` | 0 secret, **9 fusibles**, **540 fichiers d'intégrité** validés à l'exécution |

### H — Staging
| Contrôle | Preuve déterminante |
|---|---|
| `staging.postgres_redis` | Neon et Upstash de **Preview** réellement exercés |

### I — Sécurité
| Contrôle | Preuve déterminante |
|---|---|
| `security.audit` | audit complet sans dérogation + audit du runtime desktop |
| `security.hwid_source` | HWID V1 identique Node ↔ Python (**5/5**), 3 ancrages alignés |
| `security.artifact` | aucun secret dans l'artefact, vérification en mode dépôt ET artefact réel |

---

## Les 8 contrôles BLOCKED — prérequis exact par contrôle

| Contrôle | Prérequis manquant | Ce qui est déjà prouvé |
|---|---|---|
| `playwright.authenticated_staging` | **licence GF2 signée** (clé privée de `b16d2e1b…` introuvable) **et** Preview déployée | 17/17 parcours authentifiés en local sur 4 gabarits |
| `windows.signature` | **certificat de signature de code OV ou EV** | `Status: NotSigned` mesuré et consigné honnêtement dans le reçu de livraison |
| `windows.install_launch_persist_uninstall` | **environnement Windows jetable** (ce poste a une installation et 285 Mo de données réelles) | démarrage de l'exécutable empaqueté, intégrité ASAR, écran d'activation, arrêt propre ×2, base métier inchangée |
| `windows.upgrade_hwid_offline_restore` | même environnement **+ licence signée** | HWID V1 vérifié indépendamment, 23/23 |
| `staging.smtp_portal` | **serveur SMTP de test autorisé** + Preview servante | envoi SMTP réel de bout en bout contre un serveur local, **5/5** |
| `staging.einvoicing_update` | **accès au bac à sable fournisseur** + URL de distribution publique | 206 assertions e-invoicing, 177 installation Windows, `test:update-signing` vert |
| `security.secret_scan_worktree_history` | **clone du dépôt amont** `supremperf/GarageFlowsV2` (le scanner sort aussi en code 1 sur 6 fixtures triées) | les deux scans ont été EXÉCUTÉS ; 0 secret exploitable ; vérification indépendante sur 2 715 fichiers |
| `compliance.sbom_notices` | **décision produit** sur des notices par plateforme + relecture juridique | 0 texte manquant (les 2 de MASTER 4 résolus), `sbom:verify` PASS, réconciliation outillée et chiffrée |

---

## Pourquoi ces 8 ne peuvent pas être passés en `pass`

Chacun exige un **accès, un environnement ou une décision externe** — aucun ne demande une correction de code :

- un **certificat** à acquérir (achat + validation d'identité) ;
- une **clé privée** à retrouver dans son coffre, qu'il serait dangereux de remplacer : la clé publique `b16d2e1b…` est l'autorité que vérifient les clients déjà déployés ;
- une **machine jetable** : ce poste héberge une installation et des données d'exploitation réelles, et la procédure officielle du projet refuse de s'y exécuter — à raison ;
- un **compte SMTP de test** et un **bac à sable fournisseur** ;
- un **clone du dépôt amont** pour l'historique complet ;
- une **permission Vercel** (une adresse e-mail à rattacher) ;
- une **décision produit** sur les notices par plateforme.

Les sept premiers sont détaillés avec leur action précise et leur preuve attendue dans `ACTIONS_MANUELLES_RESTANTES.md`.

## Ce que le manifeste enregistre en plus

`artifacts/verification/production-readiness.json` porte `workingTreeDirtyAtAssembly`, qui indique si des fichiers non suivis existaient au moment de l'assemblage. C'est le cas : les journaux de preuves sont produits **pendant** la mission, donc nécessairement après le commit des sources. Les sources suivies, elles, sont identiques au commit — c'est ce que vérifie `repository.clean_release`.
