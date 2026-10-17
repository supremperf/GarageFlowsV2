# Config — gestion des environnements GarageFlows

## Nouveau mode par défaut : différentiel, idempotent, trois cibles

```sh
node config                         # préparation puis confirmation du plan
node config --dry-run               # inventaire Vercel, aucune mutation
node config --dry-run --offline     # simulation locale, aucun réseau/aucune écriture
node config --connect-blob --environment development # rattachement Blob ciblé
node config --probe-blob-write       # ajouter PUT/HEAD/DELETE sur un objet de sonde
node config --rotate-session-secrets # rotation explicite session/appareils/API
node config --conserver-secrets     # ancien assistant complet, migrations/déploiement inclus
npm run test:config
```

Windows : `config.cmd` ; Node.js **>=22.12.0 et <23**. Le nouveau gestionnaire ne
lance ni migration SQL, ni déploiement, ni remplacement d’autorité de licence.
Ces opérations restent dans l’assistant conservateur explicite. L’analyse lit
les fichiers suivis/non ignorés, compte les binaires et recense les références
littérales d’environnement. Elle ne désassemble pas les binaires et ne prouve
pas l’absence d’accès dynamiques.

### Voir les caractères saisis dans `node config`

Au démarrage de `node config`, répondre **oui** à :

```text
Afficher les valeurs pendant la saisie, y compris les secrets (oui/non) [non]
```

Les caractères tapés ou collés, y compris un `BLOB_READ_WRITE_TOKEN` ou un mot de
passe, deviennent alors visibles dans les champs de saisie de cette session.
Le libellé indique `saisie visible`. Répondre **non** ou appuyer sur Entrée conserve
la saisie masquée. Le choix est redemandé à chaque lancement ; il n’est pas
sauvegardé. Les simulations ne posent pas cette question.

**Attention :** les secrets saisis en mode visible restent dans l’historique
d’affichage du terminal et peuvent apparaître dans un enregistrement ou un
partage d’écran. Ne partagez pas cette sortie. Ce choix ne révèle ni les valeurs
déjà configurées/récupérées, ni le contenu des rapports, qui restent sans secrets.
Il ne change pas non plus les invites des CLI officiels externes.

### Windows : réparer le rattachement Blob, puis reprendre

