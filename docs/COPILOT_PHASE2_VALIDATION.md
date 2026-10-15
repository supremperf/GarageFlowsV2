<!-- doc-numbers: journal -->
# GarageFlows — validation de l’intelligence, phase 2

15 octobre 2026, Europe/Paris. **PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Branche : `arena/c9eaae15-garageflowsv2`. HEAD : `bd05cd521917cc059fc21780d1b562c020534942`. Travail local non commité/non publié ; PR 9 concerne la phase 1, pas ces changements. Aucun push, déploiement, appel payant, entraînement, secret fournisseur créé ou migration métier effectué.

## 1. Décision et critères ouverts

| Périmètre | Statut | Signification exacte |
|---|---|---|
| Non-régression des 94 tests Copilote antérieurs | VALIDÉ | Inclus dans P36 : 144 réussis, 7 fichiers. Tests purs/transport simulé. |
| Contrats de planification, autorisation, sélection documentaire, exécuteur | PARTIELLEMENT VALIDÉ | 44 tests ajoutés + 6 transport ; lecteurs/sondes simulés dans ces unités, pas SQL réel. |
| Configuration et politique de dépendances | VALIDÉ sur les tests exécutés | P33 : 78 ; P34 : 9 ; aucune activation implicite. Pas preuve d’un vrai émetteur de licence, accès Neon/Vercel ou poste Windows. |
| Dépendances npm | VALIDÉ pour la réponse audit conservée | P25 : zéro alerte toutes sévérités, arbre complet déclaré ; pas sécurité universelle. P40 confirme zéro toutes sévérités (807 dépendances), exit 0, 0,623 s. |
| Prisma / installation native | BLOQUÉ | Hôte officiel inaccessible avant TLS ; aucun moteur ni client natif obtenu. P20 est une installation JS avec scripts désactivés, pas npm ci normal. |
| Six suites d’intégration Copilote | BLOQUÉ au setup | P14 exit 1, 54 tests skipped, aucune assertion native validée. |
| Typecheck global | ÉCHOUÉ | P38 exit 2, 225 diagnostics ; types clients absents et erreurs en cascade, dont lecteurs Copilote. Pas de déclaration de réussite partielle du typecheck. |
| Build standard / budget JS | BLOQUÉ / ÉCHOUÉ | P15 build exit 1 à Prisma ; P16 budget exit 1 car .next/static absent. Plafond 3 625 984 octets inchangé. |
| Démarrage complet / navigateur licencié / PostgreSQL / packaging | BLOQUÉ ou NON EXÉCUTÉ | Aucune preuve phase 2 d’un démarrage opérationnel, aucun ORM factice substitué. |
| Qualité réelle du modèle / coût / latence bout en bout | NON VALIDÉ | Aucun appel Anthropic réel autorisé ; benchmark de développement, pas supériorité générale. |
| Publication et CI du candidat | NON EXÉCUTÉ | Sans autorisation nouvelle. La CI publiée de phase 1 contient déjà des échecs obligatoires. |

Les critères obligatoires restants empêchent de clore la mission comme « terminée/production ». Ce rapport livre le travail faisable et les preuves, sans transformer les blocages en réussite.

## 2. Changements exacts et architecture conservée

La phase 1 n’a pas été remplacée : routeur, intents, actions, moteurs de facturation/marge/stock/prévision/VIN/diagnostic, protections session/licence/garage, configuration et formulaires sont réutilisés. Aucun changement package.json/package-lock.json, schéma Prisma, migration, dépendance, budget, workflow obligatoire ou API d’écriture.

