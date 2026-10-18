<!-- doc-numbers: journal -->

# Blocage 6 — grille A–K, preuves et reste à vérifier

Revue du 17 octobre 2026. **Aucune catégorie entière n’est déclarée close sans preuve.** Une collecte statique générale a été effectuée, et les domaines hors incident (stock/factures/clients/DB, documentation/licences, composants UI) sont traités ci-dessous. Cela ne devient pas une revue sémantique exhaustive par simple comptage de fichiers. Le développement administratif fort reste localement inachevé ; tous les écarts ne sont donc pas imputables à un accès production manquant.

## Preuves transversales reproductibles

- `node docs/audit/2026-10-17/phase6/collect-review-inventory.mjs` produit [l’inventaire de revue](review-inventory.tsv), [les routes](route-inventory.json), [les composants UI](ui-inventory.json), [les signaux statiques](static-signals.json) et [l’encodage](encoding.json). Le TSV nomme les fichiers et porte explicitement **semantic completeness NOT attested** : pas de case cochée par défaut. Les sorties du collecteur lui-même ne sont pas auto-hachées récursivement.
- Inventaire API AST : **164 fichiers, 240 handlers explicitement exportés détectés** ; les exports/re-exports particuliers peuvent exiger inspection complémentaire. Les marqueurs de garde sont des indices lexicaux, **pas** une preuve que toute branche d’un handler est protégée. Les helpers délégués (ex. `withPortalAuth`, `licenseApiBoundary`, `internalRequestAuthorized`) expliquent certaines absences dans la liste de marqueurs.
- Inventaire UI : **109 TSX**. Un `aria-label` présent ne certifie ni le contraste ni le clavier ; son absence n’établit pas à elle seule une violation.
- [43 modèles desktop / 47 modèles serveur](schema-inventory.json). Les quatre modèles exclusivement serveur sont `GarageEInvoiceConnection`, `EInvoiceTransmission`, `EInvoiceEvent`, `EInvoiceAuditEvent`. Les noms de champs des modèles communs concordent dans ce relevé ; les annotations/contraintes et migrations ne sont pas prouvées équivalentes par ce parseur.
- [SQLite lu en lecture seule](sqlite-readonly.json) : 45 tables du template, `integrity_check=ok`, zéro violation FK. Aucun accès aux bases de postes ou serveur réels.
- [Découverte Playwright](e2e-discovery.log) : **144 tests dans 3 fichiers**, non exécutés. [Installation Chromium tentée](browser-install.log) : échec TLS/ECONNRESET vers `cdn.playwright.dev`. [Gitleaks officiel tenté](gitleaks-download.log) : curl35 vers `release-assets.githubusercontent.com`. Historique HEAD désormais disponible (481 commits), mais scan officiel non exécuté.
- Résultats finaux de tests/compilation : [validation structurée](validation.json), [traces initiales des 79 fichiers](01-TESTS-ET-TRACES.md), [cohérence du dépôt](consistency-final.log). Les mocks et contrôles statiques ne remplacent pas les 79 fichiers DB empêchés.

## Statut explicite de chaque catégorie

