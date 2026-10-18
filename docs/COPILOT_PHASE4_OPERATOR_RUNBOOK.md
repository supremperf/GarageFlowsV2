<!-- doc-numbers: journal -->
# Phase 4 — déblocage natif et essai réel, réservé à l’opérateur autorisé

**BLOQUÉ / NON PRÊT POUR LA PRODUCTION — 15 octobre 2026, Europe/Paris.**
Ce document n’est ni un consentement payant ni une autorisation de déploiement. Ne jamais fournir une clé ou un DSN dans le chat, les arguments CLI, Git ou un rapport public.

## 1. Diagnostic Prisma sans contournement

Exécuter `node scripts/diagnose-prisma-runtime.cjs`. Il ne charge aucun profil privé, ne télécharge/exécute aucun moteur, ne désactive pas TLS et n’affiche que la présence des réglages. Conserver son code de sortie, même nonzero.

Constat F03/F16/F17/F20 : Node 22.22.3, OpenSSL Node 3.5.6, Linux x64, `prisma` et `@prisma/client` **5.22.0**, commit moteur `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, cible `debian-openssl-3.0.x`. DNS résout les deux hôtes ; registry.npmjs.org répond HTTP 200 avec TLS autorisé ; binaries.prisma.sh produit ECONNRESET **avant établissement TLS**, aucun statut HTTP. Cela ne démontre pas une erreur de certificat. Aucun moteur présent.

L’administrateur réseau doit permettre HTTPS/443 vers **binaries.prisma.sh**, distribution officielle nécessaire, notamment :

```
https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/schema-engine.sha256
https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256
```

Les variantes non compressées et les fichiers associés doivent aussi être accessibles au générateur officiel. Le composant exact qui coupe la connexion n’est pas identifiable depuis ce sandbox. Ici le domaine ne fait pas partie des sorties autorisées. Vérifier la politique réseau/proxy avec l’administrateur ; ne pas contourner l’egress. Les autorités supplémentaires éventuelles relèvent d’une politique d’entreprise vérifiée, pas d’une CA arbitraire.

**Interdit** : `NODE_TLS_REJECT_UNAUTHORIZED=0`, ignorer le checksum manquant, moteur trouvé sur un miroir non approuvé, changer Prisma majeur pour esquiver le problème, `--no-engine` présenté comme génération native, copier les déclarations diagnostiques de phase 3 dans le projet. Ces déclarations externes ne sont d’ailleurs pas restaurées ici.

## 2. Reprise standard après restauration de l’accès

Dans un environnement de test autorisé, Node conforme à package.json, dépendances exactes du lock, bibliothèques système OpenSSL/glibc compatibles, schémas et réglages SQLite/Postgres approuvés :

```sh
npm ci
node scripts/diagnose-prisma-runtime.cjs
npx prisma generate
npx prisma generate --schema prisma/server/schema.prisma
npx tsc --noEmit --pretty false
npm run build
npm run check:perf-budget
npx vitest run src/lib/copilot/__tests__ src/lib/copilot-llm/__tests__
node --test tests/copilot-phase4-evaluation.test.cjs
npm run test:config
npm run test:audit
npm run test:release-safety
```

Conserver chaque exécution et son exit séparément ; ne pas chaîner avec une opération qui masque un échec. Le budget JS reste **3 625 984 octets**. L’installation F01 avec `--ignore-scripts` ne constitue pas cette installation/génération standard.

Puis les **six suites natives**, dont les helpers utilisent des fixtures de test isolées :

```sh
npx vitest run src/integration/copilot-conversation.test.ts src/integration/copilot.test.ts src/integration/copilot-ecusson-verifie.test.ts src/integration/copilot-financial-authz-v15.test.ts src/integration/copilot-cout-achat.test.ts src/integration/copilot-portee-et-porte-financiere.test.ts
```

Relire préalablement les helpers et cibles de test. Ne jamais injecter un DSN de production ; aucun reset/migration destructive de données utilisateur n’est autorisé par ce protocole. Une assertion ignorée après setup échoué reste **SKIPPED/SETUP_FAILED**, pas PASS. Les tests licence/issuer réels, l’ensemble de la CI normale et les autres intégrations restent des gates distincts.

Après un vrai build seulement : `npm run start -- --hostname 0.0.0.0 --port 4028`. Vérifier une session/licence normale, GET `/api/copilot`, puis POST ; aucune simulation d’authentification/readiness. Mesurer écoute, operational et première réponse vérifiée séparément. Les échecs F24 ne sont pas des mesures de démarrage réussi.

## 3. Anthropic : autorisation, confidentialité et budget obligatoires

Aucun appel réel effectué ni autorisé dans cette phase. Demander au responsable : modèle exact, environnement/données exclusivement synthétiques, politique de confidentialité/rétention fournisseur, maximum d’appels et montant EUR, limites d’entrée/sortie, référence tarifaire et conversion EUR conservatrices approuvées. **Ne pas demander la clé dans le chat.** Le secret est injecté côté serveur par le dispositif approuvé. Ne pas envoyer de conversation réelle pour entraînement.

Il faut aussi autoriser l’egress HTTPS officiel vers `api.anthropic.com`, actuellement absent de l’allowlist de ce sandbox. Ne pas effectuer un appel « pour vérifier » avant consentement. Aucun budget, prix courant ou modèle disponible n’est inventé ici.

Préparation sans réseau/paiement :

```sh
node scripts/evaluate-copilot-phase4.cjs --verify-freeze
node scripts/evaluate-copilot-phase4.cjs --preflight
```

Le responsable prépare **hors Git**, avec permissions restreintes, un manifeste JSON strict avec ces champs (pas de valeurs d’autorisation fictives fournies ici) :

- `authorizationId`, `approvedAt` (ISO avec timezone), `model` exact ;
- `maxCalls` entier 1..48 et `maxSpendEur` positif ;
- `maxInputTokensPerCall` entier <=200000, `maxOutputTokens` exactement **512** ;
- `inputEurPerMillion`, `outputEurPerMillion` et `pricingReference` issus du tarif/conversion approuvés.

Le manifeste/flag est une garde technique, **pas la preuve d’un consentement humain**. Garder cette preuve dans le système approuvé. Pour l’unique exécution autorisée, avec GARAGEFLOW_LLM=anthropic, ANTHROPIC_API_KEY et modèle injectés côté serveur :

```sh
node scripts/evaluate-copilot-phase4.cjs --live --approve-paid --max-calls=<plafond_approuve> --approval=<chemin_prive_du_manifeste>
```

Les chevrons sont des paramètres à renseigner, pas une commande à lancer telle quelle. Le runner refuse sans toutes les préconditions, vérifie le modèle et le plafond, réserve le pire coût estimé **avant** chaque appel et consomme atomiquement le manifeste par un fichier `.consumed`. Pas de retry, deuxième appel de repli ou reconstitution automatique du budget. Une panne consomme quand même le grant ; ne pas supprimer le marqueur pour relancer. Toute nouvelle campagne/augmentation exige un nouveau consentement.

L’estimation d’entrée utilise les octets UTF-8 des messages +4096 tokens d’allocation de protocole, sans appel payant de comptage. Elle est conservatrice pour le texte de ce protocole, pas une facture universelle garantie pour d’autres fonctionnalités. Aucun cache payant, image ou outil fournisseur activé. Les tokens de `usage`, quand présents, donnent un coût **estimé aux tarifs approuvés**, pas une facture réconciliée ; usage absent = coût inconnu, pas zéro.

## 4. Mesurer sans confondre les niveaux

Le corpus figé de 48 cas est distinct du développement, mais rédigé par le même auteur : **pas un holdout humain/statistique indépendant**. Ne pas modifier les golds après lecture des résultats. Ne pas importer ces cas dans les tests de développement. Pour une future correction guidée par ses échecs, le requalifier explicitement en développement et créer un nouveau holdout externe avant de conclure.

Le runner fournit mode, intention IR quand disponible, validité du plan, outils, paramètres, permissions structurelles, confirmations, latence et métadonnées techniques/token uniquement. Ne pas compter un repli local ou un appel évité par une garde comme compréhension réelle du modèle. `valid_json_contract` n’est pas un jugement sémantique. Les contraintes vérifiées sont celles du contrat compilé ; leur compréhension naturelle nécessite une annotation humaine indépendante.

Il ne lit aucune base, ne vérifie pas de faits métier ni la pertinence de la réponse finale. Pour cela, suivre également le niveau B de `COPILOT_PHASE3_MODEL_PROTOCOL.md` : deux garages synthétiques avec référence identique, états mutables entre tours, OWNER/MANAGER/RECEPTIONIST/rôle invalide, prix/coûts/notes/contacts, injections dans les données récupérées, timeout/annulation, erreurs de lecture, confirmations/formulaires et relecture SQL indépendante. Vérifier les contenus réellement renvoyés et les traces, pas seulement un schéma ou un nom d’outil. Les anciennes réponses ne sont jamais un oracle.

## 5. Critères de clôture

Zéro fuite tenant/permission/secret, zéro écriture du chat ; faits annoncés seulement après backend confirmé ; toutes les erreurs conservées. Seuils qualité/latence/coût définis avec l’évaluateur externe **avant** essais. Aucun label production tant que génération/typecheck/build/budget/native/startup et gates de sécurité/CI obligatoires restent ouverts. Aucune publication de clé, DSN, réponse privée ou journal brut non revu.
