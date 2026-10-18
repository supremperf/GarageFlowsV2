<!-- doc-numbers: journal -->
<!-- Journal de mesures DATÉES : les comptes de tests cités sont le résultat
     d'exécutions horodatées de ce programme, jamais une revendication d'état
     courant. L'état courant fait foi dans docs/audit/FINAL_VERIFICATION_BASELINE.md. -->

# GarageFlows — Programme de durcissement final

Journal du programme « FINAL HARDENING & REMAINING FINDINGS ». Chaque entrée
porte une cause racine, une reproduction, un correctif, un test, et — quand la
propriété s'y prête — une mutation qui prouve que le test détecte l'absence du
correctif.

Base de départ : `0b313da`. Aucun rapport antérieur n'a été cru sur parole ;
tout ce qui suit a été constaté sur le code courant.

---

## 1. Facturation électronique — l'idempotence tenait, le rejeu non

Le finding disait « idempotence sans verrou », classé P2. Les deux moitiés
étaient fausses.

**Le verrou existait.** Clé déterministe dérivée du garage et de la facture,
contrainte `UNIQUE` sur `EInvoiceTransmission.idempotencyKey`, réservation
effectuée AVANT l'appel réseau. Vingt requêtes concurrentes sur une facture
jamais transmise donnent bien un seul envoi.

**Et le défaut réel était plus grave que P2.**

### GF-DUR-001 [P1] — Vingt déclarations de la même facture à la plateforme agréée

**Cause racine.** La contrainte d'unicité protège la NAISSANCE de la ligne. Au
REJEU, la ligne existe déjà : le verrou a joué son rôle et ne protège plus rien.
Ce qui décide d'envoyer redevient une LECTURE de statut suivie d'une ÉCRITURE,
et l'intervalle entre les deux est ouvert à tous.

```ts
const existante = await db.eInvoiceTransmission.findFirst({ … })
const jamaisAboutie = existante && !existante.externalId
                   && STATUTS_REJOUABLES.has(existante.status)
if (!jamaisAboutie) return …
await db.eInvoiceTransmission.update({ where: { id: existante.id }, … })  // ← sans prédicat
```

**Scénario.** La plateforme a répondu 401 — clé API pas encore activée, cas le
plus courant d'une première configuration. Statut `error`, rien n'est parti, le
rejeu est légitime. L'exploitant corrige et double-clique ; ou deux onglets sont
ouverts ; ou deux instances du serveur traitent la même file derrière un
répartiteur. Chacun lit `error`, chacun en conclut qu'il peut renvoyer.

**Reproduction.** `submit-replay.test.ts` — vingt appels concurrents sur une
transmission `error` : **20 envois réseau, 20 créances déclarées pour une seule
vente**.

**Correctif.** Le droit de renvoyer se prend par la BASE, en une opération dont
le prédicat porte les deux conditions du rejeu :

```ts
const prise = await db.eInvoiceTransmission.updateMany({
  where: { id: existante.id, garageId, externalId: null,
           status: { in: Array.from(STATUTS_REJOUABLES) } },
  data:  { status: 'submission_pending', … },
})
if (prise.count !== 1) return etatConnu(await relire())
```

Le moteur verrouille la ligne ; une seconde tentative réévalue le prédicat sur
la version validée par la première et ne trouve plus rien à mettre à jour. Un
seul appelant obtient `count === 1`. Un `Set` en mémoire n'aurait couvert que le
cas mono-instance, en donnant l'illusion d'être protégé.

**Mutations.** 5/5 détectées (retour au simple `update`, prédicat sans statut,
prédicat sans identifiant externe, perdant qui continue, prise sans borne de
garage).

### Le premier test ne prouvait rien — et passait

Écrit avant le correctif, il rendait déjà « 1 envoi ». Cause : le simulacre de
base rendait **la ligne** au lieu d'un instantané. L'écriture du gagnant
devenait visible dans l'objet déjà lu par les perdants, qui renonçaient
d'eux-mêmes. Le test mesurait une propriété du simulacre.