- **`tools.ts`** : catalogue fermé, 12 lectures et 5 transferts vers les outils existants. Paramètres Zod stricts, droits RBAC, données accessibles, erreurs, confirmation et vérification. Aucun accès SQL/code/HTTP général ou garage fourni par le modèle. Validation du plan entier avant le premier appel et revalidation au dispatch.
- **`planning.ts`** : union stricte read/help/handoff/clarify/out_of_scope ; maximum trois lectures indépendantes, pas d’itération dépendant des résultats. Le modèle ne produit ni paramètres métier ni faits. Références/VIN/symptômes reliés au texte utilisateur local, périodes non supportées clarifiées, ambiguïtés/doublons rejetés. Garde des périodes des anciennes questions conservée dans les suivis contextuels.
- **`conversation.ts`** : `understandLocal` garde le fonctionnement historique. Orchestration facultative de plans, documentation autorisée, variantes locales et demandes composées ; repli local honnête. Priorité aux gardes de secrets/acquiescement et aux propositions explicites existantes. Une proposition du modèle n’est jamais un consentement.
- **`references.ts`** : extraction historique des références déplacée/réexportée, pas nouvelle capacité d’accès à des identifiants arbitraires.
- **`execution.ts`** : schémas/RBAC avant tout appel, erreurs/délais/résultats non confirmés distincts ; données rendues seulement après retour completed + ancrage + payload. Observations par outil avec durée et date si fournie par le lecteur ; réalisé/estimation/piste/décodage séparés. « Vérifié » signifie résultat du lecteur/moteur contrôlé, pas certitude médicale ou vérité sémantique indépendante.
- **`server-readers.ts` / route API** : lectures et helpers existants extraits ; permissions centralisées au dispatch. Calculs conservés. Libellé de marge corrigé : subMonths(today, 1) est un mois glissant depuis une date, pas exactement trente jours. Receipt d’égalité textuelle des deux helpers monthlyRevenue/stockReport conservé séparément ; ce n’est ni l’égalité de tous les résolveurs ni une validation SQL. POST conserve taille réelle du corps, schéma, session/licence, garage serveur, limite 60/min et porte financière.
- **`readiness.ts` / GET** : connaissances/catalogue validés une fois à l’import, sans entraînement/index téléchargé. Sonde réelle scoped garage et ressources autorisées du rôle (interventions, mécaniciens, pièces/consommation, devis, factures/lignes), colonnes requises sélectionnées ; aucune donnée de sonde exposée/cachée. GET authentifié no-store, HTTP 503 si dépendance essentielle non confirmée ; état facultatif du modèle séparé. Sonde SQL native ajoutée mais non validée en exécution ici.
- **`copilot-llm/{types,prompts,provider}.ts`** : méthode plan facultative ; endpoint Anthropic fixe, sortie JSON strictement validée. Corps utilisateur non fiable, instructions/catalogues serveur. classify et helpers existants conservés, fournisseur de production sans phrase/complete : pas de génération libre de faits métier.
- **`CopilotPanel.tsx`** : disponibilité à l’ouverture, erreur de sonde explicite, repli local et traces de chaque lecture ; reset/annulation et boutons de confirmation conservés. Présentation revue statiquement/lintée ; rendu navigateur phase 2 non validé.
- **`knowledge.ts`** : treize articles conservés, version 2026-10-15.2, ancres mises à jour après extraction des lecteurs.
- **Tests/scénarios/scripts** : 44 unités planification/exécution, 6 transport simulé ; trois assertions natives supplémentaires et disponibilité actualisée ; 68 scénarios de développement, ancien benchmark 27 conservé, diagnostic Prisma en lecture seule.
- **Manifeste/template/document d’environnement et guides actifs** : wording de planification/confidentialité seulement. Toujours 121 variables canoniques, 8 alias interdits, 48 plateforme ; aucun réglage ajouté ni secret activé. Rapports historiques non réécrits.

L’inventaire exhaustif des fichiers, SHA-256, plages et profondeur de revue est `COPILOT_PHASE2_REVIEW.json`. Une lecture/diff/empreinte ne remplace pas la validation fonctionnelle. Les empreintes changées invalident la revue correspondante.

## 3. Catalogue effectif

Tous les appels supposent une session licenciée et le garage de la session ; le modèle ne choisit pas le tenant. Les rôles effectivement autorisés au catalogue sont OWNER/MANAGER/RECEPTIONIST, plus le droit indiqué ; MECHANIC/UNKNOWN ne reçoivent pas ces lectures générales.

