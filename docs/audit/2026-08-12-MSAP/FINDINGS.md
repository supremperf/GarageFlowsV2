<!-- doc-numbers: journal -->
<!-- Journal de mesures DATÉES : chaque compte de tests cité est le résultat
     d'une exécution horodatée de cet audit, et non une revendication d'état
     courant. L'état courant fait foi dans docs/audit/FINAL_VERIFICATION_BASELINE.md. -->

# REGISTRE DES FINDINGS — GF31-AUD-*

Base de code auditée : `e0a2ef7` — voir `BASELINE.md`.

**Statuts employés** (§2) : `OPEN`, `FIXED / VERIFIED`, `MITIGATED`,
`BLOCKED_EXTERNAL`, `UNVERIFIED`. Aucun finding n'est déclaré corrigé sans un
test qui échoue AVANT et passe APRÈS.

## Tableau de bord

État au **2026-08-13**, après le triage P2/P3, la vague 2 adversariale et le
rejeu du release gate depuis le dépôt git :

| Sévérité | Confirmés (cumul) | Corrigés | **Ouverts** |
|---|---|---|---|
| P0 | 3 causes racines | 3 | **0** |
| P1 | 17 (16 vague 1 + 1 vague 2 sur une correction de cet audit) | 17 | **0** |
| P2 | 25 (22 + 3 découverts au rejeu depuis le dépôt) | 25 | **0** |
| P3 | 25 | 25 | **0** |

**Aucun finding connu ne reste ouvert.** Aucun n'a été masqué ni reclassé :
le détail, la reproduction et la preuve de chacun figurent ci-dessous.

Les findings bruts dédoublonnés issus de la vague 1 d'audit adversarial (12
auditeurs indépendants + réfutation) sont conservés hors dépôt ; ceux qui sont
promus ici l'ont été après **reproduction personnelle sur le code**.

---

## GF31-AUD-001 — La suite de tests ne peut pas passer sur un clone neuf

```
Sévérité : P1
Domaine  : intégration continue / reproductibilité
Fichier  : src/lib/license/__tests__/forgery-resistance.test.ts:89
```

**Cause racine.** L'assertion « la clé embarquée correspond à `keys/public.pem` »
lit le fichier sans garde :

```ts
const pem = readFileSync(path.join(ROOT, 'keys', 'public.pem'), 'utf8')
```

Or `keys/*.pem` est ignoré par git (`.gitignore:54`) et **aucun fichier de
`keys/` n'est suivi** (`git ls-files keys/` → vide). Les cinq tests frères du
même fichier sont pourtant correctement gardés par `it.skipIf(SANS_CLE)`, et
l'assertion JUMELLE de `src/lib/__tests__/license-public-key.test.ts:60` utilise
`it.skipIf(!existsSync(PEM))`. L'incohérence est interne au dépôt.

**Scénario d'échec.** `git clone` → `npm ci` → `npm test` →
`ENOENT: no such file or directory, open '…/keys/public.pem'`.

**Impact.** `.github/workflows/ci.yml:163` exécute `npm test` après un `npm ci`
sur un checkout neuf, et rien n'y crée `keys/`. **Le pipeline CI échoue donc à
chaque exécution**, et toutes les étapes suivantes — `npm run build` (l.172),
`check:perf-budget` (l.181), `audit-ci` (l.187),
`check-desktop-runtime-audit` (l.193), `npm audit` (l.197) — ne s'exécutent
jamais. Le garde-fou qualité du projet est inopérant.

**Correction.** Même garde que la vérification jumelle :
`it.skipIf(!existsSync(PUBLIC_PEM))`. Aucune couverture perdue : l'invariant
reste couvert par `license-public-key.test.ts:60`, par `npm run check:public-key`
et par `npm run keys:check` là où la clé existe.

**Preuve.**

| | Avant | Après |
|---|---|---|
| `npm test` (environnement propre) | `1 failed \| 170 passed \| 5 skipped` | `171 passed \| 5 skipped` |
| Tests | `1 failed \| 1897 passed` | `1897 passed \| 35 skipped` |

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-002 — Bons de commande fournisseur : 500 systématique, stock jamais réceptionné

```
Sévérité : P1
Domaine  : stock / cohérence des JSON monétaires
Fichier  : src/app/api/suppliers/route.ts:222 (avant correction)
```

**Cause racine.** La MÊME route contient deux actions incompatibles :

- `action: 'create-orders'` (l.190) — le seul écrivain de production, appelé par
  `SuppliersPanel.tsx` — persiste `serializePoLinesJsonV2(exactLines)`, soit un
  **objet** `{ "schemaVersion": 2, "lines": [{ …, "qtyTenThousandths": … }] }` ;
- `action: 'transition'` (l.221) lisait `JSON.parse(order.linesJson)` puis
  `lines.filter(...)` en supposant un **tableau** au format v1 (`l.qty`).

```ts
let lines: POLine[] = []
try { lines = JSON.parse(order.linesJson) } catch { lines = [] }
const stockLines = lines.filter(...)   // ← TypeError sur un objet
```

Le `try/catch` n'enveloppe que le `JSON.parse` : le `TypeError` du `.filter`
n'est pas rattrapé.

**Scénario d'échec (reproduit).** Créer un bon de commande depuis l'écran
« Commande automatique fournisseurs », puis le faire transiter :

```
TypeError: lines.filter is not a function
 ❯ src/app/api/suppliers/route.ts:222:28
```

→ HTTP 500 sur `draft→sent` comme sur `sent→received`, et **le stock n'est
jamais incrémenté à la réception**.

**Pourquoi la suite ne le voyait pas.** Les six cas de cycle de vie de
`src/integration/suppliers.test.ts` sont alimentés par des fixtures écrites à la
main au format v1 (`JSON.stringify([{ partId, partName, qty, unitCost }])`), que
l'écrivain de production ne produit plus. Faux vert classique.

**Correction.** Parsing strict versionné, identique à
`/api/purchase-orders/[id]/receive` : `parsePoLinesJson(...).lines` puis
`Math.round(fromScaled(l.qtyTenThousandths))`.

**Audit de la famille (§156).** Recensement de TOUS les lecteurs de
`worksJson` / `partsJson` / `linesJson` : `/api/suppliers` était le seul écart.
`check:money-json` ne surveillait que les ÉCRITURES — une **règle 3** a été
ajoutée pour interdire tout `JSON.parse` nu de ces champs. Vérifiée par mutation :
réintroduire le défaut fait échouer le garde-fou avec le message exact, le
retirer le fait passer.

**Test de non-régression.** `src/integration/suppliers.test.ts` —
« GF31-AUD-002 — cycle de vie sur une commande écrite par la production (V2) » :
parcours complet créer → envoyer → réceptionner **sans aucune fixture**, avec
vérification que `linesJson` est bien un objet `schemaVersion: 2`, puis que le
stock a réellement augmenté de la quantité commandée.

| | Avant | Après |
|---|---|---|
| `suppliers.test.ts` | `1 failed \| 10 passed` | `11 passed` |

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-003 — Prise de contrôle du garage d'un tiers via `/api/sync/*` (P0)

```
Sévérité : P0 CRITICAL
Domaine  : cloisonnement multi-tenant / passerelle poste ↔ cloud
Fichiers : src/lib/sync/garage-auth.ts:82        (cause racine)
           src/app/api/sync/jobs/route.ts:100,175
           src/app/api/sync/job-photo/route.ts:52
           src/app/api/sync/portal/route.ts:71,86
           src/app/api/sync/mechanic-assignment/route.ts:124
```

Six findings distincts remontés par **trois auditeurs indépendants** convergent
sur une seule cause racine.

**Cause racine.** Le contrôle d'identité de `authenticateGarageLicense` était
**conditionné à l'existence du rattachement** :

```ts
if (record.garageId && claimed && record.garageId !== claimed) {
  return { ok: false, code: 'GARAGE_MISMATCH' }
}
```

Si `record.garageId` est `NULL`, aucune comparaison n'a lieu et la revendication
du client est retenue telle quelle. Or `NULL` est l'état **nominal** d'une
licence garage côté cloud :

| Chemin | Pose-t-il `garageId` ? |
|---|---|
| `/api/admin/licenses/create` | non — le bloc est gardé par `isMechanic` |
| `/api/license/activate` | non — aucun champ `garageId` au `create` |
| `validateLicensedSession` | oui, mais **désactivé sous Electron** (`licenseEnforcementEnabled()`) |
| `/api/sync/mechanic-assignment` | oui — seulement après une première attribution de clé |

**Scénario d'exploitation.** L'attaquant est un client GarageFlows ordinaire :
licence GF2 valide, active, présente en base, jamais rattachée.

1. Il obtient l'identifiant du garage visé. Ce n'est pas un secret :
   `/api/license/activate` le renvoie en clair à toute activation de clé
   mécanicien (`garageId: record.garageId`) — donc tout ancien mécanicien le
   connaît — et il forme le slug miroir `gf-<garageId>`.
2. `POST /api/sync/portal` avec `garageId` = celui de la victime →
   `auth.garageId` étant nul, `trustedGarageId` retombait sur la revendication,
   et la licence de l'attaquant était **rattachée DÉFINITIVEMENT** au garage de
   la victime. À partir de là, tous les contrôles ultérieurs le servent
   légitimement.
3. `POST /api/sync/jobs` avec une fenêtre `{"from":"0001-01-01","to":"9999-12-31"}`
   et `jobs: []`. `Job.date` est une **chaîne** (`prisma/schema.prisma`), donc la
   comparaison est lexicographique : `existing` contient TOUTES les interventions
   de la victime, `sentIds` est vide, et
   `prisma.job.deleteMany({ where: { garageId, id: { in: staleIds } } })` les
   **supprime**. Par cascade Prisma, `JobPhoto`, `JobMechanicNote` et `JobPart`
   partent avec.
4. `POST /api/sync/job-photo` lit les photos du garage visé — malgré le
   commentaire du fichier qui affirmait « le garageId du filtre vient de la
   licence vérifiée ».

**Impact.** Lecture, écriture et **destruction** à distance des données d'un
autre garage dans la base cloud, sans aucune session utilisateur — la seule
condition est d'être client payant. Les photos et notes des mécaniciens
n'existent QUE côté cloud : leur perte est définitive.

**Correction (cause racine, trois volets).**

1. **Verrou de réservation** — `isGarageClaimedByAnotherLicense()` : un garage
   déjà réservé par une autre licence garage ne peut plus être revendiqué
   (`GARAGE_ALREADY_CLAIMED`, HTTP 409). Les clés MÉCANICIEN, qui partagent
   volontairement le `garageId` de leur parent, sont explicitement exclues du
   décompte.
