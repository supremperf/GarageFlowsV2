<!-- doc-numbers: journal -->

# Journal des corrections et clôture limitée de phase 0.5

## Chronologie / justification

1. Lecture seule, inventaire des 2 302 fichiers suivis, rapport de compréhension communiqué. Rapport initial 01 rédigé avant correction applicative.
2. Neutralisation de l'injection de code du reset et fermeture permanente du point d'entrée `revoke-by-key`. Pas de rotation, migration ou déploiement exécuté.
3. Ajout d'une frontière technique commune sur les six routes licence et treize routes sync. Les erreurs d'authentification DB étaient auparavant hors des try locaux de sync. Les catches techniques laissent maintenant la frontière produire le code dédié. Les conflits métier explicites sont conservés.
4. Activation fail-closed pour Electron/PWA, garage ET mécanicien : erreur DB ou d'appareil ne peut plus émettre les cookies de succès. Secret de session contrôlé avant accès DB. Appareil obligatoire pour les non-admin ; exemption admin préexistante conservée et documentée.
5. Vérification MAC dans l'auth garage sync, le heartbeat avec deviceToken et la licence parente à l'activation mécanicien. `LICENSE_TAMPERED` distinct de `LICENSE_INVALID`. Le contrôle de configuration MAC précède même le verdict « MAC absent ».
6. Clé publique Next : analyse P-256 avant vérification de signature ; ancre inutilisable → erreur de configuration typée. Clé publique Electron : validation isolée `license-trust.js`, message de configuration au démarrage/activation au lieu de « licence invalide ». Aucune clé modifiée.
7. Electron : extraction d'une politique d'activation testable, liste positive de refus métier, absence de repli local pour toute nouvelle tentative distante échouée/ambiguë. L'IPC initial attend le succès distant ; le changement de licence restaure l'état précédent sur échec ; le démarrage et le changement exigent ensuite la réussite locale avant ouverture de session métier.
8. Overlay : messages dédiés expired/device_revoked/device_hwid_mismatch/device_required/upgrade_required/infrastructure_error/unknown. Aucun fallback « revoked ». Le report Electron transmet le statut d'infrastructure. Les messages de changement/activation PWA utilisent un mapper commun, neutre en cas de réponse vide/inconnue, et vérifient HTTP ET ok.
9. Adaptation des tests historiques qui imposaient l'ancien comportement permissif. Leurs assertions sont remplacées par des preuves de fermeture/sans mutation, pas des skips. Les tests d'orchestration mockent désormais explicitement le MAC ; des tests séparés exercent le vrai HMAC et refusent altération/MAC absent.
10. README : suppression des références au fichier inexistant keygen_gui.py et de la copie manuelle des ancrages. Aucune initialisation de clés exécutée.
11. BOM retirés uniquement des 11 sources/tests TS/TSX concernés ; CRLF et BOM PowerShell préservés. `.gitattributes` identifie CRLF Windows comme intentionnel. Aucun texte de preuve historique normalisé.
12. Tests : warning Vite de configuration CJS/ESM corrigé par renommage `vitest.config.ts` → `vitest.config.mts`, puis `import.meta.dirname`. Aucun flag de suppression de warning.
13. Python installé dans `.venv` isolé après refus PEP 668 de l'installation système. Pas de `--break-system-packages`. Dépendances hash-lockées ; `.venv` ignoré.
14. Re-triage des 29 empreintes historiques de `keygen_ui.py` : les reçus ne doivent pas prétendre décrire la source modifiée. Ils référencent maintenant le snapshot public exact du commit initial, sous snapshots/. SHA source inchangé et contrôlé par le test de politique existant ; aucune règle Gitleaks élargie, aucune empreinte ajoutée à l'ignore.
15. Audit global : trois gardes négatives de configuration utilisées mais non déclarées identifiées (NEXT_PUBLIC_DEBUG, VERCEL_BLOB_API_URL, NEXT_PUBLIC_VERCEL_BLOB_API_URL). Déclaration au manifeste comme dangereuses, absentes par défaut, non générables/non auto-gérées. Documentation d'environnement régénérée. Aucune nouvelle variable déployée.

### Changements de compatibilité assumés