Les deux simulacres rendent désormais des copies, et chaque opération s'exécute
sans `await` interne — ce qui modélise le verrou de ligne du moteur, et laisse
entrelaçable exactement ce qui l'est en production.

### GF-DUR-002 [P1] — Une facture définitivement intransmissible après un arrêt brutal

**Cause racine.** Une transmission tuée entre la réservation et le traitement de
la réponse — redéploiement, coupure, plantage — reste `submission_pending`. Elle
n'était ni rejouable (statut hors des rejouables) ni déclarable non parvenue
(réservée à `unknown`). **Aucun chemin ne la débloquait**, ce qui est exactement
la panne que la gestion des 401 avait déjà éliminée ailleurs.

**Correctif.** Au-delà de `DELAI_ABANDON_MS` (quinze minutes ; l'adaptateur
abandonne ses appels à vingt secondes, la marge couvre reprises et horloges mal
réglées), la transmission est reconnue ABANDONNÉE et la déclaration humaine
redevient possible. Pas le rejeu automatique : épistémiquement, cet état est
identique à `unknown` — nul ne sait ce que la plateforme a reçu.

Le seuil est reporté DANS le prédicat de la prise, et pas seulement évalué
avant : entre la lecture et l'écriture, la transmission a pu être déclarée puis
relancée, et une déclaration périmée l'aurait abattue en plein vol.

### GF-DUR-003 [P1] — Toute la chaîne d'émission était inatteignable

**Quatrième occurrence du même défaut dans ce produit.**

| Fonction | Route | Interface |
|---|---|---|
| `envoyerFacture` | existe | **aucune** |
| `declarerNonParvenue` | existe | **aucune** |
| `rafraichirStatut` | **aucune** | aucune |

`declarerNonParvenue` est la SEULE sortie de l'impasse « issue inconnue » : le
correctif GF-DUR-002 aurait été lui-même inatteignable.

**Correctif.** `EInvoicePanel` monté dans la modale de facture, trois actions
déclenchables, `action: 'refresh-status'` ajoutée à la route. Tous les droits
(`peutEmettre`, `peutRelireStatut`, `peutDeclarerNonParvenue`) sont calculés par
le SERVEUR : recopier la règle des quinze minutes côté écran garantirait qu'un
jour un bouton mène à un refus. La déclaration de non-parvenance exige une
confirmation explicite — faite à tort, elle produit ce que toute la chaîne
existe pour empêcher.

---

## 2. Taux horaire — une famille de replis, pas une constante

Le finding disait « taux horaire codé en dur à 60 € », classé P3. Ce n'était pas
une constante oubliée mais une famille de replis silencieux sur quatre fichiers,
tous fabriquant une donnée de facturation que le garage n'avait pas choisie.

### GF-DUR-004 [P1] — Un garage en franchise de TVA facturait 20 %

**Cause racine.** `src/components/SettingsModal.tsx` :

```ts
hourlyRate: parseFloat(s.hourlyRate) || 60,
taxRate:    parseFloat(s.taxRate)    || 20,
```

`||` ne distingue pas « rien saisi » de « zéro saisi ». Or zéro est une valeur de
gestion ordinaire :

- un garage en **franchise en base de TVA** (art. 293 B du CGI) — cas courant
  chez les indépendants — facture à 0 %. L'écran écrivait **20 %**, et chaque
  facture réclamait au client une taxe que le garage n'a pas le droit de
  collecter, et qu'il devrait au Trésor s'il l'encaissait ;
- un atelier qui ne facture pas la main-d'œuvre à l'heure saisit 0 €/h. Le
  serveur l'accepte explicitement (`z.number().min(0)`, et un test le
  documente) ; l'écran écrivait 60 €/h ;
- un dépannage ouvert dès minuit saisit 0 h ; l'écran écrivait 8 h.

Dans les trois cas la valeur fautive partait sous un message « Enregistré ». **Le
serveur n'a jamais eu son mot à dire** : il recevait une valeur déjà falsifiée.