2. **`requireBound`** sur les routes qui n'établissent JAMAIS le miroir d'un
   garage (`/api/sync/jobs`, `/api/sync/job-photo`) : une licence non rattachée
   y est refusée (`LICENSE_NOT_BOUND`, HTTP 409). Ces routes ne peuvent donc plus
   servir de première prise, y compris sur un garage qu'aucune licence ne
   réserve encore (cas d'un garage créé côté PWA).
3. **Identité effective** : après authentification, les routes utilisent
   `auth.garageId` (issu de la licence) et non plus la revendication du corps,
   renommée `claimedGarageId` pour que la distinction soit visible à la lecture.
   Le contrôle de réservation est **rejoué dans la transaction** de rattachement
   (`portal`, `mechanic-assignment`) pour fermer la course entre deux licences
   revendiquant le même garage au même instant.

**Tests de non-régression.**
`src/lib/sync/__tests__/garage-claim-isolation.test.ts` — 9 tests : refus de la
revendication d'un garage tiers, licence de l'attaquant qui reste non rattachée,
refus `requireBound`, et les cas légitimes qui doivent continuer de fonctionner
(première réservation d'un garage libre, licence déjà rattachée à son garage,
clé mécanicien non réservataire).

**Preuve par mutation (§140).** Neutraliser les deux gardes fait échouer
exactement les deux tests d'attaque (`2 failed | 7 passed`) ; les rétablir rend
les 9 verts. Les 30 tests de synchronisation préexistants passent toujours.

**Conséquence opérationnelle à connaître.** Une licence de REMPLACEMENT (renouvellement,
réinstallation) présentée sur un garage déjà réservé est désormais refusée par
construction — c'est le même geste que l'attaque, indiscernable sans autre preuve.
Le rattachement doit alors être fait côté administration. À traiter dans le
suivi (voir `WORKLOG.md`).

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-004 — Écriture de fichier arbitraire par le type MIME d'une photo (P0)

```
Sévérité : P0 CRITICAL
Domaine  : uploads / traversée de chemin
Fichier  : src/lib/photo-store.ts:35 (avant correction)
```

**Cause racine.** L'extension du fichier écrit était dérivée du type MIME
**fourni par le client** :

```ts
const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
const filename = `photo_${crypto.randomBytes(8).toString('hex')}.${ext}`
const filePath = path.join(dirPath, filename)
fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
```

`[^;]+` accepte tout sauf « ; » — y compris les séparateurs de chemin. Aucune
liste blanche, et le repli `?? 'jpg'` ne s'applique jamais aux cas hostiles.

**Scénario d'exploitation (mesuré).** Type MIME
`x/..\..\..\..\evil.bat` → extension `..\..\..\..\evil.bat` → `path.join`
normalise et le fichier **sort du dossier des photos**, avec un contenu
entièrement choisi par l'appelant (le base64 est arbitraire). Sans même
remonter, `x/exe` suffisait à déposer un exécutable dans le dossier des photos,
et `application/javascript` un script.

**Surface d'attaque.** `/api/mechanic/jobs/[id]/photos` — donc le rôle le **moins
privilégié** du produit, un mécanicien sur la PWA — ainsi que
`/api/jobs/[id]/photos`, `/api/inspections/[id]` et `/api/garages` (logo).
Le sous-dossier était lui aussi d'origine cliente (`jobs/${params.id}`).

**Correction.** Liste blanche fermée MIME → extension (`image/jpeg|jpg|png|webp|gif`),
type inconnu **refusé** sans repli ; validation du sous-dossier (segments
`[A-Za-z0-9_-]{1,64}`, profondeur ≤ 3) ; et, en défense en profondeur,
vérification que le chemin résolu reste sous `GF_PHOTOS_DIR` avant écriture.

**Tests de non-régression.** `src/lib/__tests__/photo-store-traversal.test.ts` —
20 tests sur un **vrai** dossier temporaire, qui vérifient qu'aucun fichier
n'apparaît nulle part sous la racine pour les entrées hostiles, et que les cinq
types d'image légitimes sont toujours enregistrés avec le bon contenu.

**Preuve par mutation (§140).** Avec le code d'origine : `13 failed | 7 passed`.
Avec la correction : `20 passed`.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-005 — `recordMac = NULL` neutralise la protection anti-altération (P1)

```
Sévérité : P1
Domaine  : licences / intégrité de la base
Fichiers : src/app/api/license/activate/route.ts:346
           src/app/api/license/check/route.ts:180
           src/app/api/license/status/route.ts:60
```

**Cause racine.** `verifyRecordMac` distingue trois issues : MAC valide, MAC faux
(`tampered`), MAC **absent** (`missing`). Les trois chemins GARAGE ne bloquaient
que sur `tampered` ; `missing` produisait un simple avertissement
« enregistrement sans MAC (legacy) ».

Or effacer une colonne est bien plus simple que forger un HMAC. Un attaquant
capable d'écrire dans la base — le modèle de menace même de ce dispositif,
puisque le fichier SQLite du poste s'édite avec n'importe quel navigateur de base
— met `recordMac = NULL`, puis repasse `status` de `revoked` à `active`, prolonge
`expiryAt` ou change `hwid`. **Toute la protection tombe.**

**Preuve interne au dépôt.** `src/lib/license/mechanic-session.ts:137` et le
chemin MÉCANICIEN de `activate` (l.135) appliquent déjà
`mac.tampered || mac.missing`, avec ce commentaire : « Un MAC ABSENT n'est jamais
légitime […] le traiter comme une altération empêche l'usurpation par mise à NULL
du MAC ». La règle était donc connue et écrite — appliquée à un chemin sur deux.

**Vérification que `NULL` n'est pas un état légitime.** Les quatre chemins de
création posent tous un MAC : `/api/admin/licenses/create`,
`/api/admin/licenses/generate`, `/api/admin/licenses/revoke-by-key`, et
l'auto-enregistrement de `/api/license/activate`.

**Correction.** Politique centralisée `recordIntegrityUsable()` dans
`record-mac.ts`, appliquée aux trois chemins garage. Remise en conformité d'un
parc existant : `scripts/repair-after-secret-rotation.js` (idempotent, parité avec
le module garantie par `remac-script-parity.test.ts`).

**Test.** `src/lib/__tests__/record-mac-admin-routes.test.ts` — le scénario complet
« licence révoquée → forcée à active → MAC effacé » est refusé à chaque étape.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-006 — Les routes admin fabriquaient un MAC incohérent (P1)

```
Sévérité : P1
Domaine  : licences / intégrité de la base
Fichiers : src/app/api/admin/licenses/[id]/route.ts:64
           src/app/api/admin/licenses/revoke-by-key/route.ts:147
```

**Cause racine.** `computeRecordMac` n'ajoute `parentLicenseId` et `mechanicId` au
message signé que s'ils sont non nuls (rétrocompatibilité des licences garage).
Les deux routes d'administration recalculaient le MAC **sans les transmettre**.
Pour une clé MÉCANICIEN attribuée — donc avec les deux champs renseignés — le MAC
stocké portait alors sur un message plus court que celui que `verifyRecordMac`
reconstruit à la lecture depuis la ligne complète.

**Impact.** Suspendre puis réactiver une clé mécanicien, la révoquer, ou seulement
changer son HWID depuis l'administration la rendait **définitivement « altérée »**
(`MECHANIC_LICENSE_TAMPERED`) : le mécanicien ne pouvait plus se connecter, et le
journal accusait une compromission de base qui n'avait pas eu lieu. Un helper
correct existait pourtant déjà (`mechanic-admin.ts::macFor`), utilisé par les
chemins de synchronisation.

**Correction.** Les deux routes transmettent désormais les champs mécanicien.

**Test.** Même fichier que ci-dessus : après suspension, révocation, réactivation
et changement de HWID, le MAC écrit se re-vérifie sur la ligne telle qu'elle sera
relue. **Mutation** : retirer les deux champs fait tomber 6 tests sur 7.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-009 — La matrice d'autorisation était décorative sur les factures (P1)

```
Sévérité : P1
Domaine  : autorisation / confidentialité financière
Fichiers : src/app/api/invoices/route.ts, src/app/api/invoices/[id]/route.ts
           src/app/api/quotes/route.ts, src/app/api/quotes/[id]/route.ts
           src/app/api/quotes/[id]/convert/route.ts
```

**Deux défauts distincts sur le même périmètre.**

**1. Aucun contrôle de rôle.** `src/lib/authz.ts` — fichier intitulé « matrice de
permissions centralisée, deny by default » — réserve `invoice:manage` à MANAGER et
OWNER : un RECEPTIONIST possède `quote:manage` mais **pas** `invoice:manage`.
Aucune route de facturation n'appelait `can()`. Tout utilisateur authentifié du
garage pouvait donc émettre, modifier, encaisser et supprimer des factures — et la
conversion devis→facture offrait le même pouvoir par une autre porte.

**2. Le verrou `financial:read` se contournait.** `InvoiceLine` et `QuoteLine`
portent `unitCostTenThousandths` — le prix d'achat, donc la marge. `/api/finance`,
`/api/profitability`, `/api/forecast`, `/api/export/fec` et `/api/copilot/*`
exigent tous `financial:read` ; mais `GET /api/invoices` et `GET /api/quotes`
servaient les lignes brutes, coût inclus, à tout le monde.

**Correction.**
- `can(role, 'invoice:manage')` exigé sur `POST /api/invoices`,
  `PATCH`/`DELETE /api/invoices/[id]` et `POST /api/quotes/[id]/convert` ;
- projection d'autorisation `redactLineCosts()` : le coût d'achat est **retiré**
  des lignes pour les rôles sans `financial:read`, plutôt que de refuser la route —
  un RECEPTIONIST doit pouvoir consulter les documents de son garage sans en
  connaître la marge.

**Test.** `src/integration/invoice-authz.test.ts` — base SQLite réelle, vraies
routes, les trois rôles joués successivement (7 tests).

**Changement de comportement — TRANCHÉ.** Un RECEPTIONIST ne peut plus créer,
modifier ni supprimer de facture. Question posée à l'exploitant le 2026-08-12,
réponse : *« les réceptionnistes ne facturent pas, garde la matrice telle
quelle »*. La matrice `authz.ts` reste donc inchangée et le comportement
ci-dessus est le comportement **voulu** : les routes appliquent désormais ce que
la matrice déclarait déjà. Si cette politique devait évoluer, elle s'exprime en
une ligne dans `RECEPTIONIST_PERMISSIONS` — jamais en retirant la garde des
routes.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-014 — Les factures annulées comptées comme du chiffre d'affaires (P1)

```
Sévérité : P1
Domaine  : comptabilité / export légal
Fichier  : src/app/api/export/fec/route.ts:25
```

**Cause racine.** `Invoice.status` vaut `draft | sent | paid | overdue |
cancelled`. Le filtre de l'export FEC était `status: { not: 'draft' }` : les
factures **annulées** produisaient donc des écritures de vente (compte 706) et de
TVA collectée (compte 445710).

**Impact.** Le Fichier des Écritures Comptables remis à l'administration fiscale
**surdéclarait le chiffre d'affaires et la TVA collectée**. Une facture annulée ne
constate aucun produit.

**Correction.** `status: { notIn: ['draft', 'cancelled'] }`.

**Test.** `src/integration/fec-injection-v15.test.ts` — base SQLite réelle : trois
factures (envoyée, annulée, brouillon) à 100 € HT chacune ; seule l'envoyée
apparaît, et les **montants** sont vérifiés (706 = 100,00 € et 445710 = 20,00 €,
pas le double). **Mutation** : rétablir l'ancien filtre fait tomber le test.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-007 — La clé mécanicien d'un tiers permettait de s'approprier sa licence garage (P1)

```
Sévérité : P1
Domaine  : licences / entitlement
Fichier  : src/app/api/mechanic-licenses/route.ts:162 (avant correction)
```

**Cause racine.** Le commentaire du code affirmait : « le `plid` provient d'un
jeton SIGNÉ : un autre garage ne peut donc pas s'approprier une licence ». Le
raisonnement est faux. Le `plid` signé prouve **à quelle licence garage la clé
mécanicien appartient** — il ne prouve pas que celui qui la présente a le droit
d'en disposer.

**Scénario.** Un ancien mécanicien, un destinataire d'une clé envoyée par erreur
ou le détenteur d'une clé de démonstration enregistre ce jeton dans SON garage.
Si la licence garage parente n'est pas encore rattachée — état nominal, puisque
sous Electron `validateLicensedSession` ne s'exécute jamais
(`licenseEnforcementEnabled()` est faux) — la route la rattache
**définitivement** au garage de l'appelant. Le rattachement étant immuable, le
propriétaire légitime ne peut alors plus jamais y rattacher le sien : sa licence
est confisquée.

**Correction.** Nouvel accesseur `activeGarageLicenseId()` : l'identifiant de la
licence sous laquelle l'installation tourne réellement, lu dans le claim `lid`
du cookie `gf_session` (JWT signé HS256 posé par `/api/license/activate`).
La route exige désormais que la licence parente revendiquée **soit** cette
licence — la seule preuve serveur d'entitlement disponible.

**Tests.** 3 cas ajoutés à `register-adopt-route.test.ts` : parent différent de
la licence active → refus et licence du tiers **restée libre** ; aucune licence
active → 403 ; cas légitime (parent libre + licence active correspondante) →
rattachement effectué. **Mutation** : neutraliser les deux gardes fait tomber
exactement les 2 tests d'attaque.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-011 — XSS stocké dans le document d'impression de l'ordre de réparation (P1)

```
Sévérité : P1
Domaine  : injection / Electron
Fichier  : src/components/WorkOrderModal.tsx:265 (avant correction)
```

**Cause racine.** Le document d'impression est construit par concaténation de
chaînes puis injecté par `doc.write()` dans une iframe **de même origine**
(`src/lib/pdf/print-html.ts`). Tout `<script>` qui s'y trouve s'exécute donc dans
l'origine de l'application — et sous Electron, dans le renderer, d'où part toute
la surface IPC (§27).

Étaient interpolés **sans aucun échappement** : nom, téléphone et adresse du
client, marque et modèle du véhicule, immatriculation, notes, numéro du document,
libellé de chaque ligne de main-d'œuvre, nom et référence de chaque pièce, ainsi
que l'URL de la signature **dans un attribut `src`**.

**Scénario.** Enregistrer un client nommé `<img src=x onerror=…>`, puis imprimer
l'ordre de réparation. Le garagiste déclenche lui-même l'exécution.

**Correction.** `escapeHtml()` (les cinq caractères réservés, apostrophe comprise
pour rester sûr à l'intérieur d'un attribut quoté) et `safeImageSrc()` (seules
les images inline `data:image/…;base64,…` produites par l'application sont
admises — `javascript:` est rejeté), appliqués à toutes les valeurs saisies.

**Audit de la famille (§156).** `printHtmlDocument` n'a qu'un seul appelant. Le
seul autre `dangerouslySetInnerHTML` du dépôt (`JobQRCode.tsx:54`) reçoit un SVG
produit par la bibliothèque `qrcode` à partir d'une URL, pas du texte saisi.

**Tests.** `src/lib/pdf/__tests__/print-html-escaping.test.ts` — 12 cas, dont un
garde-fou **à la source** qui échoue si une interpolation brute d'un champ
utilisateur réapparaît dans le gabarit. **Mutation** : rétablir `${clientName}`
fait tomber ce garde-fou.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-013 — Aucune mise à jour installable depuis l'application (P1)

```
Sévérité : P1
Domaine  : updater Electron
Fichiers : src/components/UpdateModal.tsx:97
           src/components/settings/UpdatesTab.tsx:98
```

**Cause racine.** `electron/main.js` (`app:install-update`) refuse toute
installation dès qu'une clé de vérification est embarquée et que le manifeste
signé Ed25519 est absent :

```js
if (updateVerify.signingConfigured()) {
  if (!manifest) return { ok: false, reason: 'Mise à jour non signée — installation refusée…' }
```

Le manifeste est bien produit par `fetchLatestUpdate()` (`main.js:290`) et
diffusé avec l'événement `app:update-available`. Mais les **deux** interfaces
d'installation — la fenêtre de mise à jour et l'onglet « Mises à jour » des
réglages — le laissaient tomber : leur type `UpdateInfo` ne le déclarait pas et
leur appel à `installUpdate({...})` ne le transmettait pas.

**Impact.** Dans la configuration **sûre** — celle où une clé est embarquée —
aucune mise à jour ne pouvait être installée depuis l'application, à chaque
tentative, avec un message accusant à tort une mise à jour non signée. Le
mécanisme de sécurité était correct ; c'est son alimentation qui manquait.

**Correction.** `manifest` déclaré dans les deux types et transmis tel quel — sa
validation reste entièrement du ressort du processus principal.

**Tests.** `src/components/__tests__/update-manifest-forwarding.test.ts` —
contrôle **à la source** des deux interfaces, plus une assertion que la garde
côté processus principal existe toujours (sa disparition serait bien plus grave
que le défaut corrigé). **Mutation** : retirer la transmission fait tomber le test.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-008 — La liaison matérielle signée n'était plus vérifiée après le premier enregistrement (P1)

```
Sévérité : P1
Domaine  : licences / liaison matérielle
Fichier  : src/app/api/license/activate/route.ts:382 (avant correction)
```

**Cause racine.** La liaison matérielle existe à deux endroits : la colonne
`hwid` de la ligne `LicenseKey`, et le claim `hwid` du jeton — ce dernier étant
**signé**, donc infalsifiable. Le chemin « première utilisation » vérifiait bien
`payload.hwid` ; le chemin « ligne déjà existante » ne regardait que
`record.hwid`.

**Pourquoi `record.hwid` peut être nul sans aucune altération de base.**
`/api/admin/licenses/revoke-by-key` crée une pierre tombale `hwid: null` pour une
licence pas encore enregistrée ; et `PATCH /api/admin/licenses/[id]` accepte
`hwid: null` explicitement. Après réactivation, la ligne ne porte plus de
liaison — alors que la signature du jeton, elle, en porte toujours une.

**Impact.** Un jeton volé, pourtant signé pour une machine précise, s'activait
sur n'importe quel poste.

**Correction.** Les deux liaisons connues doivent tenir : celle de la base **et**
celle que porte la signature du jeton.

**Tests.** 4 cas ajoutés à `license-activate.test.ts` (ligne sans liaison + jeton
signé avec liaison), dont la non-régression « licence sans liaison nulle part →
toujours activable partout ». **Mutation** : revenir à `record.hwid` seul fait
tomber 2 tests.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-012 — Aucun mot de passe SMTP enregistrable sur le poste (P1)

```
Sévérité : P1
Domaine  : configuration / chiffrement au repos
Fichier  : electron/main.js:2033 (bloc `env` du serveur interne)
```

**Cause racine.** `/api/email` refuse — correctement — d'enregistrer un mot de
passe SMTP sans `GF_SMTP_CIPHER_KEY` : « on refuse plutôt que de dégrader »,
HTTP 503. Mais l'application packagée n'embarque aucun `.env`, et le bloc `env`
transmis au serveur Next.js interne ne fournissait pas cette variable — il donne
pourtant `NEXTAUTH_SECRET`, `GF_DB_MAC_SECRET`, `GF_INTERNAL_EXPORT_KEY` et
`GF_PHOTOS_DIR`.

**Impact.** Configurer l'envoi d'e-mails était **impossible sur le poste**,
quelle que soit la manipulation : rappels, envoi de devis et de factures par
courriel inutilisables.

**Correction.** `resolveSmtpCipherKey()` réutilise le mécanisme déjà éprouvé du
secret de session : valeur d'environnement forte prioritaire, sinon une clé
propre à l'installation conservée dans `userData` (256 bits, écriture atomique,
permissions 0600, jamais journalisée). **Fichier distinct** du secret de session,
pour que roter l'un n'invalide jamais l'autre — et surtout **stable** entre
démarrages : une clé régénérée rendrait les mots de passe déjà enregistrés
définitivement indéchiffrables (§105).