| Outil | Paramètres effectifs | Droit | Source et vérification |
|---|---|---|---|
| pending_quotes | aucun | quote:manage | Devis sent du garage, 50 max ; numéro/client/ancienneté. |
| today_revenue | aucun, aujourd’hui fixe | financial:read | Factures paid/issueDate du jour ; billing HT depuis lignes persistées, pas date de paiement arbitraire. |
| margin | aucun, mois glissant fixe | financial:read | Factures/pièces depuis subMonths(today,1), moteur profitability ; période annoncée. |
| late_vehicles | aucun, aujourd’hui fixe | job:manage | Interventions non completed, retard déclaré ; ne prouve pas sa cause. |
| low_stock | aucun | job:manage | Moteur stock-forecast, 20 plans rendus ; coûts retirés sans droit financier. |
| available_mechanics | aucun | job:manage | isAbsent=false ; pas une réservation/disponibilité de créneau. |
| top_clients | aucun | financial:read | Factures paid, billing, cinq agrégats max. |
| proactive | aucun | job:manage | Stock urgent et compte des devis sent ; aucune commande exécutée. |
| forecast_revenue | aucun, prochain mois fixe | financial:read | Douze mois de factures, moteur forecast ; estimation distincte du réalisé. |
| diagnostic | text <=500, obdCode optionnel extraits localement | session/catalogue | Moteur local, pistes possibles ; demande un symptôme utile. |
| vin_decode | VIN explicite, 17 caractères valides | session/catalogue | Moteur VIN existant, champs inconnus non inventés. |
| job_search | référence locale 2..60 | job:manage | Nom/plaque explicites ; cinq résultats + hasMore ; pas notes/contacts/prix, relecture à chaque tour. |
| create_appointment | aucun champ métier | job:manage | Proposition, confirmation UI puis formulaire /jobs ; pas POST du chat. |
| create_quote | aucun champ métier | quote:manage | Confirmation puis Facturation /quotes ; validation serveur existante. |
| send_reminder | aucun champ métier | customer:manage | Confirmation puis outil existant /notifications/dispatch ; aucune preuve d’envoi dans le chat. |
| order_parts | aucun champ métier | stock:manage | Confirmation puis outil /purchase-orders ; pas commande automatique. |
| generate_report | aucun champ métier | financial:read | Confirmation puis outil /reports ; résultat à vérifier après réponse serveur. |

Descriptions exactes d’accès, schémas, erreurs et règles de vérification dans TOOLS. Erreurs possibles : forbidden/invalid_input/invalid_plan, indisponibilité/délai/non confirmé ; pour recherche, vide/homonyme/précision ; pour transferts, confirmation/formulaire indisponible. Ne pas assimiler ouvrir un formulaire à enregistrer/envoyer une opération.

## 4. Contexte, startup et limites de temps

Six anciennes questions utilisateur sont conservées en RAM dans le panneau ; pas de résumé métier durable. Tests de référence sur plusieurs tours, pronoms en milieu de phrase, changement de sujet, historique contradictoire et référence sortie de fenêtre : relecture ou clarification, jamais ancien résultat pris comme fait. Le résumé temporaire transmis au planificateur contient uniquement thèmes autorisés et présence/ambiguïté de paramètres. Pas texte historique, valeur de référence historique, résultats ni actions confirmées. La question courante peut contenir des données personnelles : opt-in et politique fournisseur à valider avant activation. Filtre des secrets non exhaustif.

- Fournisseur : 2 500 ms, 16 KiB en flux, aucun retry automatique, circuit 30 s après erreur, succès considéré périmé après 5 minutes.
- Orchestrateur modèle : 3 000 ms, confiance >=0,75 **non calibrée** ; 512 tokens par plan (128 historique classify), coût réel non mesuré.
- Exécuteur : 3 500 ms **par lecture**, borne serveur <=5 000 ; trois lectures séquentielles peuvent donc cumuler 10,5 s, auxquelles s’ajoutent planification/auth et autres étapes. Ce n’est pas un SLA global 3,5 s.
- Sondes essentielles : 1 000 ms ; signal/timeout ne prouve pas l’annulation SQL native. Lecteurs Prisma ignorent le signal d’annulation : une requête déjà lancée peut continuer. Aucun appel suivant après timeout/abort de l’exécuteur.
- Snapshot GET : pas surveillance continue, ni preuve du prochain appel, ni de toutes les fonctions/services de GarageFlows. Lectures non atomiques ; facts peuvent évoluer entre deux observations.
- Initialisation locale unique par chargement de module/processus ; état modèle initializing/ready/degraded/unavailable. Pas sonde facturée ni promesse de disponibilité modèle sans résultat structuré récent.

## 5. Résultats et performance — ne pas mélanger les exécutions

Derniers contrôles du code final :

| Preuve | Commande | Exit / résultat | Temps mural |
|---|---|---|---|
| P36 | npx vitest run src/lib/copilot/__tests__ src/lib/copilot-llm/__tests__ | 0 ; 144/144, 7 fichiers, Vitest 3,13 s | 4,319 s |
| P37 | npx eslint src/lib/copilot src/lib/copilot-llm src/app/api/copilot/route.ts src/components/CopilotPanel.tsx src/integration/copilot-conversation.test.ts | 0, périmètre ciblé seulement | 3,467 s |
| P38 | npx tsc --noEmit | 2 ; 225 diagnostics | 6,832 s |
| P33 | node --test tests/config.test.cjs tests/config-full.test.cjs | 0 ; 78/78 | 2,403 s |
| P34 | npm run test:audit | 0 ; 9/9 | 1,192 s |
| P35 | node scripts/check-env-consistency.mjs | 0 ; contrat conforme | 0,789 s |
| P20 | npm ci --ignore-scripts --no-audit --no-fund | 0 ; 729 packages, installation JS seulement | 12,588 s |
| P40 | npm audit --json | 0 ; zéro info/low/moderate/high/critical, total 807 dépendances déclaré | 0,623 s |
| P39 | npm run check:docs && node scripts/check-env-consistency.mjs && git diff --check | 0 ; docs, environnement et diff conformes à cette exécution | 0,622 s |
| P14 | six suites natives (commande exhaustive dans le registre) | 1 ; setup échoué, 54 skipped | 22,727 s |
| P15 | npm run build | 1 ; téléchargement checksum Prisma | 3,722 s |
| P16 | npm run check:perf-budget | 1 ; .next/static absent | 0,323 s |
| P26 | node scripts/diagnose-prisma-runtime.cjs | 1 ; host officiel inaccessible avant TLS | 0,166 s |

