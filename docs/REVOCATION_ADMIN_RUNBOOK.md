# Révocation administrative — runbook et remplacement P1

**État au 17 octobre 2026 :** `/api/admin/licenses/revoke-by-key` est retiré (404 permanent), indépendamment de tout flag, secret ou environnement. **Ne pas définir de flag de réactivation et ne pas modifier la route pour une intervention support.** Le remplacement renforcé décrit ci-dessous est une **spécification prête à développer, pas une fonctionnalité livrée**. Le déploiement reste NO-GO tant que ce parcours et sa recette ne sont pas validés.

## 1. Usages retrouvés dans ce dépôt

| Appelant / preuve | Usage légitime historique | Destination retenue |
|---|---|---|
| `scripts/keygen_ui.py`, `_remote_set_status` | Révoquer, suspendre, réactiver une licence depuis le GUI, y compris avant première activation via une pierre tombale | Demande support + opération admin nominative décrite ci-dessous ; pas de clé partagée transférée vers une nouvelle route. Le GUI actuel affiche le retrait sur 404, pas une révocation réussie. |
| `scripts/keygen_ui.py`, `_test_connection` | Vérifier la connectivité/clé partagée au moyen d’un POST de statut factice | Séparer health non sensible et recette MFA/admin sans effet métier ; ne jamais utiliser une route de mutation comme ping. Le ping actuel échoue sur 404. |
| `scripts/reset-garageflow.ps1`, `Test-ProtectedApiKeyEndpoint` / diagnostic associé | Garde de validation du déploiement après configuration de clé API | Désormais bloquante et sans appel au point retiré ; remplacement par une recette admin approuvée, pas un contournement. |
| `scripts/configurer-api-garageflow.ps1`, `Test-ApiKeyEndpoint` | Même validation post-configuration | Désormais bloquante, sans envoi de clé ni POST factice ; test de non-régression dédié. |
| Tests `revoke-by-key-route`, `keygen-api-contract`, `licence-admin-durcissement`, gardes MAC | Preuves de l’ancien contrat et de son retrait | Maintenir le 404 et l’absence d’écriture, ne pas les interpréter comme appelants métier. |

La suppression physique d’un enregistrement n’est **pas** une révocation : l’activation peut créer une ligne absente. Une licence inconnue à révoquer exige une pierre tombale durable vérifiée contre le jeton signé ; elle ne peut pas être traitée en prétendant que « ligne absente = succès ». La possession du jeton ou de son identifiant n’est pas une autorisation administrative.

L’ensemble des **appelants présents dans le dépôt** a été recherché ; les macros de support, intégrations hors dépôt et procédures d’équipes externes ne sont pas observables ici. L’opérateur doit en confirmer l’inventaire avant migration du workflow.

## 2. Ce qui existe, et pourquoi cela ne suffit pas

`/admin/licenses` appelle déjà `PATCH /api/admin/licenses/[id]` pour une ligne enregistrée (révocation/suspension/réactivation explicite), avec cookie `gf_session` admin, validation DB, rate limit, MAC et machine à états. `DELETE` n’est pas un substitut. Les tests de cette machine à états restent utiles.

Mais `isAdminSession()` ne prouve pas l’identité d’un humain ni une MFA récente ; l’acteur est un identifiant de licence et l’audit des coupures est best-effort. Les `POST /api/admin/licenses/create` et `GET /api/admin/diagnostics` sont d’autres consommateurs historiques de clé partagée : **ne pas les utiliser comme remplacement**. Leur sécurité doit être revue séparément (voir phase 6, blocage 6).

**Sans barrière IAM/MFA indépendante attestée et procédure d’urgence approuvée, ne pas exploiter ce PATCH comme prétendu nouveau workflow renforcé.** Ce runbook ne donne aucune autorisation de changement de données en production. Il n’inclut aucune commande SQL d’écriture manuelle, aucun secret partagé, ni appel de mutation à copier dans un terminal.

## 3. Spécification normative du remplacement

### Identité et droits

