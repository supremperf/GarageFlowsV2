# Phase 5 — protocole de seconde mesure aveugle et campagne réelle

Statut : **EN ATTENTE D’AUTEUR / REVUE EXTERNE ET D’AUTORISATION PAYANTE**.
Ce document prépare l’intake, pas un nouveau score. Les fixtures de tests du validateur ne sont **pas** un corpus indépendant.

## 1. Acquisition indépendante (hors développement)

Un auteur/relecteur non impliqué dans cette implémentation fournit **32 nouveaux cas**, quatre par dimension :

- `novel_intent` : formulation nouvelle, non copiée du corpus de développement ;
- `compound` : opérations indépendantes, requêtes liées, couverture et plafonds ;
- `conversation` : objectif courant, changement de référence, six tours au maximum ;
- `time_status` : période/statut supportés versus demande incompatible ;
- `missing_information` : référence, objectif, période ou symptôme absent ;
- `out_of_scope` : absence de capacité et texte récupéré hostile ;
- `tools_parameters` : choix, schémas fermés, ancrage des paramètres ;
- `permissions_business_facts` : rôle/garage et oracle SQL synthétique indépendant.

Utiliser uniquement des données synthétiques et une référence pseudonyme de relecteur. Aucune clé réelle, conversation client, PII, URL signée ou donnée de production. Ne pas générer le gold avec le modèle testé. Ne pas communiquer le gold au fournisseur. Le développeur ne corrige pas le runtime en regardant ces cas avant leur mesure.

Format strict : voir `Intake` dans `scripts/prepare-copilot-blind-set.cjs` (version, référence externe, attestations, cas B000… avec dimension/query/role/history/expected/factOracleRef). Les paramètres attendus sont validés contre le catalogue et le rôle serveur ; les cas de refus ne contiennent aucun appel autorisé fictif. Chaque cas métier/permission exige un `factOracleRef` vers une fixture et une assertion indépendante. Une référence ne prouve pas que l’oracle a tourné.

Validation et gel **hors ligne**, vers un nouveau fichier privé :

```sh
node scripts/prepare-copilot-blind-set.cjs /chemin/prive/intake-externe.json /chemin/prive/gold-gele.json
```

Le fichier de sortie n’est jamais écrasé (`wx`, SHA-256). L’outil rejette doublons, chevauchement textuel normalisé avec développement/phase 3/48 figés, outils inconnus, schémas invalides, droits incompatibles, dimensions incomplètes et oracle manquant. Il ne prouve ni indépendance sémantique, ni identité de l’auteur, ni justesse du gold : la provenance doit être examinée par une personne indépendante avant acceptation. **Aucun second corpus externe n’a été reçu/validé ici.**

## 2. Préflight gratuit et état du runner

```sh
node scripts/evaluate-copilot-phase4.cjs --preflight
node --test tests/copilot-phase4-evaluation.test.cjs tests/copilot-evaluation-approval.test.cjs tests/copilot-blind-intake.test.cjs
```

Le runner existant reste lié aux **48 cas figés**, pas au futur gold externe. Une adaptation séparément revue sera nécessaire après gel du second corpus. Le préflight ne fait aucun appel fournisseur et n’accorde aucune autorisation.

**Le mode `--live` est actuellement bloqué avant chargement du fournisseur : aucun plafond de facturation effectivement imposé n’a été vérifié.** Une réservation conservatrice (octets UTF-8 + allowance, sortie 512 tokens) et des tarifs saisis ne constituent pas une garantie de coût facturé en euros. On ne réactive pas le mode avec un simple drapeau/variable de confort.

Avant toute activation : consentement humain explicite avec modèle, nombre maximal d’appels, coût EUR maximal, périmètre/durée et politique d’arrêt ; mécanisme de coût externe réellement imposé et revu sur hôte de confiance (sinon rester bloqué), vérification prix/FX et absence de retries hors ledger. Cette session n’autorise ni appel ni dépense.

## 3. Autorisation signée / anti-rejeu préparés

L’enveloppe future contient `approval` validé par `Approval` version 2 et `signatureBase64` Ed25519. Le payload canonique est celui de `canonical()` du helper ; ne pas inventer un autre encodage de signature. Le signataire et sa clé privée restent hors dépôt/chat. La clé publique est installée par l’opérateur de confiance à `~/.config/garageflows/evaluation-approval-public.pem` (home OS, pas chemin CLI).

Le grant lie modèle, SHA-256 du corpus, SHA-256 du runner, portée `COPILOT_SELECTION_FROZEN48`, date et expiration (24 h maximum), appels, budget et tarifs approuvés. Le dossier privé `~/.garageflows-evaluation-authorization-state` appartient à l’utilisateur OS, mode 0700 ; claim exclusif 0600 et fsync par **authorizationId signé**, pas par chemin du manifeste. Copier/renommer le manifeste ne réinitialise donc pas ce claim. Aucun grant réel ni clé d’autorisation n’a été créé ici.

Limite de confiance : ces contrôles ne résistent pas à un administrateur qui modifie code, clé, horloge ou état persistant et possède la clé API. Le coût doit être imposé hors du processus candidat par une autorité vérifiée. Les tests de signature/anti-rejeu sont synthétiques, pas une preuve de plafond fournisseur. **Ne pas effacer le claim d’un grant consommé ; toute reprise exige une nouvelle autorisation.**

## 4. Mesures séparées — jamais un agrégat « intelligence »

Rapporter séparément `LOCAL_ONLY`, `NO_CALL_GUARD`, `REAL_MODEL_ACCEPTED`, `LOCAL_FALLBACK_AFTER_ATTEMPT`. Une réponse JSON valide sans interprétation acceptée n’est pas un succès modèle ; un fallback correct ne remonte pas son taux. Conserver erreurs techniques, appels tentés (y compris échecs), latences, réservations et usage réel lorsqu’il existe ; rapprocher ensuite de la facture, sans prétendre l’avoir fait avant.

Pour chaque strate : intention, entités/contraintes, informations manquantes, outils/paramètres, autorisations effectives, oracle métier exécuté, et réponse finale relue humainement. Les métriques sans exécution/oracle restent nulles/non mesurées. La campagne ne lance ni écritures métier ni SQL/HTTP arbitraire ; les lectures passent par schémas, RBAC, contexte garage session et vérification des résultats. Une proposition d’action n’est jamais une autorisation d’exécution.

Arrêts : cap d’appels/réservation, expiration, signature/périmètre incorrect, défaut d’enforcement externe, fuite potentielle, erreur d’autorisation ou dérive du corpus. Aucun retry, budget augmenté, substitution de modèle ou entraînement conversationnel sans nouvel accord.