| Catégorie | Statut final de cette passe | Preuves / périmètre réellement traité | Ce qui empêche la clôture |
|---|---|---|---|
| **A — Code & logique** | **Partiellement auditée** ; validation native bloquée par moteurs Prisma ; revue sémantique locale non achevée | Lecture des primitives monnaie/stock/tenant et des flux clients/véhicules/factures ; compilation stricte ; globale ; P6-API-01 corrigé ; détails §A | Revue des modules non priorisés, parcours réels, concurrence DB, intégrations métier ; liste de fichiers à couvrir = TSV, non implicitement verte. |
| **B — Sécurité** | **Partiellement auditée** ; scan officiel bloqué par téléchargement, nouveau workflow humain/MFA non implémenté | Frontières licence/sync, MAC, ancre, auth/RBAC, SQL/HTML/commandes sensibles inventoriés ; deux nouveaux bypass de rate limiter corrigés ; §B | Autorisation humaine/step-up, diagnostics secrets, revue/dominance de tous les handlers, scan et tests d’attaque, IAM/proxy/artefacts réels. |
| **C — Encodage / textes** | **Partiellement auditée** ; encodage global contrôlé, relecture éditoriale métier non effectuée intégralement | Décodage UTF-8 strict sur tous les fichiers Git visibles non binaires : aucune erreur ni U+FFFD ; deux BOM PowerShell Windows intentionnels conservés ; §C | Orthographe/sens de tous les textes, traductions, PDFs et rendu natif Windows ; pas de justification réseau pour la relecture locale encore à faire. |
| **D — API** | **Partiellement auditée** ; runtime DB/fuzz/E2E bloqués, revue intégrale des branches encore locale | 164 routes / 240 exports, matrice licence/sync, cinq listes avec pagination corrigée/testée ; wrappers et exemples de portée tenant lus ; §D | Validation de schéma/erreur/payload/autorisation/idempotence pour chaque méthode du JSON de routes, et contrats consommateurs de tous les domaines. |
| **E — Dépendances** | **Partiellement auditée** ; installation complète/engines indisponibles | Installation sans hooks, audit npm courant sans vulnérabilité signalée, lock et SBOM inspectés ; 32 paquets obsolètes consignés ; §E | Hooks/install propre, Electron/Sharp natives, mises à jour compatibles, supply-chain et distributions multi-OS ; pas d’assimilation obsolescence/vulnérabilité. |
| **F — Licences** | **Partiellement auditée** ; attribution technique corrigée, validation de distribution/juridique absente | SBOM production 98 composants, notices intégrales/versionnées, RGBColor MIT retrouvé, présence LGPL identifiée ; §F | Inventaire du paquet final Electron/Chromium/natif/WASM, obligations LGPL/source/relinking et titularité ; ce n’est pas une seule vérification de clé licence commerciale. |
| **G — Documentation** | **Partiellement auditée** ; cohérence automatique passée, recette de procédures encore absente | README/config/exemples/env/crypto/runbook/rapports/notices/inventaire corrigés ; garde existante sans affaiblissement ; §G | Exactitude des procédures de tous les modules et historiques actifs, liens/ancres externes, captures et recettes ; baseline générée ≠ certification release. |
| **H — Tests** | **Partiellement auditée** ; 79 fichiers bloqués, services et navigateur absents | Assertions échouées nommées, 848 pending finaux ventilés nominativement (849 initialement ; cas indépendant réactivé), tests Node et nouveaux tests unitaires/API mockés ; §H | Rejeu natif complet, 21 cas PostgreSQL, 5 Redis, tests clés/artefact réels et 144 E2E ; couverture mesurée non produite. |
| **I — Déploiement/Infra** | **Partiellement auditée** ; réseaux/outils et infra réelle non accessibles | Chaîne npm/build/postbuild/packaging/CI inspectée, garde reset/probe, checks migrations et template ; §I | Build/standalone/package/signatures, proxy/TLS/CSP effective, secrets/permissions/sauvegarde/alertes réels, release gate complet. |
| **J — Base de données** | **Partiellement auditée** ; moteurs/runtime/DB réelles manquants | Deux schémas inventoriés, template read-only, primitives stock/tenant/transactions lues, migrations statiques vérifiées ; §J | Chaque modèle/index/contrainte, migrations neuves et upgrade sur copie, concurrence/isolation, backups/restauration, volumes/plans et cohérence données réelles. |
| **K — UX/UI** | **Partiellement auditée** ; Chromium/installateur absent, recette manuelle complète non faite | 109 TSX inventoriés, contrôles de câblage UI, modale clavier/focus lue, erreur/retry appareils ajoutés, 144 E2E découverts ; §K | Navigation et écrans de tous les rôles, clavier/lecteur écran/contraste, responsive, hors ligne/PWA/mises à jour, moteur Safari et Windows natif. |

**Ce tableau ne masque pas un travail local inachevé sous l’étiquette “externe”.** En particulier A/B/C/D/F/G/K comprennent des tâches de revue/conception locales encore nécessaires. Le verdict ne peut être GO CONDITIONNEL sous prétexte qu’un simple accès réseau les réglerait toutes.

## A — logique métier hors licence

Sources examinées : `src/lib/money.ts` (entiers centimes et conversion scaled), `billing.ts`, `stock/inventory.ts` (agrégation/delta et quantités entières), `stock/invoice-stock.ts:118-239` (claim conditionnel, décrément `quantity >= units`, périmètre garage), `tenant.ts` (FK par garage), routes clients/véhicules/factures/devis/interventions et leurs schémas/permissions. Les tests de monnaie, stock pur et câblage existants sont repris par la globale ; les entrelacements SQLite/PostgreSQL restent empêchés, pas déclarés prouvés par commentaires.

