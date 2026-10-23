---
doc-numbers: journal
---

# RAPPORT FINAL — MASTER 6

# Verdict : PRÊT SOUS RÉSERVE

---

## 1. Tableau de synthèse obligatoire

| Domaine | Résultat | Preuve | Blocage restant |
|---|---|---|---|
| **Prisma** | **PASS** | moteurs officiels, 2 clients, 22 migrations sur base vierge, 50 créations parallèles | — |
| **Vitest** | **PASS** | 4 390 réussis, 0 échec, 34 ignorés inventoriés — journal 20 | — |
| **Playwright** | **PASS** | **135 réussis, 0 échec**, 9 ignorés mobile-only — journal 09 | WebKit réel (matériel Apple) |
| **TypeScript** | **PASS** | 0 erreur, `strict` intact — journal 20 | — |
| **ESLint** | **PASS** | 0 erreur — journal 20 | — |
| **Build Next.js** | **PASS** | `release:gate` 16/16, `BUILD_ID` présent — journal 16 | — |
| **Build Electron** | **PASS** | `npm run dist` code 0, 9 fusibles, 540 fichiers d'intégrité | — |
| **Setup.exe** | **PASS** (produit et vérifié) | taille, SHA-256, charge utile, 0 secret — `MASTER6_RELEASE_REPORT.md` | **non signé** |
| **Licence** | **PASS** | licence de test activée réellement, 19/19 contrefaçon, isolation prouvée | émission de production impossible |
| **Clé ECC** | **BLOCKED** | recherche exhaustive par empreinte — journal 02 | **privée introuvable** → décision de rotation |
| **Authentification** | **PASS** | 11 API privées → 401, cookie forgé → 401, CSRF, isolation 404 — journal 11 | — |
| **PostgreSQL** | **PASS** | Neon Preview 18.6, 48 tables, migrations, concurrence — journaux 11, 16 | — |
| **Redis** | **PASS** | Upstash Preview : PING, TTL, limitation, 401 — journal 11 | — |
| **SMTP** | **PASS** (local) | 5/5 contre serveur réel local | **BLOCKED** : SPF/DKIM/DMARC |
| **Sécurité** | **PASS** (périmètre publié) | 0 secret exploitable, audit dépendances vert — journal 15 | **exposition historique publique** |
| **Staging** | **PASS** | 35/35 HTTP + Preview Vercel Ready — journaux 11, 12 | — |
| **Windows réel** | **BLOCKED** | démarrage, intégrité, activation, arrêt prouvés — journal 32 (M5) | **machine jetable requise** |
| **GitHub main** | **PASS** | push réel `483aae3..277e1f2`, SHA distant vérifié, clone neuf à 273/273 | — |
| **CI GitHub Actions** | **FAIL** | run `39963071669` — 4 jobs de fond verts, scan de secrets rouge | **5 faux positifs vérifiés** en attente de triage formel |
| **Vercel** | **PASS** (Preview) | `dpl_C1FGbnHRpggCVpuL6L9XA2BHHyHi` Ready, endpoints vérifiés | **aucune liaison Git** : un push ne déploie pas |
| **Intégrité des preuves** | **PASS** (après réparation) | 273/273 sur 6 manifestes, disque et versionné — journal 23 | — |

Légende : **PASS** = exécuté et validé · **BLOCKED** = non exécuté, prérequis externe absent · **FAIL** = exécuté et échoué.

**Un FAIL, et il est le mien** : le job CI de scan de secrets était vert avant ma
publication, il est rouge après. Les 5 signalements sont des fixtures de test
vérifiées — examinées puis soumises à 5 tentatives de réfutation indépendantes,
toutes infructueuses — et **aucun secret réel n'est exposé**. Je ne les ai pas
ajoutés à l'allowlist : le faire exigeait de modifier un contrôle de sécurité pour
transformer un échec en succès. Voir `MASTER6_GITHUB_PUBLICATION.md §6.2`.

---

## 2. Ce qui a été corrigé

| Correction | Motif mesuré |
|---|---|
| **jeu de recette Playwright** | six tests nommaient leur prérequis (« effectif insuffisant (5 < 20) »). 19 mécaniciens ajoutés dans la base de recette ; **aucune assertion touchée** |
| **remote `origin` configuré** | son absence était la cause du refus de déploiement Vercel, et rendait le contrôle GF-DUR-044 inerte |
| **constat stock de MASTER 5 corrigé** | la correction d'inventaire existe : `{ quantity, expectedQuantity }` → mouvement `ADJUST` tracé, 409 si valeur périmée |
| **intégration sans perte** | 9 fichiers amont que mon instantané avait convertis CRLF→LF ont été restaurés à l'octet près, dont une preuve MASTER 4 ; bits exécutables `100755` préservés |
| **régression de preuves que j'avais causée** | mon intégration a cassé 42 empreintes et fait tomber `readiness:final` ; **réparée intégralement**, 273/273 — voir §9 |