**Tests.** `src/lib/__tests__/smtp-cipher-key-electron.test.ts` — 8 cas, dont la
stabilité, la séparation des deux fichiers de clé, un aller-retour
chiffrement/déchiffrement avec le **vrai** module `secret-cipher`, et un contrôle
à la source que `electron/main.js` transmet bien la variable. **Mutation** :
retirer la ligne du bloc `env` fait tomber ce dernier test.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-015 — Facture définitivement inannulable après suppression d'une pièce (P1)

```
Sévérité : P1
Domaine  : stock / intégrité comptable
Fichiers : src/lib/stock/invoice-stock.ts:158
           src/app/api/parts/[id]/route.ts:46
```

**Cause racine — deux défauts enchaînés.**

1. `StockMovement.part` est déclaré `onDelete: Cascade` dans les **deux**
   schémas : supprimer une pièce **efface tout son journal de mouvements**. La
   cause d'une variation de stock devient irreconstituable — l'inverse de ce
   qu'un journal est censé garantir (§171). `DELETE /api/parts/[id]` ne posait
   aucune condition.
2. `reconcile()` levait `InventoryError(409, 'Restitution impossible…')` dès
   qu'une pièce à restituer n'existait plus. Le commentaire immédiatement
   au-dessus annonçait pourtant : « on ne bloque pas l'annulation de la facture
   pour autant » — le code disait le contraire (§165).

**Impact.** Toute facture ayant consommé une pièce ensuite supprimée devenait
**définitivement inannulable**, sans aucun recours.

**Correction.**
- `DELETE /api/parts/[id]` refuse (409 `PART_HAS_HISTORY`) de supprimer une pièce
  qui porte des mouvements de stock, avec un message actionnable (« mettez sa
  quantité à 0 »). Une pièce jamais mouvementée — le cas courant — reste
  librement supprimable.
- `reconcile()` restitue ce qui peut l'être, ignore ce qui n'existe plus, n'écrit
  aucun mouvement pour une pièce absente (la clé étrangère le refuserait) et
  remonte la liste dans `ReconcileResult.missingParts`. Bloquer l'opération
  comptable n'aurait rendu aucune unité au stock.

**Tests.** `src/integration/part-deletion-history.test.ts` (base SQLite réelle,
cascade réelle) et `src/lib/__tests__/stock-missing-part-release.test.ts` (moteur,
cas où le journal survit à la pièce).

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-010 — Le verrou d'immutabilité n'était pas verrouillant (P1)

```
Sévérité : P1
Domaine  : concurrence / immutabilité documentaire
Fichiers : src/app/api/invoices/[id]/route.ts:81
           src/app/api/quotes/[id]/route.ts:68
```

**Cause racine.** Les deux routes re-contrôlent bien le verrou **dans** la
transaction, sous un commentaire « ANTI-TOCTOU ». Mais cette relecture est un
simple `findFirst` : elle ne verrouille rien. Sous PostgreSQL en isolation READ
COMMITTED — celle par défaut de Prisma — deux transactions concurrentes lisent
toutes deux « draft », franchissent toutes deux le verrou, puis écrivent l'une
après l'autre : la première valide le document, la seconde réécrit ses lignes
par-dessus un document déjà émis. Pour un devis, la course a lieu entre le garage
qui modifie et le client qui accepte depuis le portail.

**Correction.** `SELECT … FOR UPDATE` conditionné à `isPostgresDatabase()`, posé
**avant** la relecture — exactement le dispositif déjà utilisé par
`PATCH /api/admin/licenses/[id]` pour « sérialiser les éditions concurrentes ».

**Portée de la preuve.** `src/lib/__tests__/document-lock-row-locking.test.ts`
vérifie la présence, l'ordre et l'emplacement du verrou. La démonstration du
comportement concurrent exige une vraie base PostgreSQL : elle relève des suites
`*.postgres.int.test.ts`, `BLOCKED_EXTERNAL` dans cet environnement (BASELINE §4).

**Corollaire traité au passage.** Les réponses de `POST`/`PATCH` factures et
devis renvoyaient encore les lignes brutes, coût d'achat inclus — la projection
`redactLineCosts()` de GF31-AUD-009 n'était appliquée qu'aux `GET`. Toutes les
sorties sont désormais filtrées.

```
Statut : FIXED / VERIFIED (verrou) — concurrence PostgreSQL : BLOCKED_EXTERNAL
```

---

## GF31-AUD-016 — Arbitrage de conflit entre deux horloges différentes (P1)

```
Sévérité : P1
Domaine  : synchronisation poste ↔ cloud
Fichier  : src/lib/sync/job-fields.ts:85 (avant correction)
```

**Cause racine.** `resolveMirrorWrite` tranchait en comparant
`incoming.updatedAt` — produit par l'horloge du **poste** — à `mirrorUpdatedAt`,
produit par celle du **serveur** (`@updatedAt` Prisma). Deux référentiels
distincts.