**Correctif.** `lib/settings/saisie-numerique` : un champ vide ou illisible ne
dit rien et n'est **pas envoyé** — le serveur conserve alors sa valeur. La
virgule décimale d'un clavier français est comprise (`parseFloat('49,90')`
valait 49). Le motif d'un refus serveur est désormais affiché.

**Mutations.** 9/9 détectées (4 sur l'écran, 5 sur l'analyse de saisie).

### GF-DUR-005 [P2] — Un champ effacé s'enregistrait comme un zéro voulu

`FeaturesTab` tenait ses champs numériques en `number` ; `Number('')` vaut 0.
Effacer le tarif l'enregistrait à 0 €/h. La saisie brute est conservée jusqu'à
l'envoi. Les bornes de l'écran sont alignées sur celles du serveur — `min={1}`
interdisait ce que l'API accepte, `max={999}` refusait ce que l'autre écran
laissait passer.

### GF-DUR-006 [P2] — Replis de calcul

`finance`, `quotes/generate`, `analytics/collect`, `JobModal` retombaient sur
`60` quand le garage était introuvable. Un devis chiffré sur un tarif inventé
part au client sans que rien ne le distingue d'un vrai : la génération est
désormais **refusée** (404). Les tableaux de bord affichent 0 — un zéro se voit,
un faux tarif se croit.

### Arithmétique vérifiée (§15, §16)

Les six tarifs et cinq durées exigés par le programme, en centimes entiers :
1,5 h × 75 € = **112,50 €** exactement ; 0,25 h × 125,50 € = **31,38 €**, arrondi
une seule fois.

### Documents historiques (§14)

Une ligne de facture porte son propre prix unitaire ; aucun montant n'est dérivé
du garage. Changer le tarif demain ne peut donc pas recalculer une facture
d'hier — propriété verrouillée par test sur le schéma et sur la route de mise à
jour des réglages.

---

## 3. Adresse du client — le sens qui manquait

### GF-DUR-007 [P1] — Le garage ne pouvait pas corriger une adresse

**Cause racine.** Le sens portail → garage existait. L'inverse n'existait pas, et
pas par oubli de propagation : **aucune route ne permettait au garage de modifier
la fiche d'un client**. `/api/clients` n'exposait que `GET` et `POST` ;
`UpdateClientSchema` était écrit, validé, exporté, appelé nulle part.

Le garage corrigeait une adresse mal saisie… nulle part, et continuait d'écrire
à l'ancienne pendant que le client se connectait avec elle.

**Politique retenue (§19).** Les deux adresses restent égales. Chacun peut la
changer, pas au même prix :

- le **client** doit la PROUVER (`pendingEmail` + lien de confirmation) — sans
  quoi un cookie volé suffirait à s'approprier le compte ;
- le **garage** l'applique tout de suite. Il est l'émetteur de cet accès et le
  teneur du carnet d'adresses ; attendre le clic d'un client qui ne relève plus
  son ancienne boîte laisserait la fiche fausse indéfiniment. Cela ne lui donne
  aucun pouvoir nouveau : il consulte déjà l'intégralité du dossier.

L'asymétrie porte sur la preuve exigée, **jamais sur le résultat**.

**Ce que la propagation entraîne.**

| Effet | Motif |
|---|---|
| `emailVerified` → faux (§23) | l'ancienne preuve portait sur l'ancienne adresse |
| sessions coupées (§21) | l'identifiant de connexion vient de changer |
| `pendingEmail` annulé (§25) | la demande du client visait un état qui n'existe plus |
| collision refusée (§22) | avant toute écriture, bornée au garage |
| journal complet (§26) | avec les deux adresses : sans elles, on saurait qu'un identifiant a changé sans pouvoir dire de quoi vers quoi |

**Mutations.** 10/10 détectées.

**Interface.** Édition de fiche dans le panneau Clients, avec l'avertissement posé
AVANT l'enregistrement — après, ce serait un constat et non un choix — et le
compte rendu des conséquences réelles, y compris l'échec d'envoi de l'avis.