- Nouvelle activation Electron hors ligne : **refusée**, contrairement à l'ancien mode permissif. Cela ne remplace pas toute la politique historique de grâce d'une licence déjà enregistrée ; aucun durcissement global de la grâce hors ligne n'est prétendu.
- Révocation/réactivation par clé partagée : **retirée sur toutes les plateformes** (404 ENDPOINT_DISABLED). Pas de flag d'activation. L'ancien reset bloque sa validation admin ; le keygen explique le retrait. Une recette forte doit remplacer ce workflow avant promotion. Ne pas remettre le bypass pour « faire passer » le reset.
- Les autorisations sync exigent désormais un MAC utilisable. Une base existante non conforme sera refusée. **Ne pas recalculer les MAC ni migrer automatiquement en production** : contrôler la provenance, sauvegarder et obtenir une décision humaine.
- L'activation n'est pas rendue atomique de bout en bout entre tous ses effets annexes : un enregistrement licence/appareil peut avoir précédé une panne ultérieure, mais aucune nouvelle session de succès ne doit être émise sur cette panne. Recette transactionnelle réelle encore requise.

## Tableau des six constats prioritaires (preuve dans la version corrigée)

| Élément vérifié | Constat dans le code | Preuve fichier + ligne | Statut |
|---|---|---|---|
| 1. Contrats HTTP | Consultation en 200 avec refus explicite conservée ; mutation sync refusée en 403, infra séparée | license/check/route.ts:35-76 ; license/status/route.ts:61-90 ; incident-license-infra.test.ts et incident-sync-contracts.test.ts | Confirmé corrigé/documenté/testé aux frontières ; recette production non vérifiable |
| 2. Injection reset | Fonctions d'injection remplacées par no-op ; aucune stack/hasPrivateKey/bypass généré | scripts/reset-garageflow.ps1:1537-1548 ; incident-safety.test.ts | Confirmé corrigé dans le dépôt ; artefact déjà déployé non vérifiable sans accès prod |
| 3. Activation fail-closed | DB/appareil : exception remonte ; aucune session de succès ; activation Electron distante unique | license/activate/route.ts:106,210,297,447,508,514 ; electron/main.js:1783,3060,4015,4034,4350 ; activation-policy.js | Confirmé corrigé ; route/politique testées, exécution native Windows non vérifiée |
| 4. Infra ≠ licence invalide | Frontière commune et erreurs typées ; vrai contrôle MAC et code distinct | license/api-boundary.ts:7 ; license/failures.ts:11 ; license/verify.ts:122 ; sync/garage-auth.ts:143 ; license/devices.ts:358 | Confirmé corrigé et testé sur scénarios injectés ; exhaustivité des pannes réelles non certifiée |
| 5. revoke-by-key | Fermeture permanente, aucune DB accessible, audit des refus ; aucune réactivation faible | api/admin/licenses/revoke-by-key/route.ts:16-36 ; revoke-by-key-route.test.ts ; incident-safety.test.ts | Confirmé corrigé par retrait, plus strict qu'un flag ; collecte effective SIEM non vérifiable sans accès prod |
| 6. UI | Statuts dédiés, repli neutre ; mapper PWA technique ; report Electron distingue infrastructure | components/LicenseRevokedOverlay.tsx:53-81,104,228 ; license/activation-message.ts:2 ; electron/activation-report.js:62-68 | Confirmé corrigé ; tests de politique/source passent, recette visuelle/native encore requise |

Les chemins courts `license/`, `sync/` et `api/` du tableau sont relatifs à `src/lib/` ou `src/app/` selon le fichier nommé. Le rapport 02 explicite les chemins de routes.

## Traçage UI : activation et état de licence