**Impact.** Un poste dont l'horloge avance de quelques minutes (dérive NTP,
réglage manuel) gagnait **systématiquement** l'arbitrage : le statut et le
chronomètre saisis par le mécanicien étaient écrasés en silence à chaque
synchronisation. Un poste en retard subissait l'inverse et ne parvenait jamais à
réappliquer son planning.

**Correction.** Le poste annonce son heure (`clientNow`) ; le serveur ramène
l'horodatage reçu dans sa propre référence avant de trancher. La compensation est
**bornée** (`MAX_CLOCK_OFFSET_MS`, 24 h) : au-delà, l'écart ne relève plus d'une
dérive mais d'une horloge faussée, et compenser laisserait un poste décider seul
de l'issue de chaque conflit — on ne compense alors pas. Un client ancien qui
n'annonce pas son horloge conserve exactement le comportement précédent.

```
Statut : FIXED / VERIFIED
```

---

## GF31-AUD-017 — Photos jamais rapatriées, interventions détruites au-delà du plafond (P1)

```
Sévérité : P1
Domaine  : synchronisation poste ↔ cloud
Fichiers : src/lib/sync/job-sync.ts:71 (curseur)
           src/lib/sync/job-sync.ts:96 + src/app/api/sync/jobs/route.ts (purge)
```

**Défaut n°1 — un curseur commun à deux flux.** `returnCursor()` retenait le
**plus récent** des deux horodatages (dernier commentaire, dernière photo). Le
curseur avançait donc au rythme du flux le plus bavard : dans un garage où les
commentaires arrivent souvent et les photos rarement, il dépassait des photos
jamais rapatriées — définitivement invisibles côté poste. Correction : on retient
le **plus ancien**, le flux le plus en retard commande. Aucun surcoût réel — la
voie de retour est idempotente et déjà conçue pour rejouer (recouvrement d'une
minute).

**Défaut n°2 — une fenêtre tronquée prise pour la vérité.** Le poste n'envoie que
`SYNC_MAX_JOBS` (500) interventions (`take`), tandis que le cloud **supprime**
toute intervention de la fenêtre qu'il n'a pas reçue. Au-delà du plafond, le
surplus était détruit à chaque remontée — et jamais recréé, `orderBy: date asc`
renvoyant toujours la même tranche. Correction : le poste annonce
`truncated: true` lorsqu'il atteint le plafond, et le serveur suspend alors la
purge en le journalisant. Un client ancien, qui n'envoie pas le drapeau,
conserve le comportement précédent.

```
Statut : FIXED / VERIFIED
```

---

## Findings confirmés restant à traiter

Triés par priorité (§189). Chacun a été confirmé par un vérificateur
indépendant chargé de le RÉFUTER ; ils seront repris un par un avec
reproduction personnelle, correction de cause racine et test.

### P0 / P1 — sécurité et intégrité

**Aucun.** Les 3 causes racines P0 et les 16 findings P1 confirmés sont corrigés
et vérifiés (voir ci-dessus). La seule réserve subsistante porte sur la
DÉMONSTRATION du comportement concurrent PostgreSQL de GF31-AUD-010, qui exige
une base réelle (`BLOCKED_EXTERNAL`, BASELINE §4) — le verrou, lui, est en place
et contrôlé.


### P2 / P3 — triage du 2026-08-13 contre le code actuel

Les 33 findings P2/P3 de la vague 1 ont été **rejugés un par un sur le code tel
qu'il est aujourd'hui**, par 10 auditeurs indépendants tenus de citer le fichier
courant, puis chaque finding jugé encore ouvert a été soumis à un sceptique
chargé de le démolir (20 agents, 0 erreur).

| Issue du triage | Nombre |
|---|---|
| Déjà corrigé par les lots P0/P1 (`FIXED`) | 5 |
| Réfuté par le sceptique | 2 |
| **Confirmé encore ouvert** | **26** (7 P2, 19 P3) |

Corrigés depuis, dans cette session : GF31-AUD-026 à 032 et 040 (voir ci-dessous).
Le reste est listé en fin de registre sous « Findings ouverts au 2026-08-13 ».

---

## Défaut fonctionnel imposé par le programme (§6, §80-103)

### GF31-AUD-020 — Facturation électronique incomplète

```
Sévérité : bloquant pour le release si la fonctionnalité est annoncée (§102)
Statut   : IMPLEMENTATION_COMPLETE + PRODUCTION_EXTERNAL_VALIDATION_REQUIRED (§101)
```

## Ce qui a été implémenté

| Critère §100 | État | Preuve |
|---|---|---|
| Catalogue officiel | **FAIT** | 135 plateformes agréées importées du registre (data.gouv.fr, ODbL, republication du registre DGFiP) ; provenance et autorité de référence affichées à l'écran ; 13 entrées au statut d'immatriculation inconnu écartées plutôt qu'inventées |
| Aucune plateforme fictive | **FAIT** | `catalog-provenance.test.ts` échoue si « Alpha Facturation », « Axion », « Azer », « Beta Invoice » ou un identifiant `example-` réapparaît |
| Connecteur réel | **FAIT** | `adapters/generic-pa.ts` — OAuth2 `client_credentials` avec cache de jeton, ou clé API ; requêtes HTTP réelles |
| Test de connexion réel | **FAIT** | `testConnection()` obtient effectivement un jeton puis appelle la plateforme ; 35 tests observent les requêtes construites (méthode, URL, en-têtes) et prouvent qu'aucun `ok: true` n'est rendu sans échange réseau |
| Identifiants chiffrés | **FAIT** | AES-256-GCM ; jamais renvoyés, même tronqués ; laisser un champ vide conserve la valeur en base |
| Mapping + format | **FAIT** | modèle canonique en centimes entiers → CII profil Factur-X MINIMUM, fail-closed |
| Soumission | **FAIT** | `submit.ts` — validation → document → empreinte → clé d'idempotence → plateforme |
| Identifiant externe | **FAIT** | un envoi sans identifiant de suivi est un **échec**, pas un succès silencieux |
| Statuts | **FAIT** | correspondance vers statut canonique ; toute valeur non reconnue devient `unknown`, **jamais** `accepted` ; le statut brut est conservé |
| Erreurs et rejets | **FAIT** | un rejet 4xx (`PROVIDER_REJECTED`, document fautif) est distingué d'une panne 5xx (`PROVIDER_UNAVAILABLE`, rejouable) ; messages actionnables sans pile d'appels |
| Idempotence | **FAIT** | clé déterministe (garage + facture + empreinte du document), **réservée AVANT l'appel réseau** ; test : 20 envois concurrents → 1 seule soumission |
| Multi-tenant | **FAIT** | `garageId` toujours issu de la session ; la clé d'idempotence est cloisonnée par garage |
| Rôles | **FAIT** | connexion réservée à `settings:manage`, émission à `invoice:manage`, lecture des transmissions à `financial:read` |
| Variables d'environnement | **VÉRIFIÉ** | les 10 variables `EINVOICING_*` / `GF_EINVOICE_*` sont déclarées au manifeste avec `autoGenerate:false` et `autoManage:false` — un reset ne peut ni activer la fonctionnalité ni roter la clé de chiffrement (§103, §105) |
| Cohérence Desktop/PWA | **FAIT** | les 4 modèles sont cloud-only (dérogation documentée) ; les routes répondent `501 SERVER_ONLY` sur une installation poste au lieu d'un 500 opaque |

## Ce qui reste hors de portée, et pourquoi

Le connecteur est **générique et configurable** : l'URL de l'API, les chemins et
le mode d'authentification sont saisis par le garage depuis son contrat de
plateforme agréée. Ce choix est délibéré et a été validé par l'exploitant le
2026-08-12.

Les plus de 130 plateformes agréées exposent chacune une API propriétaire, sous
contrat commercial, sans spécification publique commune. Coder en dur les routes
de l'une d'elles aurait exigé d'**inventer** des chemins d'API — précisément ce
que §81 interdit et ce que cet audit existe pour éliminer. Ce qui varie d'une
plateforme à l'autre est donc traité comme de la configuration explicite ; tout
le reste — authentification, envoi, idempotence, statuts, rejets — est
réellement implémenté.

**Sources officielles consultées** (§81) :

| Élément | Vérifié | Source |
|---|---|---|
| Registre des plateformes agréées | oui | impots.gouv.fr (autorité) via le jeu de données ODbL data.gouv.fr |
| Points de jeton OAuth2 PISTE (bac à sable et production) | oui | documentation Chorus Pro / AIFE |
| URL de base des API PISTE, en-têtes requis | oui | idem |
| Noms officiels des services (`soumettreFacture`, `consulterHistoriqueFacture`, `consulterCR`) | oui | spécification externe AIFE V5.00 (annexe services API) |
| Préfixe d'URL mappant ces services sur des routes HTTP | **non** | portail développeur PISTE, derrière authentification — **non inventé**, traité en configuration |

## Statut au sens du programme

`IMPLEMENTATION_COMPLETE` — la chaîne sous contrôle de GarageFlows est entière.

`PRODUCTION_EXTERNAL_VALIDATION_REQUIRED` — aucun bac à sable de plateforme
agréée réelle n'a été exercé : cet environnement ne dispose d'aucun identifiant
(BASELINE §1.2). Conformément à §101, ce n'est **pas** `OFFICIAL_SANDBOX_VERIFIED` :
un simulacre ne vaut jamais bac à sable officiel.

## État initialement constaté (conservé pour mémoire)

État constaté sur le code (et non sur la documentation) :

| Élément | Constat |
|---|---|
| `src/lib/einvoicing/adapter.ts:130` | `einvoiceAdapterRegistry` — registre global **vide** |
| `src/lib/einvoicing/catalog.ts:92` | catalogue = 4 entrées de démonstration **fictives** (`Alpha Facturation`, `Axion`, `Azer`, `Beta Invoice`), toutes `coming_soon` |
| `src/lib/einvoicing/flags.ts` | tous les drapeaux à `false` par défaut, environnement verrouillé sur `sandbox` |
| `src/app/api/einvoicing/status/route.ts:42` | seule route existante — lecture seule, `connection: null` |
| Routes de connexion / test / envoi / statut | **inexistantes** |
| `src/components/settings/EInvoicingTab.tsx:170` | « Connexion indisponible pour l'instant (connecteur en préparation) » |
| Modèles Prisma serveur | `GarageEInvoiceConnection`, `EInvoiceTransmission`, `EInvoiceEvent`, `EInvoiceAuditEvent` — présents et inutilisés |

Ce qui est en revanche **réel et de bonne facture** : le modèle canonique en
centimes entiers (`document-model.ts`), le sérialiseur CII profil Factur-X
MINIMUM fail-closed (`cii-xml.ts`), la validation de profil (`validate.ts`) et le
chiffrement AES-256-GCM des identifiants avec version de clé
(`credentials-cipher.ts`).

Le travail restant porte donc sur la **chaîne d'exécution**, pas sur les
fondations. Sources officielles retenues à ce stade (§81) :

- registre des **Plateformes Agréées** (ex-PDP) publié par la DGFiP sur
  `impots.gouv.fr` — le sigle PDP a été remplacé par « PA » en juillet 2025 ;
  ~138 plateformes immatriculées au 14 juin 2026 ;
- **Chorus Pro / PISTE** (AIFE) comme connecteur réel : OAuth2
  `client_credentials`, jeton sur
  `https://sandbox-oauth.piste.gouv.fr/api/oauth/token` (production :
  `https://oauth.piste.gouv.fr/api/oauth/token`), API sur
  `https://sandbox-api.piste.gouv.fr` / `https://api.piste.gouv.fr`, en-têtes
  `Authorization: Bearer …` et `cpro-account: base64(login:motdepasse)`.
  Documentation et bac à sable publics — donc vérifiables sans accord commercial.

---

# Session du 2026-08-13 — findings GF31-AUD-024 et suivants

