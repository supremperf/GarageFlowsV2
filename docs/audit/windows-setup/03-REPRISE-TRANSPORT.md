<!-- doc-numbers: journal -->
# Reprise — limites des échanges JSON du processus Electron

## Diagnostic préalable (avant patch)

Départ HEAD8b760e5, branche de session propre. Derniers checks audit/build/types/lint/Gitleaks/public-E2E réussis ; tests natifs/Windows encore en cours au relevé. Résultats CodeQL :9 (2high/7medium), pas zéro ; analyse réussie ≠ absence de résultats.

Lecture des vrais httpGetJson/httpPost d’electron/main.js : concaténation de toutes les données réseau dans une chaîne, sans limite de taille. Le timeout est celui du socket ; un serveur émettant régulièrement peut empêcher l’expiration et faire grossir la mémoire du main process. GET recommence aussi ce budget sur chaque redirection. Une réponse interrompue n’est pas traitée explicitement. La conversion implicite de chaque Buffer en texte peut couper un caractère UTF8 entre deux chunks.

Surfaces concernées : réponses JSON de licence/check/activation, métadonnées update, notifications/crash-control-plane. Les téléchargements binaires d’installateurs et les corps de requête métier/photo ne sont pas à tronquer par ce correctif. Aucune exploitation ni cause d’incident de production n’est affirmée.

## Contrat retenu

- Module Node builtin partagé, aucun nouveau paquet/configuration client.
- Réponse JSON plafonnée à8Mio (budget conservateur de métadonnées ; refus explicite via le résultat indéterminé existant, jamais troncature de JSON acceptée).
- Limite du nombre de chunks pour borner aussi leur coût mémoire ; buffers assemblés puis UTF8 décodé une seule fois.
- Deadline totale incluant connexion, réponse et redirections, plus timeout socket ; libération des ressources sur erreur, dépassement ou interruption.
- GET : maximum5redirections, résolution relative, protocole HTTP/HTTPS seulement et aucun downgrade HTTPS→HTTP. User-Agent existant conservé.
- POST : pas de suivi de redirection ni de transfert d’authentification ajouté ; httpStatus réel reste autoritaire. Erreurs => null comme auparavant, sans secret dans les logs.
- Les politiques d’activation/refus/révocation/grâce et les signatures restent inchangées. Pas de bypass de licence pour tester.

Tests prévus : vrai serveur loopback, JSON/UTF8, dépassement, corps coupé, réponse lente active, deadline sur redirections et limite de sauts, statut POST, politique anti-downgrade. Ne pas comptabiliser une réduction éventuelle de localisations CodeQL comme la preuve que tous les flux réseau/fichier ont été sécurisés.

## Reproduction et premiers tests

Exécution du vrai ancien httpGetJson extrait de8b760e5, sur un serveur loopback fini envoyant un petit JSON pendant300ms : timeout configuré100ms, ancien helper accepte le JSON après308ms. Le nouveau helper, même budget100ms, rendnull à la deadline. Aucun gros payload/bombe/serveur de production utilisé. Ce constat démontre le défaut de timeout total, pas une exploitation réelle.

Dix tests du vrai nouveau module passent : encodageUTF8 multichunk, User-Agent, requête POST/statut réel, limite annoncée et mesurée, réponse lente, redirections relatives/budget/deadline, interruption/JSONmalformé, protocoles/downgrade, limites/options et surcharge en nombre de chunks.67tests Vitest de câblage/startup/licence passent, types/lint/cohérence0. Le garde de redirection texte a été remplacé par l’appel de la vraie politique partagée plus l’assertion de branchement, pas supprimé.

Les erreurs gardent le contratnull et les mécanismes métier d’autorité/grâce/refus existants ; aucune nouvelle tentative automatique et aucun relâchement TLS. Le correctif ne prétend pas résoudre toutes les alertes réseau/fichier : les destinations, permissions et minimisations restent des dimensions distinctes.

## Réactivation : le statut HTTP ne pouvait pas être ignoré

Le test du vrai POST réseau + vraie heartbeatDecision a mis en évidence un défaut distinct : **HTTP503 + allowed:true/status:active pouvait lever un blocage distant**. Avant patch :10/11tests transport passent, ce nouveau cas échoue. Ce n’est pas attribué à un incident de production sans logs corrélés.