| Source | Message / déclenchement exact | Traitement infrastructure |
|---|---|---|
| LicenseRevokedOverlay.tsx:27-52 | Compte révoqué/suspendu/Sécurité compromise : `allowed===false` avec status revoked/suspended/tampered depuis poll ou IPC | Aucune sélection de ces entrées par défaut ; infra non-2xx ignorée par poll, statut précédent conservé (ce n'est pas une nouvelle révocation) |
| même fichier:53-81 | Licence expirée/Appareil révoqué/Appareil différent/Enregistrement requis/Mise à jour requise : status exact correspondant | Entrées distinctes, jamais révoqué par repli |
| même fichier:73-81,228 | Vérification indisponible / État non confirmé : infrastructure_error ou statut absent/inconnu | Neutre, pas d'affirmation de révocation ou de compte invalide |
| même fichier:84-90 | Appareil non enregistré : activation_refused provenant d'un refus métier explicitement reconnu par activation-policy | Les réponses infra/ambiguës sont infrastructure_error, pas activation_refused |
| même fichier:111-117,202-219 | Compte réactivé : uniquement status active après blocage observé | Une réponse unknown ou une exception ne déclenche pas cette transition. Une panne après un refus antérieur laisse ce refus visible ; elle ne le prouve pas de nouveau. |
| app/license/page.tsx:52-100 | checking ; erreur via activationErrorMessage si !HTTP-ok ou data.ok!==true ; succès admin/mécanicien/garage si succès strict ; catch réseau distinct | 5xx/codes infra produisent toujours un message d'indisponibilité ; réponse ambiguë reste « vérification non aboutie » |
| LicenseChangeModal.tsx:145-192 | IPC updateLicense : succès res.ok ; sinon reason neutre. PWA : succès HTTP-ok ET data.ok===true ET licenseType ; sinon mapper ; catch Erreur réseau | Aucune valeur par défaut « Licence invalide » sur réponse technique manquante |
| LicenseChangeModal.tsx:39-77 | Postes activés / plafond atteint : uniquement GET devices HTTP-ok et d.ok, puis activeCount>=seats ; révoqué/libéré selon statut de la ligne | Une panne masque la liste (comportement existant, pas un message de révocation). Amélioration UX à prévoir : signaler l'échec plutôt que masquer silencieusement. |
| electron/license.html:150-178 | Affichage de license-error, via textContent ; spinner jusqu'au retour IPC | main attend désormais le verdict distant ; panne/config retourne message neutre, pas succès |
| electron/main.js:3060-3100 | Nouvelle clé : vérification locale puis activation distante ; erreur IPC et aucune validation de fenêtre sur échec | Ancre invalide → message configuration ; réseau/DB/config distant → indisponibilité générique |
| electron/main.js:4015-4058 | Changement : restore ancien état sur échec distant/local ; retour ok:false | Aucun fallback local de nouvelle activation ; exception inattendue → INTERNAL_ERROR neutre |
| electron/main.js:4229-4235,4350-4360 | Dialogues Configuration indisponible / Vérification indisponible avant fenêtre principale | Sortie fermée, aucun diagnostic de licence révoquée basé sur une panne |
| electron/startup-gate.js:28,55-86 + main.js | Licence bloquée : état signé persistant revoked/suspended/tampered lié à la licence ; autre clé peut être présentée | Contrôle distinct de l'activation, non réécrit ; ne prouve pas l'état courant distant pendant une panne |
| components/admin/LicenseDevices.tsx:78-104,146-147 | Erreur de chargement/action refusée/serveur injoignable ; succès explicite après HTTP-ok ; étiquette du statut DB | Pas de mapping infra vers révoqué observé dans ces branches ; handlers admin hors phase sync/licence non intégralement requalifiés |
| app/admin/licenses/page.tsx:294-387,592-598 | Badges status DB et expiration par date ; toast succès après résultat de patch positif ; chargement/réseau dédiés | Pas de mapping infra vers révocation observé ; recette des droits admin et MFA non réalisée |

Ce traçage couvre les surfaces d'activation/état repérées, pas une certification linguistique ou visuelle exhaustive de toute l'application. Le rapport final garde donc la case « chaque message de toute l'UI validé en environnement réel » ouverte.

## Hypothèses ouvertes

Aucun log de production fourni : tableau d'hypothèses du rapport initial toujours ouvert. Une panne Prisma, un reset permissif et une incohérence de configuration sont compatibles avec le code initial ; aucune n'est une cause racine confirmée de l'incident externe. Il faut un request ID corrélé, statut HTTP + JSON réel, SHA de l'artefact et état DB avant/après (lecture seule). Un MAC invalide sans attestation de configuration ne prouve pas une compromission.

## Plan d'action priorisé

| Priorité / action | Propriétaire suggéré / délai indicatif | Rollback | Surveillance après déploiement approuvé |
|---|---|---|---|
| P0 conserver le gel de promotion ; collecter les preuves incident | Incident commander + SRE, immédiat | Aucun changement production à annuler dans cette session | 403 par code LICENSE_INVALID/TAMPERED ; 503 DB_UNAVAILABLE ; 500 SERVER_MISCONFIGURED ; corrélation request ID |
| P0 vérifier en staging isolé les erreurs DB/config/sièges et le retrait admin | Backend + QA, avant toute promotion | Revenir à un artefact sûr approuvé ; ne pas restaurer une voie permissive comme rollback de sécurité | Taux activation réussie/échouée, consommation sièges, cookies émis sur échec (doit être zéro) |
| P0 vérifier les ancrages et secrets existants, sans rotation automatique | Responsable clés + SRE, avant promotion | Restaurer uniquement une configuration originale attestée ; aucune génération de clés opportuniste | Hausse de tampered après changement config, erreurs de vérification, aucune valeur sensible dans logs |
| P1 remplacer la recette reset et l'admin par authentification forte approuvée | Security + responsable outillage, 1–3 jours après conception | Maintenir endpoint retiré ; l'ancien reset reste bloqué | Tentatives admin refusées/action revoke-by-key.denied, alertes de rafale ; vérifier réception SIEM |
| P1 fournir moteur Prisma et services DB/Redis dédiés + Windows/browser | CI/SRE + QA, avant go/no-go | Aucun changement de schéma prod ; annuler seulement ressources de test isolées | Suites intégration/E2E, DB/Redis dégradés, restaurations et migrations réelles |
| P1 résoudre conflit du contrat d'alias fournisseur sans casser l'import | Responsable configuration, 1–2 jours et tests dédiés | Revenir au manifeste/outil cohérent attesté ; aucun alias runtime ajouté en contournement | check:env-consistency et tests config ; absence d'alias non canonique dans env runtime |
| P2 moderniser dépendances dépréciées et valider accessibilité/traductions | Mainteneur + QA UX, sprint suivant mais avant certification zéro warning | Mise à jour par lots avec lockfile et tests, pas npm audit fix --force aveugle | Warnings d'installation/build, tests UI, budget performance |

## Déclaration de phase 0.5

**Aucune cause racine de l'incident de production n'atteint le seuil de preuve ≥90% sans accès aux logs/DB de production.** Les défauts de code suivants sont en revanche confirmés et corrigés dans le dépôt : injection de diagnostics/bypass par reset, fail-open d'activation Electron, confusion technique/refus dans les frontières auditées, MAC non contrôlé sur auth sync/heartbeat appareil, endpoint de révocation à clé partagée, et fallbacks d'affichage trompeurs. Leur validation native/production demeure distincte et incomplète. La phase incident production est documentée **non vérifiable sans accès production**, et non clôturée comme cause résolue.

## Complément de dernière passe — statuts et preuves finales

16. `electron/activation-policy.js` / `electron/activation-report.js` : les refus métier reconnus de l'activation ne sont plus tous aplatis en `activation_refused`. Révocation, expiration, suspension, altération, appareil révoqué et HWID différent conservent leur statut jusqu'à l'overlay ; repli neutre conservé pour les réponses non reconnues. Six tests paramétrés ajoutés dans `incident-safety.test.ts`. Revalidation ciblée : **252/252**, dont **117 tests incident** ; lint, TypeScript et **364/364 tests Node** repassés après ce changement.
17. Dernière globale récupérée : **4 144 tests, 3 292 pass, 3 fail, 849 pending** ; **341 fichiers, 262 pass, 79 failed**. 78 fichiers comportent un échec de téléchargement des moteurs Prisma, un fichier révèle l'inaptitude runtime du client généré sans moteur pour le typage. Le dernier affinage du point 16 est couvert par le ciblé, pas par une nouvelle globale. Aucun échec caché par ajout de skip.
18. Dernier contrôle env : **28 constats ouverts**, alias d'import fournisseur / noms non canoniques. `npm outdated` : **32 paquets signalés**, rapport conservé, pas de mise à niveau majeure aveugle. Dernier `git diff --check` et liens relatifs des rapports : OK.

La synthèse, les justifications des écarts ouverts, la checklist Done When et le verdict **NO-GO production** sont dans [04-REVALIDATION-ET-CHECKLIST.md](04-REVALIDATION-ET-CHECKLIST.md), avec les [preuves structurées](04-PREUVES.json). La cause de l'incident reste **non vérifiable sans accès production**, sans preuve ≥90 %.