---

## 4. Passe adversariale — routes sans appelant

Le défaut « une route correcte que personne n'appelle » s'étant produit quatre
fois, il a été recherché **systématiquement** plutôt qu'au cas par cas.

**Constat : 159 routes, 37 sans aucun appelant** dans tout le code (composants,
pages, Electron, tests).

Trois catégories, très inégales :

| Catégorie | Nombre | Ce que cela signifie |
|---|---|---|
| `cadre` | 1 | imposée par NextAuth |
| `exploitation` | 5 | destinée à un opérateur, sans interface attendue |
| `double` | 5 | la fonction est atteignable ailleurs ; surface HTTP en trop |
| **`sans-interface`** | **26** | **la fonctionnalité n'existe pas pour l'utilisateur** |

Le dernier groupe est le seul qui compte, et il est large. En particulier :

- **le portail client** : messagerie (`tickets`), prise de rendez-vous, double
  facteur, gestion des appareils — écrits, testés, et absents des cinq pages du
  portail ; le client ne peut ni écrire à son garage, ni prendre rendez-vous, ni
  activer le double facteur que le schéma porte, ni révoquer une session ;
- **cinq modules** dont le cœur métier n'est appelé que par leur propre route :
  optimisation des prix, planification intelligente, mémoire du garage,
  gamification, assistant proactif ;
- **les licences** : l'exploitant ne voit pas ses postes activés et ne peut en
  libérer aucun — un ordinateur remplacé consomme une place à vie ;
- alertes de contrôle technique, alertes de stock bas, suggestions de rappels,
  historique véhicule.

**Aucune de ces fonctions n'est « décorative » au sens strict** : aucun bouton ne
les promet. Ce sont des fonctions absentes, pas des mensonges à l'écran — la
distinction a été vérifiée (aucun composant ne mentionne ces modules).

**La garde.** `routes-sans-appelant.test.ts` fige l'inventaire. Elle n'exige pas
que tout soit branché : elle exige que chaque route sans appelant soit une
DÉCISION portant un motif écrit, et qu'aucune ne s'ajoute en silence. Elle échoue
aussi si une entrée devient périmée, pour que l'inventaire ne cesse jamais de
décrire la réalité.

### La garde a d'abord dû se corriger elle-même

Premier usage : elle comptait une route citée **en commentaire** comme appelée.
Le panneau de licence explique dans son en-tête pourquoi il n'appelle PAS
`/api/license/deactivate` — et cette phrase suffisait à la déclarer branchée.
Une garde qu'un commentaire désarme ne garde rien.

Après retrait des commentaires du corpus, **trois routes de plus** sont
apparues, jusque-là masquées par de la prose : `/api/forecast`,
`/api/profitability` et `/api/suggestions`. Les deux premières figurent parmi les
« modules livrés en qualité entreprise » de `docs/DELIVERY_STATUS.md`.

### Reclassement après vérification

`/api/parts/low-stock` était classée `sans-interface`. Vérification faite, le
panneau Stock calcule déjà le même prédicat (`quantity <= minQuantity`) côté
client depuis `/api/parts`, et propose un onglet « stock bas ». La fonction EST
atteignable : la route en est un second point d'entrée. Bâtir un écran de plus
aurait été un doublon, pas une correction. Reclassée `double`.

---

## 6. Branchement des fonctions absentes — premier lot

### GF-DUR-010 [P1] — Un poste remplacé consommait un siège à vie

**Cause racine.** `GET /api/admin/licenses/[id]/devices` et
`POST /api/admin/licenses/[id]/devices/[deviceId]` existaient, éprouvés, sans
aucun écran. Or l'auto-désactivation (`/api/license/deactivate`) ne peut rien y
faire : elle exige le `deviceToken`, que **seul l'appareil détient**. Une machine
en panne, volée ou remplacée ne se libère donc pas elle-même — il faut passer par
l'éditeur, et c'était la seule sortie, sans porte.

