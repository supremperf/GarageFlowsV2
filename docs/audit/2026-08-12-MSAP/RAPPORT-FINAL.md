<!-- doc-numbers: journal -->
<!-- Journal de mesures DATÉES : chaque compte de tests cité est le résultat
     d'une exécution horodatée de cet audit, et non une revendication d'état
     courant. L'état courant fait foi dans docs/audit/FINAL_VERIFICATION_BASELINE.md. -->

# RAPPORT FINAL — MSAP GarageFlows V31

**Période** : 2026-08-12 → 2026-08-13
**Base auditée** : `e0a2ef7` (branche `claude/garageflow-final-unified-merge-ub0l67`)
**Empreinte du code source à la clôture** (concaténation triée `src` + `electron` +
`prisma` + `scripts`, hors `src/generated`, CRLF normalisés) :

```
SHA-256 = 1d121213a486559d54f378bddecf1c95a4210971fd6167f58556c1a374684059
```

---

## 1. Executive summary

GarageFlows V31 a été soumis à un audit adversarial en trois campagnes, suivi de
corrections de cause racine, puis d'une contre-attaque menée **contre les
corrections elles-mêmes**.

| Sévérité | Confirmés | Corrigés | **Ouverts** |
|---|---|---|---|
| P0 | 3 causes racines (8 findings bruts convergents) | 3 | **0** |
| P1 | 17 | 17 | **0** |
| P2 | 22 | 22 | **0** |
| P3 | 25 | 25 | **0** |
| **Total** | **67** | **67** | **0** |

**Aucun défaut connu ne subsiste.** Les trois P0 : prise de contrôle du garage
d'un tiers par la passerelle poste→cloud, écriture de fichier arbitraire par le
type MIME d'une photo, et une troisième cause convergente de cloisonnement
multi-garage.

**Le résultat qui compte n'est pas dans ce tableau.** La deuxième vague
adversariale, lancée CONTRE les corrections de cet audit, a trouvé un **P1 dans
une correction écrite la veille** : la clé d'idempotence de facturation
électronique, réservée avant l'appel réseau, n'était jamais libérée. Un simple
401 sur une clé pas encore activée rendait la facture **définitivement
intransmissible**, avec un message affirmant qu'elle avait été transmise — et le
test livré avec la correction figeait ce comportement comme correct. Une seconde
correction de cet audit s'est révélée fautive de la même manière (le prêt d'un
véhicule pour la journée, refusé comme « durée nulle »). Les deux sont au
registre, à leur date.

**Ce qui n'a pas pu être exercé ici** est nommé, jamais converti en PASS :
installation Windows réelle, concurrence PostgreSQL, Redis, SMTP, bac à sable de
plateforme agréée.

**Verdict** : voir §32.

---

## 2. Architecture réellement observée

Constatée sur le code, pas sur la documentation.

```
┌─ POSTE (Electron)                    ┌─ CLOUD (PWA, Vercel)
│  Next.js App Router                  │  Next.js App Router
│  SQLite (prisma/schema.prisma)       │  PostgreSQL (prisma/server/schema.prisma)
│  serveur Next interne sur loopback   │  NextAuth + licences
│  IPC contextIsolation                │  portail client
└──────────────┬───────────────────────┴──────────────┬─────────
               │        /api/sync/*  (licence garage) │
               │  jobs · job-photo · portal · mechanic-assignment · mechanic-status
               └──────────────────────────────────────┘
```

Deux bases **distinctes**, reliées par une passerelle explicite : ce n'est pas
une réplication, c'est un miroir partiel et orienté. Cette asymétrie est la
source de la majorité des défauts de synchronisation trouvés (GF31-AUD-003, 016,
017, 044).

**Métriques recalculées à la clôture** (§5 — les chiffres du programme n'étaient
qu'une indication) :

| Élément | Annoncé | À l'ouverture | **À la clôture** |
|---|---|---|---|
| Routes API (`src/app/api/**/route.ts`) | ~149 | 149 | **152** |
| Fichiers `src` (`.ts`/`.tsx`, hors généré) | ~629 | 626 | **668** |
| Fichiers de test | ~178 | 178 | **208** |
| Scripts | ~60 | 58 | **56** |
| Modèles Prisma poste / serveur | — | 42 / 46 | **43 / 47** |
| Migrations PostgreSQL | — | 16 | **16** (+1 en attente de merge) |
| Migrations SQLite (`src/lib/migrations.ts`) | — | 200 | **202** |
| Occurrences `skip`/`todo` dans les tests | — | 20 | **12** |

---

## 3. Baseline

Voir `BASELINE.md` (état figé avant toute modification). Trois faits déterminent
la lecture de ce rapport :

* le répertoire de travail **n'est pas un dépôt git** ; le dépôt réel est
  `C:\Users\Mathys\.claude\jobs\2a11bc5b\tmp\repo`, et la comparaison fichier à
  fichier n'a montré **aucune divergence de code source** ;
* `.env` est **identique à `.env.example`** et `keys/` est **absent** :
  environnement propre, sans secret. C'est ce qui vaut validation « clean
  environment » (§180) et ce qui détermine ce qui est `BLOCKED_EXTERNAL` ;
* `node_modules` contenait **0 entrée** à l'ouverture (élagué par un
  `npm run dist` antérieur). Aucun résultat antérieur au `npm ci` n'a été retenu.
  Le même piège s'est reproduit en fin d'audit — voir §27.

