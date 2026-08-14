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

**Ce qui a été fait.** `routes-sans-appelant.test.ts` fige l'inventaire. La garde
n'exige pas que tout soit branché : elle exige que chaque route sans appelant
soit une DÉCISION portant un motif écrit, et qu'aucune ne s'ajoute en silence.
Elle échoue aussi si une entrée devient périmée, pour que l'inventaire ne cesse
jamais de décrire la réalité.

**Ce qui n'a pas été fait, et pourquoi.** Construire ces interfaces représente
plusieurs lots de conception produit — où placer la messagerie dans le portail,
quel parcours de rendez-vous, quelle présentation du double facteur. Ce n'est pas
un arbitrage technique, et le dimensionner revient au propriétaire du produit.
**Décision requise.**

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
| `npm test` | **233 fichiers, 2651 tests verts**, 0 échec, 28 ignorés |
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement, 0 erreur |
| `npm run check:consistency` | **12/12 gardes vertes** |
| Tests par mutation | **28 mutations appliquées, 28 détectées** |

## Ce qui reste ouvert

1. **26 fonctions sans interface** (§4) — inventoriées, verrouillées contre toute
   aggravation, non construites. Dimensionnement produit requis.
2. **Clés publiques de licence** — le dépôt reste sur `fe5b7807…`, distincte de
   celle du poste de l'exploitant (`835c1e90…`). Propager l'une ou l'autre
   invalide un parc : décision explicite requise (`npm run keys:sync`).
3. **Recette navigateur du portail** — exige des identifiants de recette non
   disponibles ici (`BLOCKED_EXTERNAL`).