**Correctif.** `LicenseDevices` dans la zone d'administration, chargé à
l'ouverture du détail d'une licence. Les deux gestes sont nommés par leur
CONSÉQUENCE, jamais par leur verbe technique :

| Écran | Route | Effet |
|---|---|---|
| **Libérer le siège** | `reset` | siège rendu, la machine pourra se réactiver — SAV, poste remplacé |
| **Révoquer** | `revoke` | siège conservé, la machine bannie — poste volé |

Les confondre coûte cher dans les deux sens : libérer un poste volé le laisse
revenir, révoquer un poste remplacé prive le client d'un siège qu'il a payé.

### GF-DUR-011 [P2] — L'exploitant ne voyait pas ses sièges

`GET /api/license/devices` sans écran : quand l'activation échouait faute de
siège, l'exploitant n'avait aucun moyen de comprendre pourquoi. La modale de
licence affiche désormais `activeCount / seats` et la liste.

**En lecture seule, et c'est dit.** Aucun bouton de libération n'y figure : il ne
pourrait pas fonctionner. L'écran indique quoi faire à la place.

### GF-DUR-012 [P1] — Le client ne pouvait pas fermer une session

`GET` et `POST /api/portal/auth/devices` existaient ; aucune des cinq pages du
portail ne les appelait. Le client ne pouvait ni voir où son compte était ouvert,
ni fermer une session — pas même après avoir prêté son téléphone ou s'être
connecté depuis un poste public. C'est la **seule action qu'il puisse
entreprendre seul** s'il craint que son compte soit ouvert ailleurs.

Section « Mes connexions » dans l'espace client. Fermer SA PROPRE session
prévient avant et redirige après : le serveur efface le cookie, et laisser le
client découvrir qu'il est dehors le ferait passer pour une panne. C'est le
serveur qui dit si la session fermée était la courante — le déduire du drapeau
local se tromperait sur une liste vieillie.

### GF-DUR-013 [P2] — Le garage ne voyait jamais qui relancer

`GET /api/reminders/suggestions` (véhicules dont le dernier passage dépasse le
seuil du garage) et `GET /api/vehicles/ct-alerts` (contrôles techniques à
échéance ou dépassés) calculaient la relance commerciale du garage sans que rien
n'en montre le résultat.

Onglet « À relancer » dans le panneau Rappels. Ce n'est **pas un filtre** de la
liste : c'est une autre source — ce que le logiciel propose, par opposition à ce
que le garage a décidé. Les mêler ferait passer une proposition pour un
engagement pris.

Chaque ligne porte son bouton de création : le rappel est écrit par
`POST /api/reminders`, et l'utilisateur bascule sur « À faire » où sa décision a
atterri. Une liste qu'il aurait fallu recopier dans le formulaire d'à côté aurait
été une décoration. Un CT **dépassé** se rappelle aujourd'hui ; un CT à venir, la
veille de l'échéance — ce ne sont pas les mêmes appels téléphoniques.

**Mutations sur ce lot.** 9/9 détectées.

**Mutations sur ce lot.** 9/9 détectées.

---

## 7. Messagerie client ↔ garage

### GF-DUR-014 [P1] — Cinq routes, zéro écran, des deux côtés

**Cause racine.** Toute la mécanique existait : ouverture d'un fil, historique,
réponse, clôture, réouverture, et une machine à états éprouvée
(`lib/portal/tickets`) qui distingue qui attend qui. Aucune des cinq pages du
portail ne l'appelait, et aucun panneau du poste non plus. Le client ne pouvait
pas écrire à son garage depuis son espace ; le garage n'aurait rien vu s'il
l'avait fait.

**Correctif.** Deux écrans, et une traversée éprouvée de bout en bout.

*Côté client* — `/clients/messages`, atteignable depuis l'espace client. Le
statut est traduit en « qui doit agir » (« En attente du garage », « Réponse
reçue ») plutôt que recopié : `pending` et `answered` sont ambigus dans les deux
sens pour qui ne connaît pas la machine à états. Le fil peut être rattaché à un
véhicule — sans quoi le garage doit demander de quelle voiture on parle.