Le diagnostic `Aucun store Blob confirmé ... development` signifie que
l’association projet/**Development** n’est pas prouvée. Accepter un token exposé
ne crée pas cette association, et répondre « oui » pour retester ne la crée pas
non plus. Le gestionnaire s’arrête maintenant avec la commande utile, au lieu de
proposer de répéter cette vérification sans réparation.

**1. Mettre le code à jour sans effacer les fichiers privés.** Si le projet vient
d’un ZIP GitHub, télécharger la dernière version de la branche
`arena/d8de065e-garageflowsv2`, puis remplacer les fichiers du code dans le dossier
existant. Conserver `.vercel/`, `GarageFlow-configuration/`, les fichiers `.env*`
privés et `keys/`. Ne pas extraire dans un sous-dossier supplémentaire par erreur.
Si c’est un clone Git de cette branche, faire `git pull --ff-only origin
arena/d8de065e-garageflowsv2` dans ce dossier, sans écraser d’éventuelles
modifications locales. Un ZIP n’est pas automatiquement un clone Git.

**2. Dans l’Invite de commandes Windows (CMD), taper :**

```bat
cd /d "%USERPROFILE%\Desktop\GarageFlowsV2-arena-d8de065e-garageflowsv2"
node config --help
node config --connect-blob --environment development
```

L’aide doit afficher `--connect-blob` : sinon les fichiers locaux ne sont pas
encore à jour. Le chemin est celui de la capture ; l’adapter si le dossier a été
déplacé. La troisième ligne ouvre une réparation **Development uniquement** :

- saisir **`AUTORISER BLOB`** dans l’invite de l’assistant, pas dans une autre fenêtre ;
- confirmer le bon projet/l’équipe avec **oui** ;
- choisir le numéro du **store existant** dans la liste vérifiée de cette équipe
  (nom et ID sont affichés) ; aucun token n’est à coller à cette étape ;
- lire le plan de connexion et confirmer avec **oui** seulement si la cible/store
  sont corrects. Le token statique est demandé explicitement au fournisseur à
  côté des variables OIDC, car ce gestionnaire teste actuellement un vrai token.

La commande prépare d’abord un `storage connect` ou `storage update` officiel,
avec `--project`, `--scope`, **une seule** option `--environment`, `--auth oidc`
et `--add-rw-token`. Elle vérifie son plan JSON `--dry-run`, sauvegarde l’état
privé des trois cibles et du store, puis requiert l’accord final avant `--yes`.
Aucune variable hors Blob ou suppression n’est permise dans le plan. Elle relit
le rattachement et les autres cibles après l’opération. Une connexion partagée
n’est jamais réduite à Development : si sa modification toucherait une autre
cible, la commande bloque et demande une séparation explicite dans Vercel.

**3. Une fois revenu à l’invite `C:\Users\...>` du même dossier, taper :**

```bat
node config
```

Les brouillons privés sont conservés ; les empreintes sont réconciliées lorsque
seul le rattachement Blob prévu a changé, pour ne pas régénérer les clés déjà
préparées. `node config` relit les trois environnements et reprend ses contrôles.
Si Vercel masque encore le token, il faut une vraie valeur locale ; s’il est connu
exposé, choisir son renouvellement ou l’autorisation temporaire décrite plus bas.
Le rattachement ne révoque pas et ne renouvelle pas automatiquement les anciens
tokens du store.

Si le même diagnostic apparaît plus tard pour Preview ou Production, quitter
l’assistant, puis utiliser **uniquement pour la cible voulue** :

```bat
node config --connect-blob --environment preview
node config --connect-blob --environment production
```

Ces commandes ne sont pas à lancer dans le navigateur Vercel et ne sont pas des
réponses aux questions oui/non : elles se tapent après le retour à CMD. Chaque
rattachement a sa propre sélection et confirmation ; aucun partage de store
entre les cibles n’est décidé silencieusement.

Le coffre contient les sauvegardes `blob-connect-backup-*/before.json` et le
journal `journal.json` écrits avant la mutation. Une réponse perdue ou une sonde
en échec garde un état **non confirmé**, sans détachement/rollback aveugle. Une
relance inspecte l’état réel avant de reconnecter. `blob-setup-report.json` ne
contient que des noms/IDs/statuts ; les sauvegardes contiennent des secrets et ne
se partagent pas. Le contrôle SDK n’est déclaré réussi que si `list` réussit ;
un token illisible/exposé laisse ce contrôle non vérifié. Ce n’est pas encore
une validation globale de l’application ni un déploiement.

Les options ont été contrôlées dans le code officiel Vercel CLI **64.0.2** et
avec les vraies commandes publiques `vercel storage connect --help` et
`vercel storage update --help`. Les tests de
réparation utilisent des doubles, pas les services du client.

### Séquence et confirmations

1. Contrôle Git : aucun `.env` secret suivi, exemples sans secrets, destinations
   ignorées et absence de liens symboliques (y compris les parents du coffre).
2. `AUTORISER`, session Vercel officielle, sélection si le projet n’est pas lié,
   puis vérification serveur de l’ID **et de son `accountId`**. Confirmation
   explicite de l’équipe/projet et des trois cibles.
3. Inventaire **Development, Preview, Production avant toute mutation** : liste,
   pull API et lectures ciblées autorisées. Chiffrement, placeholders et valeur
   réellement exploitable sont distingués. Les branches Preview spécifiques et
   environnements personnalisés ne sont jamais modifiés.
4. Sources locales **par cible** + variables distantes lisibles. Un fichier
   `.env.storage.local` historique ne sert qu’à Production. Les valeurs exposées
   connues sont éliminées **avant les sondes réseau** ; elles ne deviennent pas
   utilisables en changeant le nom de variable ou les query parameters d’une URL.
5. Récupération Neon/Upstash possible avec les sessions officielles et sélection
   de ressource, **sans création de service**. Sinon saisie masquée précise des
   accès manquants. Chaque saisie est checkpointée pour reprise. Une sonde
   échouée propose une correction immédiate ou une suspension, pas un faux OK.
6. Neon : deux connexions via le vrai client Prisma PostgreSQL et inspection SQL
   en lecture seule. Redis : PING REST. Blob : association ressource/projet/cible,
   token et `list` via SDK officiel épinglé. Les clés de protection des données
   attendent ces validations. Les dépendances/client Prisma manquants sont préparés après
   autorisation ; aucun `reset`, `db push` ni `migrate deploy` dans ce mode.
7. Clés internes existantes préservées. `NEXTAUTH_SECRET` (base64) et
   `GARAGEFLOW_API_KEY` (hexadécimal) sont générées automatiquement avec 32 octets
   cryptographiques dès que leur absence locale **et distante** est établie,
   même si la base contient des données. Leur brouillon privé est sauvegardé
   avant les demandes d’accès fournisseurs, sans rotation à la reprise. Les
   autres clés internes absentes sont générées automatiquement après validation
   des fournisseurs **si la base est vide et leur absence distante confirmée**.
   Sur base utilisée, les clés de chiffrement/MAC/appareils peuvent protéger des
   données existantes : original nécessaire. Une clé distante masquée n’est
   jamais considérée absente. Aucune clé
   P-256/Ed25519 de remplacement n’est inventée. La rotation session/appareils/API
   est séparée, nommée et soumise à confirmation avant application.
8. Plan différentiel (créations, remplacements, retraits, fichiers). Le nettoyage
   retire seulement les noms explicitement obsolètes et sauvegardables, une fois
   leur remplaçant canonique prêt. Un nom inconnu n’est pas « inutile » par défaut.
9. Confirmation distincte des modifications destructives, avec liste des valeurs
   dont la restauration est impossible. Nouvelle confirmation d’application,
   relecture des métadonnées/valeurs des trois cibles, contrôle de la cible et des
   fichiers, sauvegarde privée, journal **avant chaque requête**.
10. Écritures Vercel v10 POST/PATCH/DELETE, relecture après chaque opération et
    vérification finale. Un PATCH remplace en place, sans suppression préalable.
    Synchronisation locale seulement après vérification distante, puis relecture
    des fichiers. Une relance réutilise valeurs et reçus, sans nouvelles clés ni
    mutation distante inutile.

Les variables d’intégration/plateforme restent protégées. Une valeur partagée
entre plusieurs cibles ne peut pas être modifiée par un PATCH présenté comme
isolé : le plan bloque et demande de séparer sa portée. Les overrides serveur
`ELECTRON`, `NODE_ENV` incompatibles et noms publics de secrets bloquent le plan.
Un partage de base entre deux cibles exige une confirmation distincte. Development
autorise HTTP uniquement pour les origines loopback (`localhost`, `127.0.0.1`,
`::1`) de NextAuth/application ; Preview/Production et Redis restent en HTTPS.

### Coller un token Blob et comprendre un refus

Pour le champ `BLOB_READ_WRITE_TOKEN`, les trois formes suivantes sont acceptées
(exemples fictifs, pas des tokens utilisables) :

```dotenv
vercel_blob_rw_STORE_EXEMPLE_TOKEN_FICTIF
"vercel_blob_rw_STORE_EXEMPLE_TOKEN_FICTIF"
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_STORE_EXEMPLE_TOKEN_FICTIF"
```

Les accès copiés sous forme `NOM="valeur"` sont également reconnus pour les URLs
Neon/NextAuth et les accès Redis. Une seule variable est acceptée par saisie ;
une ligne destinée à un autre champ est refusée sans reproduire son contenu.
Les mots de passe bruts ne sont pas réécrits. Les anciens brouillons contenant
une ligne Blob complète sont normalisés à la reprise.

La découverte Vercel lit, si nécessaire, la liste **puis les détails et les
connexions** des stores, y compris les stores Blob historiques sans champ `type`
et les listes ne contenant pas les portées complètes. Les hints du projet
Vercel vérifiés pour la cible restent utilisables si la liste globale de l’équipe
est interdite. Un token préfixé (par exemple `PREFIX_BLOB_READ_WRITE_TOKEN`) de
la cible peut être récupéré s’il est unique ; plusieurs candidats différents
ne sont jamais départagés au hasard.

Un token de forme correcte ne suffit pas : son store doit être rattaché au bon
**projet et environnement**, puis une vraie requête SDK `list` doit réussir.
Un rattachement Production ne vaut pas pour Development. Si l’association
manque, ouvrir **Vercel > Storage > le store > Connect Project**, vérifier le
projet et les cibles autorisées. L’assistant n’élargit pas les portées tout seul.
Pour une association manquante, utiliser la réparation ciblée décrite plus haut ;
pour les autres erreurs de réseau/inventaire, une nouvelle vérification peut être
demandée sans ressaisir le token. Dans un champ
de correction du token, Entrée conserve également la valeur courante comme
défaut masqué et relance la vérification.

Les diagnostics sans secrets distinguent : format, inventaire Vercel inaccessible,
association manquante, store différent, accès Blob refusé, store suspendu/absent
et indisponibilité/réseau. Une erreur de réseau ou d’inventaire n’est plus
présentée comme preuve que le token est mauvais. Les messages bruts des SDK ne
sont jamais affichés. Les tokens exposés sont bloqués par défaut, même correctement
formatés ; voir ci-dessous le choix explicite de renouvellement, suspension ou
dépannage temporaire. Révoquer les tokens exposés reste recommandé.

### Token Blob reconnu comme exposé : choix explicite, sans boucle

Le message « valeur précédemment exposée » est un **blocage local par empreinte**,
pas un refus de l’API Vercel. Ajouter/retirer les guillemets ne change pas le token.
Le gestionnaire propose maintenant trois choix :

1. **Saisir un token renouvelé** — recommandé ; aucun ancien accès n’est réutilisé.
2. **Autoriser temporairement ce token**, puis saisir exactement la confirmation
   affichée pour la cible, par exemple `UTILISER BLOB EXPOSE POUR development`.
3. **Suspendre** — aucun accès Blob ni changement distant après ce choix.

L’exception du deuxième choix concerne **uniquement la valeur exacte du token
Blob sélectionné**, dans **cette cible et cette exécution**. Elle n’est pas
sauvegardée comme autorisation, ni étendue aux autres environnements, bases de
données ou clés de chiffrement. Elle est redemandée à la relance, même si le token
se trouve dans les fichiers privés ou Vercel. La simulation et les validateurs
standards restent stricts. Aucun argument global ne désactive la protection.

**Ce n’est pas une rotation ni un token éphémère :** le token peut être enregistré
dans les fichiers privés et les variables Vercel après confirmation du plan. Il
reste exploitable par un tiers jusqu’à sa révocation chez le fournisseur. Le
rapport porte `securityDegraded: true` et un avertissement explicite ; il ne
présente pas cette configuration comme sécurisée. Le registre des empreintes
compromises n’est pas effacé. Le contrôle d’association projet/environnement,
le vrai `list` Blob et l’autorisation séparée de toute sonde d’écriture restent
obligatoires ; l’exception ne transforme pas un échec fournisseur en succès.

Sur Windows, coller une ligne `BLOB_READ_WRITE_TOKEN="…"` **dans l’invite de
`node config`**, pas après le retour à `C:\Users\…>`. Une affectation dotenv
seule n’est pas une commande CMD. Relancer `node config` pour reprendre le brouillon.
Ne partager ni le token renouvelé ni les captures d’une saisie visible.

### Génération automatique ou accès à fournir

`node config` décide par cible, sans vous demander de fabriquer un secret :

| Type | Comportement |
|---|---|
| `NEXTAUTH_SECRET` absent partout | Génération automatique : 32 octets aléatoires encodés en base64 |
| `GARAGEFLOW_API_KEY` absente partout | Génération automatique : 32 octets aléatoires encodés en hexadécimal (64 caractères) |
| Autres secrets internes absents sur une base neuve | Génération automatique de 32 octets, au format base64/hexadécimal déclaré par le contrat applicatif ; AES : 32 octets en base64 |
| Valeur existante lisible sur la cible Vercel ou dans ses fichiers privés | Réutilisation ; aucune nouvelle génération inutile |
| `DATABASE_URL`, `DIRECT_URL`, accès Redis/Blob et autres identifiants fournisseurs | Récupération depuis la cible Vercel ; sinon sources privées/sessions fournisseur autorisées ou saisie locale ; jamais une fausse valeur aléatoire |
| Clé existante mais masquée, ou clé de protection manquante sur base utilisée | Original à récupérer ; aucun remplacement automatique qui rendrait les données illisibles |

Les valeurs restent indépendantes entre Development, Preview et Production.
Les générations sont annoncées par **nom uniquement**, puis mémorisées dans le
brouillon privé pour reprise. Une saisie manquante chez un fournisseur ne fait
pas perdre le `NEXTAUTH_SECRET` déjà préparé. Aucune clé n’est créée par une
simulation. Les connexions sont validées avant toute synchronisation Vercel.
Les sessions fournisseurs supplémentaires ne sont proposées que si des accès
Neon/Redis sont encore manquants après lecture des valeurs Vercel/locales.

### Destinations et reprise

| Cible | Fichiers applicatifs | Entrées fournisseur privées |
|---|---|---|
| Development | `.env.development.local`, `.env.local` | `.env.storage.development.local` |
| Preview | `.env.preview.local` (export explicite, pas un fichier Next automatique) | `.env.storage.preview.local` |
| Production | `.env.production.local`, `.env.server.local` | `.env.storage.production.local` |

`.env` reste le profil SQLite desktop et n’est pas écrasé. Les noms inconnus des
fichiers locaux sont préservés, sauf les valeurs connues exposées. Les alias
obsolètes sont migrés vers le contrat canonique. `DATABASE_URL_UNPOOLED`, les
paramètres `PG*` et les variantes `POSTGRES_*` sont acceptés comme **entrées
fournisseur** ; seuls les noms applicatifs canoniques sont déployés. Prisma
attend `DIRECT_URL`, pas un alias supplémentaire. `.env.storage.example` montre
les champs acceptés **sans aucun secret**. `.env.example` reste sans secrets.

Le coffre privé `GarageFlow-configuration/` contient :

- `manager-state.json` : saisies/drafts, projet, tentatives et journal de reprise ;
- `manager-backup-*/` : valeurs relisibles et originaux locaux avant application ;
- `manager-receipts.json` : empreintes + versions distantes, liées au projet/cible ;
- **`manager-report.json` : seul rapport partageable**, noms/statuts sans valeurs.

Les sondes refusent les modes `DEBUG`/`NEXT_PUBLIC_DEBUG` actifs pour éviter les
traces verbeuses des bibliothèques Prisma/Blob. Fichiers POSIX `0600`, dossiers
`0700` ; sur Windows, utiliser en plus un dossier avec ACL utilisateur et
chiffrement disque. Ne jamais partager les autres
fichiers du coffre. Un verrou interdit les configurations simultanées sur ce
poste ; un verrou interrompu doit être contrôlé avant retrait. Une transaction
interrompue propose une restauration vérifiée à la reprise. Une modification
locale concurrente n’est jamais écrasée par le rollback.

### Neon, Blob et limites de vérification

La référence Neon non secrète est intégrée : `neondb_owner`, base `neondb`,
région `us-east-2`, hôtes poolé/direct `ep-aged-cell-ayqiwroc` fournis. **Aucun
ancien mot de passe n’est embarqué**. Avec un nouveau mot de passe brut fourni
localement, les URLs sont encodées une fois, y compris les `%` littéraux.
`DATABASE_URL`/`DIRECT_URL` doivent viser la même branche/base/rôle avec SSL.
`POSTGRES_URL_NO_SSL` est seulement une variante de compatibilité dans les
entrées privées : jamais utilisée comme transport de production.

La sonde Blob par défaut vérifie l’association et la lecture de liste, **pas
l’écriture**. `--probe-blob-write` demande une autorisation PUT/HEAD/DELETE et la
visibilité effective du store. Elle crée un objet unique sans contenu sensible,
interdit l’écrasement, vérifie ses métadonnées, le supprime et relit la liste.
Un échec de nettoyage est signalé sans secret. Ces opérations peuvent être
facturées par le fournisseur. Aucun consommateur Blob applicatif n’a été trouvé
lors de cet audit : cela ne migre **pas** les sauvegardes/uploads du disque.

La simulation en ligne n’écrit pas les fichiers du projet et ne mute aucune
variable ; le CLI officiel peut gérer son propre cache/session d’authentification.
La simulation hors ligne ne lance aucun CLI externe au contrôle Git/audit local.

Les créations Vercel portent un commentaire de transaction unique : une
restauration ne retire pas la création concurrente d’un autre opérateur, même
si sa valeur est identique. Les commentaires existants sont préservés.

Les modifications multi-environnements ne sont **pas une transaction distribuée
atomique**. Le rollback est vérifié là où les valeurs originales sont connues.
Une valeur masquée/inaccessible n’a pas d’original sauvegardable ; une rotation
ne peut pas être honnêtement annoncée réversible. Une modification concurrente
ou une restauration non confirmée laisse un journal et un statut interrompu.

Un reçu n’est jamais créé pour prétendre connaître la valeur d’une intégration
masquée que le gestionnaire n’a ni lue ni écrite. Une métadonnée modifiée après
envoi confirme la présence, **pas l’égalité en clair**. Dans ce cas le rapport
reste **VÉRIFICATION PARTIELLE**, avec code de sortie 1. Sans connexion réellement
testée, le rapport affiche **NON VÉRIFIÉ**. La simulation hors ligne ne valide ni
le compte, ni les services, ni les suppressions distantes ; la génération des
clés de protection reste conditionnelle à une inspection SQL future.

### Incident de publication des accès de test

Le fichier `.env.storage.local` publié au commit `290d290` est retiré du suivi
courant. **Il reste dans l’historique public.** Les empreintes des accès publiés
sont ajoutées à `scripts/compromised-secrets.json` ; les modes de validation les
refusent par défaut, y compris si un mot de passe est réutilisé dans une autre URL.
Seul le dépannage Blob interactif décrit plus haut permet une exception ciblée.
Révoquer le mot de passe Neon, les tokens Redis écriture/lecture seule et le
token Blob chez leurs fournisseurs. Ni supprimer un fichier ni changer une
variable ne prouve la révocation. Aucun accès client n’a été utilisé ici.

### Validation de cette livraison — 17 octobre 2026

| Contrôle exécuté dans le dépôt | Résultat |
|---|---|
| `node --test tests/*.cjs` | 358 tests réussis, aucun échec ni test ignoré |
| `npm run test:config` (sous-ensemble du précédent) | 239 tests réussis, dont 75 pour le nouveau gestionnaire et la réparation Blob |
| ESLint des modules de configuration modifiés et de leurs tests | Réussi |
| Cohérence documentaire, marque et `git diff --check` | Réussis |
| `npm audit --omit=optional --audit-level=low` | Aucune vulnérabilité signalée dans le périmètre audité |
| Vraie commande `node config --dry-run --offline` | Code 0 ; contenu, permissions et dates de modification des fichiers `.env*` et du coffre inchangés ; aucune valeur sensible connue dans la sortie |
| Compte/équipe/projet et écritures Vercel réels | **Non vérifiés** |
| Nouveau mot de passe et connexions Neon poolée/directe via Prisma | **Non vérifiés** ; génération réelle du client et accès fournisseur non validés ici |
| Nouveaux accès Upstash et token Blob ; opérations Blob réelles | **Non vérifiés** |
| Synchronisation effective des trois environnements cloud | **Non finalisée** |

Les tests automatisés des fournisseurs utilisent des doubles contrôlés, pas
les services du client. Ils ne prouvent ni la validité des nouveaux accès, ni
leur rotation/révocation, ni la disponibilité des services. Les accès manquants
doivent être récupérés ou saisis dans le terminal masqué sur le poste autorisé ;
ne pas les transmettre dans un chat, un ticket ou un commit.

Les sections suivantes documentent les diagnostics de compatibilité et le
**mode conservateur historique**. Ses migrations, keygen, modifications desktop
et déploiements ne font pas partie du nouveau gestionnaire par défaut.

### Si les quatre connexions semblaient introuvables

Le correctif de lecture ne rejette plus une valeur authentiquement récupérée
uniquement parce que sa métadonnée vaut `type: sensitive` ou
`visibility: secret`. Le pull utilise toujours un **fichier temporaire neuf**
pour ne pas confondre une ancienne valeur locale conservée par le CLI avec une
réponse serveur. Les placeholders officiels `[SENSITIVE]`, valeurs vides et
marqueurs de masquage ne sont jamais des credentials exploitables.

Recherche, toujours limitée à l’équipe/projet sélectionné et à **production** :

- pull officiel puis `/v3/env/pull/{projectId}/production` ;
- liste `/v10/projects/{projectId}/env` avec demande de déchiffrement et filtre
  production, puis lecture `/v1/projects/{projectId}/env/{envId}` pour les
  variables fournisseur encore manquantes. Le ciphertext de la liste n’est
  jamais interprété comme un mot de passe ;
- une seule reconnexion officielle Vercel si une authentification requise ou
  un compteur de variables cachées est signalé. Le type Sensitive seul et une
  valeur masquée ne déclenchent plus ce réessai. Confirmer un login dans le
  navigateur ne garantit pas la satisfaction d’un challenge renforcé ni
  l’autorisation d’exporter les secrets ;
- inventaire Storage, détails de ressource et connexions du projet lorsque la
  liste ne fournit pas les métadonnées. Postgres/Redis natifs et intégrations
  sont reconnus. Les `contentHint` et préfixes (`NEON_`, `CACHE_`…) sont utilisés
  seulement pour les variables/ressources de ce projet en production ; aucune
  paire de connexions n’est assemblée depuis plusieurs bases différentes.

Le diagnostic **`GarageFlow-configuration/storage-discovery.json`** contient
uniquement les identifiants de cible, étapes et compteurs d’accès, et les
**noms** des paramètres trouvés/manquants, jamais leurs valeurs. Le **schéma 2**
ajoute les causes filtrées par lecture, la tentative (`initial` / `after_login`),
le statut HTTP lorsqu’il est disponible, des codes d’erreur sur liste fermée,
des indicateurs de forme de réponse et de protection des connexions. Il peut
être partagé pour investiguer le blocage. **Ne pas partager les autres fichiers du
coffre**, les sauvegardes ou les `.env` : ils contiennent les secrets.

Pour obtenir ce seul rapport, **sans relancer la reconstruction** :

```sh
node config --diagnostic-storage
```

La cible doit être déjà liée dans `.vercel/project.json` et est affichée pour
confirmation. La commande utilise seulement des lectures API authentifiées :
aucun login interactif/rattachement, export de secrets, changement des profils
`.env`, génération, migration ou suppression. Seul le rapport filtré est écrit.
Un code de sortie 1 signifie que des paramètres restent manquants, même si le
rapport a bien été écrit.

Interprétation :

- `stages.pull/list: "lu"` indique une réponse structurellement lisible, **pas**
  la présence de credentials. Les compteurs du pull précisent ce qu’il contient.
- `stages.denied` est conservé pour compatibilité : il totalise les lectures
  ciblées **non exploitables**, pas les seuls refus HTTP.
- `masked_value`, `not_decrypted`, `missing_value` décrivent une valeur masquée,
  un déchiffrement explicitement absent ou une valeur absente ; ils ne prouvent
  pas qu’un login permettra la lecture.
- `http_forbidden` signifie HTTP 403 sans code discriminant : cela ne distingue
  pas les permissions d’un éventuel challenge renforcé. `permission_denied`
  exige un code de refus reconnu ; `auth_challenge` un code de challenge reconnu.
- `wrong_key`, `wrong_target`, `unexpected_response`, `invalid_json` et
  `incomplete_response` ne sont pas présentés comme des refus de permission.
- `command_failed` reste volontairement indéterminé lorsqu’aucune information
  structurée ne permet de conclure. Les messages bruts, headers et challenges
  d’authentification ne sont jamais inclus dans le rapport ou la console.

Le CLI 64 peut lever une erreur avant d’imprimer les headers de `api --include`.
Ses lignes de statut debug sont donc capturées **en mémoire uniquement**, puis
réduites au statut numérique sur échec. Ne pas activer/partager des logs bruts
manuellement pour ce diagnostic.

Si les droits Vercel refusent encore la lecture après reconnexion, le script
ne contourne ni MFA ni permissions : il s’arrête avant toute suppression et
indique la lecture manquante. Une ressource liée ne garantit pas automatiquement
que le compte courant a le droit d’en exporter les valeurs.

## Analyse du dépôt et couverture

**[CONFIG_REPOSITORY_AUDIT.md](CONFIG_REPOSITORY_AUDIT.md)** contient l’inventaire transversal et la décision pour **variables canoniques lors de sa génération (le décompte courant est fourni par `node config --list`)** : applicative, plateforme, runtime Electron, keygen, publication, maintenance/manuelle ou sans consommateur.

Le configurateur prend en charge **54 paramètres applicatifs**, y compris ceux absents du template initial : `GF_APP_URL`, `GF_TOTP_ENC_KEY`, anciennes clés TOTP, plafonds mécanicien, délai Redis et paramètres de stockage. Une variable déclarée historiquement mais sans consommateur n’est pas fabriquée : elle n’aurait aucun effet. Les variables OS/tests/debug/reset ne sont pas déployées en production.

```sh
node config --list   # couverture courante : noms, profils et destinations, aucune valeur
npm run config:audit  # réactualise l’inventaire ; aucun accès cloud
```

L’inventaire lit les fichiers texte de l’ensemble des sources suivies/non ignorées et les références littérales d’environnement. Ce n’est pas une certification de chaque comportement métier ni un test des services externes. Les binaires sont identifiés, pas désassemblés. Les rapports ne contiennent pas de valeurs secrètes.

## Plan complet conservateur (`--conserver-secrets`)

1. **Inventaire du dépôt** : rapport local sans secrets et classification de tout le contrat d’environnement.
2. **Dépendances** : si nécessaires, `npm ci` depuis le lockfile ; génération des deux clients Prisma. Le setup desktop est neutralisé pendant l’installation des dépendances cloud, puis exécuté avec son propre profil.
3. **Vercel** : session existante réutilisée ou connexion officielle ; sélection/confirmation explicite du projet et de l’équipe ; récupération de production **avant génération des secrets**. Pas de modification de Preview/Development. Un override Electron, un NODE_ENV non production ou un nom de secret exposé publiquement bloque le plan avant déploiement.
4. **Neon/PostgreSQL** : session existante ou authentification officielle ; choix automatique lorsqu’une seule ressource existe, sinon sélection guidée ; création possible d’un projet/base/rôle en Europe si le compte est vide, uniquement après autorisation. Les deux véritables URLs sont récupérées. Les URLs manquantes sont sauvegardées immédiatement dans `.env.server.local`, avant les licences et migrations : un arrêt ultérieur ne les fait plus perdre. Une sélection différente d’une `DATABASE_URL` existante est refusée. Pour un PostgreSQL non-Neon existant, l’URL directe manquante est demandée sans deviner son hostname.
5. **Inspection SQL en lecture seule** : connectivité, tables et présence de **données métier** — les registres `_prisma_migrations`/`_gf_migrations` sont ignorés. Sur une base neuve, toutes les clés absentes sont générées sans saisie ; sur une base réellement utilisée, une clé absente n’est jamais régénérée à l’aveugle : importer l’original depuis le coffre, déclarer explicitement un domaine **jamais configuré** (`NONUTILISE`) ou demander explicitement `GENERER` avec confirmation.
6. **URL serveur automatique** : `https://garageflows.fr` est la cible du mode complet, sans saisie d’URL pour une nouvelle configuration. Une cible existante différente exige confirmation ; aucun secret/API key n’est changé à cette étape. `GF_APP_URL` reçoit cette URL lorsqu’elle est absente. Cela ne crée ni DNS ni domaine Vercel : le domaine doit appartenir à l’opérateur et pointer sur le projet autorisé. Les conflits avec des valeurs Vercel existantes restent bloquants, sans écrasement silencieux.
7. **Upstash** : session officielle réutilisée ou accès demandé (email + clé Developer API, pas le mot de passe du compte), récupération automatique de l’endpoint REST et du token. S’il n’existe pas de Redis, création possible sur autorisation avec **plan gratuit explicite**, TLS, région Europe et eviction désactivée. Si le fournisseur refuse/renvoie un format inexploitable, demander les deux valeurs REST manuellement. Aucun passage automatique au pay-as-you-go. Un **PING REST réel** doit réussir ; aucun repli mémoire PWA.
8. **Secrets** : génération indépendante de 32 octets pour les domaines applicatifs absents sur une nouvelle configuration : session, appareil, API admin, MAC licences, portail, signatures, SMTP, TOTP et sauvegardes. Pour une **base sans données**, préparation possible de la clé de chiffrement de facturation ; tous les drapeaux de facturation restent **OFF**. Les valeurs existantes restent inchangées. Sur une base utilisée, les replis historiques portail/signature sur le secret de session original sont préservés plutôt que remplacés par une nouvelle clé invalidant les liens/preuves. Les empreintes connues compromises bloquent le plan et nécessitent une rotation explicite.
9. **Licences** : import automatique de la paire P-256 locale existante ; sur une première installation à base vide, génération et enregistrement automatiques de la paire, puis synchronisation des ancrages publics. Une autorité locale existante dont le privé manque exige l’original ; aucune nouvelle paire ne la remplace automatiquement. Le remplacement d’une autorité connue reste soumis à confirmation explicite. La clé doit correspondre aux ancrages Next/Electron. Un PEM P-256 chiffré peut être importé avec sa passphrase (saisie masquée, mémoire uniquement) ; le PEM local du keygen conserve son chiffrement, tandis que le serveur reçoit la représentation attendue en variable Sensitive. Les clés commerciales des clients ne sont jamais créées automatiquement.
10. **Fichiers** : profil serveur, profil desktop séparé et configuration du keygen écrits aux emplacements réellement lus par le code. SQLite existante inspectée avant génération de clés manquantes ; une base absente est créée au chemin réellement configuré depuis le template, sans écraser une base existante. Une SQLite neuve issue du modèle (aucune ligne métier) reçoit automatiquement ses clés locales dans `.env`. Si un ancien `.env` contient PostgreSQL, demander sa migration et conserver une copie privée avant de créer le profil desktop.
11. **Clients packagés** : sur autorisation, aligner les défauts publics compilés de licence, mise à jour et liens publics sur les endpoints desktop validés (les endpoints existants distincts sont conservés) ; ajouter uniquement son hostname aux listes de téléchargement autorisées du client et du signer. Aucun secret dans ces modifications. Un `.env` seul ne configure pas les binaires déjà installés : **rebuild et distribution restent nécessaires**.
12. **SQL** : `migrate deploy`, `migrate status`, puis comparaison du schéma réel avec le schéma Prisma (`migrate diff --exit-code`). Base utilisée : confirmation `MIGRER` après vérification de sauvegarde/PITR. Drift/échec : arrêt ; jamais de `db push`, reset, seed démo destructif ou modification arbitraire de l’historique.
13. **Premier accès admin** : proposition explicite de créer une licence admin signée uniquement pour la première installation. Le jeton est dans un fichier local privé, pas dans le terminal. Aucune licence existante remplacée.
14. **Vercel production** : seconde lecture avant mutation, refus de conflit/changement concurrent, ajouts des variables absentes et remplacements explicitement autorisés. Valeurs transmises par stdin, pas par arguments de commande. Les remplacements de secrets illisibles sont nommément autorisés ; aucune suppression globale dans ce mode conservateur. Déploiement après succès SQL/synchronisation, puis contrôle `/api/health` du nouveau deployment via `vercel curl`. La sonde du domaine public est également contrôlée ; DNS/protection indisponibles apparaissent dans le rapport.
15. **Publication locale (avant migrations/déploiement)** : sur une installation dont la première autorité vient d’être générée automatiquement, création/enregistrement de la première clé Ed25519 **hors du dépôt**, sans copier-coller. Sinon, réutilisation/import de l’original ou création explicitement autorisée d’un nouveau canal. Ajout de sa clé publique sans retirer les clés historiques ; mémorisation seulement du chemin/keyId. La commande `release:sign` utilise automatiquement cette configuration. La clé privée n’est jamais envoyée au Vercel PWA.
16. **Keygen Python** : recherche d’un Python >=3.10, vérification de `cryptography`, installation utilisateur proposée par le plan si manquante ; impossibilité d’installation indiquée, pas de faux succès.

Les CLI téléchargés à la demande sont fixés : `vercel@64.0.2`, `neonctl@8.4.4`, `upstash@1.5.0`. Le poste doit pouvoir accéder à npm et aux comptes fournisseurs. Le configurateur n’enregistre pas leurs jetons dans le projet ; les CLI officiels gèrent leurs sessions. La création Redis gratuite utilise la Developer API authentifiée, sans inscrire les accès dans les sources.

## Où vont les valeurs ?

| Destination | Contenu / lecteur |
|---|---|
| `.env` | Desktop/développement SQLite uniquement. Clés locales distinctes du serveur. |
| `.env.server.local` | Serveur PostgreSQL, secrets et paramètres canoniques. Injectés explicitement à Prisma et synchronisés dans Vercel production. |
| `.env.legacy-server.local` | Copie privée d’un ancien profil serveur trouvé dans `.env`, uniquement si sa migration a été autorisée. |
| `keys/private.pem`, `keys/public.pem` | Paire P-256 de l’émetteur lue par le keygen et son packaging public. |
| `keys/server_config.json` | `url=https://garageflows.fr`, `api_key` identique au `GARAGEFLOW_API_KEY` du profil serveur destiné à Vercel, `max_mechanic` ; chargés automatiquement par `keygen_ui.py`. Aucun collage manuel de la clé dans l’interface. |
| `keys/bootstrap-admin-license.json` | Première licence admin signée, uniquement sur création explicitement autorisée. Jeton sensible. |
| `GarageFlow-configuration/keygen-runtime.json` | Lanceur Python détecté, sans credential. |
| Coffre **hors dépôt** | PEM privé Ed25519 de publication ; défaut `~/.garageflows-publisher/update-signing.pem`. Les symlinks vers l’intérieur du dépôt sont refusés. |
| `GarageFlow-configuration/publisher.json` | Chemin du coffre, keyId et clé **publique**, pas de PEM privé. |
| `GarageFlow-configuration/generated-keys.json` | Reçu de première création : empreinte **publique** de licence et état de préparation du premier signer, jamais de clé privée. Permet une reprise sans régénération. |
| `GarageFlow-configuration/report.json` | Étapes réussies/échouées et actions externes restantes, **sans secrets**. |
| `GarageFlow-configuration/repository-audit.md` | Analyse/inventaire local sans valeurs. |

`.env.server.local` n’est **pas chargé automatiquement par Next.js** : cela empêche les secrets serveur de supplanter le profil d’un build Electron. Les valeurs web réelles sont dans Vercel. Pour un autre hébergeur, importer le profil serveur dans son gestionnaire d’environnement sans le publier avec les sources.

Les destinations locales sensibles sont ignorées par Git et Vercel ; permissions POSIX `0600` (dossiers privés `0700`). Sous Windows, sécuriser aussi les ACL du compte. Ne jamais ajouter de force ces fichiers à Git. Les inconnues locales non canoniques sont conservées ; les paramètres connus incompatibles avec un profil ne sont retirés qu’après autorisation. Les commentaires `.env` sont remplacés par l’en-tête généré.

Dans un Electron **déjà installé**, les secrets session/MAC/SMTP et la clé interne sont gérés par le code sous userData ou en mémoire. Le configurateur ne les remplace pas par des clés partagées de production et ne prétend pas modifier à distance les postes.

## Commandes disponibles

```sh
npm run config                         # gestion idempotente des trois cibles
node config --profile full
node config --list                     # inventaire en lecture seule, sans valeurs
node config --diagnose-sql              # lecture seule : comparer PostgreSQL au schéma attendu
node config --profile desktop          # réglage ciblé local
node config --profile pwa               # réglage ciblé serveur
node config --profile licences         # réglage ciblé émetteur
node config --check --profile desktop   # lecture seule, hors ligne
node config --check --profile pwa --vercel
node config --check --profile licences --vercel
npm run config:audit
npm run test:config
npm run keygen                         # interface Python, configuration locale appliquée
npm run keygen -- --hwid                # CLI Python avec les mêmes paramètres
npm run release:sign -- --help          # wrapper qui réutilise le coffre configuré
```

Les profils ciblés restent des assistants à confirmations étape par étape ; le mode complet a une autorisation initiale pour la chaîne technique et ne redemande pas chaque commande sûre. Les valeurs dangereuses peuvent être corrigées dans les réglages avancés ; `GENERER` demande une génération explicite d’un secret symétrique, `SUPPRIMER` le retire du profil. Aucun remplacement automatique d’un secret non vide.

## Génération des clés dans le mode conservateur historique

Pour une **première installation**, lancer simplement `node config` (ou double-cliquer `config.cmd`), puis autoriser le plan avec `AUTORISER`. Aucune commande OpenSSL, valeur de clé, choix de format ou copier-coller n'est nécessaire pour les secrets locaux ci-dessous. Les connexions officielles Vercel/Neon/Upstash précèdent l'inspection de la base : cela évite de remplacer par erreur des secrets distants déjà existants.

| Usage | Génération et sauvegarde |
|---|---|
| Sessions, pepper d'appareil, portail, signatures, MAC/HMAC-SHA256, API interne GarageFlow | Secret indépendant de **32 octets aléatoires cryptographiques (256 bits)**, encodé en base64 ou hex selon le contrat ; `.env.server.local`. La même clé API est appliquée à `keys/server_config.json`. |
| SMTP, sauvegardes, TOTP, identifiants de facturation | Clés dédiées de 32 octets ; sauvegarde dans le profil compatible. La clé de facturation est préparée sur base serveur vide, sans activer la fonctionnalité. |
| Desktop | Secrets locaux distincts enregistrés dans `.env`, pas les clés privées de l'émetteur. Sur une SQLite **sans donnée métier**, toutes les clés desktop absentes sont créées sans aucune saisie. |
| Licence | Paire **P-256** dans `keys/private.pem` et `keys/public.pem`, privé encodé pour le serveur, ancrages Next/Electron synchronisés automatiquement. Les clients déjà installés et garagesite3 ne sont pas modifiés : propagation de la clé publique/reconstruction nécessaires pour la nouvelle autorité. |
| Signature des mises à jour | Première clé **Ed25519** au chemin `~/.garageflows-publisher/update-signing.pem`, hors dépôt ; clé publique ajoutée sans retirer les anciennes, chemin/keyId appliqués au lanceur `release:sign`. Préparée avant SQL/déploiement pour conserver les clés lors d'une interruption. |

### Ce qui est considéré comme « base vide »

Seules les tables **métier** comptent. Les registres de migrations `_gf_migrations` (SQLite desktop, baseline du modèle livré) et `_prisma_migrations` (PostgreSQL) sont ignorés, exactement comme `sqlite_%`. Sans cette distinction, une base **neuve** créée depuis `prisma/garageflow-template.db` paraissait déjà « contenir des données » à cause de ses 214 lignes de registre, et le plan réclamait des clés originales (`NEXTAUTH_SECRET`, `GF_DB_MAC_SECRET`, `GF_BACKUP_KEY`, `GF_TOTP_ENC_KEY`…) qui n'avaient jamais existé. Le comportement correct est désormais : base neuve ou sans ligne métier → génération automatique complète ; base contenant réellement des données métier → original du coffre, `NONUTILISE` (déclaration explicite, génération d'une nouvelle clé) ou `GENERER` (confirmation explicite). Une confirmation refusée arrête le plan sans écrire de remplacement.

### Variable existant chez Vercel sans être relisible (`Sensitive`)

Une variable `Sensitive` illisible **existe déjà**. La remplacer constitue une
rotation ; télécharger à nouveau le dépôt ne prouve pas que la production est neuve.

| Situation | Ce que fait `config` |
|---|---|
| Valeur locale avec reçu du même projet et de la même version distante | Réutilisée, sans question ni rotation. |
| Valeur locale sans reçu fiable, ou URL récupérée de Neon | Confirmation groupée que ce sont les **originales de ce projet**, sans remplacement. Choisir une autre base Neon ne récupère pas la connexion de production. |
| Empreinte locale différente du reçu de ce projet/version | Une autorisation explicite de remplacement est exigée. |
| Secret symétrique illisible absent localement, plan complet | Résolution différée jusqu’à l’inspection SQL réelle de la cible confirmée. Base sans données métier : génération 256 bits et remplacement automatiques. Base utilisée : accord groupé explicite, sinon valeurs originales nécessaires. |
| Même secret dans un profil expert sans inspection SQL | Accord groupé explicite avant génération et remplacement. Aucun accord implicite déduit des fichiers du PC. |
| Secret réellement absent du profil et de Vercel | Génération par le plan habituel après contrôle de la base, puis sauvegarde locale et ajout à Vercel. |
| `DATABASE_URL` / `DIRECT_URL` | Récupération des vraies connexions via Neon (projet/branche/base/rôle existants), ou saisie des originales si cet accès est indisponible. Aucune URL inventée, aucun nouveau projet créé dans cette récupération. |
| Mot de passe SMTP, clé d’API externe, clé privée perdue | Non générable comme identifiant de service ou comme récupération d’autorité : fournir l’original ou suivre une procédure de rotation explicite. |

Le remplacement Vercel utilise `env rm`, puis `env add --sensitive`.
**Ces deux opérations ne sont pas atomiques** : un échec après suppression peut
laisser la variable absente. Le profil local sauvegardé avant la synchronisation
conserve la nouvelle valeur pour une relance. Aucun reçu de succès n’est écrit
si la vérification finale échoue. Présence et métadonnées sont relues ; cela
atteste l’écriture ; lorsqu’une valeur reste masquée, elle ne permet pas de
comparer son contenu. Les valeurs effectivement relisibles sont comparées.

Le fichier **`GarageFlow-configuration/secrets-receipt.json`** (`0600`, ignoré par
Git) ne contient aucune valeur secrète : empreintes SHA-256, identifiants
équipe/projet et version distante. Un reçu absent, illisible, ancien sans ces
métadonnées, d’un autre projet ou correspondant à une variable modifiée ne
permet pas l’adoption automatique. Pour une valeur déjà illisible et jamais
envoyée par cet outil, la première concordance repose sur la confirmation de
l’opérateur, pas sur une comparaison que Vercel ne permet pas.

### Où chaque clé générée est écrite

Le plan complet termine par l'étape **`récapitulatif-des-clés-et-destinations`** qui affiche, pour chaque clé créée durant l'exécution, ses destinations réelles (noms uniquement, jamais de valeur) et les enregistre dans `GarageFlow-configuration/report.json` (`keys[]`).

| Clé générée | Destinations |
|---|---|
| `NEXTAUTH_SECRET` | `.env` (desktop) et/ou `.env.server.local` + Vercel production (Sensitive) |
| `DEVICE_TOKEN_PEPPER`, `GF_PORTAL_SECRET`, `GF_EINVOICE_CREDENTIALS_KEY` | `.env.server.local` + Vercel production (Sensitive) |
| `GARAGEFLOW_API_KEY` | `.env.server.local` + `keys/server_config.json` (keygen) + Vercel production (Sensitive) |
| `GF_DB_MAC_SECRET`, `GF_SIGNATURE_SECRET`, `GF_BACKUP_KEY`, `GF_SMTP_CIPHER_KEY`, `GF_TOTP_ENC_KEY` | `.env` (desktop) et/ou `.env.server.local` + Vercel production (Sensitive) ; `GF_BACKUP_KEY` sert aussi aux sauvegardes chiffrées |
| `GF_PRIVATE_KEY` (P-256, non symétrique) | `.env.server.local` (base64) + `keys/private.pem` + `keys/public.pem` + ancrages publics Next/Electron |
| Clé Ed25519 de publication | coffre **hors dépôt** uniquement ; clé publique + keyId dans `GarageFlow-configuration/publisher.json` et `electron/update-verify.js` |

Vercel reçoit les variables **absentes** de l'environnement production (ajout simple) et, lorsque c'est décidé nommément (valeur générée pour une clé introuvable, ou écart local autorisé), le **remplacement** d'une variable non relisible — jamais une suppression « au cas où ». Tout est transmis en Sensitive. Les clés desktop restent distinctes de celles du serveur et ne sont jamais envoyées à Vercel.

**SHA-256 est un algorithme de hash/HMAC, pas une clé à taper.** Config génère le secret aléatoire utilisé par l'algorithme ; les empreintes publiques sont calculées automatiquement. Les fichiers sensibles sont ignorés par Git/Vercel et protégés en `0600` sous POSIX ; les premières écritures de clés refusent un fichier déjà existant, même en cas de création concurrente. Sous Windows, les ACL restent à sécuriser sur le poste.

Une relance **conserve et réutilise** les secrets enregistrés, et peut reprendre une synchronisation publique interrompue avec exactement la même paire. Une clé de publication déjà initialisée puis perdue n'est pas régénérée automatiquement. Si la base contient des données, si une clé publique/configuration d'émetteur existe sans le privé, ou si le reçu de création diverge, l'outil exige les originaux ou s'arrête : générer des valeurs différentes ne récupérerait pas les données/licences. Les champs `*_OLD` sont réservés aux vraies clés historiques et ne sont jamais remplis avec du hasard.

Les clés d'API **Anthropic, Vercel, Neon, Upstash** sont délivrées par leurs fournisseurs : config réutilise les sessions/accès autorisés et récupère les connexions disponibles, mais ne fabrique pas de faux jetons. Les profils ciblés restent des modes experts ; la première génération sans choix de source de licence est automatisée dans le mode complet par défaut.

## Toutes les variables `.env` : accès et vérification

`node config --list` (Windows : `config.cmd --list`) vérifie que chaque nom du template a une décision et affiche les profils/destinations **sans aucune valeur**. Un nom nouveau non déclaré fait sortir la commande avec le code 1. Le contrat courant comprend 48 noms du template : 46 paramètres applicatifs, `GF_INTERNAL_EXPORT_KEY` générée par le runtime Electron, et `GF_UPDATE_SIGNING_KEY` réservée au coffre de publication. Les paramètres applicatifs du manifeste absents du template sont également proposés : 54 au total, répartis entre les profils compatibles, jamais tous copiés dans le client.

Le mode complet propose explicitement **« Personnaliser les variables facultatives du serveur »**, puis la même option pour le desktop, même si la configuration est déjà valide. Les réglages serveur précèdent l'inspection de la base et la génération de clés ; une correction ne peut pas changer silencieusement une cible déjà inspectée. Le mode ciblé propose ses **réglages avancés**. Saisir le nom exact, sa valeur, puis Entrée au prochain nom pour terminer. Entrée conserve une valeur existante ; `SUPPRIMER` la retire. Les clés restent masquées et leur modification requiert confirmation.

Deux commandes évitent de saisir les noms un par un : **`GENERER`** (ou `GENERER-TOUT`) génère d'un coup toutes les clés symétriques encore absentes du profil, avec la liste des destinations et une confirmation unique ; **`LISTE`** réaffiche les variables du profil. `GENERER` est également accepté comme **valeur** d'un secret symétrique (confirmation par clé). Dans tous les cas, `GENERER` ne remplace jamais une valeur déjà enregistrée et ne sert pas à récupérer une clé perdue : les champs historiques `*_OLD` ne sont jamais remplis automatiquement.

Les variables personnalisées déjà présentes dans le fichier du profil sont conservées et proposées dans ces réglages ; leurs valeurs sont masquées. Elles ne sont **pas synchronisées automatiquement vers Vercel**. Les variables système, runtime, de publication, les alias obsolètes et celles d'un autre profil ne deviennent pas des secrets applicatifs. `--check --profile …` refuse les paramètres connus hors profil ; il n'efface rien. Le mode complet et les profils ciblés exigent une autorisation avant retrait de paramètres incompatibles.

Les chemins Windows de sauvegardes/photos et les URL SQLite `file:` sont normalisés en `/` à l'écriture, y compris les chemins UNC. Les mots de passe personnalisés contenant des guillemets ou des antislashs utilisent un délimiteur dotenv compatible ; les caractères `$` restent littéraux. Les valeurs multilignes/NUL ou une combinaison de guillemets non représentable sans ambiguïté sont refusées, jamais tronquées. Les PEM passent par l'import de fichier/base64 prévu. Les endpoints HTTP publics refusent identifiants intégrés, query et fragment ; les identifiants des URL PostgreSQL restent autorisés.

`--list` signale aussi les overrides Next.js présents (`.env.local`, `.env.production`, etc.) : **config ne les modifie pas**, et ils peuvent primer sur `.env`. Leur présence ne doit pas être confondue avec une configuration du profil géré. `.env.server.local` reste une destination explicite, pas un fichier chargé automatiquement par Next.js.

Les commandes Windows avec arguments ne font plus de pause finale bloquante et conservent le code de sortie de Node ; le double-clic sans arguments garde la pause pour lire le résultat. Un contrôle `--check` réussi signifie uniquement « syntaxe/contrat du profil valide » : aucune connexion, licence réelle, migration ou disponibilité cloud n'est prouvée par ce contrôle.

## Ce qui ne peut pas être configuré honnêtement tout seul

- **Secret Vercel Sensitive non relisible** : l’assistant détecte qu’il existe et ne confond jamais son placeholder avec une absence. Il le RÉSOUT (valeur locale conservée, URL de base récupérée auprès de Neon, clé symétrique manquante générée puis remplacée après inspection SQL vide dans le plan complet, ou après autorisation explicite) — voir la section dédiée ci-dessus. Ce qu’il ne peut pas faire : retrouver une valeur que personne n’a conservée **et** qui doit correspondre à un service externe ; celle-là reste à fournir, et aucune valeur inventée ne la remplace.
- **Clé privée perdue** : impossible de la retrouver depuis une clé publique ou des données chiffrées. Nouvelle autorité/nouveau canal sur confirmation seulement ; les anciens clients/licences peuvent rester incompatibles.
- **Stockage durable Vercel** : les services actuels de sauvegarde et publication/upload des installateurs écrivent sur disque. Un stockage objet et une adaptation applicative sont nécessaires. Mettre `/tmp/backups` ne suffit pas ; un chemin local de stockage durable est refusé pour le profil Vercel. Les photos ont une voie legacy base64 lorsque le stockage fichier est désactivé, pas une intégration objet automatique.
- **garagesite3** : le serveur de publication/control-plane externe n’est pas dans ce checkout. Le signer local et les ancrages clients peuvent être préparés, pas déployer du code absent. Le rapport demande l’accès et la propagation publique/keyId nécessaires.
- **SMTP, identité légale, plateformes de facturation** : données et accès réels du garage, à fournir dans l’application. La préparation de clés ne crée pas ces comptes et n’active pas la facturation. Les clés historiques de SMTP/TOTP/facturation doivent être préservées pour relire les enregistrements existants.
- **Copilot LLM** : son provider réseau n’est pas implémenté. La clé Anthropic configure l’OCR existant ; le reste nécessite du code, pas une variable fictive.
- **Node/Python/Tkinter/permissions système, signature de code Windows, DNS, limites ou conditions fournisseurs** : intervention possible sur le poste/compte. Aucun mot de passe utilisateur ou paiement fourni à votre place.

Le résultat peut donc être **configuré avec actions externes restantes**, jamais « tout opérationnel » malgré une étape échouée ou non réalisable.

## Reprise et précautions

Les fichiers locaux sont écrits avant synchronisation ; une interruption peut avoir laissé des migrations ou quelques ajouts Vercel déjà appliqués. **Relancer `config`**, qui relit les configurations et conserve les clés. Aucun rollback destructif automatique. La licence admin candidate est enregistrée avant insertion pour permettre la reprise sans afficher le jeton.

Un verrou local empêche deux plans complets simultanés. Après un arrêt brutal, vérifier qu’aucun processus config ne tourne puis retirer uniquement `GarageFlow-configuration/config.lock` avant de reprendre. Ne jamais supprimer un verrou pendant une configuration active.

Conserver une sauvegarde chiffrée des secrets dans un coffre indépendant. Avant migration d’une base utilisée, vérifier PITR/sauvegarde chez le fournisseur. Les contrôles unitaires et les fournisseurs simulés ne constituent pas un déploiement réel sur vos comptes : la connexion et les sondes réelles sont effectuées lors de l’exécution autorisée sur votre poste.

## Arrêt à la vérification de drift SQL

`migrate deploy` et `migrate status` précèdent la comparaison du schéma. Une sortie non nulle de cette comparaison arrête le plan avant synchronisation Vercel et déploiement. Le configurateur distingue maintenant :

- **Code Prisma 2** : différence de schéma détectée ; il faut analyser les migrations/schéma, sans réinitialiser la base.
- **Autre code / code indisponible** : comparaison impossible (erreur technique), ce qui ne prouve pas un drift.

Après un arrêt, lancer `node config --diagnose-sql`. Ce diagnostic utilise explicitement `.env.server.local`, pas le profil SQLite `.env`. Si une URL manque, il propose la connexion Neon officielle puis la sélection explicite de l’organisation, du projet, de la branche, de la base et du rôle existants. Il récupère les deux URLs réelles et enregistre uniquement les paramètres manquants dans le fichier local, sans remplacer les autres secrets/commentaires. La session CLI existante est réutilisée ; une session absente nécessite la connexion navigateur. Aucun projet ni base ne peut être créé dans ce mode. La comparaison SQL ne lance que `prisma migrate diff` : aucune migration, synchronisation Vercel ou correction de données. Les sorties brutes du fournisseur restent masquées ; le code, son interprétation et un résumé structurel sont affichés. Le résumé ne montre que les tables/colonnes connues du contrat Prisma et les catégories de contraintes : ni URLs, ni valeurs par défaut, ni noms arbitraires provenant de la base. Un format non reconnu reste masqué au lieu de divulguer la sortie brute. Les codes de sortie 0/2/1 signifient respectivement conforme/drift/erreur technique. Un résultat non nul est donc attendu si le problème persiste. Ne pas contourner le contrôle par reset, suppression de base ou `db push`.

## Configuration automatique du serveur dans keygen_ui

`node config` (mode complet) sélectionne désormais directement `https://garageflows.fr` comme URL serveur. Il reprend la `GARAGEFLOW_API_KEY` existante du serveur ou, sur une nouvelle configuration autorisée, en génère une seule. La même valeur est écrite dans `.env.server.local` et `keys/server_config.json`, puis proposée au projet Vercel autorisé après succès des contrôles SQL. Une clé Vercel Sensitive non récupérable nécessite toujours son original ; aucune nouvelle clé ne la remplace silencieusement.

À la prochaine ouverture via `npm run keygen`, l’onglet Serveur lit automatiquement `url` et `api_key` dans ce JSON. Si le keygen est déjà ouvert, le fermer puis le rouvrir pour recharger les valeurs. Le fichier est créé avant les migrations : un arrêt SQL laisse donc les champs du keygen préremplis, mais ne prouve pas que le serveur distant possède ces valeurs ou que la connexion fonctionne. Une clé locale différente exige une confirmation d’alignement, jamais une rotation serveur automatique.

### URLs PostgreSQL absentes lors du diagnostic

Lancer `node config --diagnose-sql`, accepter la récupération Neon proposée, puis sélectionner la base **existante**. Le programme obtient la connexion poolée (`DATABASE_URL`) et la connexion directe (`DIRECT_URL`) depuis Neon, sans exposer leurs valeurs. L’enregistrement local des seules URLs manquantes est une opération explicitement autorisée ; la base reste en lecture seule. Une annulation, une sélection incompatible avec une URL déjà présente ou un compte sans projet accessible arrête la récupération sans créer de ressource. Une URL existante non-Neon n’est jamais remplacée par une ressource Neon : utiliser son fournisseur d’origine.

Cela récupère les connexions PostgreSQL, **pas les secrets applicatifs perdus** (chiffrement, licences, API admin). Ceux-ci doivent rester dans leurs fichiers/coffres originaux.

## Chemin automatique des clés et correction du drift JobPart

La clé privée est recherchée automatiquement dans `<dossier-du-dépôt>/keys/private.pem` (sur Windows, le chemin absolu utilise le dossier courant du dépôt, sans nom d’utilisateur codé en dur). Si elle existe, aucune saisie de source/chemin n’est demandée : la paire P-256 est vérifiée contre la clé publique embarquée **avant** l’import. Le fichier original reste inchangé, y compris s’il est chiffré. Sinon, la saisie propose ce chemin comme valeur par défaut ; les chemins collés entre guillemets sont acceptés. Les sorties attendues du keygen restent `keys/private.pem`, `keys/public.pem` et `keys/server_config.json`.

Le drift confirmé sur `JobPart.unitPriceTenThousandths` et `JobPart.unitCostTenThousandths` provenait des `DEFAULT 0` conservés par la migration monétaire PostgreSQL alors que le contrat Prisma exige des snapshots explicites. La nouvelle migration `20261014000000_jobpart_snapshot_defaults` retire uniquement ces deux DEFAULT. Les champs restent `Int` obligatoires, sans défaut côté Prisma. Les migrations historiques/checksums ne sont pas modifiés, aucune colonne n’est supprimée et aucun montant n’est réécrit par ce correctif.

Après mise à jour de `config` et ajout du dossier de migration `prisma/server/migrations/20261014000000_jobpart_snapshot_defaults`, relancer `node config`. Le plan régénère les clients Prisma, applique la nouvelle migration puis vérifie le drift avant déploiement. Un simple `--diagnose-sql` reste en lecture seule et ne peut pas appliquer le correctif. Tout autre drift reste bloquant ; pas de reset ni de contournement. Le correctif a été vérifié par validation/DMMF Prisma 5.22 WASM et rejeu des 22 migrations dans PostgreSQL embarqué PGlite, avec vérification des defaults et préservation de snapshots monétaires de test ; cela ne constitue pas une exécution sur le compte Neon de l’opérateur.