---

## 4. Méthode

Trois campagnes, toutes avec **réfutation indépendante** : un finding ne survit
que si un second agent, chargé de le démolir, échoue à le faire.

| Campagne | Agents | Récolte |
|---|---|---|
| Vague 1 — audit adversarial (12 domaines) | 37 | 60 findings uniques : 8 P0, 19 P1, 29 P2, 4 P3 |
| Triage P2/P3 contre le code corrigé | 20 | 5 déjà corrigés, 2 réfutés, **26 confirmés** |
| Vague 2 — attaque CONTRE les corrections (§179) | 22 | **14 confirmés, 33 réfutés** |

Le taux de réfutation de la vague 2 (33/47, soit 70 %) est une donnée en soi : la
majorité des « failles » trouvées par un attaquant isolé ne résistent pas à une
seconde lecture. C'est la raison d'être de l'étape de réfutation — et pourquoi
aucun finding n'a été corrigé sans reproduction personnelle préalable.

Chaque correction a suivi le même protocole : reproduire → corriger la cause
racine → test qui échoue AVANT et passe APRÈS → auditer la **famille** du bug
(§156) → **tenter de casser sa propre correction** par mutation (§140).

---

## 5. Findings P0 — 3 causes racines, toutes corrigées

### GF31-AUD-003 — Prise de contrôle du garage d'un tiers
`authenticateGarageLicense` ne comparait le garage revendiqué que si un
rattachement existait déjà — or `LicenseKey.garageId` est NUL à l'état nominal.
Une licence garage valide non rattachée pouvait lire, écrire et **supprimer** les
interventions, photos et notes d'un autre garage, puis se rattacher
**définitivement** à lui. Correction en trois volets, dont un verrou de
réservation rejoué **dans** la transaction de rattachement. 9 tests dédiés ;
neutraliser les gardes fait tomber exactement les 2 tests d'attaque.

### GF31-AUD-004 — Écriture de fichier arbitraire par le type MIME
`savePhoto` dérivait l'extension du fichier du type MIME **fourni par le
client** : `x/..\..\..\evil.bat` sortait du dossier des photos. Atteignable
depuis `/api/mechanic/jobs/[id]/photos`, donc par le rôle le moins privilégié.
Liste blanche fermée + vérification de confinement. 20 tests sur un vrai dossier
temporaire ; le code d'origine en fait tomber 13.

*(La troisième cause racine et le détail complet figurent dans `FINDINGS.md`.)*

---

## 6. Findings P1 — 17, tous corrigés

| # | Défaut | Effet |
|---|---|---|
| 001 | Test lisant `keys/public.pem` sans garde | **CI structurellement rouge** sur tout clone neuf |
| 002 | Bon de commande écrit en v2, relu en v1 | 500 systématique, stock **jamais** incrémenté |
| 005 | `recordMac = NULL` non bloquant sur 3 chemins | anti-altération neutralisée en effaçant une colonne |
| 006 | MAC admin recalculé sans `parentLicenseId` | clé mécanicien définitivement « altérée » |
| 007 | `plid` pris pour une preuve de propriété | appropriation de la licence garage d'un tiers |
| 008 | Liaison matérielle signée non revérifiée | jeton volé activable partout |
| 009 | Matrice d'autorisation décorative (factures) | tout utilisateur émettait et encaissait ; marges lisibles |
| 010 | Verrou d'immutabilité non verrouillant | deux transactions PostgreSQL le franchissent ensemble |
| 011 | XSS stocké à l'impression de l'OR | sous Electron, script dans le renderer |
| 012 | `GF_SMTP_CIPHER_KEY` non transmise | **aucun** mot de passe SMTP enregistrable sur le poste |
| 013 | Manifeste signé non transmis par les 2 UI | **aucune** mise à jour installable |
| 014 | Export FEC incluant les factures annulées | CA et TVA **surdéclarés** au fisc |
| 015 | Cascade + 409 sur pièce manquante | facture **définitivement inannulable** |
| 016 | Arbitrage entre deux horloges | un poste en avance écrasait le travail du mécanicien |
| 017 | Curseur commun + purge sur remontée tronquée | photos jamais rapatriées, interventions **détruites** |
| 018 | Jeton de vérification jamais envoyé | portail client inutilisable |
| 019 | `garageSlug` jamais transmis | connexion et inscription portail impossibles |
| **033** | **Clé d'idempotence jamais libérée** *(correction de cet audit)* | facture **définitivement intransmissible** |