**P6-API-01 corrigé** : `Math.max(1, parseInt('abc'))` produisait NaN dans les listes clients, factures, devis, véhicules et interventions ; un offset énorme dépassait la plage Prisma. `src/lib/pagination.ts` refuse formats partiels, NaN/Infinity/fractions/entiers non sûrs et offsets >2^31−1 avant requête. Cinq GET retournent désormais **400 INVALID_PAGINATION** sur ces entrées, au lieu d’une erreur DB/500. Défauts/maxima conservés (dont 500 pour une journée d’interventions). 11 tests purs + 15 tests de vrais handlers avec DB mockée, et les 6 tests de pagination cloisonnée existants passent (**32/32**).

La lecture ne démontre pas toutes les règles de planification, contrats d’e-invoicing, IA, import/export, prêt de véhicule, paiement, concurrence et rattrapages sync. Ces familles et les fichiers correspondants du TSV restent à contrôler ; aucune ligne non revue n’est marquée conforme.

## B — sécurité

- **P6-SEC-01 corrigé** : `admin/licenses/create` et `admin/diagnostics` ne contournent plus `degraded=fail_closed`. 503 neutre avant traitement, même avec clé partagée valide. Test d’enregistrement adapté pour exiger **aucune écriture**, test diagnostic ajouté pour exiger absence de corps sensible. Ce changement n’authentifie pas davantage une clé partagée : la refonte forte reste ouverte.
- **P6-SEC-02 ouvert** : identité humaine/MFA récente et audit durable administratif incomplets. La licence admin et son JWT ne constituent pas une authentification nominative forte ; les diagnostics exposent toujours longueur/premier point de code/hash de certaines variables, derrière l’ancien contrôle partagé. Le domaine public utilisé pour le hash **n’est pas un sel secret empêchant le bruteforce**. Il faut minimiser cette surface et la rattacher à l’autorisation renforcée, pas prétendre que la fermeture de revoke-by-key a réparé tous ses voisins.
- Repérages SQL : les advisory locks de `mechanic-licenses/route.ts:256,307` passent le garage comme paramètre `$1` ; le `VACUUM INTO` de `internal/backup/route.ts:87-110` impose une racine et échappe les apostrophes. Cela n’exonère pas la vérification des liens symboliques/concurrence et des opérations de migration. Les SQL de migration sont un cas distinct de données utilisateur.
- `JobQRCode.tsx:96-117` reçoit le SVG de `qrcode.toString` plutôt que concaténer l’URL comme HTML. Présence de `dangerouslySetInnerHTML` ne suffit pas à conclure XSS, et n’exonère pas l’audit des options et de la bibliothèque.
- Restent : toutes les politiques RBAC/tenant/CSRF/SSRF/uploads/HTML/SQL/shell et les surfaces de tokens publics, erreurs, cryptographie au repos, proxy headers, cache/CORS, logs/TTL, authentification portail/mécanicien. Le JSON de signaux est un index d’inspection, pas un scanner certifiant leur absence.

## C — encodage et langue

`encoding.json` recense les fichiers, la liste explicite des dix binaires et les deux BOM PowerShell. Aucun octet invalide UTF-8 dans le périmètre textuel. BOM/CRLF des deux scripts Windows conservés ; normaliser à l’aveugle pourrait casser Windows PowerShell. Le contrôle n’évalue ni l’orthographe française ni la justesse d’un statut/message, ni les textes contenus dans des images/PDF/binaires. La relecture UI licence effectuée ne s’étend pas automatiquement à 109 composants et tous les documents.

## D — API hors licence

Lecture ponctuelle des guards `withAuth/requireSession`, `withPortalAuth`, `internalRequestAuthorized`, `assertRelations` et filtre garage des exemples clients/véhicules. La route portail rendez-vous borne ses lectures à l’utilisateur portail ; la vérification `vehicleId` inclut garage/client. Vérifier cette propriété par deux tenants en DB réelle reste nécessaire. Les nombres d’exports AST ne constituent pas des décisions d’autorisation.

Le corps `null` et les tableaux ne sont pas uniformément rejetés partout (ex. `admin/licenses/[id]` lit les propriétés après JSON sans vérifier objet, `portal/appointments` caste le JSON puis lit `body.reason`). C’est un **écart de robustesse ouvert P2**, pas une preuve d’accès indu. Un parseur objet commun et des tests de contrat sur toutes ces routes sont encore requis. Les filtres/dates/pagination offset d’autres listes, notamment rendez-vous, doivent aussi être recettés ; ne pas généraliser la correction des cinq GET à toutes les API.

## E — dépendances