*Côté garage* — panneau « Messages », ouvert sur **« À traiter »** : les fils
`open` et `pending`, ceux où le client attend. Tout montrer par défaut noierait
ces deux-là dans l'historique, et un message sans réponse est exactement ce
qu'une messagerie doit rendre impossible à manquer. `answered` n'y figure pas :
la balle est chez le client — c'est le seul intérêt de conserver la distinction.

**Deux refus assumés dans l'interface.** Un fil CLOS n'affiche aucun champ de
saisie, des deux côtés : le serveur refuserait le message (409), et laisser
quelqu'un écrire pour se voir refuser après coup lui ferait perdre son texte. Et
un envoi refusé conserve la saisie à l'écran — la lui reprendre serait la pire
réponse possible à un message qu'il vient d'écrire.

Le corps des messages est rendu tel quel (`whitespace-pre-line`), jamais
interprété comme du balisage.

**Vérification.** `messagerie-client-garage.test.ts` — 16 tests sur la traversée
réelle (client → garage → client), la clôture des deux côtés, et l'isolation :
un garage voisin ne voit rien, un client n'atteint pas le fil d'un autre, un
véhicule qui ne lui appartient pas est refusé.

### GF-DUR-015 [P1] — La correspondance client était ouverte à tout le garage

**Trouvé en construisant l'interface.** `/api/tickets` et `/api/tickets/[id]`
n'exigeaient **aucune permission** — seulement une session. Or le modèle de rôles
du produit est explicite : un MECHANIC n'a ni `customer:manage` ni
`financial:read`. Il pouvait pourtant lire toutes les conversations du garage,
litiges de facturation compris, y répondre **au nom du garage** — le message est
signé de son nom — puis les clore.

Le défaut préexistait ; l'interface l'aurait rendu commode. Les deux routes
exigent désormais `customer:manage`, la permission de la relation client, qui
couvre le comptoir — la refuser au RECEPTIONIST rendrait la messagerie inutile là
où elle sert le plus. Le bouton du poste suit la même règle : un bouton qui mène
à un 403 est pire que pas de bouton.

**Mutations sur ce lot.** 15/15 détectées (5 sur les routes du portail, 4 sur
celles du poste, 3 sur les autorisations, plus 9 sur les deux interfaces).

---

## 8. La garde s'est trompée deux fois, et ce qu'elle cachait

### Les tests comptaient comme des appelants

Le commentaire de `corpusAppelant` affirmait qu'une route dont seul un test parle
« reste orpheline pour l'utilisateur, et c'est exactement ce qu'il faut voir ».
L'implémentation faisait l'inverse : les tests étaient DANS le corpus, si bien
qu'un simple `import` dans un test d'isolation suffisait à déclarer une route
branchée.

Coût exact de l'écart : `/api/appointments` et `/api/appointments/[id]` — toute
la confirmation de rendez-vous côté garage — passaient pour vivantes parce que
deux tests d'isolation les importaient. Après correction, **quatorze routes
supplémentaires** sont apparues.

### L'angle mort des chemins calculés

Toutes ne sont pas mortes. `/api/invoices/[id]` est bel et bien appelée, mais par
une URL assemblée à l'exécution :

```ts
const apiBase = mode === 'quote' ? '/api/quotes' : '/api/invoices'
```

Une recherche textuelle ne peut pas la voir. Plutôt que d'ignorer le cas — ce qui
reviendrait à laisser la garde mentir — un quatrième motif l'accueille,
`chemin-calcule`, dont la note doit DÉSIGNER la construction. Sans cette
exigence, l'étiquette servirait à faire taire n'importe quel constat gênant.

### GF-DUR-016 [P0] — Le mot de passe provisoire enfermait le client dehors

Le plus coûteux de toute la série, et le plus discret : **toutes les routes se
comportaient correctement**.