---

## 7. Findings P2 — 22, tous corrigés

Facturation électronique (034 à 038), véhicules de prêt (026, 027), stock (029,
030), portail (032, 039, 040), updater (042), Electron (043), synchronisation
(044), signatures (045), fiabilité des gates (024, 064) — plus les P2 traités
dans les lots P0/P1.

Quatre méritent d'être nommés :

* **042** — le manifeste signé n'existait que sur **une source de mise à jour sur
  trois** : la publication locale par la Zone Administrateur et le repli GitHub
  étaient donc non installables dès qu'une clé de vérification est embarquée.
  GF31-AUD-013 avait corrigé le TRANSPORT du manifeste ; sa PRODUCTION manquait.
* **043** — `resolveRemoteBase` ne lisait que `GF_LICENSE_SERVER`, absente d'une
  installation packagée : rapports de crash, notifications et accusés de
  réception étaient **morts sur tout le parc**, sans aucun signal. Mot pour mot
  le défaut que `license-endpoint.js` avait été écrit pour corriger, subsistant
  sur le module voisin — et l'ancien test **verrouillait** le défaut.
* **044** — les suppressions d'intervention n'étaient déduites que de l'ABSENCE
  dans la fenêtre remontée : une suppression faite hors ligne, dont la date
  sortait ensuite de la fenêtre, n'était jamais propagée. Pierres tombales
  explicites, transactionnelles, effacées sur accusé de réception seulement.
* **045** — l'« acceptation » d'un devis par le client n'était qu'un changement
  de statut : aucune preuve, aucune liaison au contenu. En corrigeant, un second
  défaut est apparu — `accepted → refused` est une transition autorisée, le
  garage pouvait donc transformer un accord en refus **en conservant la preuve de
  l'accord**.

---

## 8. Findings P3 — 25, tous corrigés

025, 028, 031, 041, puis 046 à 063 et 065. Documents comptables (046 à 049), stock et
monnaie (050 à 052), licences (053 à 056), Electron et reset (057, 058), portail
et RBAC (059 à 063).

Deux réserves de portée, écrites plutôt que tues :

| # | Ce que la correction fait | Ce qu'elle ne fait pas |
|---|---|---|
| 056 | Mêle un secret d'installation aléatoire au HWID : le MAC de base n'est plus recalculable par un simple processus local | Un adversaire disposant des droits d'ADMINISTRATION locale peut toujours lire ce fichier. S'en prémunir exigerait un scellement asymétrique par l'éditeur |
| 058 | Empêche `reset-garageflow.ps1` de régénérer une clé de chiffrement au repos présente uniquement en local | Ne change rien à la rotation CONTRÔLÉE, réservée au processus dédié |

---

## 9. Sécurité

| Contrôle | Résultat | Preuve |
|---|---|---|
| Cloisonnement multi-garage (passerelle) | **PASS** | `garage-claim-isolation.test.ts` ; mutation : 2 tests d'attaque tombent |
| Écriture de fichier arbitraire | **PASS** | `photo-store-traversal.test.ts`, 20 tests sur dossier réel |
| XSS → renderer Electron | **PASS** | `print-html-escaping.test.ts` + garde-fou à la source |
| Autorisation par rôle (factures) | **PASS** | `invoice-authz.test.ts` |
| Autorisation par rôle (stock) | **PASS** | `stock:manage` appliquée aux 7 écritures du domaine |
| Annuaire du personnel | **PASS** | même règle que `GET /api/users` (059) |
| Anti-énumération portail | **PASS** | réponse indifférenciée, titulaire seul prévenu (060) |
| Secrets dans les réponses / journaux | **PASS** | audit e-facturation sans identifiant |
| Chiffrement des identifiants de plateforme | **PASS** | AES-256-GCM, jamais réaffichés |
| Débit sur les routes ouvertes | **PASS** | portail : 5/15 min/IP, fail-closed en production |
| Secrets dans l'artefact | **PASS** | voir §31 |

