<!-- doc-numbers: journal -->

# Investigation complémentaire FUP — 14 octobre 2026

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.** Suivi autonome ; les rapports et preuves antérieurs restent inchangés. Ce premier état publie une collecte de métadonnées Gitleaks, pas une clôture de sécurité.

## A. Réconciliation et décision

Départ propre sur arena/c9eaae15-garageflowsv2, HEAD et distant 77558ca7dad4ed145aa7a58cf6ef7b31a325d7cd. Push initial : Everything up-to-date. Autorisation explicite utilisateur de mise à jour avant/après cette investigation ; aucune autorisation main/PR, release, force push, rotation ou déploiement. Toutes les empreintes du manifeste au départ vérifiées ; copie nommée EVIDENCE-SHA256-at-77558ca.jsonl conservée.

Les CI source c53d8e5 (38581782030) et documentaire 77558ca (38583146598) sont toutes deux terminées en failure : scan Gitleaks/Required validation échoués, trois jobs de contrôle réussis, recette authentifiée/Windows/release complète skipped. Aucun succès transmis d’un commit à l’autre. Les réponses complètes horodatées sont dans evidence/ci-{source,documentary}.log.

## B. P0 Gitleaks — FUP-009/008/020

Statut **ÉCHOUÉ** du contrôle distant, accès détaillé **BLOQUÉ** : nouvel essai de récupération des logs par gh sur 77558ca, avec query strings supprimées avant tout enregistrement ; voir external-access.json. Ne pas interpréter le précontrôle de trois familles comme un scan Gitleaks.

Amélioration de collecte : scripts/gitleaks-ci.cjs conserve le binaire officiel, le périmètre dir/config/redact et le code négatif. Rapport temporaire expurgé dans un répertoire 0700, sortie enfant jamais imprimée, projection exclusivement règle/chemin/lignes/commit/scope. Annotations notice pour métadonnées non triées ; le job reste en échec sur exit1, aucun finding n’est ignoré. Suppression du seul répertoire temporaire possédé. Échec fermé sur rapport absent/incohérent, JSON invalide, interruption, erreur système. Caractères de workflow échappés. Quatorze tests unitaires du collecteur passent ; il ne s’agit PAS d’un scan officiel local. Le JsonReporter v8.24.3 officiel confirme l’encodage JSON d’une slice nil en null, pris en charge sans transformer exit1 en succès. La CI doit encore confirmer le comportement réel et les limites d’annotations.

## C. P0 Dependabot — FUP-026

Accès détails retenté en lecture seule ; HTTP403 (external-access.json). Aucun paquet/plage/exploitabilité des 151 alertes annoncé. Compteur historique main distinct de l’audit npm de branche. main récupérée pour comparaison en lecture seule, sans checkout/merge. Export expurgé ou permission Dependabot alerts read requis ; aucune clé ni jeton dans le chat.

## D. Régressions et Prisma

Vrais tests locaux réexécutés : backup réel SQLite/FS 10/10 ; suite ciblée crypto/redaction/sauvegarde/crash réussie (totaux exacts dans corrections-regression.json). Trois échecs SQLite reproduits dans sqlite-reproduction.json : échec du checksum/moteur officiel Prisma, pas un succès de persistance. Une vérification statique réussit dans le même fichier ; aucun mock de moteur. Le résultat global historique 3829/2982 pass/3 fail/844 skips/4 erreurs est une exécution distincte et n’est pas recalculé en additionnant ces relances. Lint et type-check réussis ; test:release-safety renforcé avec le collecteur, réussi.

## E. Travaux indépendants et preuves

Triage/parser Semgrep, comparaison main, revue manuelle et réconciliation des skips poursuivis dans cette investigation. Le budget reste 3625984 octets ; ni build officiel ni paquet Windows ni issuer/staging ne sont validés. Les résultats approfondis et la matrice courante seront ajoutés sans réécrire les résultats historiques. commands.jsonl capture argv, versions référencées, heures UTC/Paris, HEAD, état de travail et codes propres à chaque contrôle. external-access.json distingue les codes des accès externes du succès de collecte de leur diagnostic. Les manifestes ne certifient pas la sécurité intrinsèque des contenus.

Premier contrôle consistency : ÉCHOUÉ car la nouvelle lecture du SHA fourni par GitHub n’était pas déclarée dans le registre canonique. GITHUB_SHA ajouté précisément à platformProvided (pas une exemption de fichier/règle). Les deux lignes vides finales des journaux types/lint sont conservées telles quelles : le contrôle whitespace initial retourne2, pas0 ; aucune preuve normalisée pour cacher ce résultat.

## F. Nouvelle exécution 3870736 — ne pas confondre avec les deux précédentes

Run38587226456 terminé en échec. Cette fois **Install gitleaks échoue avant le scan**, qui est skipped : aucune annotation de finding n’a été produite, le collecteur réel n’est donc pas encore validé. Cause réseau/permission/checksum non déterminée faute de logs détaillés. E2E responsives échouent aussi, après installation Chromium et préparation SQLite réussies ; pas de régression métier attribuée sans preuve. FUP-003/009 restent ouverts. Réponse complète ci-collector-final.log et liste d’annotations vide conservées.

Prochaine correction de robustesse/diagnostic : installation du même binaire vérifié sous RUNNER_TEMP plutôt qu’un répertoire système ; annotations HTTP/exit par téléchargement, checksum conservé, aucun retry aveugle ni bypass TLS. Cela évite une dépendance aux droits système sans affirmer qu’elle était la cause du premier échec. Inventaire de findings annoncé en annotation pour pouvoir réconcilier la pagination API. Les tests du collecteur restent14/14 et test:release-safety51/51.

Comparaison main e3ac5f5a55284906531dcc5d4a620cb0ff072313 effectuée en lecture seule ; audit npm du snapshot de manifestes : 50 alertes de paquets (2critical/34high/13moderate/1low), exit1. Ce n’est pas l’export des151 alertes Dependabot et aucune identité de compte n’est supposée. Audit npm de la branche courante :0, exit0. Pas d’installation de main, pas d’exécution de ses scripts.
