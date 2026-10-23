---
doc-numbers: journal
---

# BLOCAGES RESTANTS — MASTER 6

**Trois blocages de MASTER 5 sont levés. Cinq subsistent**, chacun exigeant un accès, un environnement, un certificat ou une décision externe. **Aucun ne demande une correction de code.**

## 1. Levés en MASTER 6

| Blocage MASTER 5 | Comment il a été levé |
|---|---|
| **90 tests Playwright authentifiés** inexécutés faute de licence signable | paire de clés de **TEST** + ancrages modifiés dans une **copie isolée** → **135 réussis, 0 échec**, activation réelle |
| **Déploiement Preview Vercel** refusé (« commit author doesn't have permission ») | configuration du remote `origin` → Vercel résout le dépôt et rattache l'auteur → **Preview Ready et vérifié** |
| **Staging non exercé** par des parcours réels | **35/35** contrôles HTTP en mode production contre PostgreSQL Neon Preview et Upstash Preview |

## 2. Les cinq blocages restants

### B1 — Clé privée de licence introuvable

| | |
|---|---|
| gravité | **élevée** — le système de licences **n'émet plus** |
| mesuré | `GF_PRIVATE_KEY` absente de tous les environnements Vercel ; aucune clé correspondant à `b16d2e1b…` sur le poste ; la sauvegarde du 2026-08-10 la **nomme** mais n'en garde qu'un marqueur `[SENSITIVE]` |
| conséquence | `/api/admin/licenses/generate` inopérante ; aucune licence client ne peut être créée ni renouvelée |
| ce qui le lève | retrouver la clé dans son coffre, **ou** décider d'une rotation parmi les trois options chiffrées de `MASTER6_ECC_KEY_REPORT.md §6` |
| **décision requise de votre part** | **oui** |
| non fait délibérément | aucune paire générée, `keys:sync` jamais exécuté, aucun ancrage déplacé — une rotation improvisée invaliderait les licences en circulation |

### B2 — Installateur non signé

| | |
|---|---|
| gravité | **moyenne** — fonctionnel, mais SmartScreen avertit chaque client |
| mesuré | `Get-AuthenticodeSignature` → `NotSigned` sur l'installateur **et** sur l'exécutable ; aucun certificat sur le poste ni dans la configuration |
| ce qui le lève | certificat de signature de code **OV ou EV**, déclaré dans la cible `win` d'electron-builder, puis reconstruction |
| **décision requise** | **oui** — achat et validation d'identité |

### B3 — Parcours Windows complet non joué

| | |
|---|---|
| gravité | **moyenne** — le démarrage, l'intégrité ASAR, l'écran d'activation, la sauvegarde pré-migration et l'arrêt propre **sont** prouvés ; installation, mise à niveau et désinstallation ne le sont pas |
| mesuré | ce poste héberge une installation réelle et **411 fichiers / 285 Mo** de données réelles ; la procédure officielle du projet refuse de s'y exécuter, à raison |
| ce qui le lève | une **machine Windows jetable** + une licence de test (B1 partiellement) |
| procédure | prête, dans `MASTER6_WINDOWS_INSTALL_REPORT.md §2` |

### B4 — Exposition historique du dépôt public

| | |
|---|---|
| gravité | **élevée** — le dépôt est **PUBLIC** |
| mesuré | trois fichiers absents de toute branche actuelle mais présents dans d'anciens commits : `.env.storage.local`, **`keys/licenses_db.json`** (jwt), `keys/server_config.json` |
| conséquence | toute valeur qu'ils contenaient doit être considérée **publique à jamais** |
| ce qui le lève | **rotation** de ces secrets (voir `MASTER6_MANUAL_ACTIONS.md`) |
| non fait délibérément | aucune réécriture d'historique — ce serait masquer la fuite, ce que le mandat interdit |
| à noter | **préexistant** ; mon HEAD n'en suit aucun |

### B5 — Conformité des notices de l'artefact Windows

| | |
|---|---|
| gravité | **faible** — conformité de licence, pas vulnérabilité |
| mesuré | six composants distribués sans section de notice : `typescript` (Apache-2.0, 8,9 Mo), `source-map` (BSD-3-Clause), `source-map-support` (MIT), `buffer-from` (MIT), `@img/sharp-win32-x64` (Apache-2.0), `@next/swc-win32-x64-msvc` (MIT) |
| ce qui le lève | décision produit : publier des notices **par plateforme** et les embarquer, puis reconstruire |
| **décision requise** | **oui** — modifie le contenu distribué |

## 3. Décisions produit en attente (pas des blocages techniques)

| Sujet | Mesure | Décision |
|---|---|---|
| **archivage des clients et véhicules** | `DELETE` → 405 ; FK en `Restrict` ; aucun `archivedAt` alors que `Mechanic` en a un | appliquer la migration **additive** proposée, ou documenter l'absence comme voulue |
| **auteur des mouvements de stock** | `StockMovement` porte motif, date et quantité, **pas l'utilisateur** | ajouter `actorUserId`, ou accepter la lacune |
| **copilote IA** | moteur **local déterministe** ; aucune sortie externe même avec clé valide, par choix documenté du code | assumer le mode local, ou mettre en service le contrôle de plafond monétaire attendu |
| **liaison Git ↔ Vercel** | projet **non relié** : un push ne déploie rien | connecter le dépôt, ou garder le déploiement manuel |
| **inventaire des licences de production** | 0 sur le staging ; production non interrogée (hors périmètre autorisé) | m'autoriser une lecture seule pour chiffrer l'impact de B1 |

## 4. Ce qui n'est PAS un blocage

| Point | Pourquoi |
|---|---|
| 34 tests Vitest ignorés | 28 sont des suites de service **exécutées séparément par la porte** où elles passent ; 6 dépendent de B1 |
| 9 tests Playwright ignorés | tests **mobile uniquement**, correctement écartés sur tablette et desktop |
| 3 tests `release-safety` ignorés | bits POSIX inapplicables à NTFS |
| findings Gitleaks du contenu versionné | empreintes SHA-256, fixtures et **entrées de détecteur** — aucun secret exploitable |
| findings Gitleaks dans `dist/` | non versionné, non publié ; `check:artifact-secrets` confirme |
| `ECONNRESET` Playwright en parallèle | transport du serveur de développement ; le test rejoué seul passe 9/9 |
| Preview protégée par SSO Vercel | réglage du projet ; endpoints exercés via `vercel curl` authentifié |
