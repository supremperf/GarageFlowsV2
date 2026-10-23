---
doc-numbers: journal
---

# SYNTHÈSE DE DIRECTION — MASTER 6

## Verdict : PRÊT SOUS RÉSERVE

Le logiciel est techniquement prêt. **Trois des cinq blocages de MASTER 5 sont levés.** Les cinq réserves restantes portent toutes sur la **livraison** ou attendent une **décision**, pas une correction de code.

---

## Ce qui a changé depuis MASTER 5

| | MASTER 5 | **MASTER 6** |
|---|---|---|
| tests Playwright authentifiés | **90 inexécutés** faute de licence signable | **135 réussis, 0 échec** |
| déploiement Preview Vercel | **refusé** par un contrôle d'auteur | **Ready et vérifié** |
| staging exercé par des parcours réels | **non** | **35/35 contrôles HTTP** |
| clé privée de licence | non recherchée | **recherchée, introuvable, stratégie chiffrée** |
| arbitrages métier | 3 constats en attente | **3 tranchés sur mesure, dont 1 erroné corrigé** |
| publication GitHub | **aucun remote** | **publiée sur `main`** |

## Les trois blocages levés, et comment

**1. Licence de test** — la clé publique est un ancrage de compilation, sans dérogation runtime : c'est un choix de sécurité qu'il ne fallait pas contourner. Une paire de clés de **test** a donc été générée et les ancrages modifiés dans une **copie isolée** du projet. La licence obtenue est `VERIFIED` sous l'ancrage de test et **`SIGNATURE_INVALID` sous celui de production** : elle ne peut jamais activer une installation réelle. L'activation a eu lieu pour de vrai, par le formulaire.

**2. Preview Vercel** — le refus « the commit author doesn't have permission » venait de l'absence de remote : Vercel recevait un auteur de commit sans pouvoir rattacher le dépôt. Configurer `origin` a suffi. Aucun commit réécrit, aucune identité modifiée.

**3. Staging** — le serveur de **production** du produit a été branché sur les services de staging (PostgreSQL Neon Preview 18.6, Upstash Preview) : 35/35, dont les 11 API privées qui refusent toutes en 401 sans session.

## Une erreur que j'ai commise, et réparée

Mon intégration a **cassé l'intégrité des preuves historiques** : en ré-extrayant les
dossiers de preuves pour corriger des fins de ligne, j'ai remplacé les fichiers
originaux du disque par des versions que git avait normalisées. 42 empreintes sont
tombées, et avec elles la porte `readiness:final`.

C'est réparé en totalité : **273/273 empreintes** sur les 6 manifestes. La cause est
supprimée (`.gitattributes` déclare `-text` sur les dossiers de preuves) et chaque
octet restauré est validé par l'empreinte que MASTER 5 avait elle-même enregistrée —
**aucun manifeste n'a été réécrit**. Un point positif en est sorti : les preuves sont
désormais vérifiables **depuis un clone**, ce qui n'était vrai ni avant, ni pendant.
Détail dans `MASTER6_FINAL_REPORT.md §9`.

## Un constat de MASTER 5 était faux

MASTER 5 affirmait que la quantité de stock n'était pas modifiable. **C'est inexact.** `PATCH /api/parts/:id` accepte `{ quantity, expectedQuantity }`, écrit un mouvement `ADJUST` tracé dans la même transaction, et applique une concurrence optimiste : 400 sans la quantité observée, 200 avec, **409 si elle est périmée**. Mon sondage précédent utilisait le mauvais nom de champ. Seule lacune réelle : le mouvement ne porte pas d'auteur.

## Le point le plus important de cet audit

**Le dépôt `supremperf/GarageFlowsV2` est PUBLIC, et son historique contient trois fichiers de secrets** retirés depuis mais définitivement exposés : `.env.storage.local`, `keys/licenses_db.json` (base des licences émises) et `keys/server_config.json`.

Ce n'est pas introduit par MASTER 6 — aucune branche actuelle ne les suit. Mais **toute valeur qu'ils contenaient doit être rotée**. Aucune réécriture d'historique n'a été faite : sur un dépôt public déjà cloné, cela ne retire rien et masque la trace.

## Le système de licences n'émet plus

La clé privée de l'autorité de production (`b16d2e1b…`) est **introuvable**. Elle était configurée chez Vercel le 2026-08-10 — la sauvegarde la **nomme** — et a disparu lors d'un reset. Conséquence : les licences existantes restent vérifiables, mais **aucune nouvelle licence ne peut être émise**.

Deux faits compliquent toute rotation : les jetons ne portent **aucun identifiant de clé**, et la base n'enregistre **pas** la clé signataire. Trois options sont chiffrées dans `MASTER6_ECC_KEY_REPORT.md`. **Aucune n'a été appliquée** — une rotation improvisée invaliderait les licences en circulation.

## État des validations

| Suite | Résultat |
|---|---|
| `release:gate` | **16 / 16**, code 0 |
| Vitest | **4 390 réussis, 0 échec**, 34 ignorés justifiés |
| Playwright authentifié | **135 réussis, 0 échec**, 9 ignorés (mobile-only) |
| TypeScript / ESLint | **0 / 0** |
| HTTP réels contre staging | **35 / 35** |
| 10 parcours métier | **899 assertions, 0 échec** |
| preuves historiques (6 manifestes) | **273/273**, sur disque **et** en versionné |

## Les cinq réserves

| # | Réserve | Ce qu'il faut |
|---|---|---|
| 0 | **CI rouge** : 5 faux positifs gitleaks vérifiés, en attente de triage formel — *conséquence de ma publication*, aucun secret réel | **votre décision** |
| 1 | secrets exposés dans l'historique public | **rotation** |
| 2 | clé privée de licence introuvable | la retrouver, ou **décider** d'une rotation |
| 3 | installateur **non signé** | certificat OV ou EV |
| 4 | parcours Windows installation/désinstallation non joué | **machine jetable** |
| 5 | six composants distribués sans notice | **décision produit** |

Trois d'entre elles (0, 1 et 2) sont des décisions qui vous appartiennent et que je ne peux pas prendre à votre place.

## La publication a rendu la CI rouge

Le job *Secret scan* de GitHub Actions était vert avant mon push, il est rouge
après : les 51 commits publiés apportent cinq tests dont les fixtures **ressemblent**
à des secrets. Chacune a été examinée puis soumise à une tentative de réfutation
indépendante — **5/5 inoffensives, 0 réfutation aboutie**, aucun secret réel exposé.

Je n'ai pas remis le job au vert : l'allowlist du projet est verrouillée par
empreintes et compteurs, et l'élargir aurait voulu dire **modifier un contrôle de
sécurité pour transformer un échec en succès**. Les quatre jobs de fond — tests,
dépendances, E2E, construction native — passent sur le commit publié.

## Ce qui n'a jamais été fait

Aucun test supprimé ou affaibli. Aucun `BLOCKED` transformé en `PASS`. Aucune porte contournée. Aucune clé régénérée, aucun ancrage déplacé. Aucun `push --force`, aucun `reset --hard` destructif, aucun historique réécrit. Aucune donnée détruite : votre installation Windows, vos 285 Mo de données métier et `prisma/dev.db` sont intacts. Aucun secret publié. Aucun crédit payant consommé.
