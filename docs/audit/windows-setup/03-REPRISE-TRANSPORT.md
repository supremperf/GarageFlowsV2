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