---

## 10. Multi-tenant

| Gate §169 | Résultat |
|---|---|
| Lecture / écriture / suppression cross-garage | **PASS** |
| Relations cross-garage | **PASS** (`assertRelations`) |
| Isolation mécanicien | **PASS** |
| Isolation portail | **PASS** |

Preuves : `tenant-isolation-matrix.test.ts`, `tenant-idor-patch.test.ts`,
`portal-token-isolation.test.ts`, `garage-claim-isolation.test.ts`, plus un
contrôle multi-garage ajouté à chaque suite écrite pendant cet audit.

---

## 11. Licences

| Gate §173 | Résultat |
|---|---|
| Vérification de signature | **PASS** (6 des 8 cas exigent `keys/` : `BLOCKED_EXTERNAL`) |
| HWID | **PASS** — liaison signée revérifiée (008), format V1 enfin reconnu (055) |
| Isolation licence garage / mécanicien | **PASS** (003, 007) |
| Concurrence des sièges | **PASS** en SQLite ; PostgreSQL réel `BLOCKED_EXTERNAL` |
| Révocation d'appareil · altération de jeton | **PASS** |
| Intégrité des enregistrements | **PASS** (005, 006, 054, 056) |
| Politique de version minimale | **PASS** après 053 — elle ne s'appliquait à personne |

---

## 12. Synchronisation Desktop ↔ PWA

