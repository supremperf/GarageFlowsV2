<!-- doc-numbers: journal -->
# Reprise — confirmation et lecture des réponses de synchronisation

## Diagnostic avant modification

La session retrouve les fichiers du dernier lot mais HEADaa90f89/index ancien. Fetch de la seule branche de session, vérification d’ascendance puis avance soft vers la branche déjà publiéecccbe33 et gitadd : **zéro différence de contenu**, aucun travail utilisateur écrasé. Main non modifiée. Les contrôles natifs/build/audit/Gitleaks publics passent au dernier relevé ; recette Windows encore en cours et CodeQL9résultats (2high/7medium).

Lecture du vrai cloudPost : `res.json()` est sans borne explicite de volume, et une erreur JSON est avalée pour garder `{}`. Le résultat vaut ensuite `res.ok && data.ok !== false`. **HTTP200 avec HTML/JSON malformé, objet sans accusé, tableau ou scalaire peut donc être annoncé réussi.** pushMechanicAssignment/status écrit cloudSyncedAt sur out.ok ; pushTicketAnswer annonce remonte:true. C’est un faux acquittement possible, pas une preuve d’incident de production.

Les16familles de consommateurs et leurs handlers cloud ont été inspectés : les succès du protocole courant fournissent ok:true, les refus ok:false. Ils ne doivent pas être remplacés par un succès supposé à partir du seul statut HTTP.

Particularité à préserver : job-photo renvoie les photos mécanicien déjà plafonnées à **8Mio décodés**. Leur dataURI/base64 représente environ10.67Mio ; une limite générale8Mio casserait cette fonctionnalité. Le budget de réponse retenu ici est16Mio, sans réduire la taille des requêtes/photo d’origine. Pas de changement de seuil photo/métier.

## Correctif prévu et limites

- Lecture streaming de Response.body, budget octets/chunks réel, décodageUTF8 unique et erreur/abandon explicites ; pas de fallback vers json() non borné.
- Deadline existante8s (20s pour rapatriement photo) conservée ; annulation du reader si le signal expire, pas de timeout allongé.
- Succès exige un objet JSON et un accusé propre ok:true ; les refus métier et codes HTTP restent distincts. Réponse HTTP2xx invalide/malformée/non acquittée => échec protocole502, jamais done/synced.
- Aucune redirection de corps privé, aucun log de réponse brute ; pas de modification des payloads, licences, clés, environnements cloud/desktop ou données production.
- Tests avant/après pour les faux positifs ; photo maximale8Mio/base64 testée, streaming hostile borné et orchestration réelle de synchronisation. Les résultats CodeQL ne seront pas déclarés résolus par simple changement de forme du transport.

## Ajustement indispensable après lecture détaillée des contrats de volume

Une limite16Mio appliquée aveuglément à tous les retours serait une régression : quote-return peut renvoyer50preuves dont des images de signature jusqu’à2MB chacune, et les messages d’un ticket n’ont pas de plafond de volume global historique. **Pas de plafond global16Mio imposé à ces lots.**

La borne16Mio s’applique aux réponses unitaires connues : job-photo, mechanic-assignment/status/avatar, portal-account, quote et portal. Les autres protocoles bulk conservent un budget d’octets Infinity explicite, ainsi que deadline existante et limite de chunks. Un test renvoie un lot de10preuves sous leur limite individuelle et dépassant16Mio, sans rejet. La pagination/limitation de volume des protocoles bulk reste donc **ouverte**, pas certifiée corrigée ou sans risque mémoire. Aucun lot accepté n’est tronqué ni acquitté partiellement.

## Reproductions et orchestration réelles

- Avant patch du transport : **2/9 pass,7/9 fail** sur HTML/JSONmalformé/vide/sansack/tableau/scalaire/ack de mauvais type, tous rendus success à tort par le vrai cloudPost.
- Ancien cloudPost extrait du commitcccbe33 et vrai HTTPloopback :200avec JSON incomplet puis timeout150ms => **ok:true/data:{}**, l’AbortError du corps étant avalée. Reproduction finie, pas de production contactée.
- Après : **32/32 ciblés** reader/transport/redirection/orchestration. pushMechanicAssignment et pushMechanicStatus réels utilisent le vrai cloudPost ; seule la DB locale est simulée. HTML200 laisse la synchronisation en attente et n’écrit pas cloudSyncedAt ; un vrai JSONok:true ultérieur confirme et écrit ;503positif ne confirme jamais.
- Photo8Mio complète après expansion base64, lot bulk>16Mio, annulation de reader après fetch résolu, vrai HTTP200 incomplet/timeout, UTF8multichunk/invalide et corps/octet/chunkhostile couverts. Pas de mock permissif json() sans stream dans le chemin nouveau.

