# GarageFlow — Modèles d'e-mails d'approche acquéreur

*Modèles factuels. Ne jamais insérer de chiffres de revenu, de nombre de clients, de témoignages ou de valorisation présentés comme des faits — ces éléments ne sont pas vérifiés. Personnaliser les crochets `[...]`.*

---

## Modèle A — Approche à froid (générique)

**Objet :** Cession d'un logiciel de gestion d'atelier automobile (desktop + cloud, PI propre)

Bonjour [Prénom],

Je cède **GarageFlow**, un logiciel de gestion d'atelier automobile pour garages indépendants, livré en application desktop (Electron), PWA et control-plane cloud partageant un même socle de code.

Je pense que cela peut intéresser [Société] parce que [raison spécifique au profil — canal de distribution / brique verticale / marque à poser].

Quelques éléments factuels et vérifiables en data room :

- Socle **sécurité et licensing de qualité production-candidate** : mises à jour signées Ed25519 vérifiées avant exécution, licence ECDSA P-256, contrôle de sièges transactionnel, rate-limiting distribué fail-closed.
- **~857 cas de test backend** et CI complète (typecheck, lint, build, tests sur Postgres/Redis réels).
- Posture **PI/dépendances propre** : toutes les dépendances directes permissives, aucun GPL/AGPL.
- Fonctionnel atelier large : clients, véhicules, OR/devis/factures, planning, catalogue pièces, stock, fournisseurs, inspections, VIN/OCR.

Je suis transparent sur le périmètre : le produit s'exploite via des **actifs à transférer explicitement** (clés de signature, backend, domaines) et certaines briques (facturation électronique, import, API publique de production) restent à construire — c'est documenté dans un audit d'acquisition que je partage sous NDA.

Fourchette envisagée : **150 k – 350 k EUR** selon structuration.

Seriez-vous ouvert à un premier échange de 30 minutes ? Je peux envoyer le résumé une page et l'audit sous NDA.

Cordialement,
[Nom] — [contact]

---

## Modèle B — Société de facturation électronique / PDP

**Objet :** Canal vers les garages français avant le mandat B2B 2026-2027

Bonjour [Prénom],

GarageFlow est un logiciel métier installé au poste de travail des garages, avec des **fondamentaux de facturation solides** (numérotation séquentielle sans trou, immuabilité des factures émises, TVA calculée en centimes entiers, export FEC).

Je suis direct sur un point qui vous concerne : **la couche facturation électronique n'est pas encore construite** (pas de Factur-X/UBL/CII ni de raccordement Chorus Pro/PDP). C'est précisément la capacité que [Société] apporte — d'où une synergie naturelle : votre technologie de dématérialisation, ma base installée et mon socle métier.

Je propose d'en discuter sous cet angle : distribution + conformité. Documentation technique complète disponible sous NDA.

Cordialement,
[Nom] — [contact]

---

## Modèle C — Distributeur de pièces / équipementier

**Objet :** Placer votre catalogue au cœur de l'atelier

Bonjour [Prénom],

GarageFlow embarque déjà des modules **catalogue pièces, stock, fournisseurs et bons de commande** utilisés dans le flux de réparation.

Transparence utile : l'API publique actuelle est un **bac à sable de démonstration** (non persistant) ; un couplage catalogue/commande de production nécessiterait de la construire réellement. Je pense que c'est justement là que réside votre intérêt stratégique : intégrer votre flux commercial dans un outil déjà adopté au poste de travail.

Puis-je vous envoyer le résumé une page et convenir d'une démo ?

Cordialement,
[Nom] — [contact]

---

## Modèle D — Relance (suite sans réponse)

**Objet :** Re: [objet initial] — audit technique disponible

Bonjour [Prénom],

Je reviens brièvement. Pour objectiver l'évaluation, je peux partager sous NDA l'**audit d'acquisition** : il détaille sans complaisance ce qui est opérationnel, partiel ou à construire, ainsi que les actifs à transférer (clés, backend, domaines).

Si le calendrier n'est pas le bon, dites-le moi simplement.

Cordialement,
[Nom] — [contact]

---

## Règles de rédaction (rappel honnêteté)

- Ne jamais écrire « X clients », « Y € de revenu », « noté N/5 », « certifié … » : ces éléments ne sont pas vérifiés.
- Toujours mentionner l'existence d'un audit d'acquisition franc — cela crédibilise plutôt que l'inverse.
- Nommer les bloquants P0 dès qu'un acquéreur devient sérieux (ne pas les découvrir en due diligence).

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