Deux sources : le **triage P2/P3** de la vague 1 contre le code actuel, et la
**vague 2 adversariale** (§179 PASS 2) — 11 attaquants lancés CONTRE les
corrections des lots 1 à 9, chaque finding soumis ensuite à un sceptique
indépendant chargé de le réfuter (22 agents, 0 erreur). Récolte : 14 findings
confirmés, 33 réfutés.

Un fait mérite d'être écrit noir sur blanc : **le finding le plus grave de cette
session porte sur une correction du lot 8, écrite par cet audit**
(GF31-AUD-033). C'est exactement ce que §179 existe pour trouver.

---

## GF31-AUD-025 — `db:server:validate` échouait sur tout poste propre

```
Sévérité : P3
Domaine  : reproductibilité / cohérence documentaire
Fichiers : package.json, .env.example, scripts/validate-server-schema.mjs
Statut   : FIXED / VERIFIED
```

`prisma/server/schema.prisma` déclare `directUrl = env("DIRECT_URL")`. Prisma
exige la variable **même pour une validation purement statique** : la commande
documentée au programme (§143) répondait `P1012 Environment variable not found:
DIRECT_URL` alors qu'aucun défaut de schéma n'existait. Un gate toujours rouge
cesse d'être lu.

Et `.env.example` annonçait un repli (« sinon = DATABASE_URL ») que Prisma
n'applique nulle part : documentation contredite par le code (§165).

**Correction.** Enrobage `scripts/validate-server-schema.mjs` qui fournit une
valeur de substitution POUR LA VALIDATION SEULE, et l'annonce à l'écran. Le
repli n'est **pas** étendu à `migrate deploy` / `db push` : y substituer l'URL
poolée produirait des migrations instables — précisément ce que la séparation
`url` / `directUrl` existe pour éviter. Documentation corrigée.

Défaut trouvé **par mon propre test** au passage : `spawnSync('npx.cmd', …)`
sans shell échoue en `EINVAL` sous Windows — le script rendait 1 **sans aucune
sortie**, échec de lancement indiscernable d'un vrai défaut de schéma. Le CLI
Prisma du projet est désormais lancé par `process.execPath`.

**Tests.** `src/__tests__/server-schema-validate-env.test.ts` (7).

---

## GF31-AUD-026 — La modification d'une réservation échappait à toutes les règles de la création

```
Sévérité : P2
Domaine  : intégrité de données / concurrence
Fichier  : src/app/api/loaner-reservations/[id]/route.ts
Statut   : FIXED / VERIFIED
```

`PATCH` recopiait le corps champ par champ, sans aucune validation :

* `status` **verbatim**. Or planning, fiche véhicule, détection de chevauchement
  et refus de supprimer un véhicule filtrent tous sur `['reserved','active']` :
  un statut hors énumération (« en cours ») faisait disparaître le prêt de
  **toutes** les vues et de **tous** les garde-fous. Le véhicule physiquement
  sorti redevenait réservable, avec un 201 ;
* `new Date(body.startDate)` sans contrôle — période inversée acceptée, date
  illisible persistée en `Invalid Date`, alors que le POST refuse ces deux cas
  depuis GF31-AUD-022 ;
* la disponibilité (§64) n'était vérifiée qu'à la CRÉATION : déplacer une
  réservation sur une période déjà prise, ou ranimer une réservation annulée qui
  en recouvre une autre, contournait la garantie « un véhicule, un prêt à la
  fois ». Une règle métier qui ne tient que sur un chemin d'écriture sur deux
  n'en est pas une (§156).

**Correction.** Schémas Zod `CreateLoanerReservationSchema` /
`UpdateLoanerReservationSchema` ; règle de disponibilité extraite dans
`src/lib/loaner/availability.ts` et appliquée **par les deux** chemins, dans la
transaction, précédée du verrou de ligne PostgreSQL.

**Mutation (§140).** Neutraliser la validation et le contrôle de disponibilité
fait tomber exactement 10 tests.

---

## GF31-AUD-027 — Supprimer un véhicule de prêt effaçait tout son historique

```
Sévérité : P2
Domaine  : intégrité de données
Fichier  : src/app/api/loaner-vehicles/[id]/route.ts
Statut   : FIXED / VERIFIED
```

`LoanerReservation.vehicle` est en `onDelete: Cascade`. Le seul garde-fou
comptait les réservations `reserved`/`active` : il protégeait le prêt en cours,
jamais les preuves passées — kilométrages, états des lieux contradictoires,
cautions, c'est-à-dire les pièces qui tranchent un litige client. Et comme
`PATCH` écrivait `status` verbatim (GF31-AUD-026), il suffisait de sortir la
réservation vive de l'énumération pour franchir le garde-fou, puis de tout
détruire.

**Correction.** Refus dès qu'il existe UNE réservation, quel que soit son statut
(409 `VEHICLE_HAS_HISTORY`), avec renvoi vers la désactivation (`isActive`), qui
existe déjà et conserve l'historique. La chaîne d'exploitation complète est
testée de bout en bout.

---

## GF31-AUD-028 — Le total estimé d'un prêt s'affichait en flottant brut

```
Sévérité : P3
Domaine  : exactitude monétaire / affichage
Fichier  : src/components/LoanerPanel.tsx
Statut   : FIXED / VERIFIED
```

`jours × Number(dailyRate)` : 3 × 19,90 € donnait « 59.699999999999996€ » — au
comptoir, au moment où l'on annonce un prix. Passage par la couche monétaire
entière puis rendu au centime, plus un garde-fou à la source contre la
réapparition du motif.

**Tests.** `src/components/__tests__/loaner-estimate-formatting.test.ts` (7).

---

## GF31-AUD-029 — La permission `stock:manage` n'était appliquée nulle part

```
Sévérité : P2
Domaine  : autorisation
Fichiers : src/app/api/parts/*, src/app/api/purchase-orders/*, src/app/api/suppliers/route.ts
Statut   : FIXED / VERIFIED
```