P38 contient neuf implicit-any dans les lecteurs déplacés et des erreurs globales de clients Prisma absents. Aucun diagnostic des autres fichiers Copilote/Panel à cette exécution ; **cela ne valide pas globalement ces fichiers** ni leur intégration avec les types clients générés. Lint global, suite entière et packaging candidat non exécutés ; pas de substitution par un lint ciblé.

P11 a réellement échoué : 141 pass / 1 fail, mauvaise période CA. Correction et réexécutions P12 puis P21/P28/P36 réussies ; échec conservé. Dépréciations de dépendances dans P20 et avertissement Vite configLoader/native dans les unités conservés, pas masqués. Politique P34 comprend 4 653 sorties de compatibilité fork/upstream et chargement réel Sharp ; risque/maintenance du fork préexistant non annulés par ce succès.

### Benchmark élargi P30, baseline bd05cd5 → candidat local

| Strate | Avant | Après |
|---|---:|---:|
| 50 requêtes sans planificateur | 35/50 | 50/50 |
| 18 réponses de planificateur scriptées | 9/18 | 18/18 |
| Ensemble de développement | 44/68 | 68/68 |
| Médiane chaude understand/plan | 0,063844 ms | 0,096852 ms |
| p95 chaude understand/plan | 0,146712 ms | 1,428409 ms |

15 répétitions/cas, 1 020 échantillons/version ; temps mural P30 2,419 s. Quatre compteurs structurels à zéro dans les deux versions : payload factuel prématuré, confirmation absente, plan retourné invalide, erreur inattendue (68 demandes évaluées). Ces compteurs **ne mesurent pas** le taux sémantique d’hallucination ou la pertinence humaine.

Cas simples, ambiguïtés, fautes/langage familier, composés, multi-tours, références, longue fenêtre, périodes, droits, données manquantes/contradictoires, injections, hors périmètre, modèle indisponible/score bas et transfert contrôlé. Unités distinctes : transport/abort/circuit, lecteur non vérifiable, timeout et startup local avec sonde simulée. Pas de benchmark complet SQL/HTTP/navigateur à froid ; pas de disponibilité en production mesurée. La réponse scriptée est donnée par construction : réussite ne prouve pas que le vrai modèle la choisirait. Corpus de développement, pas jeu de validation indépendant.

**Ancien corpus P29** : 27/27 conservés, comparaison à une baseline plus ancienne `4f19f77891debc6009a1c241d2689f2a42bca0e8` (12/27). 675 échantillons/version ; médiane avant/après 0,016702/0,070307 ms, p95 0,036055/0,180753 ms ; mural 1,853 s. Ne pas attribuer 12→27 à la seule phase 2. P29/P30 précèdent seulement le libellé de marge et l’assertion observedAt ; fonctions de sélection évaluées inchangées depuis ces mesures. Les timings historiques P23 restent séparés.

## 6. Prisma : cause, preuve et résolution sûre attendue

