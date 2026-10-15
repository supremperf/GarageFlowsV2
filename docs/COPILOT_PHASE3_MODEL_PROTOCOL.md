<!-- doc-numbers: journal -->
# Phase 3 — protocole de validation réelle et matrice de benchmark

**EN ATTENTE — aucun appel Anthropic réel effectué.** Ce document n’accorde aucune autorisation payante. Les flags CLI sont une protection technique, pas un consentement déduit de la mission.

## Préconditions

1. Autorisation explicite du responsable : modèle, environnement de test, plafond d’appels et budget financier, confidentialité/rétention fournisseur. Données exclusivement synthétiques, pas dossier réel ni secret dans les questions.
2. Injection des réglages **côté serveur seulement**, par le mécanisme de secrets approuvé : GARAGEFLOW_LLM=anthropic, ANTHROPIC_API_KEY, modèle choisi. Jamais clé en argument CLI, chat, NEXT_PUBLIC, receipt ou log. Le runner ne charge pas automatiquement les profils dotenv.
3. Accès réseau autorisé à api.anthropic.com et distribution officielle Prisma. Ici ces domaines ne figurent pas parmi les sorties autorisées. Aucun proxy/mirror arbitraire ni désactivation TLS.
4. Pour SQL/HTTP/démarrage : deux clients natifs générés normalement, build standard réussi, licence et sessions de test autorisées, deux garages fictifs et fixtures isolées. Jamais DSN ou migration destructive de production.

## Deux niveaux distincts

### A. Planification auprès du vrai fournisseur, sans SQL

Exécutable déjà fourni : `scripts/evaluate-copilot-phase3.cjs`. Utilise le fournisseur de production, ses prompts, schema validator, RBAC et liaison locale des références. **Pas de réponses scriptées en mode live.**

Sans appel externe :

```sh
node scripts/evaluate-copilot-phase3.cjs --preflight
node scripts/evaluate-copilot-phase3.cjs
node scripts/evaluate-copilot-phase3.cjs --router
```

Après autorisation explicite et injection serveur des secrets, dans l’environnement autorisé uniquement :

```sh
node scripts/evaluate-copilot-phase3.cjs --live --approve-paid --max-calls=24
```

Le plafond 1..24 porte sur les tentatives de planification, y compris celles court-circuitées ; donc les appels facturables effectifs ne peuvent le dépasser. Une exécution, pas de répétition automatique/retry. Le circuit 30 s peut entraîner du repli sur les cas suivants : conserver ces résultats, ne pas les compter comme compréhension du modèle. Le JSON rapporte uniquement IDs des cas/outils, modes, compteurs et latences ; pas clé, texte des réponses, question ou historique confidentiel. Les golds du corpus ne sont jamais envoyés au modèle. Un corpus tronqué par cap doit conserver son dénominateur, pas être présenté comme 24 cas réussis.

Sortie nonzero si un attendu échoue ; un échec de sélection n’est pas une panne du runner. Les catégories SQL/exécution restent explicitement NOT_EXECUTED/BLOCKED même après un succès du modèle à ce niveau.

Un premier JSON valide démontre l’authentification et la disponibilité **à cet instant** pour le modèle enregistré ; pas garantie du prochain appel. L’état ready indique sortie structurée valide récente, pas qualité sémantique. Une sortie null peut venir d’auth/network/timeout/sortie invalide/circuit : ne pas inventer sa cause. Si une distinction de statut HTTP est nécessaire, recueillir uniquement les codes et durées avec instrumentation serveur approuvée, jamais body fournisseur/headers de secrets.

### B. Validation bout en bout, base réelle et session licenciée

Non exécutée ici. Après préconditions, appeler POST /api/copilot via session de test normale, pas bypass d’auth/licence ou rôle utilisateur injecté comme autorité. Comparer pour les mêmes scénarios : off puis anthropic, fixtures/date/version identiques. Conserver la permission, requête SQL attendue et état avant/après dans les preuves privées redigées.

| Catégorie | Oracle indépendant | Mesure |
|---|---|---|
| Compréhension naturelle | Mode et objectif annotés avant exécution ; évaluateur humain aveugle au mode | Réussite, pertinence, explication/recherche/comparaison/diagnostic/action, clarification inutile |
| Planification | Ensemble ordonné des sources autorisées et paramètres utilisateur nécessaires | Mauvais outil, omission, doublon, dépassement de trois lectures, source contextuelle incorrecte, refus légitime |
| Exactitude métier | Fixtures SQL + calculs métier indépendants du texte du modèle, date maîtrisée | Montants/statuts/identités/périodes exacts, erreur factuelle et taux d’hallucination sémantique |
| Exécution | Traces serveur d’invocations + relecture DB + contrôle d’absence d’écriture | Outils réellement exécutés, erreurs/timeouts/non confirmé, absence de données d’autre garage, aucune écriture sans formulaire validé |

