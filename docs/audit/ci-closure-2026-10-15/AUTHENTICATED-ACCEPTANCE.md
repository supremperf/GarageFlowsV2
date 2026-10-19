# Recette authentifiée — matrice préparée, NON EXÉCUTÉE

Statut : **PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION**.

Aucune cible de préproduction et aucun compte/licence de test approuvés n’ont été fournis à l’agent. Les jobs authentifiés du candidat `df66ebb2a92263091a60206725f1fed8c9e3b87c`, **116507743486** (push) et **116507944698** (PR), échouent à `Require explicitly approved non-production test target and fixtures`, avant checkout et navigateur. L’API de job prouve cet échec de préflight, pas lequel des champs est absent/invalide : les logs bruts de ce préflight ne sont pas accessibles ici.

## Entrées nécessaires, sans transmission de secrets dans le chat

Le propriétaire autorisé doit configurer l’environnement GitHub **`e2e-staging`** :

- secrets `E2E_STAGING_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_LICENSE` ;
- variable `E2E_NON_PRODUCTION=true`, cible HTTPS explicitement approuvée, différente des domaines de production refusés par le workflow ;
- comptes synthétiques des rôles OWNER / MANAGER / RECEPTIONIST / MECHANIC, et scénario de rôle inconnu ou session invalide ;
- **deux garages isolés**, données sentinelles distinctes et cas de référence identique dans les deux garages ; oracles métier attendus, quota de licence de test et effectif du planning préparés en amont ;
- périmètre des écritures de test, modalités de nettoyage approuvées, accès autorisé aux journaux expurgés et possibilité de provoquer des erreurs contrôlées.

Ne pas utiliser une licence commerciale, créer une base, réinitialiser des données, consommer des sièges réels ou activer un fournisseur payant pour satisfaire le gate. Aucun compte ni secret fictif n’a été présenté comme une connexion valide.

## Matrice à exécuter sur la cible autorisée

Toutes les lignes ci-dessous sont **NON EXÉCUTÉES**, sans résultat inventé. Les contrats unitaires/natifs existants sont des preuves séparées, pas un substitut.

| ID | Parcours / preuve attendue | Blocage actuel |
|---|---|---|
| A01 | Connexion valide depuis `/login`, arrivée effective dans l’application, session et licence de test contrôlées ; pas de simple page de login considérée comme l’application | Cible/comptes/licence approuvés |
| A02 | Mot de passe invalide, compte inexistant : refus générique, aucune session privilégiée, aucune valeur sensible en log | Mêmes entrées + autorisation des essais négatifs |
| A03 | Session absente/expirée/invalide : refus des lectures et ouvertures d’outil ; distinguer redirection navigateur et statut HTTP API | Sessions contrôlées |
| A04 | OWNER/MANAGER : lectures autorisées de devis, interventions, stock et finances, rapprochement avec les oracles du garage de la session | Fixtures/oracles approuvés |
| A05 | RECEPTIONIST : stock autorisé mais coûts retirés sans `financial:read` ; refus des lectures financières non autorisées | Compte réception + oracle de redaction |
| A06 | MECHANIC : maintien des refus Copilote/stock concernés, aucune lecture avant le refus, pas d’élargissement de droits | Compte mécanicien + journaux instrumentés autorisés |
| A07 | UNKNOWN : refus par défaut, aucun fallback privilégié et aucun outil ouvert | Scénario de rôle inconnu contrôlé |
| A08 | Deux garages : mêmes références synthétiques, résultats limités au garage connecté, refus d’un identifiant appartenant à l’autre garage | Deux sessions et jeux de données distincts |
| A09 | Demande textuelle/modèle de changement de tenant : ne change jamais la portée serveur ; texte de document récupéré traité comme non fiable | Sessions et fixtures d’injection synthétiques |
| A10 | Conversation : nouvelle lecture des faits mutables à chaque tour, correction/ambiguïté de référence, six tours maximum, hypothèses non persistées | Session + oracles modifiables autorisés |
| A11 | Proposition d’action sans écriture ; confirmation explicite puis validation du formulaire/serveur ; annulation sans effet de bord | Écritures de recette limitées et approuvées |
| A12 | Parcours essentiels : devis/intervention/facture/planning ; vérifier écran, réponse serveur et persistance réelle autorisée, pas seulement un message UI | Fixtures + périmètre métier approuvé |
| A13 | Entrées invalides, erreur DB/service et timeout contrôlés : erreur honnête, pas de faits inventés, fuite inter-tenant ou succès fabriqué | Moyens d’injection de panne autorisés |
| A14 | Double clic/rejeu/concurrence sur opérations explicitement autorisées : pas de doublon, état final rapproché avec l’oracle | Autorisation d’écritures/concurrence ; aucun fournisseur réel |
| A15 | Déconnexion : session du navigateur supprimée, nouvel accès protégé refusé ; documenter séparément le comportement d’un ancien jeton selon la politique réelle, sans supposer une révocation serveur | Session de recette + politique vérifiée |
| A16 | Réponses/sources/journaux : absence de mots de passe, jetons, clés, payloads sensibles et sentinelles de l’autre garage ; conserver seulement résultats expurgés/hashes | Accès autorisé aux logs et sentinelles |
| A17 | Chemins LLM payants : restent fermés ; pas de trafic fournisseur même avec opt-in/configuration de test. Aucun test d’intégration facturable tant que plafond effectif + consentement ne sont pas démontrés | Plafond positif non démontré ; tests locaux de refus déjà séparés |

## Limite de la suite Playwright existante

`playwright.config.ts` et `e2e/global-setup.ts` ouvrent une session et les suites actuelles couvrent surtout responsive/planning. En l’absence de fixtures, certains tests se déclarent ignorés. Le job authentifié ajoute un préflight obligatoire, mais **un futur job Playwright vert ne démontrera pas à lui seul toutes les lignes A01–A17**, en particulier les rôles multiples, les deux garages et les erreurs métier. Il faudra conserver un résultat distinct par scénario ou ajouter les scénarios strictement nécessaires après réception des fixtures.

Les traces navigateur, captures et `storageState` peuvent contenir des sessions/données : stockage privé, aucun upload brut ni publication de cookies/jetons. Un export expurgé doit annoncer sa portée ; pas de claim « aucun secret » fondé sur un simple inventaire.
