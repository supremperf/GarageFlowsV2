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
