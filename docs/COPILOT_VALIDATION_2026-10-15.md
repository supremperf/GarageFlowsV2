<!-- doc-numbers: journal -->
# Copilote — livraison et validation du 15 octobre 2026

**PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Branche : `arena/c9eaae15-garageflowsv2`. HEAD de référence : `4f19f77891debc6009a1c241d2689f2a42bca0e8`. Modifications locales non publiées. Aucun push, déploiement, appel Anthropic facturé, entraînement, migration métier ou nouveau stockage de conversations.

## Réalisé et effectivement disponible dans le code

- **VALIDÉ au niveau unitaire** : priorité aux questions d’aide plutôt qu’à une création, corpus de 13 articles versionnés avec sources de code et recherche lexicale filtrée par droit ; détection VIN par frontière de mot ; suppression du faux lien meilleurs fournisseurs → meilleurs clients.
- **VALIDÉ au niveau unitaire** : schéma strict des entrées/contexte (500 caractères par question, six questions utilisateur, pas de rôle système ou garage forgé), aide contextuelle et référence de dossier sans mémoire de faits métier. Les acquiescements textuels et instructions négatives ne déclenchent aucune écriture.
- **PARTIELLEMENT VALIDÉ** : outil de recherche d’interventions, filtre du garage issu de la session, permission `job:manage` revérifiée à la frontière de l’outil, projection sans notes/coûts/contacts, au plus cinq résultats, statut/retard observés et cause inconnue explicitée. Les scénarios de vraie base sont écrits, mais leur amorçage est bloqué.
- **VALIDÉ au niveau simulé, BLOQUÉ en direct** : adaptateur Anthropic réellement implémenté, opt-in explicite, modèle configurable, JSON strict, liste blanche des lectures et score borné, abort réseau de 2,5 s, sortie limitée à 16 384 octets, circuit de repli 30 s. Pas de reformulation libre de faits métier ni de transmission de résultats SQL/historique. Les tests utilisent un transport simulé, pas Anthropic.
- **PARTIELLEMENT VALIDÉ** : disponibilité authentifiée sans cache, états distincts modèle/local, succès ancien expiré, base explicitement non sondée. Panneau avec sources, remise à zéro, annulation et contexte borné ; erreurs et confirmations ne sont pas assimilées à des écritures réussies. Aucun test navigateur authentifié exécuté.
- **VALIDÉ sur réinstallation JS propre** : réparation des deux liens `braces` du verrou npm qui pointaient vers des répertoires inexistants. Aucun changement de version, de dépendance déclarée, de code du fork ou d’intégrité de paquet. Les deux liens résolvent maintenant vers le fork existant `vendor/braces-bounded`. Le premier échec ESLint reste dans les preuves ; il est corrigé, pas effacé.
- **VALIDÉ** : contrat d’environnement synchronisé, modèle `off` sur installation neuve, conservation des choix existants dans les profils desktop/serveur. L’assertion du template passe de 48 à 50 parce que les deux réglages du copilote y sont réellement documentés ; un nouveau test vérifie leur conservation et l’absence d’activation automatique. Pas d’assertion retirée.

Audit/plan : `COPILOT_ADVANCED_AUDIT.md`. Guide : `COPILOT.md`. Confidentialité, fournisseur et bornes : `COPILOT_LLM.md`. Revue par fichier : `COPILOT_REVIEW_2026-10-15.md`.

## Résultats : exécutions séparées, pas un agrégat artificiel

Preuves locales sous `/home/user/copilot-validation-2026-10-15/` (hors Git). Horodatages des lots finaux en Europe/Paris, commandes exactes, cwd, HEAD, empreintes des sources au départ, codes de sortie et SHA-256 des logs dans `final-receipt.json`, `dependency-repair-receipt.json`, `closure-receipt.json` et le reçu documentaire de clôture `doc-closure-receipt.json`. Node v22.22.3, npm 10.9.8, Vitest 4.1.11. Le lot initial n’avait pas encore de reçu complet ; ses logs ne sont pas présentés comme un reçu équivalent.