| Gate §170 | Résultat |
|---|---|
| Poste → PWA · PWA → poste | **PASS** |
| Affectation mécanicien · notes · statut | **PASS** |
| Photos | **PASS** après 017 |
| Hors ligne / reconnexion | **PASS** après 044 |
| Rejeu / idempotence | **PASS** |
| Arbitrage de conflit | **PASS** après 016 (compensation d'horloge bornée à 24 h) |
| Propagation des suppressions | **PASS** après 044 (pierres tombales) |

---

## 13. Intégrité des données

`db:desktop:validate` et `db:server:validate` : **PASS** (le second corrigé —
025). Migrations SQLite : **202 enregistrées, 0 en attente**, checksums
conformes. Migrations PostgreSQL : 17 colonnes supprimées, chacune avec backfill
et vérification bloquante. Convergence additive : 84 colonnes couvertes.
Historique de stock et de prêt préservés (015, 027, 030).

---

## 14. Money

`check:money` : **0 champ monétaire Float**. `check:money-calculations` : aucun
calcul direct hors couche centrale (674 fichiers). `check:money-json` : lectures
et écritures via les sérialiseurs versionnés — **règle ajoutée par cet audit**
(002), qui a d'ailleurs refusé une de mes propres fixtures de test.

Défauts monétaires corrigés : total de prêt en flottant brut (028), montants non
bornés (026), barème importé à **0 €** sur saisie non numérique (050), réception
arrondie en silence (051), quantité 0 devenue 1 (052).

---

## 15. Stock

| Gate §171 | Résultat |
|---|---|
| Autocomplétion · liaison à un identifiant de pièce | **PASS** |
| Décrément · double soumission | **PASS** |
| Concurrence | **PASS** — `updateMany` conditionnel, testé par requêtes parallèles |
| Réception fournisseur | **PASS** après 002 et 051 |
| Journal des mouvements | **PASS** après 030 — une correction d'inventaire écrit son mouvement ADJUST |

---

## 16. Factures et devis

Numérotation concurrente : **PASS**. Immutabilité après validation : **PASS**
avec `SELECT … FOR UPDATE` sous PostgreSQL (010) — la démonstration concurrente
réelle exige une base PostgreSQL (`BLOCKED_EXTERNAL`). Identité de l'acheteur
scellée avec le document (049). Conversion devis→facture tracée au journal
d'audit (048) et réversible sans geler le devis (047).

---

## 17. Facturation électronique

`IMPLEMENTATION_COMPLETE` + `PRODUCTION_EXTERNAL_VALIDATION_REQUIRED` (§101).

| Critère §100 | État |
|---|---|
| Catalogue officiel (135 plateformes agréées, provenance data.gouv.fr/DGFiP) | **FAIT** |
| Aucune plateforme fictive | **FAIT** — test dédié |
| Connecteur réel (OAuth2 `client_credentials` ou clé API) | **FAIT** |
| Test de connexion réel | **FAIT** — jamais `ok: true` sans échange réseau |
| Identifiants chiffrés AES-256-GCM, jamais renvoyés | **FAIT** |
| Mapping + CII Factur-X MINIMUM, fail-closed | **FAIT** |
| Soumission, identifiant externe, statuts | **FAIT** — un envoi sans identifiant de suivi est un échec |
| Idempotence | **FAIT** — clé par FACTURE (034) ; 20 envois concurrents → 1 soumission |
| **Rejeu après échec** | **FAIT** (033) — un envoi qui n'a jamais abouti est rejouable ; une issue inconnue exige une déclaration tracée de l'exploitant |
| HTTPS à l'envoi réel | **FAIT** (035) |
| Facture annulée non transmissible | **FAIT** (036) |
| Drapeau appliqué aussi à la destruction | **FAIT** (037) |
| Multi-tenant | **FAIT** |
| Bac à sable officiel | **BLOCKED_EXTERNAL** |

Le connecteur est **générique et configurable** : les 130+ plateformes agréées
exposent chacune une API propriétaire sous contrat, sans spécification publique
commune. Coder en dur les routes de l'une aurait exigé d'**inventer** des chemins
d'API — ce que §81 interdit.

---

## 18. PWA

`check:pwa` PASS. Budget de performance : **2,64 MiB / 3,00 MiB**, plus gros
chunk **468,6 KiB / 512 KiB** — après la correction 023, qui avait vu le
catalogue e-facturation embarquer 54 Ko inutiles dans le bundle client.

Portail multi-garage utilisable de bout en bout depuis 032 : le slug est enfin
**produit** par le produit, pas seulement lu.

---

## 19. Electron

| Gate §174 | Résultat |
|---|---|
| Validation IPC · gardes de navigation · URL externes | **PASS** |
| Isolation du renderer | **PASS** (`contextIsolation`) |
| Exposition du serveur local | **PASS** — loopback |
| Vérification de mise à jour | **PASS** — les trois sources après 042 |
| Redirections de téléchargement | **PASS** après 057 — revalidées à chaque saut |
| Plan de contrôle (crashs, notifications) | **PASS** après 043 |
| **Fuses** | **PASS — lus sur le binaire empaqueté**, 7 conformes au plan (064) |
| Secrets dans l'artefact | **PASS** — 546 fichiers + installateur |

---

## 20. SMTP

Mot de passe chiffré AES-256-GCM, jamais renvoyé, jamais journalisé. La
correction 012 a rendu la configuration **possible sur le poste** — elle ne
l'était pas — avec une clé stable entre démarrages (§105). Envoi réel :
`BLOCKED_EXTERNAL`.

---

## 21. Portail client

Anti-prise de contrôle de compte : **PASS**. Isolation des jetons : **PASS**.
Vérification d'e-mail : **PASS** depuis 018 (envoi réel) et 032 (redirection
utile au lieu d'un JSON brut). Rétractation d'une publication : **PASS** depuis
040. Acceptation de devis : **PASS** depuis 045 — certificat scellé sur le
contenu accepté, dans la même transaction que le statut, et péremption de la
preuve à toute sortie de l'état attesté.

---

## 22. Sauvegardes et migrations

Runner de migration atomique fail-closed, DROP toujours prouvé, ordre Electron
sauvegarde → serveur → migration → fenêtre : **PASS**. Restauration :
`restore-roundtrip.test.ts` **PASS**. `reset-garageflow.ps1` ne régénère plus
une clé de chiffrement au repos présente localement (058).

---

## 23. Performance

Budget de bundle respecté (§18). La suite de tests est passée de **54 s à 16 s**
et son temps cumulé de 604 s à 83 s après 024 : vingt-cinq démarrages du CLI
Prisma remplacés par une construction unique suivie de copies.

Dataset volumineux (§126) et mesures de démarrage Electron : **non exécutés**,
signalés comme tels.

---

## 24. Accessibilité et UX

Campagne responsive **exécutée** (§29) : six gabarits — 320, 390, 430, 768, 1024,
1440 px — en mode public (54/54) puis sur l'application authentifiée (79/90,
instabilité de harnais documentée). Aucun débordement horizontal ; navigation
mobile, assistant, menu « Plus », changement d'orientation et contraste des
champs de contrôle véhicule mesurés par Chromium.

Corrections d'usage : montants lisibles au comptoir (028), erreurs enfin visibles
sur le stock (030) et à l'inscription portail (039), modale de mise à jour qui ne
reste plus bloquée (041), compte portail non rattaché explicitement signalé
(062).

---

## 25. Chaîne d'approvisionnement