`grep 'stock:manage' src/app` ne renvoyait **aucun résultat**. La permission
existait dans la matrice, réservée à MANAGER/OWNER — et n'était vérifiée par
aucune route. Un RECEPTIONIST créait des commandes fournisseur, déclenchait leur
réception (donc l'entrée en stock) et modifiait les prix de vente. C'est
GF31-AUD-009 sur le domaine voisin : la matrice restait décorative là où
personne n'avait regardé.

**Correction.** Garde `can(role, 'stock:manage')` sur les sept écritures du
domaine. La LECTURE reste ouverte — un réceptionniste doit voir le stock.

**Effet de bord traité honnêtement.** `suppliers.test.ts` construisait une
session **sans rôle** — situation qui n'existe pas en production : la fixture
porte désormais un rôle réel, et quatre tests de rôle ont été ajoutés. Aucune
assertion affaiblie.

---

## GF31-AUD-030 — Corriger un inventaire écrasait les ventes, sans laisser de trace

```
Sévérité : P2
Domaine  : stock / concurrence / auditabilité
Fichier  : src/app/api/parts/[id]/route.ts
Statut   : FIXED / VERIFIED
```

`PATCH` posait `quantity` en valeur **absolue**, par un `update` nu : ni
transaction, ni condition sur l'état lu, ni `StockMovement`.

1. **Mise à jour perdue.** L'écran envoie la valeur qu'il AFFICHE. Stock 10
   affiché, correction à 12, une facture sort 3 unités entre-temps : on attend 9,
   on obtient 12 — la vente est réintroduite en stock.
2. **Aucune traçabilité.** Le moteur de facturation écrit un mouvement pour
   chaque unité qui bouge, et `DELETE /api/parts/[id]` refuse d'effacer une pièce
   mouvementée POUR PRÉSERVER ce journal (GF31-AUD-015) — mais la correction
   manuelle ne laissait rien. L'origine d'un écart était irreconstituable, ce qui
   vide le journal de son sens.

**Correction.** La correction de quantité est conditionnée à la quantité
**observée** (`expectedQuantity`, obligatoire) : `updateMany` conditionnel dans
une transaction, 409 `STOCK_CONFLICT` si le stock a bougé, et écriture d'un
`StockMovement` ADJUST signé portant le motif. Côté écran, l'échec n'est plus
avalé — il l'était aussi pour le refus `PART_HAS_HISTORY`, rendu invisible.

**Tests.** `src/integration/part-inventory-adjustment.test.ts` (13), dont deux
corrections concurrentes réelles et un contrôle multi-garage.

---

## GF31-AUD-031 — Planning : prêt du jour même refusé, réservations englobantes invisibles

```
Sévérité : P3
Domaine  : intégrité de données / affichage
Fichier  : src/app/api/loaner-reservations/route.ts
Statut   : FIXED / VERIFIED
```

Deux défauts opposés dans la même route :

* **Correction de ma propre correction.** GF31-AUD-022 refusait « fin == début »
  comme une durée nulle. Or l'interface saisit des dates SANS heure et propose —
  en chiffrant son prix — le prêt « du 10 au 10 » : la règle interdisait le prêt
  du jour même. Seule l'inversion est désormais refusée, et `finEffective()`
  donne à une telle période la journée qu'elle occupe réellement — sans quoi
  l'intervalle serait vide et le véhicule prêtable deux fois le même jour.
* Le planning hebdomadaire filtrait « le début OU la fin tombe dans la fenêtre » :
  une réservation qui **englobe** la semaine affichée n'était jamais renvoyée. Un
  véhicule sorti trois semaines apparaissait « libre », sauf la semaine de départ
  et celle de retour. Le bon critère est le chevauchement.

---

## GF31-AUD-032 — La convention `?garage=<slug>` n'était produite nulle part

```
Sévérité : P2
Domaine  : portail client / fonctionnalité incomplète
Fichiers : src/app/api/portal/[token]/route.ts, src/app/portal/[token]/page.tsx,
           src/app/api/portal/auth/verify-email/route.ts
Statut   : FIXED / VERIFIED
```

GF31-AUD-019 avait appris aux pages à **lire** `?garage=<slug>` et à le
mémoriser. Mais aucun lien de GarageFlows ne portait ce paramètre : aucun
producteur dans tout le dépôt. Sur le déploiement PWA — multi-garage par
construction — le client n'avait donc toujours aucun moyen d'atteindre la bonne
page, sauf à taper un slug à la main. La moitié aval de la correction manquait.

**Correction.** Le slug est émis là où GarageFlows fabrique lui-même un lien
destiné au client : la page de suivi par jeton (« se connecter » / « créer un
compte »), et la vérification d'e-mail — qui **redirige** désormais vers la
connexion au lieu de répondre un JSON brut dans le navigateur du client.

---

## GF31-AUD-033 — Un envoi raté verrouillait DÉFINITIVEMENT la facture (vague 2)

```
Sévérité : P1
Domaine  : facturation électronique
Fichier  : src/lib/einvoicing/submit.ts
Statut   : FIXED / VERIFIED
```

**Défaut d'une correction de cet audit** (lot 8), trouvé par la vague 2.

La clé d'idempotence est réservée AVANT l'appel réseau — c'est ce qui protège du
cas §96. Mais réserver ne doit pas **condamner** : toute tentative ratée — 401
d'une clé pas encore activée, 404 d'un chemin mal saisi, 503 de la plateforme —
laissait la clé occupée, et chaque nouvel essai répondait « Cette facture a déjà
été transmise ». C'était **faux** : rien n'était parti. Et comme les montants
d'une facture émise sont figés, régénérer un document différent est impossible :
la facture devenait réglementairement intransmissible, sans aucun recours.

Aggravant : le test `submit-chain.test.ts` **figeait ce comportement** en le
présentant comme correct, confondant « la plateforme a accepté, la réponse s'est
perdue » et « l'appel n'est jamais arrivé ».

**Correction.** Le critère qui tranche n'est pas le statut, c'est l'**identifiant
externe** : sans lui, la plateforme ne nous a rien accusé. Trois issues sont
désormais distinguées au lieu de deux :

| Issue | Statut | Rejeu |
|---|---|---|
| la plateforme a RÉPONDU une erreur (4xx/5xx) | `rejected` / `error` | autorisé — elle n'a pas pris la facture |
| configuration inutilisable (rien n'est parti) | `error` | autorisé |
| connexion coupée SANS réponse | `unknown` | **refusé** — issue inconnue |

Un rejeu réutilise la MÊME ligne et la MÊME clé d'idempotence, transmise à la
plateforme : si celle-ci l'honore, un premier appel reçu à notre insu y est
dédoublonné. Le cas `unknown` se dénoue par une **déclaration tracée de
l'exploitant** (`declarerNonParvenue`, journal d'audit) — jamais par une
déduction du logiciel (§92, §96).

---

## GF31-AUD-034 — Renommer le client rouvrait l'envoi d'une facture déjà transmise (vague 2)

```
Sévérité : P2
Domaine  : facturation électronique / idempotence
Fichier  : src/lib/einvoicing/submit.ts
Statut   : FIXED / VERIFIED
```

La clé d'idempotence incluait l'empreinte du DOCUMENT. Modifier un champ resté
modifiable d'une facture émise — le nom du client — changeait l'empreinte, donc
la clé : la même facture repartait à la plateforme agréée. **Double
déclaration.** L'unité de déclaration réglementaire étant la facture, la clé
porte désormais sur `(garage, facture)`. L'empreinte du document reste
enregistrée à part : elle prouve CE QUI a été transmis, elle ne décide pas SI
l'on transmet.

---

## GF31-AUD-035 — « HTTPS obligatoire » n'était vérifié qu'au test de connexion (vague 2)

```
Sévérité : P2
Domaine  : facturation électronique / confidentialité
Fichier  : src/lib/einvoicing/adapters/generic-pa.ts
Statut   : FIXED / VERIFIED
```

`validateConfiguration()` refuse une URL non HTTPS, mais n'était appelée que par
« Tester la connexion ». L'envoi réel — celui qui transporte **la facture ET la
clé API** — ne la rappelait pas : une connexion enregistrée avant durcissement,
restaurée d'une sauvegarde ou modifiée en base transmettait les deux en clair.
La configuration est revalidée à chaque envoi.

---

## GF31-AUD-036 — Une facture ANNULÉE pouvait être déclarée à la plateforme (vague 2)

```
Sévérité : P2
Domaine  : facturation électronique
Fichier  : src/app/api/einvoicing/invoices/[id]/submit/route.ts
Statut   : FIXED / VERIFIED
```

Seul `draft` était bloqué. Transmettre une facture annulée déclare une créance
que le garage a précisément retirée. Refus explicite `INVOICE_CANCELLED`.

---

## GF31-AUD-037 — Le drapeau de fonctionnalité laissait passer la DESTRUCTION (vague 2)

```
Sévérité : P2
Domaine  : facturation électronique
Fichier  : src/app/api/einvoicing/connection/route.ts
Statut   : FIXED / VERIFIED
```

`connectionsEnabled` gardait le `PUT` mais pas le `DELETE` : fonctionnalité
coupée, on pouvait encore détruire les identifiants d'une plateforme — sans
pouvoir les ressaisir, puisque l'écriture était fermée. Un interrupteur qui
laisse passer la destruction n'est pas un interrupteur.

---

## GF31-AUD-038 — Un `catch` nu transformait toute panne de base en « déjà transmise » (vague 2)

```
Sévérité : P2
Domaine  : facturation électronique / faux succès
Fichier  : src/lib/einvoicing/submit.ts
Statut   : FIXED / VERIFIED
```

La réservation d'idempotence attrapait **toute** exception et concluait « déjà
transmise » — une idempotence qui n'a pas eu lieu. Seule la violation de
contrainte d'unicité est désormais traitée ; le reste remonte.

---

## GF31-AUD-039 — Un lien de vérification non envoyé s'affichait « Compte créé » (vague 2)

```
Sévérité : P2
Domaine  : portail client / faux succès
Fichier  : src/app/portal/register/page.tsx
Statut   : FIXED / VERIFIED
```

La route renvoyait honnêtement `verificationEmailSent: false` (GF31-AUD-018) —
la page jetait ce champ et affichait « Compte créé. Redirection… ». Le client
attendait indéfiniment un courriel qui n'existait pas, sans jamais voir ses
documents (le compte n'est rattaché qu'après vérification). L'écran dit
désormais ce qui s'est réellement passé.

Durcissement joint : le nom, repris dans le corps du courriel, est borné et
débarrassé de ses sauts de ligne — la route étant ouverte, elle ne doit pas
devenir un moyen de faire porter un texte arbitraire par le SMTP du garage. Le
débit était déjà borné (5 tentatives / 15 min / IP, fail-closed en production).

---

## GF31-AUD-040 — Publication portail non rétractable (triage P2)

```
Sévérité : P2
Domaine  : portail client / confidentialité
Fichier  : src/app/api/sync/portal/route.ts
Statut   : FIXED / VERIFIED
```

Chaque publication créait un instantané de plus ; les précédents restaient
servis sept jours. Un garage qui s'aperçoit qu'une photo ou une ligne de devis
n'aurait pas dû être publiée ne pouvait **pas se rétracter** : republier ne
révoquait rien, l'ancien lien continuait de servir le contenu litigieux. Une
seule publication vivante par intervention désormais, la révocation ayant lieu
dans la même transaction que la nouvelle.

---

## GF31-AUD-041 — Échec de téléchargement rendu comme un succès (vague 2)

```
Sévérité : P3
Domaine  : updater / faux succès
Fichier  : src/components/UpdateModal.tsx
Statut   : FIXED / VERIFIED
```

Le processus principal ouvre le navigateur en repli quand le téléchargement
échoue, et renvoie `{ ok: true, method: 'browser-fallback' }`. L'écran ne
regardait pas `method` : la modale restait indéfiniment sur « Téléchargement… »,
non fermable pour une mise à jour obligatoire, recouvrant l'application alors
que rien ne s'installait.

---

# Findings ouverts au 2026-08-13

Aucun P0. **Le seul P1 de la session a été corrigé le jour même**
(GF31-AUD-033). Ce qui suit reste ouvert, avec reproduction établie : c'est le
reste à faire, et il est nommé.

## P2 ouverts — TOUS CORRIGÉS DEPUIS (voir « Clôture des P2 » en fin de registre)

| # | Domaine | Défaut | Fichier |
|---|---|---|---|
| GF31-AUD-042 | updater | Le manifeste signé n'existe que sur 1 des 3 sources de `fetchLatestUpdate()` : la publication par la Zone Administrateur et le repli GitHub restent non installables dès qu'une clé de vérification est embarquée | `electron/main.js:305` |
| GF31-AUD-043 | electron | `resolveRemoteBase` ne lit que `GF_LICENSE_SERVER`, absente d'une installation packagée : rapports de crash, notifications et accusés de réception sont morts sur tout le parc, sans aucun signal | `electron/main.js:875` |
| GF31-AUD-044 | synchronisation | Une intervention supprimée hors ligne reste indéfiniment visible dans la PWA du mécanicien si sa date sort de la fenêtre — aucune pierre tombale, la file de reprise est en mémoire | `src/app/api/sync/jobs/route.ts` |
| GF31-AUD-045 | portail / signatures | L'« acceptation » d'un devis par le client n'est qu'un changement de statut : aucune preuve, aucune liaison au contenu, réversible par le garage dans les deux sens | `src/app/api/portal/quote/[token]/route.ts` |
| GF31-AUD-024 | fiabilité des gates | 24 fichiers d'intégration lancent chacun `npx prisma db push` ; sous charge le `hookTimeout` de 30 s est dépassé (mesuré ce jour), alors que le même fichier passe seul en 11,3 s. Le gate `npm test` est donc sensible à la charge de la machine (§141) | `vitest.config.ts` + suites d'intégration |

## P3 ouverts — TOUS CORRIGÉS DEPUIS (voir « Clôture des P3 » en fin de registre)

Dix-neuf findings, tous reproduits et localisés : réception d'un bon de commande
qui arrondit silencieusement la quantité ; `GET /api/garages` qui sert
l'annuaire du personnel à tout rôle authentifié ; suppression d'une facture
issue d'une conversion qui laisse le devis dans un état terminal irrécupérable ;
identité de l'acheteur d'une facture émise restée modifiable sans trace ;
conversion devis→facture sans entrée au journal d'audit ;
`reset-garageflow.ps1` qui régénère une clé de chiffrement au repos ;
redirections de téléchargement non revalidées ; `GF_MIN_ELECTRON_VERSION`
inopérante sur les clients Electron ; `POST /api/admin/licenses` qui insère sans
vérifier la signature ni poser de `recordMac` ; secret du `recordMac` dérivé du
HWID par un algorithme public ; import en masse du barème où un prix non
numérique devient 0 € ; quantité 0 saisie à l'écran enregistrée comme 1 ; champs
écrits hors schéma Zod sur les factures ; énumération de comptes à l'inscription
portail ; onglet e-facturation proposé au MANAGER alors que la connexion exige
`settings:manage` ; et trois défauts d'affichage du tableau de bord portail.

---

# Clôture des P2 — 2026-08-13 (suite)

Les quatre P2 restants ont été corrigés. Deux d'entre eux ont révélé, au cours de
leur correction, un défaut supplémentaire que le finding d'origine ne décrivait
pas — signalé ci-dessous à chaque fois.

---

## GF31-AUD-042 — Le manifeste signé n'existait que sur une source de mise à jour sur trois

```
Sévérité : P2
Domaine  : updater / fonctionnalité morte
Fichiers : electron/main.js, src/app/api/admin/updates/route.ts,
           src/components/settings/UpdatesTab.tsx, src/components/UpdateModal.tsx
Statut   : FIXED / VERIFIED
```

`fetchLatestUpdate()` interroge trois sources : le serveur central, le fichier
publié localement par la « Zone Administrateur », puis les Releases GitHub.
**Seule la première** renvoyait un `manifest`. Or `app:install-update` l'exige
dès qu'une clé de vérification est embarquée : sur un poste hors ligne ou
mono-poste — précisément le cas d'usage de la publication locale — chaque clic
sur « Mettre à jour » se soldait par « Mise à jour non signée ».

GF31-AUD-013 avait corrigé le TRANSPORT du manifeste dans les deux interfaces ;
il manquait sa PRODUCTION sur deux sources sur trois. Le test de l'époque ne
pouvait pas le voir : il vérifiait que les composants transmettent le champ,
jamais qu'un manifeste existe dans l'objet reçu.

**Correction, deux volets.**

1. La publication locale accepte et transporte un manifeste signé. Il est produit
   par l'ÉDITEUR à la release (`npm run release:manifest`) : l'administrateur du
   garage le téléverse tel quel, il n'a rien à signer lui-même. Un fichier qui
   n'en est pas un est refusé **à la publication** (400), avec le motif.
2. Quand aucune source n'en fournit, l'application le dit AVANT : chaque mise à
   jour est annotée `installable: false` + motif, les deux écrans ouvrent le
   téléchargement manuel au lieu de lancer une opération dont l'échec est certain,
   et la publication sans manifeste renvoie un avertissement explicite.

La garde du processus principal est inchangée : rien de non signé ne s'installe.

**Tests.** `src/components/__tests__/update-sources-installable.test.ts` (10).

---

## GF31-AUD-043 — Crashs, notifications et accusés de réception morts sur tout le parc packagé

```
Sévérité : P2
Domaine  : Electron / plan de contrôle
Fichiers : electron/control-plane.js, electron/main.js
Statut   : FIXED / VERIFIED
```

`resolveRemoteBase` ne lisait que `GF_LICENSE_SERVER`. Une application packagée
n'embarque **aucun `.env`** : la variable est absente en production, la fonction
rendait `null`, et ses trois consommateurs — file de crash, récupération des
notifications, accusé de réception — sortaient **en silence**. Trois
fonctionnalités livrées, consenties par l'utilisateur, sans le moindre effet ni
le moindre signal : l'éditeur ne recevait aucun rapport de crash de son parc.

C'est mot pour mot le défaut que `license-endpoint.js` avait été écrit pour
corriger sur l'autorité de licence (« une app packagée sans .env doit TOUJOURS
pouvoir joindre l'autorité distante »). Il subsistait ici, sur le module voisin.

Aggravant : l'ancien test **verrouillait le défaut** en exigeant
`resolveRemoteBase({}) === null` sans distinguer développement et production.

**Correction.** Même règle que l'autorité de licence, importée du même module
pour qu'elles ne puissent pas diverger : surcharge d'environnement si elle
existe (refusée en clair sur un build packagé), sinon autorité officielle
compilée en production, sinon `null` en développement — pour qu'un poste de mise
au point n'envoie pas ses crashs en production. Et chaque canal journalise
désormais son silence : un canal muet ne peut plus l'être sans le dire.

**Tests.** `src/lib/__tests__/control-plane.test.ts` — 6 cas ajoutés, dont la
non-divergence des deux autorités.

---

## GF31-AUD-044 — Une intervention supprimée pouvait rester visible pour toujours

```
Sévérité : P2
Domaine  : synchronisation poste ↔ cloud
Fichiers : prisma/schema.prisma, prisma/server/schema.prisma, src/lib/migrations.ts,
           prisma/server/migrations/20260813000000_job_tombstone/,
           src/app/api/jobs/[id]/route.ts, src/lib/sync/job-sync.ts,
           src/app/api/sync/jobs/route.ts
Statut   : FIXED / VERIFIED
```

Le cloud déduisait les suppressions de l'**absence** d'une intervention dans la
fenêtre de dates remontée. L'inférence ne couvre pas deux cas réels :

1. le poste est **hors ligne** au moment de la suppression ; quand il
   resynchronise, la date de l'intervention est sortie de la fenêtre —
   l'absence n'est plus interprétable, et rien n'est supprimé ;
2. la remontée est **tronquée** (plus de `SYNC_MAX_JOBS` interventions) : toute
   purge par inférence est alors suspendue, à raison (GF31-AUD-017).

Dans les deux cas le mécanicien pouvait se déplacer sur une intervention
annulée, et des données client supprimées côté garage restaient exposées dans le
cloud. Aucune file de reprise n'existait : le `pending` de `job-sync` est une
`Map` en mémoire, perdue à l'extinction du poste.

**Correction — pierres tombales explicites.**

* Table `JobTombstone` (poste **et** serveur, pour la parité des deux schémas
  Prisma vérifiée par test), migration SQLite `201`/`202` et migration
  PostgreSQL `20260813000000_job_tombstone`, toutes deux additives et
  idempotentes. Aucune clé étrangère vers `Job` : la ligne doit survivre à la
  disparition de l'intervention, c'est son objet même.
* `DELETE /api/jobs/[id]` écrit la trace **dans la même transaction** que la
  suppression.
* La remontée transmet `deletedIds` **indépendamment de la fenêtre**.
* Le cloud applique `deleteMany` borné à son `garageId`, puis **accuse** ce
  qu'il a traité ; le poste n'efface ses traces que sur cet accusé. Un échec
  réseau, une extinction, un cloud muet : la trace repart à la remontée
  suivante.

Le modèle SQLite livré (`prisma/garageflow-template.db`) a été mis à jour et
re-baseliné : 202 migrations enregistrées, 0 en attente, checksums conformes.

**Tests.** `src/lib/sync/__tests__/job-tombstones.test.ts` (6), dont la
suppression hors fenêtre, la non-perte sur échec réseau et l'accusé partiel.
Mutation : ne plus envoyer les suppressions, ou effacer les traces sans accusé,
fait tomber exactement 3 tests.

---

## GF31-AUD-045 — L'accord du client sur un devis n'était qu'un changement de statut

```
Sévérité : P2
Domaine  : portail client / valeur probante
Fichiers : src/app/api/portal/quote/[token]/route.ts, src/app/api/quotes/[id]/route.ts,
           src/app/portal/quote/[token]/page.tsx
Statut   : FIXED / VERIFIED
```

`POST /api/portal/quote/[token]` posait `status = 'accepted'` et rien d'autre :
aucune trace de QUAND, aucune liaison à CE QUI a été accepté, aucune distinction
avec un statut posé par le garage lui-même — qui peut l'écrire directement. En
cas de litige sur une réparation, il n'existait **aucune preuve**, ni pour le
client, ni pour le garage.

Le dépôt disposait pourtant de tout le nécessaire — `buildSignableDocument`,
`createCertificate`, modèle `Signature` avec empreinte de contenu et sceau
HMAC — mais cela ne servait qu'aux signatures dessinées.

**Correction.** L'acceptation produit un certificat scellé sur le document
réellement affiché : empreinte du contenu canonique, horodatage, adresse IP,
agent utilisateur, le tout sous HMAC, écrit **dans la même transaction** que la
revendication de statut. Un devis « accepté » par ce chemin sans certificat est
structurellement impossible. Aucune image de signature n'est fabriquée — le
portail propose un bouton, pas un pavé de signature ; inventer une image serait
inventer une preuve.

La lecture distingue désormais un accord client d'un statut posé par le garage,
et **revérifie** que la preuve porte sur le document affiché aujourd'hui : si le
devis a changé depuis, l'écran le dit au lieu de présenter la preuve comme
valide (§74).

**Défaut supplémentaire trouvé pendant la correction, et corrigé.** La machine à
états autorise `accepted → refused` : le garage pouvait donc transformer un
accord client en refus **tout en conservant la preuve de l'accord** — deux
vérités contradictoires en base. Toute sortie de l'état attesté invalide
désormais la preuve (marquée, jamais supprimée), sauf `accepted → converted`,
suite naturelle de l'accord à contenu inchangé.

**Tests.** `src/integration/quote-acceptance-proof.test.ts` (10), sur base
SQLite réelle, dont deux réponses concurrentes et la péremption de preuve.

---

# État du registre au terme de la session

| Sévérité | Confirmés | Corrigés | **Ouverts** |
|---|---|---|---|
| P0 | 3 causes racines | 3 | **0** |
| P1 | 17 | 17 | **0** |
| P2 | 22 | 22 | **0** |
| P3 | 24 | 5 | **19** |

Les 19 P3 ouverts restent nommés et localisés à la section « Findings ouverts au
2026-08-13 » ci-dessus. Aucun n'a été reclassé pour arranger ce tableau.

---

# Clôture des P3 — 2026-08-13 (fin de session)

Les 18 P3 encore ouverts sont corrigés (les 5 autres l'avaient été en chemin par
les lots P0/P1/P2 : rôles stock, véhicules de prêt, updater). Chacun suit le même
protocole : reproduction sur le code, correction de cause racine, test qui
échoue avant et passe après.

| # | Défaut | Correction | Statut |
|---|---|---|---|
| **046** | `vehicleModel` / `licensePlate` ÉCRITS par `PATCH /api/invoices/[id]` sans figurer au schéma Zod — persistés sans borne | Champs ajoutés à `UpdateInvoiceSchema` | FIXED / VERIFIED |
| **047** | Supprimer la facture issue d'une conversion laissait le devis en état TERMINAL avec un `invoiceId` mort : ni convertible, ni supprimable | Le devis redevient `accepted`, pointeur effacé, dans la même transaction | FIXED / VERIFIED |
| **048** | La conversion devis→facture — voie de création la plus utilisée — n'écrivait RIEN au journal d'audit | `logAudit` avec l'auteur et le devis d'origine | FIXED / VERIFIED |
| **049** | L'identité de l'acheteur d'une facture ÉMISE restait librement modifiable, sans trace | Scellée comme les montants ; 409 `INVOICE_IDENTITY_LOCKED` renvoyant vers l'avoir | FIXED / VERIFIED |
| **050** | Import de barème : `Number('abc')` = NaN, toute comparaison FAUSSE → prix enregistré à **0 €**, succès confirmé | `parseAmountToScaled` (seul parseur borné) ; un prix fautif annule tout l'import | FIXED / VERIFIED |
| **051** | Réception de commande : quantité fractionnaire arrondie en silence sur un statut TERMINAL non rejouable | Refus 409 `INVALID_STOCK_QUANTITY` AVANT la revendication du statut — la commande reste corrigeable | FIXED / VERIFIED |
| **052** | Devis/facture : une quantité à 0 devenait **1** ; le document validé ne valait pas le montant affiché | Refus explicite nommant la ligne, avant tout envoi | FIXED / VERIFIED |
| **053** | `GF_MIN_ELECTRON_VERSION` ne s'appliquait à PERSONNE : la plateforme était déduite de `process.env.ELECTRON`, jamais positionné sur le cloud | Le client ANNONCE sa plateforme (liste blanche) ; `unknown` reçoit le minimum le plus contraignant | FIXED / VERIFIED |
| **054** | `POST /api/admin/licenses` insérait depuis le CORPS : ni signature vérifiée, ni `recordMac` — ligne échappant pour toujours au contrôle d'intégrité | Aligné sur `/create` : jeton vérifié, champs de sécurité dérivés du payload signé, MAC posé | FIXED / VERIFIED |
| **055** | Le client rejetait les empreintes HWID **V1**, format accepté par le serveur et documenté canonique ; `getHwidV1()` sans aucun appelant | `hwidMatches` reconnaît les deux formats et compare v1 avec v1, toujours en temps constant | FIXED / VERIFIED |
| **056** | Secret du MAC de base dérivé du seul HWID par un algorithme public : tout processus local pouvait le recalculer | Secret d'installation aléatoire mêlé au HWID (mécanisme du secret de session). **Portée honnête** : élève le coût de « recalculer » à « lire un fichier protégé » ; un adversaire administrateur local reste capable de le lire | FIXED / VERIFIED |
| **057** | Téléchargement de mise à jour : redirections suivies sans revalider hôte ni protocole — la liste blanche et l'exigence HTTPS tombaient au premier saut | `checkDownloadUrl` appliqué à CHAQUE saut, `Location` relatif résolu explicitement ; bouclage local admis (publication par la Zone Administrateur) | FIXED / VERIFIED |
| **058** | `reset-garageflow.ps1` : une clé de chiffrement au repos présente UNIQUEMENT en local était régénérée — données déjà chiffrées perdues | La valeur locale est reprise et promue en Production au lieu d'être remplacée | FIXED / VERIFIED |
| **059** | `GET /api/garages` servait l'annuaire du personnel (noms, e-mails, rôles) à tout rôle authentifié, contournant `GET /api/users` | Exactement la même règle que `/api/users` — deux portes vers la même donnée, une seule serrure | FIXED / VERIFIED |
| **060** | L'inscription au portail confirmait l'existence d'un compte, annulant l'anti-énumération de la connexion | Réponse indifférenciée ; le titulaire légitime — et lui seul — est prévenu par courriel | FIXED / VERIFIED |
| **061** | Le tableau de bord client redirigeait vers `/portal/login` nu : le garage mémorisé était perdu hors de l'onglet d'origine | Redirections passant par `lienPortail()` | FIXED / VERIFIED |
| **062** | Le tableau de bord ignorait `linkedClient: false` et affirmait « Aucune facture » à un client simplement non rattaché | Bandeau explicite : les documents existent peut-être, l'adresse n'est pas vérifiée | FIXED / VERIFIED |
| **063** | Onglet « Facturation électronique » proposé au MANAGER, alors que la connexion exige `settings:manage` (OWNER) : il n'y trouvait que des 403 | L'onglet suit `settings:manage` — écran et route concordent | FIXED / VERIFIED |

**Tests ajoutés :** `invoice-document-integrity-p3.test.ts` (15),
`stock-money-p3.test.ts` (11), `licence-p3.test.ts` (15),
`portal-rbac-p3.test.ts` (15) — 56 tests.

Deux corrections méritent une note de scope honnête :

* **056** ne rend pas le MAC infalsifiable pour un administrateur local. S'en
  prémunir exigerait un scellement asymétrique par l'éditeur — refonte hors
  périmètre, et il vaut mieux le dire que le laisser croire.
* **058** corrige le chemin local ; la rotation contrôlée d'une clé de
  chiffrement au repos reste réservée au processus dédié
  (`GF_SMTP_CIPHER_KEY_OLD`), inchangé.


---

# État du registre au terme de la session

| Sévérité | Confirmés | Corrigés | **Ouverts** |
|---|---|---|---|
| P0 | 3 causes racines | 3 | **0** |
| P1 | 17 | 17 | **0** |
| P2 | 25 | 25 | **0** |
| P3 | 25 | 25 | **0** |

Les trois derniers P2 — **GF31-AUD-066**, **067** et **068** — n'apparaissaient pas dans la
copie de travail de l'audit : ils ont été découverts en rejouant le release gate
DEPUIS LE DÉPÔT git. Un audit qui ne s'exécute qu'à un seul endroit ne prouve
quelque chose qu'à cet endroit-là.

**Aucun finding connu ne reste ouvert.** Ce qui subsiste n'est pas du code : ce
sont les vérifications qui exigent un environnement dont celui-ci ne dispose pas
— artefact Windows signé, PostgreSQL, Redis, SMTP, bac à sable de plateforme
agréée. Elles sont énumérées au §31 du rapport final.


---

## GF31-AUD-065 — La baseline canonique ne pouvait plus être régénérée

```
Sévérité : P3
Domaine  : cohérence documentaire / reproductibilité
Fichier  : scripts/generate-verification-baseline.mjs
Statut   : FIXED / VERIFIED
```

`generate-verification-baseline.mjs` appelait `git rev-parse` **sans repli**.
Hors dépôt, la génération s'arrêtait sur `fatal: not a git repository` — et le
document canonique restait **figé sur une mesure ancienne** : il annonçait 1541
tests (mesure du 2026-08-09) alors que la suite en comptait 2255.

C'est la divergence que ce fichier existe précisément pour empêcher (§165) :
`FINAL_VERIFICATION_BASELINE.md` se déclare « single canonical source of truth »,
et il contredisait tout le reste de la documentation. Une baseline périmée est
pire qu'absente — elle fait autorité en se trompant.

**Correction.** L'identité git devient optionnelle et **explicite** :
`gitIdentity: false`, `commit: null`, plus un avertissement à l'écran
(« HORS DÉPÔT GIT … Rejouez-la depuis le dépôt avant un tag »). Les comptes
restent MESURÉS ; seule l'identité de build manque, et elle le dit.

Le relâchement porte sur la BASELINE (une mesure), **jamais sur l'artefact** :
`verify-artifact` continue d'exiger un commit de 40 hex, faute de quoi aucune
release n'est rattachable à sa source (§150). Un test verrouille cette
distinction.

**Prose canonique alignée dans la foulée** : le document affirmait encore
« PostgreSQL 16.13 et Redis 7 **locaux réels** » et un gate « 11/11 OK ». Ces
mesures du 2026-08-07 sont conservées comme preuve, mais explicitement datées et
assorties de la mention que la regénération du 2026-08-13 n'en disposait pas.

**Tests.** `src/__tests__/baseline-git-identity.test.ts` (4).

## GF31-AUD-066 — La porte documentaire jugeait sur des résidus ignorés

```
Sévérité : P2
Domaine  : porte de release / reproductibilité du verdict
Fichier  : scripts/lib/docs-consistency.mjs
Statut   : FIXED / VERIFIED
Découvert: en rejouant le release gate DEPUIS LE DÉPÔT (2026-08-13)
```

`checkDocsConsistency` inventoriait les documents en parcourant le disque, en
n'écartant que `node_modules`, `.next` et `.git`. Le dépôt réel contient un
ancien worktree oublié sous `.claude/worktrees/blackscreen/` — **ignoré** par
`.gitignore:67`, **non suivi**, invisible pour quiconque relit le dépôt. Ce
worktree embarque sa propre copie de `FINAL_VERIFICATION_BASELINE.md`, marqueur
canonique compris.

Résultat au gate :

```
[canonical-count] (global)  2 sources canoniques déclarées (attendu : 1) :
   .claude/worktrees/blackscreen/docs/audit/FINAL_VERIFICATION_BASELINE.md,
   docs/audit/FINAL_VERIFICATION_BASELINE.md
```

Deux contrôles obligatoires en échec (`check:consistency` et `Cohérence
documentaire`) sur un dépôt dont **git ne suit qu'une seule** baseline —
vérifié : `git ls-files '*FINAL_VERIFICATION_BASELINE.md'` en retourne une.

Ce défaut n'était pas visible depuis la copie de travail de l'audit, qui ne
contient pas ce résidu. C'est précisément ce qui le rend grave : **le verdict de
la porte dépendait de ce qui traînait en local**. Un gate irreproductible ne
prouve rien — ni quand il est rouge, ni, surtout, quand il est vert.

**Correction.** L'inventaire passe par git :
`git ls-files --cached --others --exclude-standard`. Les fichiers suivis **et**
les nouveaux non encore indexés sont vus ; seuls les ignorés disparaissent. La
propriété qui compte est conservée : un second document canonique tout juste
écrit, pas encore `git add`, est toujours refusé — le confondre avec « ignoré »
aurait ouvert un faux vert.

Hors dépôt (copie détachée, tarball), repli sur la marche disque, avec la liste
d'exclusions élargie aux dossiers jamais documentaires (`.claude`, `dist`,
`out`, `build`, `coverage`, `release`, `.turbo`, `.vercel`). Et si git répond
sans mentionner la baseline canonique alors qu'elle est sur disque, on retombe
également sur le disque : mieux vaut un faux rouge qu'un vert obtenu sur une
liste vide.