Audit npm de l’arbre complet : aucune vulnérabilité signalée à la date de cette passe. Ce n’est ni une revue du code de chaque dépendance ni une attestation des hooks d’installation. L’installation a gardé `--ignore-scripts`, les clients sans moteurs ne sont pas des artefacts déployables. Paquets obsolètes : versions exactes dans [outdated.json](outdated.json), audit registre dans [npm-audit.json](npm-audit.json) ; la mesure précédente de `04-PREUVES.json` reste historique. Les dépréciations npm/ESLint et SQLite expérimental/ESM de migrations ne sont pas ignorées ; prévoir des lots de maintenance testés, sans migration globale `type:module` ou majors opportunistes.

## F — licences et notices

**P6-LIC-01 corrigé techniquement** : SBOM datée d’août remplacée par l’arbre courant ; notices générées pour **98 composants de production** de cet environnement. Suppression de la troncature arbitraire des licences à 8 000 caractères. Lecteur par chemin SBOM + vérification nom/version et confinement node_modules pour les versions imbriquées. Trois tests Node dédiés couvrent texte long, versions distinctes, faux chemin/version.

**P6-LIC-02 ouvert** : l’ancienne affirmation d’absence de copyleft était fausse pour l’arbre courant : `@img/sharp-wasm32` déclare notamment LGPL-3.0-or-later. Le fichier `docs/sbom/LICENSE_INVENTORY.md` est corrigé ; RGBColor dispose d’un texte MIT malgré l’absence de métadonnée SPDX reconnue. Les bibliothèques natives/WASM peuvent avoir d’autres notices que la licence du paquet racine. Il faut vérifier la distribution effective, les textes/source/relinking requis et le paquet Electron/Chromium. Aucune conclusion juridique de violation ou de conformité absolue sans ces vérifications.

## G — documentation générale

Actualisés : README, `docs/CONFIG.md`, exemples env, registre généré, procédure de clés, runbook administratif, notices et inventaire licences, rapports et preuves. Ancienne mention `keygen_gui.py`/édition manuelle d’ancres retirée du commentaire actif de `public-key.ts`.

Les relevés datés (notamment 03/04/05/06) sont identifiés par le marqueur **déjà prévu** `doc-numbers: journal`. Cela exempte seulement leur compteur point-dans-le-temps de la comparaison à une ancienne baseline ; les contrôles de revendication et de statut restent actifs. Aucune exemption générale ou diminution des tests de la garde. La baseline machine/humaine est régénérée à partir du dernier rapport réel, y compris ses échecs, et doit rester explicitement une mesure d’un arbre modifié, pas une identité d’artefact propre.

Restent à recetter hors incident : installation poste/cloud, factures/stock/portail/planning, e-invoicing, restauration/migrations, sécurité/IAM, mises à jour, licences tierces et documentation d’intégrations externes. Les docs historiques ne deviennent pas des preuves contemporaines ; le rapport racine d’août a été explicitement reclassé historique après son refus légitime par la garde de compteurs. Vérification des liens locaux des nouveaux livrables exécutée ; liens externes et ancres de tous les documents non certifiés.

## H — tests et preuves

Voir blocage 1 pour chaque assertion et les 79 fichiers. Les pending ne sont pas tous des décisions de skip : 813 découlent d’un hook échoué. Après réexamen, le cas `alg: none` a été légitimement réactivé sans clé privée ; restent 848 pending, dont 35 conditionnels, et aucun todo. Les six cas de présence/correspondance de clés réelles restent conditionnels, ainsi que les deux GF_TEST_LICENSE ; aucune clé étrangère injectée pour faire passer les tests contre l’ancre réelle. [Liste finale](pending-tests-final.tsv), [matrice finale par fichier](vitest-final-files.json). Ne pas fournir une clé de production à la CI pour améliorer les chiffres ; les fixtures cryptographiques fournissent leur preuve indépendante.

Une passe intermédiaire a révélé un **quatrième échec local** après extraction du transport appareils : le test de câblage attendait encore le `fetch` littéralement dans le composant. [Trace conservée](intermediate-ui-guard-failure.json). Garde adaptée pour suivre import/appel/helper HTTP **et** erreur/retry, sans supprimer d’assertion fonctionnelle ; transport testé séparément. Rejeu UI/câblage : **115/115**. Ce défaut de test n’est pas attribué au réseau. Une seconde [régression de garde pagination](intermediate-pagination-guard-failure.json) a ensuite été corrigée : import et appel réels du helper suivis, lecture de son contrat et contre-exemples import mort/appel sans import/paramètre inconnu. Validation ciblée finale des 32 fichiers : 477/477, sans pending.