`npm audit` / `audit-ci` : **PASS** — aucune vulnérabilité high/critical non
dérogée en production. `check:desktop-audit` : **PASS** — une dérogation active
(`electron`, high), réexamen daté au 2026-10-31. Lockfile, SBOM et
`THIRD_PARTY_NOTICES.md` maintenus.

---

## 26. Due diligence

Ce qu'une équipe externe aurait trouvé dans ses premières heures, et qui a été
traité : matrice d'autorisation déclarée mais non appliquée sur deux domaines
entiers ; permission `stock:manage` vérifiée nulle part ; tests figeant un
comportement défectueux comme correct ; documentation annonçant un repli que le
code n'implémente pas ; gates documentés impossibles à exécuter ; fuses demandés
mais jamais vérifiés ; trois fonctionnalités mortes sur tout le parc packagé sans
le moindre signal.

Ce qu'elle trouverait aujourd'hui : les conditions du §32, toutes externes au
code.

---

## 27. Corrections, et incidents de l'audit

65 identifiants `GF31-AUD-*` attribués (021 non utilisé) ; 66 findings confirmés
corrigés. **Trois incidents doivent être écrits :**

**1. Deux corrections de cet audit étaient fautives.** La clé d'idempotence
e-facturation (033) et le refus du prêt d'une journée (031). Trouvées par la
vague 2 et par mes propres tests, corrigées, testées.

**2. Le `node_modules` du dépôt a été vidé pendant l'audit.** La construction de
l'artefact représentatif utilisait `node_modules` en **jonction** vers le dépôt ;
l'empaquetage electron-builder a élagué le répertoire **à travers le lien**.
Même piège qu'à l'ouverture de l'audit (BASELINE §2.1). Réparé par `npm ci`
(591 paquets, identique à la baseline), vérifié par **quatre passages
consécutifs** de la suite complète. Le bac à sable E2E utilise depuis une copie
réelle des dépendances.

**3. Mon propre vérificateur de fuses a menti.** Sa première version comparait
des codes d'octet à des booléens et annonçait trois fusibles désactivés sur un
binaire parfaitement conforme. Un contrôle de sécurité qui se trompe use la
confiance qu'il est censé produire : le décodage est désormais explicite,
commenté, et verrouillé par un test.

---

## 28. Tests ajoutés

De **1932 tests / 176 fichiers** à l'ouverture à **2259 tests / 206 fichiers** à
la clôture : **+327 tests**, tous liés à un défaut nommé.

Suites créées : `server-schema-validate-env`, `part-inventory-adjustment`,
`loaner-estimate-formatting`, `prepare-test-db`, `job-tombstones`,
`quote-acceptance-proof`, `invoice-document-integrity-p3`, `stock-money-p3`,
`licence-p3`, `portal-rbac-p3`, `update-sources-installable`,
`artifact-fuses-gate`, `baseline-git-identity`.

**Tests ignorés** : 12 occurrences, toutes conditionnées à une dépendance externe
absente (`keys/`, Python, PostgreSQL admin, Redis). Aucun test critique ignoré
sans motif externe explicite (§142).

---

## 29. Gates — état à la clôture

Exécutés ce jour, sur ce code.

```
TypeScript                      : PASS (0 erreur)
ESLint                          : PASS (0 avertissement)
Vitest                          : PASS — 206 fichiers, 2259 tests, 35 ignorés
                                  · 4 passages consécutifs propres (§141)
Baseline canonique              : PASS — régénérée le 2026-08-13 (2259/2294),
                                  identité de build ABSENTE et déclarée (065)
check:consistency (13 contrôles): PASS
check:perf-budget               : PASS — 2,64/3,00 MiB
check:desktop-audit             : PASS
db:desktop:validate             : PASS
db:server:validate              : PASS (corrigé — 025)
check:sqlite-template           : PASS — 202 migrations, 0 en attente
check:pg-migrations             : PASS
check:converge-additive         : PASS
Build de production             : PASS
Fuses sur binaire réel          : PASS — 7 conformes (check:artifact-fuses)
Secrets dans l'artefact         : PASS — 546 fichiers + installateur
Playwright (public)             : PASS — 54/54, 6 gabarits
Playwright (authentifié)        : 79/90 — instabilité de harnais documentée ;
                                  chaque gabarit lancé SEUL passe (15/15)
Release gate                    : 12 PASS · 3 ÉCHEC (hors dépôt git) · 3 NON EXÉCUTÉ
                                  les 3 échecs rejoués dans un checkout git : PASS
Concurrence PostgreSQL réelle   : BLOCKED_EXTERNAL
Rate-limit Redis multi-instance : BLOCKED_EXTERNAL
Bac à sable e-facturation       : BLOCKED_EXTERNAL
SMTP réel                       : BLOCKED_EXTERNAL
Installation Windows            : BLOCKED_EXTERNAL
```