| Contrôle | Exécution / preuve | Résultat | Statut et portée |
|---|---|---|---|
| Baseline unitaire avant code | `baseline.log` | 3 fichiers, 53 tests, exit 0, 693 ms observés | VALIDÉ : tests purs/scriptés existants, pas une qualité de conversation réelle. |
| Installation après réparation du verrou | R01, `npm ci --ignore-scripts --no-audit --no-fund` | exit 0 | VALIDÉ : installation JS seule ; pas une installation complète avec scripts natifs. |
| ESLint ciblé | R02 | exit 0 | VALIDÉ : bibliothèques copilote, route, panneau et nouveau test d’intégration ; pas un lint global. |
| Unités après réinstallation propre | R03 | 5 fichiers, 94 tests, aucun skip, exit 0 ; durée 1,13 s | VALIDÉ : les 53 existants plus 41 nouveaux ; transport fournisseur simulé. Ce temps CLI n’est pas comparable directement à une suite plus petite. |
| Configuration | R04 | 78 tests, aucun skip, exit 0 | VALIDÉ : configuration locale et conservation des nouveaux réglages. |
| Audit npm | R05 | info/low/moderate/high/critical/total : 0 ; exit 0 | VALIDÉ : audit npm de cette arborescence de dépendances, pas une certification du code ou du fork privé. |
| Politique audit / fork | R06 | 9 tests, aucun skip, exit 0 | VALIDÉ : contrôles existants, notamment compatibilité/bornes du fork ; pas une revue indépendante de ce fork. |
| Environnement | V04 | 121 noms canoniques, 48 plateforme, 995 fichiers balayés, exit 0 | VALIDÉ à cette exécution. Le balayage ne vaut pas validation fonctionnelle. |
| Documentation | V05 | 183 fichiers Markdown balayés, exit 0 | VALIDÉ à cette exécution, antérieure au document de revue final ; les contrôles de clôture sont séparés. |
| Clôture diff/environnement/docs | C01/C02/C03 | exit 0 ; 121 noms canoniques, 48 plateforme, 995 fichiers balayés ; 184 Markdown | VALIDÉ sur le lot de clôture. |
| Corpus avant/après | V06 | 12/27 → 27/27, exit 0 | VALIDÉ : uniquement corpus de régression ciblé et étiqueté manuellement. |
| TypeScript global | V07 | exit 2 ; clients Prisma desktop/serveur absents et erreurs de typage en cascade, dont paramètres implicites dans les routes | BLOQUÉ pour certification globale ; la commande a effectivement échoué. Aucun client factice ni exclusion ajoutée. |
| TypeScript après réinstallation JS propre | C04 | exit 1 ; 225 diagnostics, dont clients Prisma absents, paramètres implicites et erreurs de propriétés | BLOQUÉ pour validation globale ; origine exhaustive des diagnostics non triée, ne pas affirmer que tous disparaîtront après génération. Aucun type factice ajouté. |
| Prisma generate | `prisma-generate.log` | exit 1, téléchargement du checksum `schema-engine.sha256` interrompu avant TLS | BLOQUÉ : moteur officiel Prisma 5.22, commit `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, plateforme `debian-openssl-3.0.x`, hôte binaries.prisma.sh. Aucun contournement TLS/checksum. |
| Intégrations Copilote | `integration.log` | exit 1, 6 suites en échec d’amorçage ; 51 tests marqués skipped par Vitest | BLOQUÉ : ce ne sont ni 51 succès ni 51 skips volontaires. Moteurs Prisma indisponibles, aucun scénario exécuté ; le nouveau test comporte six scénarios. |
| Build standard, budget JS et démarrage complet | Prérequis Prisma manquant | Non exécutés | BLOQUÉ : ne pas confondre tests purs/ESLint avec build ou démarrage réel. Budget JS 3 625 984 octets inchangé, pas mesuré à nouveau. |
| Navigateur, vraie session/licence, PostgreSQL et Anthropic réel | Pas d’environnement adéquat ni de clé fournie ; api.anthropic.com hors des hôtes réseau autorisés | Non exécutés | BLOQUÉ : pas de preuve inventée de connexion, de coûts, de qualité modèle ou de livraison métier. |

### Comparaison locale reproductible

Commande : `node scripts/evaluate-copilot.cjs 4f19f77891debc6009a1c241d2689f2a42bca0e8`.

V06 a été lancé sans argument, avec ce même SHA par défaut. Le script lit les sources de baseline depuis Git sans changer de branche et exécute uniquement du code local/committé de confiance via le compilateur TypeScript déjà installé. Ce n’est pas un outil accessible au modèle ou à une route HTTP. Il faut disposer du commit dans le clone ; il ne télécharge aucun code ni paquet.

V06 : 27 demandes choisies pour couvrir les intentions existantes, aide, références de dossier, contexte et gardes ajoutées ; 25 répétitions par demande, 675 mesures par variante. Résultat de catégorie attendu : **12/27 avant, 27/27 après**. Corpus construit pendant le développement, pas un jeu aveugle indépendant ni une mesure universelle de compréhension.

| Routage chaud local seulement | Avant | Après |
|---|---:|---:|
| Médiane | 0,018784 ms | 0,062933 ms |
| p95 | 0,039714 ms | 0,107638 ms |

**Pas de gain de latence démontré** : les vérifications et l’aide ajoutent un petit coût local. Compilation/imports, base, authentification, navigateur, réseau et modèle exclus ; ne pas annoncer ces chiffres comme latence utilisateur. Le gain observé est la couverture de ce corpus, pas une accélération ou une intelligence générale.

## Limites restantes et prérequis

1. **BLOQUÉ** : autoriser/rendre accessible le téléchargement officiel vérifié des moteurs Prisma, générer les deux clients, puis relancer TypeScript, intégrations SQLite/PostgreSQL, build standard, budget et navigateur avec session/licence de test autorisée. Aucun accès de production requis ou utilisé ici.
2. **BLOQUÉ** : pour valider le modèle réel, environnement réseau autorisant Anthropic et clé fournie via le mécanisme de secrets approuvé, après décision confidentialité/coût. Ne jamais transmettre une clé dans le chat. Le modèle par défaut n’est pas une preuve qu’il est accessible à ce compte.
3. **PARTIELLEMENT VALIDÉ** : les droits financiers, redactions et écusson historiques restent dans le code ; leurs tests d’intégration sont conservés mais ne sont pas validés sur ce candidat faute de moteurs. Certaines permissions héritées ne passent pas toutes par une nouvelle matrice unifiée ; ce patch ne revendique pas un audit d’autorisation de toutes les routes.
4. **EN ATTENTE DE REVUE** : relecture fonctionnelle du corpus applicatif, contrôle navigateur des courses annulation/réinitialisation et de l’accessibilité/traduction des nouveaux libellés. Une ancre existante ne garantit pas le sens d’une explication.
5. **PARTIELLEMENT VALIDÉ** : recherche limitée aux interventions, plaques SIV/noms, résultats bornés ; pas une recherche exhaustive de clients, documents, FNI ou VIN. Pas encore de clarification interactive avancée d’homonymes, ni de politique de timeout/annulation SQL universelle. L’abandon du fetch n’annule pas forcément une requête serveur déjà reçue.
6. **PARTIELLEMENT VALIDÉ** : pas de diagnostic certain d’un véhicule, de raisonnement général évalué, de planification autonome multi-outils ou de prise en charge de périodes arbitraires. Les résolveurs historiques conservent leur période affichée ; aucune parité ChatGPT revendiquée. Le GET est un instantané, pas une supervision continue de toutes les dépendances.
7. **EN ATTENTE DE REVUE** : budget financier, métriques de coûts/latence réseau, évaluation aveugle plus large, rétention contractuelle fournisseur et observabilité opérationnelle à définir avant activation. Pas de fine-tuning ni mémoire persistante : pas d’apprentissage non consenti.
8. **PARTIELLEMENT VALIDÉ** : les critères globaux antérieurs de sécurité/publication ne sont pas clôturés par cette livraison ; zéro npm ne résout ni les alertes de la branche principale précédemment observées, ni toutes les analyses sémantiques/SAST ou gates distantes. Les anciens rapports/proofs restent intacts.

## Décision

Socle amélioré et vérifié localement sur les contrôles exécutables, **pas livraison de l’intégralité de l’objectif d’un assistant généraliste autonome**. La mise en production est refusée tant que les intégrations, build, budget, licence/session réels et conditions d’activation fournisseur obligatoires restent ouverts. Aucune publication sans nouvelle autorisation.