1. Le garage ouvre un accès → mot de passe provisoire, `mustChangePassword` levé.
2. Le client se connecte : la session est bien émise.
3. TOUTE route du portail répond alors `403 PASSWORD_CHANGE_REQUIRED` — voulu,
   et juste.
4. L'espace client traitait tout échec non-401 comme « pas de données » : page
   **blanche**, sans explication.
5. Et **aucun écran** n'appelait la route de changement.

Autrement dit, chaque accès ouvert par le garage — la fonctionnalité livrée au
commit `0b313da` — produisait un client enfermé dehors, définitivement. Le défaut
n'était dans aucune route : il tenait à l'absence du seul écran qui refermait la
boucle.

**Correctif.** `/clients/password`, qui sert la première définition (imposée) et
le changement volontaire — le texte distingue les deux, parce que dans le premier
cas le client subit une obligation qu'il n'a pas demandée.

La redirection est centralisée dans `lib/portal/redirection` : deux refus du
serveur sont des ORDRES de navigation, pas des erreurs, et personne ne regardait
le second. La connexion rend désormais `mustChangePassword` pour envoyer
directement au bon endroit — sans quoi le client traverse une page vide avant
d'être réorienté, ce qui ressemble à une panne.

**Vérification.** `portail-mot-de-passe-provisoire.test.ts` — 6 tests sur
l'enchaînement complet, du mot de passe remis par le garage jusqu'à la
réouverture du portail. Mutations : 4/4.

Ce test échouait d'abord en 429 dans la suite complète tout en passant seul :
sans `TRUST_PROXY_HEADERS`, le compteur de connexions est partagé par tous les
fichiers du même processus. Faux échec, réparé dans le test — pas dans le
produit.

---

## 9. Rendez-vous client ↔ garage

### GF-DUR-017 [P1] — Quatre routes, et un côté que la garde ne voyait même pas

**Cause racine.** La demande, la modification, l'annulation et les transitions
côté garage existaient, avec une validation de créneau éprouvée
(`lib/portal/appointments` : format, futur, dans les heures d'ouverture, tient
avant la fermeture) et une machine à états. Aucun écran ne les appelait.

Le côté garage n'était même pas VISIBLE dans l'inventaire : deux tests
d'isolation importaient ces routes, ce qui suffisait à les faire passer pour
branchées tant que les tests comptaient comme des appelants (§8).

**Ce que les écrans doivent porter.**

*Une DEMANDE n'est pas un rendez-vous.* C'est la distinction qui traverse tout le
lot, parce que c'est elle qui décide si un client se présente devant un rideau
fermé. Le client propose ; le garage confirme, ou non. Les libellés le disent —
« Demande envoyée », « Confirmé par le garage » — au lieu de recopier `requested`
et `confirmed`.

*Les heures d'ouverture viennent du serveur.* `validateSlot` refuse tout créneau
hors ouverture. Les recopier côté client les ferait diverger au premier
changement de réglage : le client se verrait proposer une heure que le serveur
refuse. Elles accompagnent donc la liste et bornent directement le champ.

*Déplacer un créneau confirmé annule la confirmation* — le garage doit se
réengager. L'écran le dit AVANT, sinon le client croit conserver sa place.

*Le panneau garage ouvre sur « À confirmer ».* Les demandes en attente sont les
seules où quelqu'un attend une réponse ; le planning complet les noierait dans
les rendez-vous déjà réglés. Et il ne propose que les transitions que le serveur
accepterait — en appelant `nextAppointmentStatus`, la MÊME fonction, pas une
copie qui divergerait.

### GF-DUR-018 [P2] — Un mécanicien pouvait annuler le rendez-vous d'un client

`POST /api/appointments/[id]` ne contrôlait aucune permission. Consulter le
planning de l'atelier concerne tout le monde ; s'ENGAGER auprès d'un client —
confirmer un créneau, l'annuler — relève de la gestion des interventions. La
route exige désormais `job:manage` ; la lecture reste ouverte, et le bouton avec
elle.