P01 curl exit 35, P03 generate exit 1, P14/P15 même échec ; P26 diagnostic Node confirme : DNS résolu, connexion interrompue **avant TLS** (ECONNRESET), aucun statut HTTP sur binaries.prisma.sh. Comparateur npm : HTTP 200, TLS établi/autorisé. Node 22.22.3 / OpenSSL Node 3.5.6 ; Prisma/client 5.22.0 / moteur `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, Linux x64 debian-openssl-3.0.x. Outil système OpenSSL distinct. Pas de fichiers moteurs ou overrides proxy/CA/mirror observés.

URL officielle de reproduction : `https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/schema-engine.sha256`. Ce domaine est hors de l’allowlist sortante du sandbox ; observations concordantes avec une restriction d’egress, pas une preuve d’une chaîne de certificats invalide. P04 releases GitHub officielles vide dans la requête effectuée ; pas preuve d’absence de toute distribution alternative.

Aucun TLS désactivé, checksum ignoré, certificat ajouté arbitrairement, binaire tiers/factice, client simulé ou upgrade majeur. **La cause probable est documentée ; elle n’est pas corrigée dans ce sandbox.** Résolution compatible : runner/environnement autorisant cet hôte officiel, TLS normal et checksums, mêmes versions verrouillées ; générer les deux clients et exécuter les vrais contrôles. Pas de téléchargement vers une source inconnue proposé.

## 7. Reproduction et reprise

Depuis `/home/user/GarageFlowsV2`, Node 22.12..<23, npm 10.9.8 observé. Outils de cette vérification : TypeScript 5.9.3, ESLint 8.57.1, Vitest 4.1.11, Next 15.5.27, Prisma/client 5.22.0, Git 2.39.5, Python 3.11.2.

Local sans moteur : installation JS P20 puis commandes P36/P33/P34/P37, `node scripts/evaluate-copilot.cjs`, `node scripts/evaluate-copilot-phase2.cjs`, `node scripts/diagnose-prisma-runtime.cjs`, `npm audit --json`. Le diagnostic doit rester nonzero si Prisma inaccessible ; ne pas masquer le statut. Pas transformer --ignore-scripts en installation standard.

Sur environnement autorisé, sans base métier de production ni reset :

```sh
npm ci --no-audit --no-fund
npx prisma generate
npx prisma generate --schema prisma/server/schema.prisma
npx vitest run src/integration/copilot-conversation.test.ts src/integration/copilot.test.ts src/integration/copilot-ecusson-verifie.test.ts src/integration/copilot-financial-authz-v15.test.ts src/integration/copilot-cout-achat.test.ts src/integration/copilot-portee-et-porte-financiere.test.ts
npx tsc --noEmit
npm run lint
npm test
npm run build
npm run check:perf-budget
npm audit --json
```

Suite entière/DB PostgreSQL : profils et fixtures isolés selon conventions du dépôt, jamais DSN production ni migration destructive. Après réussite build, démarrer avec configuration/licence autorisées, vérifier login/rôles/deux garages, GET 200/503, erreurs/délais, relectures et UI réelle, puis e2e/packaging applicables. Rien de ces étapes à venir n’est présenté comme effectué. Évaluer le vrai modèle sur un jeu indépendant et le coût/latence, seulement après autorisation explicite et accord confidentialité ; sans cela laisser GARAGEFLOW_LLM=off.

`node config` et les automatisations originales sont inchangés ; tests utilisent des fixtures. Pas revendication d’une licence émise réellement, de DSNs Neon/Vercel récupérés en direct ou de credentials hébergeur inventés.

## 8. CI, sécurité et preuves

P18 consulte les check-runs du **HEAD publié phase 1** : Type-check/Lint/Test, Gitleaks, Required validation et agrégat CodeQL en failure ; gates release/staging/Windows skipped. Audit dépendances, E2E auto-démarrage et Analyze javascript-typescript success ne valident pas le candidat phase 2 ni ne compensent ces échecs. P19 récupération de log job a échoué exit 1 ; wrapper n’a pas retenu la cause, aucun contenu de job analysé. Ne pas attribuer ces failures à Prisma sans preuve. Aucun nouveau scan de secrets/arbre/historique phase 2 revendiqué, aucun Secret/Match copié, aucune rotation/réécriture/protection/merge.

Ancienne alerte du dépôt par défaut (151 alertes lors d’un push antérieur) distincte de l’audit npm candidat à zéro ; pas de remédiation du défaut revendiquée. Un audit npm à zéro n’est pas une preuve d’absence de secret/faute métier/vulnérabilité non publiée.

Registre exhaustif P01–P40 : `COPILOT_PHASE2_EVIDENCE.json`. Contrôle de clôture P41 (docs/environnement/diff/empreintes de revue et de logs) : reçu et log externes dans le même répertoire de preuves ; son résultat n’est pas présumé par ce rapport. Reçus/logs originaux immuables : `/home/user/copilot-phase2-2026-10-15/`. Chaque reçu identifie ID, commande exacte, cwd, date/timezone, HEAD, empreintes des sources modifiées, exit, durée et SHA-256 de log ; le registre ajoute interprétation/limites et versions d’outils observées. Sources d’une exécution ≠ toutes les sources d’une autre. Les logs sont hors Git ; le registre conserve leur hash/référence, pas des secrets ni des logs de scan bruts.

**Aucune autorisation de publication demandée pour contourner ces critères. Décision finale locale : PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**