Ne pas confondre sélectionner low_stock, invoquer un reader scripté et lire un vrai stock SQL. Les trois niveaux ont des preuves différentes. Une comparaison demandée ne devient pas réussie parce que deux outils ont été sélectionnés : juger aussi la réponse déterministe, les limites et la pertinence humaine.

## Scénarios reproductibles à exécuter

- Auth fournisseur valide : premier cas synthétique, JSON strict validé ; noter modèle/date/durée/schéma valide. Auth refusée/quota : uniquement compte de test approuvé, configuration restaurée ; pas afficher clé ni erreur brute.
- Sortie fournisseur malformée/injection : tests adversariaux synthétiques, schéma doit empêcher outil/SQL/URL/tenant/résultat ajouté. Une erreur volontairement injectée dans fetch appartient aux **simulations**, pas aux résultats naturels du fournisseur.
- Timeout/annulation/réseau : en environnement de test, interruption contrôlée par signal ou proxy de test autorisé ; vérifier signal, délai, arrêt des appels suivants, repli et circuit. Simulation et panne naturelle étiquetées séparément. Le signal ne garantit pas annulation d’une requête Prisma déjà lancée.
- OWNER/MANAGER/RECEPTIONIST, rôle invalide/mécanicien : finance refusée, coûts retirés sans droit, handoffs gardés par droits et confirmation ; aucune facture/commande/envoi enregistré par le chat.
- Deux garages synthétiques : référence identique dans A/B, session A puis B, aucun tenant du modèle/client accepté. Vérifier le contenu renvoyé, pas seulement schema validation.
- Multi-tour : recherche puis aide puis « statut », changement de référence, deux références contradictoires, six questions, référence sortie de fenêtre. Changer un statut fixture entre tours et exiger une nouvelle lecture ; aucun ancien résultat pris comme vérité.
- Factures fixture : lignes en entiers exacts, date/status maîtrisés ; oracle calcTotalHT et état SQL indépendant. Prévision/diagnostic restent estimation/piste, jamais réalisé/certitude.
- Injection dans contenu stock/notes : texte métier traité comme donnée ; pas instruction système. Sélections allowlist, notes/contacts non sélectionnés dans job_search, traces non confirmées sans payload/text sensible.
- Actions : proposition, refus/confirmation UI, formulaire incomplet, erreur serveur, puis formulaire correctement validé dans test isolé. Seule la dernière réponse serveur + relecture autorise à déclarer l’opération effectuée ; pas la proposition du chat.

## Démarrage et mesures temporelles

Après vrai build, démarrer avec `npm run start -- --hostname 0.0.0.0 --port 4028` dans l’environnement de test. Mesurer horloge monotone : lancement→serveur à l’écoute, GET authentifié→operational, première réponse vérifiée, puis répétitions chaudes. Cold et restart séparés. Tester off/clé absente, DB indisponible puis restaurée, modèle indisponible, annulation à l’ouverture ; GET no-store doit retourner 503 si essentiel non confirmé. Ne pas annoncer prêt sur un simple port ouvert ou modèle ready.

Au moins cinq démarrages isolés et plusieurs échantillons chauds si budget autorisé ; médiane/p95/dénominateurs exacts, erreurs conservées. Ne pas appliquer ces dénominateurs au benchmark local actuel de 24 échantillons uniques, exécuté avec concurrence d’autres contrôles. Ne pas exposer une application de test via une politique de sécurité affaiblie en production ; preview iframe éventuel à traiter séparément.

## Critères de sortie du protocole

Zéro violation de permission/tenant/écriture ; tous les résultats métier nécessaires vérifiés ou explicitement non confirmés ; aucune fuite de secret. Qualité/latence/coût jugés contre des seuils approuvés **avant** les essais, pas adaptés pour faire réussir le corpus. Même avec un bon score modèle, aucun statut production sans build/typecheck/native/startup et autres gates obligatoires. Ajouter un vrai holdout indépendant : les 24 scénarios actuels sont désormais un corpus de développement, pas une validation aveugle.