- Endpoint distinct : `POST /api/admin/license-revocation-operations` et lecture du reçu `GET /api/admin/license-revocation-operations/[operationId]` ; ancienne route inchangée en 404.
- Exiger une session **humaine** serveur NextAuth liée à un compte opérateur nominatif, une attribution explicite `licensing:revoke` gérée par un propriétaire IAM et, selon la politique, une seconde approbation indépendante pour le parc critique.
- Interdire les cookies de licence seuls, clés `x-gf-key`, simples rôles client/garage, et possession d’un jeton GF2 comme autorisation. Un rôle garage n’obtient pas un droit global.
- Step-up WebAuthn ou MFA de l’IdP avec `acr/amr`, `auth_time` vérifiés côté serveur, **âge ≤5 minutes**, audience/origine/RP ID fixés par configuration attestée. Toute preuve absente/inconnue/expirée/config MFA invalide = refus ; pas de fallback OTP non enregistré ou de paramètre client `mfa:true`.
- Autoriser uniquement same-origin, contrôle CSRF lié à la session, cookie Secure/HttpOnly/SameSite approprié, TLS et no-store. Pas de CORS wildcard. Origine et forward headers uniquement de proxies de confiance.

### Demande et cible

Corps JSON strict (limite 16 KiB, objet non nul, champs inconnus refusés) :

```json
{
  "operationId": "UUID idempotent",
  "target": { "licenseId": "UUID signé" },
  "action": "revoke",
  "reason": "Motif support obligatoire, 10 à 500 caractères",
  "ticket": "Référence du dossier approuvé",
  "expectedStatus": "active",
  "stepUpChallengeId": "Identifiant opaque à usage unique"
}
```

- `action` limité initialement à `revoke` / `suspend`. **Aucune réactivation dans cet endpoint.** Une réactivation est une opération permissive distincte, avec motif, nouvelles preuves MFA et approbations ; ne pas transformer la révocation en toggle.
- Si la ligne n’existe pas : exiger en plus un jeton GF2 signé valide (jamais journalisé), vérifier sa signature et son `lid` contre la cible et créer une pierre tombale `revoked` à partir des champs signés. Pour les jetons expirés, prévoir une vérification d’intégrité sans octroi d’accès, séparée et testée ; ne pas appeler la validation d’activation pour contourner une expiration.
- Si le MAC de la ligne existante est invalide : refuser le rescellement automatique et ouvrir un incident d’intégrité. Une procédure de quarantaine doit être approuvée séparément ; ne pas « réparer » une ligne potentiellement compromise au cours d’une révocation ordinaire.
- Rate limiting distribué par acteur et IP, **fail-closed** en cas d’indisponibilité ; pas d’exemption parce qu’il s’agit d’un outil support.

### Anti-rejeu, transaction et audit

- Introduire une table d’opérations avec `operationId` unique, acteur stable, cible, action, hash canonique de la demande, challenge, date d’authentification, motif/ticket, date UTC, résultat et reçu. Attribution IAM/challenges et conservation font l’objet de migrations révisées/approuvées ; aucune migration automatique en production.
- Lier le challenge au hash de l’intention (acteur, cible, action), à la session, à une expiration courte et à un nonce. Une preuve destinée à la licence A ne peut agir sur B. Un challenge ne peut servir à un autre operationId.
- Transaction PostgreSQL : vérifier/reverrouiller la ligne de licence et l’unicité d’opération ; vérifier état attendu et MAC ; appliquer machine à états ; recalculer le MAC sur les champs exacts ; inscrire révocation horodatée et marqueur d’invalidation appareils/session ; écrire l’opération et un événement audit/outbox durable **dans la même transaction**. Les validations de session doivent refuser immédiatement le nouvel état ; l’envoi externe du journal est repris depuis l’outbox.
- Si DB/audit durable indisponible : transaction annulée, HTTP503 neutre, pas de succès fictif. Sur un besoin d’urgence de couper un accès malgré DB down, utiliser une procédure IAM/réseau préapprouvée hors application, pas un fail-open de cet endpoint.
- Répétition **identique** de la même opération par le même acteur autorisé : reçu d’origine, pas de second effet. Même ID avec corps/acteur différent : 409, événement d’alerte. Après restauration DB, les reçus et challenges ne doivent pas devenir réutilisables (tests de reprise).
- Journal : acteur nominatif, droits exercés, MFA attestée (métadonnées non secrètes), approbateur si nécessaire, cible pseudonymisée, avant/après, motif/ticket, UTC, request ID, IP dérivée de proxy attesté, UA borné, résultat. Aucun token, clé, cookie, challenge secret ou signature brute. Conservation, contrôle d’accès et SIEM définis par l’équipe sécurité.