L’outillage local a dû être restauré : node_modules/.venv absents au redémarrage. Un premier npx a tenté un Vitest non épinglé sans charger la config : **ce n’était pas une exécution de tests**. npm11.16ci --ignore-scripts et wheels Python hashés restaurés ; vrai Vitest du lock utilisé ensuite. Clients --no-engine uniquement pour typage/mocks, pas une preuve SQLnative. Aucun manifest/lock supprimé ni version de dépendance mise à jour.

## Résultats finaux du lot

**35/35 ciblés**, **431/431 Node**, types/lint/cohérence/env0, audit npm complet0. La vraie passerelle e-facturation est testée avec le vrai cloudPost : HTML200 devient502/ok:false et n’est pas enrichi ; refus409conservé ; succès200 et enrichissement de rôle inchangés. Un HTTP503 portant ok:true est normalisé en échec de protocole sans relayer un ok:true trompeur, avec statut503préservé.

Globale locale finale **4272total/3420pass/3échecs TLSPrisma/849pending**, mêmes79fichiers empêchés,351fichiers au total ;24guards docs/baseline passent. Les3échecs restent ceux de préparation DBnative inaccessible dans ce sandbox ; les clients --no-engine ne les transforment pas en réussite. Les nouvelles suites ont réellement été exécutées, pas skippées.

### CI réelle et candidat Setup

Sur **7e6891e290120cc68f0997b9bd5e2c138b427ab8**, [run39153598489](https://github.com/supremperf/GarageFlowsV2/actions/runs/39153598489) : tests natifs SQLite/PostgreSQL/Redis, types/lint/build/budget, audit des dépendances, Gitleaks/public-E2E **SUCCESS**. La [recette Windows117753171801](https://github.com/supremperf/GarageFlowsV2/actions/runs/39153598489/job/117753171801) est **SUCCESS** : vraie installation/lancement jusqu’à activation, serveur installé/API/SQLite/export/backup/migration, relance/réinstallation/désinstallation avec conservation vérifiée.

**[GarageFlows-Setup.exe candidat](https://github.com/supremperf/GarageFlowsV2/actions/runs/39153598489/artifacts/12147085040)** : version1.1.0, Windowsx64/NSIS offline, **231063408octets (220.4Mio)**, SHA256 **cb2db7611d605be3aa6d0135d8d66285a8d8a1a76b490427640f9178c2ea6082**.3045fichiers de payload comparés par hash ; transport ZIP GitHub contenant seulement l’EXE, à extraire par l’éditeur pour son canal de distribution. Les reçus sont séparés et ne contiennent pas userData/secrets.

[Identité](synchronisation/delivery-7e6891e.json), [smoke installé](synchronisation/windows-smoke-7e6891e.json), [serveur installé](synchronisation/installed-server-7e6891e.json), [jobs exacts](synchronisation/ci-7e6891e.json). **NotSigned Authenticode**, pas de session métier avec licence/autorité de production ni de PC physique d’usine sans outils testés ; pas de publication production. Les tests de passerelle ajoutés ensuite au SHAe28acd8 ne reçoivent pas artificiellement les checks de7e6891e.

### Reste ouvert / NO-GO

CodeQL reste **9résultats (2high/7medium)**, sans exclusion/dismissal ni annonce de résolution par reformulation du transport. [Résultats](synchronisation/codeql-7e6891e.json). Le précontrôle authentifié confirme **MISSING_INPUT:BASE_URL**, via E2E_STAGING_URL ; les autres fixtures/approbations ne sont pas présumées disponibles. [Preuve](synchronisation/staging-blocker.json). Dernier message de push :151alertes sur main, non intégrée ; API Dependabot encore403/count:null, pas zéro. [Accès](synchronisation/dependabot-access.json).

Surtout, **les volumes bulk non bornés restent un risque**, explicitement conservés pour ne pas casser les historiques/preuves. Il faut traiter leur pagination/accusé/curseurs avant d’affirmer une borne mémoire globale. Le nouveau lecteur ne signifie pas que tous les flux cloud sont totalement sécurisés.

[Avant2/9-7échecs](synchronisation/before-summary.json), [ancien faux succès à abort](synchronisation/legacy-abort-false-success.json), [35ciblés](synchronisation/targeted-summary.json), [globale réelle](synchronisation/global-failures.json), [validation structurée et limites](synchronisation/validation.json). **NO-GO production maintenu** ; aucun merge, déploiement, migration/rotation de production ou nouvelle clé/certificat inventée.