Aucune autre modification de code n'a été faite en MASTER 6, hormis l'ajout de
`scripts/verify-evidence-manifests.mjs` (contrôle d'intégrité, §9). Les corrections
MASTER 5 (11 fichiers, 4 ajouts) sont intégrées telles quelles.

---

## 3. Ce qui a été testé

| Objet | Comment |
|---|---|
| parcours authentifiés complets | 135 tests Playwright sur 6 gabarits, avec **licence réellement activée** |
| clients, véhicules, planning, facturation, stock, paramètres, copilote | API HTTP réelles depuis une session authentique |
| autorisation et isolation | 11 API privées, cookie forgé, identifiant d'un autre tenant |
| PostgreSQL et Redis de staging | connexion, migrations, concurrence, expiration, limitation |
| serveur de production | `.next/standalone` démarré, 35 contrôles HTTP, en-têtes de sécurité |
| déploiement Vercel | Preview réel, endpoints exercés |
| cryptographie des licences | 19/19 (altération, clé étrangère, expiration, substitution d'algorithme, courbe) |
| HWID V1 | 5 vecteurs Node ↔ Python, 23 tests |
| artefact Windows | secrets, fusibles, intégrité 540 fichiers, démarrage réel |

---

## 4. Ce qui a réellement réussi

- **`release:gate` 16/16**, code 0, avec de vrais PostgreSQL et Redis.
- **Playwright authentifié 135/0/9** — le blocage de MASTER 5 est levé.
- **Preview Vercel déployé et vérifié** — le blocage de MASTER 5 est levé.
- **35/35 contrôles HTTP** contre les services de staging.
- **Installateur Windows** produit, vérifié, sans secret, 9 fusibles conformes.
- **Publication GitHub `main`** réelle, sans force, sans rien écraser.
- **Preuves historiques vérifiables** : **273/273** empreintes sur 6 manifestes, sur disque **et** dans le contenu versionné — après réparation de la régression décrite en §9.

---

## 5. Ce qui reste bloqué

| # | Blocage | Prérequis |
|---|---|---|
| B1 | clé privée de licence introuvable → **aucune émission possible** | la retrouver, ou décider d'une rotation (3 options chiffrées) |
| B2 | installateur **non signé** | certificat de signature de code OV ou EV |
| B3 | installation / mise à niveau / désinstallation Windows non jouées | machine Windows jetable |
| B4 | **secrets exposés dans l'historique du dépôt public** | rotation de ces secrets |
| B5 | six composants distribués sans notice | décision produit (notices par plateforme) |
| B6 | **CI rouge** : 5 faux positifs gitleaks en attente de triage formel | décision du propriétaire du dépôt — §9 bis |

Détail dans `MASTER6_BLOCKERS.md`, actions dans `MASTER6_MANUAL_ACTIONS.md`.

---

## 6. Réponses aux quatorze questions du mandat

1. **Ce qui a été corrigé** — §2 ci-dessus : jeu de recette, remote, constat stock erroné, intégration sans perte, et la **régression d'intégrité des preuves que j'avais moi-même causée** (§9).
2. **Ce qui a été testé** — §3.
3. **Ce qui a réussi** — §4.
4. **Ce qui reste bloqué** — §5 : **six** réserves. Cinq sont externes (un achat, une machine, deux décisions, une rotation). La sixième, la CI rouge, est la conséquence de ma publication et attend un triage formel que je me suis interdit de faire moi-même (§9 bis).
5. **Le logiciel est-il prêt pour la production ?** — **PRÊT SOUS RÉSERVE.** Le serveur web est en ligne, vérifié et sain. Le produit Desktop est construit et vérifié, mais **non signé et non testé en installation réelle**.
6. **Le Setup.exe est-il signé ?** — **NON.** `Get-AuthenticodeSignature` → `NotSigned`. Aucun certificat disponible ; aucun certificat fabriqué.
7. **Les parcours Windows ont-ils été réellement testés ?** — **PARTIELLEMENT.** Démarrage de l'exécutable empaqueté, intégrité ASAR 540 fichiers, écran d'activation, sauvegarde pré-migration, arrêt propre ×2, base métier inchangée : **oui**. Installation, raccourcis, mise à niveau, désinstallation : **non** — refusé pour protéger vos 285 Mo de données réelles.
8. **Les licences fonctionnent-elles réellement ?** — **OUI en vérification et activation** : une licence de test a été émise par le vrai keygen, activée par le formulaire, et le serveur a émis `gf_license_validated`. **NON en émission de production** : la clé privée est introuvable.
9. **Le staging fonctionne-t-il réellement ?** — **OUI.** 35/35 contrôles HTTP, PostgreSQL Neon Preview 18.6 avec 48 tables, Upstash Preview, et un déploiement Preview Vercel `Ready`.
10. **GitHub `main` a-t-il reçu les changements ?** — **OUI.** `483aae3..277e1f2`, en avance rapide, sans force, 51 commits, 754 fichiers, **0 fichier supprimé**. Le SHA distant est vérifié et un clone neuf valide 273/273 empreintes de preuves. **Mais la CI est rouge** : mon push a fait passer le scan de secrets de 0 à 5 signalements — cinq fixtures de test vérifiées, aucun secret réel. Voir `MASTER6_GITHUB_PUBLICATION.md`.
11. **Quel commit est présent sur GitHub ?** — **`277e1f2f16a0ceb333fdfffcfe1a80b159dd33b0`**, arbre `a89298c63efd354b6a07fe2ee285d27a1c9d6cd5`.
12. **Vercel a-t-il déployé ce même commit ?** — **NON, et ce n'est pas un échec** : le projet Vercel **n'est relié à aucun fournisseur Git** (toutes les `VERCEL_GIT_*` vides). Un push ne déclenche aucun déploiement. Le Preview vérifié a été créé **depuis la CLI**.
13. **Adresse de production** — **https://app.garageflows.fr**, en ligne, vérifiée, **non modifiée** par cette mission.
14. **Actions manuelles restantes** — douze, ordonnées dans `MASTER6_MANUAL_ACTIONS.md`.

---

## 7. Pourquoi pas « PRÊT POUR LA PRODUCTION »

Trois raisons, toutes vérifiables :

1. **Un installateur non signé** déclenche un avertissement SmartScreen chez chaque client. Ce n'est pas acceptable pour une distribution professionnelle.
2. **Le parcours d'installation n'a jamais été joué de bout en bout.** Le démarrage est prouvé ; l'installation, la mise à niveau et la désinstallation ne le sont pas.
3. **Le système de licences ne peut plus émettre.** Un produit sous licence qui ne peut pas délivrer de licence à un nouveau client n'est pas commercialisable en l'état.

Aucune de ces trois réserves ne relève du code. Ce sont un achat, une machine, et une décision.

---

## 8. Pourquoi pas « NON PRÊT »

Aucune erreur critique ne subsiste dans le code : 0 erreur TypeScript, 0 échec sur 4 390 tests Vitest, 0 échec sur 135 tests Playwright authentifiés, `release:gate` 16/16, et un serveur de production qui démarre et répond correctement — en refusant ce qu'il doit refuser.

---

## 9. Une régression que j'ai causée, et sa réparation

Je dois la signaler explicitement : **mon intégration a cassé l'intégrité des
preuves historiques, et fait tomber une vraie porte de validation.**

**Ce qui s'est passé.** Au début de MASTER 6, les preuves étaient saines (relevé
horodaté : MASTER 4 69/69, MASTER 5 48/48). Pour corriger des fins de ligne, j'ai
désindexé puis ré-extrait les dossiers de preuves. Cette ré-extraction a remplacé
les fichiers du disque — qui étaient les originaux — par le contenu des blobs.
Résultat : MASTER 5 à 36/48, le lot `readiness` à 2/32, et `readiness:final`
retournant **30 erreurs d'empreinte divergente**.

**La cause.** `core.autocrlf=true` normalise les fins de ligne à l'indexation. Les
preuves MASTER 5 avaient été committées sans attribut `-text`, donc normalisées en
LF — alors que ces journaux ont des fins de ligne **mixtes** : LF pour les lignes
écrites par le script, CRLF pour celles capturées d'un programme natif Windows
(`python.exe`, `powershell.exe`). Aucune conversion globale ne peut inverser cela.

**La réparation.** Trois gestes :

1. `.gitattributes` déclare `-text` sur tous les dossiers de preuves — la cause est
   supprimée pour l'avenir ;
2. réécriture des octets du dépôt là où le blob était resté intact (26 fichiers) ;
3. **reconstruction du masque exact de fins de ligne** là où le blob avait été
   normalisé (14 fichiers), par recherche bornée sur le nombre de transitions
   LF↔CRLF. Exemple : `26-hwid-licence-cles.txt` avait **une seule** ligne en
   CRLF — la sortie de `python.exe`.

**Pourquoi c'est une restauration et non un maquillage.** Chaque reconstruction est
validée par l'empreinte SHA-256 que MASTER 5 avait elle-même enregistrée. Aucun
octet n'a été écrit sans que son empreinte corresponde exactement. **Aucun manifeste
n'a été régénéré** : réécrire les empreintes aurait affiché « conforme » sans rien
restaurer. Les quatre preuves existant en double exemplaire ont deux manifestes
indépendants attestant la même empreinte — double contrôle.

**État final**, vérifiable par `node scripts/verify-evidence-manifests.mjs` :

```
✅ MASTER4_EVIDENCE                                       disque  69/69  versionné  69/69
✅ MASTER5_EVIDENCE                                       disque  48/48  versionné  48/48
✅ artifacts/verification/audit-2026-10-22                disque  26/26  versionné  26/26
✅ artifacts/verification/mission-3-2026-10-22            disque  57/57  versionné  57/57
✅ artifacts/verification/production-readiness-2026-10-22 disque  41/41  versionné  41/41
✅ artifacts/verification/production-readiness-master5    disque  32/32  versionné  32/32

✅ preuves : 273/273 sur disque, 273/273 versionnées — 6 manifestes
```

La colonne « versionné » est celle qui compte : elle atteste que **quiconque clone
le dépôt obtient des preuves vérifiables**, ce qui n'était vrai ni avant MASTER 6,
ni pendant. `readiness:final` ne signale plus aucune erreur d'intégrité ; son verdict
`NON PRÊT` provient désormais uniquement des **8 contrôles légitimement bloqués**
(signature de code, installation Windows réelle, acheminement SMTP externe).

Détail complet, masques reconstruits et mesures : `MASTER6_EVIDENCE/logs/23-integrite-preuves-reparation.txt`.

---

## 9 bis. La CI est rouge, et c'est ma publication qui l'a rendue rouge

Je le dis sans détour : **le job « Secret scan (Gitleaks) » de la CI était vert
avant mon push, il est rouge après.**

**Ce n'est pas une régression de configuration.** `.gitleaksignore` est identique
entre les deux commits (972 lignes de part et d'autre) et `.gitleaks.toml` ne
diffère que d'une ligne, qui *ajoute* une entrée d'allowlist. La cause est que les
cinq fichiers signalés n'existaient pas, ou pas sous cette forme, au commit
`483aae3` : ce sont des tests apportés par les 51 commits publiés — dont plusieurs
ont précisément pour objet de vérifier qu'un faux matériel de clé n'est pas pris
pour un vrai.

**Les cinq ont été vérifiés contradictoirement.** Chacun a été examiné, puis soumis
à une tentative de réfutation indépendante chargée de démontrer que la conclusion
« fixture inoffensive » était fausse, avec consigne de trancher en faveur du risque
en cas de doute. **5 / 5 confirmés inoffensifs, 0 réfutation aboutie.** Le plus
parlant : à `03-synchronisation.test.js:124` il n'y a **aucun littéral** — gitleaks
a capturé le texte de l'expression `aides.VALEURS_TEST.hex_32`.

**Aucun secret réel n'est exposé.**

**Et je n'ai pas remis le job au vert.** `tests/secret-scan-policy.test.cjs:35`
impose que `.gitleaksignore` soit *exactement* l'union de registres de triage
hash-verrouillés, validés un à un par `verifyFinding`, avec des compteurs assertés
en dur et un ensemble **fermé** de classifications. Ajouter ces cinq empreintes
exigerait d'étendre cet ensemble dans une bibliothèque de sécurité, d'ajouter cinq
lignes hash-verrouillées et de corriger un compteur de synthèse — c'est-à-dire
**modifier un contrôle de sécurité pour transformer un échec en succès**. Le mandat
l'interdit, et la décision vous appartient.

Les quatre jobs de fond de la CI, eux, passent sur le commit publié : compilation,
lint et suite de tests complète, audit de dépendances, tests E2E, construction
native.

Tout est prêt pour un triage en une passe : empreintes, justifications et citations
de code dans `MASTER6_EVIDENCE/logs/27-triage-gitleaks-ci.txt`, procédure dans
`MASTER6_MANUAL_ACTIONS.md`.