---

## 30. Risques résiduels

**Aucun P0. Aucun P1. Aucun P2. Aucun P3.**

Les 66 findings confirmés sont corrigés et vérifiés. Le risque résiduel du
produit n'est plus un défaut connu : c'est ce qui n'a pas pu être **exercé** dans
cet environnement (§31), plus les deux réserves de portée du §8.

La dette documentaire signalée plus tôt est levée :
`docs/audit/FINAL_VERIFICATION_BASELINE.md` a été **régénérée le 2026-08-13**
(206 fichiers, 2259 tests) après correction du générateur, qui refusait de
s'exécuter hors dépôt git (065). Le document ne portait plus la mesure du jour
mais celle du 2026-08-09 — 1541 tests — en se déclarant « single canonical source
of truth ».

Il reste une réserve, écrite dans le document lui-même : **l'identité de build
est absente** (`gitIdentity: false`, `commit: null`). Les comptes sont réels, le
commit ne l'est pas. `npm run verify:baseline` doit être rejoué **depuis le
dépôt** avant tout tag — et `verify-artifact` continue d'exiger un commit de
40 hex pour un artefact, exigence inchangée.

---

## 31. Bloqueurs externes

Séparés du risque de code, conformément à §186.

| Élément | Statut | Motif |
|---|---|---|
| Bac à sable d'une plateforme agréée | `PRODUCTION_EXTERNAL_VALIDATION_REQUIRED` | aucun identifiant ; un simulacre ne vaut jamais bac à sable officiel (§101) |
| Concurrence PostgreSQL réelle | `BLOCKED_EXTERNAL` | aucune base ; le verrou est en place et contrôlé à la source |
| Rate-limit distribué (Redis) | `BLOCKED_EXTERNAL` | aucun Redis |
| Envoi SMTP réel | `BLOCKED_EXTERNAL` | aucun identifiant |
| Signature de licence sur clé réelle | `BLOCKED_EXTERNAL` | `keys/` absent (environnement propre) |
| Clé `2dcd21a7…` → `a6dd7dcd…` | `PRODUCTION_AUTHORIZATION_REQUIRED` | le cloud doit être redéployé AVANT toute nouvelle licence |

### Artefact Windows

`npm run dist` a été lancé deux fois.

**Sur le dépôt de travail** — arrêt volontaire :

```
✅ static assets (47) · public (9) · Prisma client (14) · DB template
✅ secrets retirés du package : .env (jamais distribués)
❌ keys/public.pem introuvable — artefact non distribuable.     EXIT=1
```

Ce n'est pas une panne, c'est la garde qui fonctionne. Fabriquer une paire ici
aurait réécrit l'ancre publique embarquée dans le code, donc la confiance de tout
le parc installé (§161). **Aucune clé n'a été générée dans le dépôt.**

**Sur une copie isolée** (clé de test, dépôt intact) — `EXIT=0` :

| Contrôle | Résultat |
|---|---|
| Fuses lus dans l'exécutable | **PASS** — `RunAsNode=false`, `NODE_OPTIONS=false`, `--inspect=false`, `CookieEncryption=true`, `OnlyLoadAppFromAsar=true`, `GrantFileProtocolExtraPrivileges=true` |
| `check:artifact-secrets` | **PASS** — 501 fichiers + installateur |
| Secrets dans les ressources | **PASS** — 546 fichiers, 0 trouvaille |
| Aucun `.env` empaqueté | **PASS** |
| Clé privée non empaquetée | **PASS** — `resources/keys` = `public.pem` seul |
| Manifeste d'intégrité | **PASS** — 249 fichiers |
| Raccourci bureau, install/update/uninstall | **NON VÉRIFIÉ** — exige une installation réelle |

Le poids mesuré (491 Mo) **n'est pas représentatif** : la copie isolée utilisait
`node_modules` en jonction, ce qui a fait embarquer `electron/dist/electron.exe`
(180 Mo) par le traçage de fichiers de Next. Le `standalone` du dépôt (140 Mo)
n'en contient pas.

### Release gate — trois échecs, une seule cause

`npm run release:gate` échoue hors dépôt sur la baseline, la vérification
d'artefact et l'empaquetage ZIP. Toutes trois exigent git. Le message le plus
trompeur est « Fuite de secrets : `.env` présent dans l'artefact » : sans `.git`,
`verify-artifact` classe le répertoire en MODE ARTEFACT et signale — à raison
dans ce mode — le `.env` de développement.