Correction minimale de la seule branche positive : accord explicite allowed:true obligatoire ; quand le transport fournit httpStatus (toujours dans le vrai chemin), seul200 peut réactiver. Les anciens appelants directs sans champ HTTP restent compatibles s’ils fournissent l’accord explicite. Repli local jamais autorité, refus/révocation/expiration/minVersion toujours honorés, aucune rotation ni nouvelle émission de licence.

Après :11/11transport,88/88heartbeat/infra/câblage ; matrice de13statuts invalides (3xx,4xx,5xx,null/typeerroné), réponse active sans accord, succès200 et refus426 inchangés. Types/lint0. Le résultat metadata HTTP réel prime toujours sur une propriété httpStatus reçue dans le JSON.

## Résultats finaux du SHA66859cc

- **431/431 Node**, **113/113 release-safety**, **88/88 ciblés** de politique/licence/câblage, **11/11 transport**, types/lint/cohérence0 ;24guards baseline/docs0échec. La globale locale réelle est **4238total/3386pass/3échecs TLSPrisma/849pending**, mêmes79fichiers empêchés ; aucune erreur supplémentaire attribuée au réseau.
- CI [39150958125](https://github.com/supremperf/GarageFlowsV2/actions/runs/39150958125) : tests natifs SQLite/PostgreSQL/Redis, build/budget standard, audit complet, Gitleaks et E2E publics **SUCCESS**. La [recette Windows117745065119](https://github.com/supremperf/GarageFlowsV2/actions/runs/39150958125/job/117745065119) passe : vraie installation/lancement sécurisé, serveur installé, SQLite/export/backup/migration, relance/réinstallation/désinstallation et conservation des données vérifiées.
- **CodeQL reste9résultats (2high/7medium)**. Le déplacement du transport dans un module n’est pas revendiqué comme résolution de ces flows. E2E authentifié toujours rouge au précontrôle de staging, Required validation rouge, release gate manuel skipped par événement.

### Setup réel de ce correctif

[Artefact client](https://github.com/supremperf/GarageFlowsV2/actions/runs/39150958125/artifacts/12144369832), transport ZIP GitHub contenant seulement **GarageFlows-Setup.exe**. Fichier produit dans **release/GarageFlows-Setup.exe**, version1.1.0, Windowsx64/NSIS offline ; **231058681octets (220.4Mio)**, SHA256 **d77b1aa7a99c47b0bee5e8c7f3d125f41cfbf2a0a7aafd54093154bb088e88df**.3045fichiers/hashs de payload vérifiés,7fuses conformes et scan de clés privées passé. [Identité](transport/delivery-66859cc.json), [smokeWindows](transport/windows-smoke-66859cc.json), [serveur installé](transport/installed-server-66859cc.json). GitHub enveloppe l’EXE dans un ZIP pour l’éditeur ; le client ne reçoit que l’EXE, pas les sources/dist/ressources séparées.

**NotSigned Authenticode**, pas de validation d’un PC d’usine sans outils ni d’une session métier avec licence/autorité de production. Pas de nouveau certificat/clé généré pour prétendre le contraire. Aucun artefact binaire ajouté à Git, aucune publication production/merge/déploiement/migration/rotation. Les données/templates, chemins historiques, ancres publiques,14langues et PWA/PostgreSQL n’ont pas été remplacés.

### Preuves et limites

[Reproduction ancien/nouveau](transport/legacy-deadline-reproduction.json), [tests transport](transport/heartbeat-after.txt), [ciblés](transport/policy-targeted-summary.json), [Node](transport/node.txt), [globale locale](transport/global-failures.json), [CI exacte](transport/ci-66859cc-final.json), [CodeQL](transport/codeql-66859cc.json), [validation structurée](transport/validation.json).

**NO-GO production maintenu**, malgré ces deux défauts structurels corrigés et un candidat Windows réel revalidé. Les151alertes annoncées sur main/REST403 et les conditions de staging/CodeQL/signature/recette métier ne sont pas effacées par un packaging réussi. Les preuves sont celles du SHA66859cc ; les mises à jour de rapport ultérieures ne reçoivent pas artificiellement ses checks.