## I — infra et déploiement

Build standard essayé sans remplacement de sa chaîne, échec Prisma avant Next. Mode Accelerate/adapters étudié au blocage 2, avec [source Prisma 5.22](prisma-5.22-getEngineInstance.ts.txt) copiée à titre de preuve depuis le [tag officiel](https://github.com/prisma/prisma/blob/5.22.0/packages/client/src/runtime/core/init/getEngineInstance.ts) (Prisma, Apache-2.0). Les lignes 55–60 refusent explicitement la combinaison adapter/`--no-engine` : ce n’est pas un contournement drop-in. Mode WASM != migrations sans schema engine.

Contrôles migration-safety/template/pg/convergence/critical-files repassés dans `consistency-final.log`, sans déploiement ni migration production. Headers Next examinés : CSP sans unsafe-eval en prod, mais unsafe-inline encore présent (nonce à concevoir) ; politique effective au proxy non attestée. CI utilise installation normale et services isolés ; son existence ne prouve pas sa réussite sur ce patch. Pas de trigger CI, release/tag/push effectué par cette passe. npm local 10.9.8 diffère du `packageManager` épinglé 11.16.0 : rejeu avec la toolchain déclarée nécessaire.

Restent : build avec moteurs, perf budget, standalone et fuses/signatures/paquet Windows ; restauration et monitoring, RBAC des consoles/proxies, secrets de runtime et permissions de stockage. Les blocages navigateur/Gitleaks ont des logs de téléchargement, pas un simple outil supposé absent.

## J — base hors licence

Stock : décrément conditionnel par garage, `stockCommittedAt` revendiqué conditionnellement ; atomicité dépend de la transaction fournie. Monnaie : scaled integers, cohérence API/PDF éprouvée par tests purs, pas un audit comptable réglementaire. Clients/portail : propagation d’adresse/invalidation de sessions présente dans le code ; concurrence réelle et effet des e-mails non recettés.

43/47 modèles et toutes leurs colonnes sont listés dans `schema-inventory.json`, 45 tables du template dans `sqlite-readonly.json`. Vérifier encore chaque contrainte/index/default, tenant FK, suppression/cascade, argent/dates, évolution desktop/cloud et les quatre modèles e-invoicing serveur. Les audits 17 colonnes/84 colonnes de scripts ne sont pas une migration exécutée. Aucune requête de production faite ; toute requête ultérieure doit être encadrée `BEGIN TRANSACTION READ ONLY; … ROLLBACK;`.

## K — UX/UI au-delà du heartbeat

Lecture de la modale de changement licence (focus initial/restauré, trap Tab, Escape, scroll lock), de ses appareils, du panneau d’administration et des liens clients/QR. Les tests de câblage Clients/portail/admin sont repris ; ils ne testent pas un écran réel. Les scénarios E2E couvrent inspection/contraste, planning/mécaniciens et responsive, six viewports sous Chromium ; émulation iPhone n’est pas une preuve Safari.

**P6-UI-01 corrigé** : appareils distinguent chargement, absence de contexte (401/404), erreur (y compris HTTP200 mal formé/refusé), vraie liste vide et succès. Erreur neutre avec `role=alert` et bouton retry, pas de diagnostic brut ni message de licence invalide déduit de cette panne. Onze tests de transport/format/reprise. La recette clavier/lecteur écran/rendu de ce nouveau bloc reste à faire sur navigateur.

**Reste exhaustif par périmètre** : tous les fichiers du JSON UI exigent une recette de navigation/erreurs/états vides/permissions, desktop 1440, mobile 320/390 portrait-paysage, tablette, clavier/zoom/contraste/lecteur écran ; planning, accueil, devis/factures/PDF, stock, clients/véhicules, portail et mécaniciens, paramètres, admin, IA et e-invoicing ; PWA installation/cache/offline/mise à jour ; Electron activation, restart/update et Windows natif ; Safari réel. Les 144 tests découverts n’épuisent pas cette liste et n’ont pas été exécutés ici.

## Conclusion blocage 6

La grille est désormais renseignée avec preuves et défauts supplémentaires corrigés ; les domaines auparavant seulement signalés sont explorés et instrumentés. **L’audit exhaustif intégral demandé n’est toutefois pas terminé.** Ses restes sémantiques/administratifs/juridiques ne sont pas tous externes. Aucun artifice de marquage ou de statistiques ne permet de cocher A–K intégralement. Cette réserve est un motif autonome de **NO-GO**, même si les réseaux Prisma et navigateur étaient ouverts demain.