**Tests.** `src/__tests__/docs-consistency-ignored-residue.test.ts` (5).
Mutation vérifiée : sur l'ancien code, 2 des 5 tests échouent (le résidu ignoré
et le repli disque) ; les 3 autres — vrai doublon suivi, doublon non indexé,
repli fonctionnel — passent des deux côtés et interdisent la sur-correction.

## GF31-AUD-067 — Un test de cet audit était instable, et pouvait mentir

```
Sévérité : P2
Domaine  : fiabilité de la suite / risque de faux vert
Fichier  : src/lib/__tests__/record-mac-admin-routes.test.ts (livré par cet audit)
Statut   : FIXED / VERIFIED
Découvert: 2 occurrences, toutes deux au premier `npm test` suivant un `npm ci`
```

Ce fichier — écrit pendant cet audit pour verrouiller GF31-AUD-005/006 — a fait
échouer la suite deux fois, toujours ses **deux premiers tests**, jamais lancé
seul. La première occurrence avait été consignée comme « non reproductible » ;
la seconde, au release gate depuis le dépôt, a imposé un vrai diagnostic.

**Mesure.** Durées par test sur machine au repos :

```
suspendre une clé mécanicien …   520 ms
les six suivants …               0 à 16 ms
```

Chaque `it` faisait son propre `await import('@/app/api/admin/licenses/[id]/route')`.
Le premier payait donc, seul, la construction de tout le graphe de modules de la
route. Sous la charge de la suite complète et avec un cache disque froid — les
deux échecs sont survenus juste après un `npm ci`, qui vide ce cache — ces
520 ms peuvent franchir le budget de 5 s d'un test.