**Vérification.** `rendez-vous-client-garage.test.ts` — 16 tests sur la traversée
(demande → confirmation → clôture), la validation des créneaux, le déplacement,
les transitions impossibles et l'isolation. Mutations : 13/13.

### Ce qui reste, et pourquoi

L'inventaire compte **17 routes `sans-interface`**. Les plus notables : le
changement d'adresse depuis le portail, le double facteur, la gestion du
personnel (`/api/users` : le garage ne peut pas ajouter de collègue), la
génération assistée de devis, et cinq modules d'analyse dont le cœur n'est appelé
que par leur propre route.

Chacune demande un arbitrage de conception — où la placer, quel parcours — qui
revient au propriétaire du produit. **Décision requise.**

---

## 5. Autres correctifs

### GF-DUR-008 [P2] — L'apostrophe que l'utilisateur tape

**Cause racine.** Les listes de mots-clés portent l'apostrophe DROITE
(`"chiffre d'affaires"`, `"joint d'étanchéité"`). Les normalisations retiraient
accents et casse, **pas les variantes d'apostrophe**. Or presque personne ne tape
la droite : claviers de téléphone, correction automatique, copier-coller depuis
un traitement de texte — et l'interface de GarageFlows elle-même, si bien qu'un
utilisateur recopiant une expression lue à l'écran ne pouvait **pas** tomber
juste.

« Quel est mon chiffre d’affaires ? » ne contenait pas `chiffre d'affaires` : le
copilote répondait qu'il n'avait pas compris, sur la question la plus courante
qu'un garagiste puisse poser. Une recherche de « joint d’étanchéité » ne trouvait
pas la pièce en stock.

**Correctif.** `lib/text/apostrophes` plie toutes les variantes — y compris
l'accent aigu et l'accent grave isolés, que `NFD` ne décompose pas — sur la forme
droite. Appliqué aux six normalisations qui comparent du texte saisi à du texte
stocké : copilote, diagnostic, recherche de pièces, catalogue, pièces oubliées,
plateformes agréées.

**Mutations.** 4/4 détectées.

### GF-DUR-009 [P3] — Une justesse qui tenait à l'ordre des verrous

`/api/jobs/[id]/parts` calculait `existing.quantity + qty`. C'était juste, mais
pour une raison indirecte : le verrou pris sur la PIÈCE au décrément ordonne les
requêtes concurrentes, si bien que la relecture voyait déjà la ligne de l'autre.
Cette justesse se serait perdue au premier réagencement du bloc. `increment` la
rend indépendante de l'ordre.

Reclassé honnêtement : **durcissement, pas défaut** — aucune reproduction n'a pu
être obtenue.

---

## État de la vérification

| Contrôle | Résultat |
|---|---|
| `npm test` | **236 fichiers, 2726 tests verts**, 0 échec, 28 ignorés |
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement, 0 erreur |
| `npm run check:consistency` | **12/12 gardes vertes** |
| Tests par mutation | **69 mutations appliquées, 69 détectées** |

## Ce qui reste ouvert

1. **17 fonctions sans interface** (§4, §6 à §9) — inventoriées, verrouillées
   contre toute aggravation. Le compte avait AUGMENTÉ au §8 après correction de
   la garde, qui comptait les tests comme des appelants. Les chaînes les plus
   coûteuses sont branchées : postes de licence, sessions du portail, relance
   commerciale, messagerie, mot de passe provisoire, rendez-vous. Les restantes —
   changement d'adresse depuis le portail, double facteur, gestion du personnel,
   cinq modules d'analyse — demandent un dimensionnement produit.
2. **Clés publiques de licence** — le dépôt reste sur `fe5b7807…`, distincte de
   celle du poste de l'exploitant (`835c1e90…`). Propager l'une ou l'autre
   invalide un parc : décision explicite requise (`npm run keys:sync`).
3. **Recette navigateur du portail** — exige des identifiants de recette non
   disponibles ici (`BLOCKED_EXTERNAL`).