### Réponses

- 200 : `ok:true`, `operationId`, état appliqué, date, reçu ; uniquement après commit durable. Rejeu identique explicitement marqué.
- 400 : corps non conforme ; 401 : absence de session humaine ; 403 : droits/CSRF/MFA insuffisants ; 404 : cible inconnue sans preuve signée ; 409 : état/contenu/rejeu contradictoire ; 429 : limite ; 503 `DB_UNAVAILABLE` / dépendance de sécurité indisponible ; 500 `SERVER_MISCONFIGURED` si configuration inutilisable. `ok:false`, request ID et message neutre ; pas de stack publique.
- Lecture du reçu : mêmes contrôles de rôle et de périmètre, jamais un endpoint public permettant d’énumérer les licences.

## 4. Tests d’acceptation obligatoires (P1)

1. Cookie licence admin seul, clé partagée seule, session garage seule, MFA absente/ancienne/fausse, CSRF absent et origine étrangère refusés **sans écriture**.
2. Humain habilité + MFA récente + cible correcte : transaction et audit durable atomiques ; licence/session/appareil refusés dès la réponse.
3. DB down, Redis down, clé MAC/config MFA invalide : fail-closed, codes neutres, pas de ligne/jeton/session créé.
4. 20 appels concurrents identiques : une opération, un effet ; variantes d’acteur/contenu : 409 ; challenge pour autre cible refusé.
5. Licence non enregistrée : jeton signé correspondant → pierre tombale persistante ; prochaine activation refusée. Token faux/autre lid → refus ; pas de token en logs.
6. Licence révoquée ne peut redevenir active par cet endpoint, DELETE ou réactivation implicite ; MAC invalide jamais rescellé comme légitime.
7. Audit durable en panne → pas de commit ; SIEM en panne mais outbox durable → commit puis livraison reprise, sans doublon et avec alerte.
8. Tests SQLite/PostgreSQL réels des primitives utilisées, propriété d’anti-rejeu après redémarrage/restauration, E2E opérateur et tests d’accessibilité de confirmation.
9. Ancien endpoint toujours 404 pour tous les flags ; anciens probes n’envoient plus de secret ; Keygen ne propose pas de réouverture.

## 5. Exploitation une fois le remplacement livré et recetté

1. Recevoir un dossier support approuvé ; identifier environnement, licence et effet attendu (révocation licence ≠ révocation d’un appareil). Ne pas demander les secrets du client.
2. Se connecter au plan d’administration nominatif, effectuer le step-up MFA, contrôler la cible et saisir motif/ticket. Obtenir la seconde approbation quand imposée.
3. Confirmer une **intention unique** ; conserver operationId et reçu, pas le jeton. Ne pas répéter une nouvelle opération après un timeout : consulter le reçu/rejouer le même ID de façon idempotente.
4. Vérifier le refus check/status/sync sur un poste autorisé pour la recette, corrélé au request ID, et l’événement durable/SIEM. Un HTTP200 `allowed:false` est bien un refus métier.
5. Signaler tout échec technique comme tel ; ne pas supprimer la ligne, ne pas réinitialiser les clés, ne pas mettre de flag sur l’ancien endpoint.
6. Pour une restauration d’accès, ouvrir une demande distincte approuvée ; aucun bouton de rollback automatique de la révocation.

**Responsables proposés** : sécurité/IAM (droits et MFA), backend (transaction/outbox/contrats), exploitation (provenance et runbook), QA (tests natifs/E2E). Délai cible P1 à fixer par ces propriétaires avant promotion ; pas d’engagement d’équipe non consultée. Déploiement/migration uniquement après validation humaine explicite. Rollback : désactiver la nouvelle surface au proxy, conserver tombstones/reçus, ne jamais réactiver la route retirée.