**Le second échec est une conséquence, pas une cause.** Vitest abandonne le test
dépassé, mais la promesse continue : la requête `PATCH` se termine et écrit dans
`db.ecrit`, champ unique et partagé, pendant que le test SUIVANT s'exécute.
Celui-ci lit alors l'écriture du précédent et échoue sur un MAC incohérent —
symptôme situé à mille lieues de sa cause. Le risque symétrique est pire : un
test dont la route n'écrit rien peut lire l'écriture d'un autre et **passer au
vert**. Une suite qui peut mentir dans ce sens-là ne prouve plus rien (§150).

**Correction, en deux temps.**

1. Les deux routes sont importées une fois dans `beforeAll`, hors du budget d'un
   test et sous le délai des hooks. Mesuré après : premier test **9 ms** au lieu
   de 520 ms, maximum du fichier 9 ms.
2. Les écritures sont **collectées** au lieu d'être écrasées, et chaque test
   exige `toHaveLength(1)` via `ecritureUnique()`. Une écriture parasite n'est
   plus silencieuse : elle nomme elle-même l'anomalie.

Relever `testTimeout` aurait déplacé le seuil sans rien corriger — c'est
exactement le geste que le dépôt s'interdit (§151), et qu'il avait déjà refusé
pour GF31-AUD-024.

**Portée résiduelle, mesurée et déclarée.** Dix fichiers de test importent
encore dynamiquement dans un `it` ; quatre partagent en plus un état de module
mutable. Aucun n'a échoué à ce jour et aucun n'a été modifié ici : les corriger
sans défaut observé relèverait de la spéculation. Le motif est consigné pour
qu'une future instabilité soit diagnostiquée en une minute plutôt qu'en une
heure.

## GF31-AUD-068 — La porte de release n'était pas idempotente

```
Sévérité : P2
Domaine  : porte de release / fiabilité du verdict
Fichiers : scripts/final-release-gate.mjs, scripts/post-build.js
Statut   : FIXED / VERIFIED
Découvert: au rejeu de confirmation, 5e exécution de la porte (2026-08-13)
```

Deux exécutions consécutives de `npm run release:gate` sur le même arbre
donnaient **vert puis rouge**, avec le message le plus alarmant du dépôt :

```
❌ Artefact NON conforme :
  • Fuite de secrets : .next\standalone\.env présent dans l'artefact.
```

Sans la moindre fuite.

**Mécanisme.** Next (`output: 'standalone'`) trace le `.env` du dépôt dans sa
sortie, et `package.json` → `build.extraFiles` recopie **tout**
`.next/standalone` dans l'application empaquetée. C'est exactement le chemin par
lequel un `.env` de production s'est déjà retrouvé en clair dans un installateur,
lisible sous `resources/standalone/.env` — le commentaire de `post-build.js` le
raconte lui-même.

Le vrai pipeline s'en protège : `npm run dist` enchaîne
`build` **puis** `post-build.js`, qui purge. La porte, elle, ne construisait
qu'à moitié : `npm run build` seul, sans purge. Elle laissait donc derrière elle
l'état précis que son propre contrôle `verify-artifact` — exécuté **avant** le
build — refuse au passage suivant.

**Les deux moitiés comptent, et la seconde est la pire.** Sur un arbre neuf,
`verify-artifact` ne trouve aucun `.next/standalone` et passe **à vide** : le
contrôle censé interdire un `.env` empaqueté ne regardait rien. Sur un arbre déjà
construit, il refusait un état que le pipeline réel nettoie. Ni l'un ni l'autre
n'est le contrôle voulu.

**Correction.** La purge devient une implémentation unique,
`scripts/lib/purge-standalone-env.cjs`, appelée par `post-build.js` **et** par la
porte juste après son build. La porte laisse ainsi l'arbre dans l'état que
produit le vrai pipeline. En CommonJS explicite pour être requise depuis le CJS
comme depuis le `.mjs` (`createRequire`), sans dépendre du support `require(esm)`
d'une version de Node.

**Rien n'a été assoupli** : un `.env` dans un standalone reste une fuite et
`verify-artifact` continue de le dire — un test verrouille ce point précis, pour
que la recherche d'idempotence ne serve jamais de prétexte à désarmer le
contrôle.

**Tests.** `src/__tests__/release-gate-idempotent.test.ts` (6). Mutation
vérifiée : une correspondance élargie à `.env*` — qui supprimerait
`environment.js` de l'application — et le retrait de la tolérance à l'absence de
build font chacune tomber un test, et un seul.

**Preuve directe** : la porte a été rejouée **deux fois de suite** sur le même
arbre après correction.

---