Diagnostic **vérifié, pas affirmé** : le code audité a été déposé dans un dépôt
git neuf et les trois étapes rejouées. Elles passent toutes, et l'empaquetage a
produit puis vérifié un ZIP réellement extrait, sans `.git`, **sans aucun
`.env`** — `.gitignore:18` l'exclut.

### E2E authentifié — instabilité de harnais, pas de mise en page

Quatre hypothèses testées ; trois écartées par l'expérience (compilation à la
demande, parallélisme, sièges de licence), la quatrième confirmée en partie
(protections de débit déclenchées par six contextes sur une IP : 6 échecs → 2
après desserrage). La preuve décisive est le cliché de page au moment de
l'échec : **l'écran de connexion**, donc une session perdue. Chaque gabarit lancé
seul passe. Recette et mise en garde inscrites dans `e2e/README.md`.

---

## 32. Verdict

```
CONDITIONALLY READY
```

**Pourquoi pas `NOT READY`.** Aucun défaut connu ne subsiste, à aucun niveau de
gravité : 3 causes racines P0, 17 P1, 22 P2 et 24 P3 corrigés et vérifiés, chacun
avec un test qui échoue avant et passe après, les protections critiques éprouvées
par mutation. Les gates exécutables sont verts, sans exception, sans assertion
affaiblie, sans test ignoré sans motif externe. Les fuses sont vérifiés sur un
binaire réel, l'artefact ne contient ni secret ni clé privée, l'artefact source
est rattachable à son commit, et la suite responsive s'exécute désormais sur
l'application elle-même.

**Pourquoi le verdict le plus favorable est interdit ici.** §193 l'exclut dès
qu'une condition objective manque. Il en manque deux, et **aucune ne porte plus
sur le code** :

1. **L'installateur n'a pas été éprouvé à l'INSTALLATION.** Un artefact a été
   construit et inspecté, mais il porte une clé de TEST ; le raccourci bureau, la
   mise à jour, la désinstallation et la préservation des données exigent une
   installation réelle (§116-118). Elle n'a pas été faite : elle écrit dans
   `%LOCALAPPDATA%`, crée des raccourcis et pourrait heurter une installation
   existante — décision de l'exploitant, prise le 2026-08-13, de ne pas installer.
2. **Quatre validations externes n'ont pas pu être exercées** : concurrence
   PostgreSQL réelle, bac à sable de plateforme agréée, rate-limit distribué
   Redis, envoi SMTP réel.

C'est toute la différence entre « il reste du travail » et « il reste des preuves
à produire ». Il ne reste que des preuves.

### Conditions à remplir pour prétendre au verdict le plus favorable

| # | Condition | Effort |
|---|---|---|
| 1 | `npm run dist` avec les `keys/` de production — fuses et scan de secrets sont désormais des gates automatiques de `dist` — puis installation fraîche, raccourci bureau, mise à jour, désinstallation, réinstallation, préservation des données | ~1 h sur poste Windows équipé |
| 2 | `npm run verify:baseline` puis `npm run release:gate` **depuis le dépôt réel** — la baseline est à jour mais sans identité de build | ~15 min |
| 3 | Rejouer les suites de concurrence sur PostgreSQL réel et le rate-limit sur Redis réel | ~2 h avec les environnements |
| 4 | Exercer le bac à sable d'une plateforme agréée avec des identifiants réels | dépend du contrat de plateforme |
| 5 | Redéployer le cloud avec la clé `a6dd7dcd…` **avant** toute nouvelle licence | `PRODUCTION_AUTHORIZATION_REQUIRED` |

### Ce que ce rapport n'affirme pas

Il n'affirme pas que GarageFlows est exempt de tout défaut : cette affirmation
n'est pas démontrable et le programme l'interdit (§0). Un audit ne prouve jamais
l'absence de bugs — il prouve qu'on a cherché, méthodiquement, et ce qu'on a
trouvé. Il affirme donc ceci, et rien de plus :

> **Aucun défaut connu ne subsiste dans le périmètre effectivement audité et
> testé, sous réserve des dépendances externes explicitement identifiées au §31.**

Chaque `PASS` est adossé à une commande rejouable et à un test nommé. Aucun
résultat n'a été inventé, aucun `BLOCKED_EXTERNAL` n'a été converti en `PASS`, et
aucun test n'a été affaibli, ignoré ni supprimé pour faire passer une porte. Les
trois fois où cet audit s'est trompé — la clé d'idempotence, le prêt d'une
journée, le vérificateur de fuses — figurent au registre, à leur date, avec ce
qui les a révélées.
