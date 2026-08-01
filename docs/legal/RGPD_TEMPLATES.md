# Modèles juridiques RGPD — **[À FAIRE VALIDER PAR UN JURISTE]**

> **AVERTISSEMENT.** Ces modèles sont des **gabarits techniques non contractuels**.
> Ils **ne constituent pas un avis juridique** et **doivent être validés/adaptés
> par un juriste ou un DPO** avant tout usage réel. Les crochets `[…]` sont à
> compléter. Voir `../RGPD_DATA_MAPPING.md`.

---

## 1. Registre des activités de traitement (modèle) — [À FAIRE VALIDER PAR UN JURISTE]
| Champ | Valeur (à compléter) |
|---|---|
| Responsable de traitement | [Garage — raison sociale, SIRET, adresse, contact] |
| Sous-traitant | [Éditeur GarageFlow — coordonnées] (mode cloud) |
| Finalités | Gestion d'atelier, facturation, relances, portail client |
| Catégories de personnes | Clients du garage, employés, utilisateurs portail |
| Catégories de données | Voir `../RGPD_DATA_MAPPING.md` §2 |
| Base légale | [exécution du contrat / obligation légale / intérêt légitime] |
| Destinataires | [interne ; hébergeur ; PDP le cas échéant] |
| Transferts hors UE | [Oui/Non — hébergeur, garanties] |
| Durées de conservation | [à définir ; compta ≈ 10 ans] |
| Mesures de sécurité | Chiffrement au repos, hachage, isolation, audit, sauvegardes chiffrées |

## 2. Clauses de sous-traitance (DPA, art. 28) — [À FAIRE VALIDER PAR UN JURISTE]
- Objet, durée, nature et finalité du traitement : [à compléter].
- Le sous-traitant traite les données **sur instruction documentée** du garage.
- Confidentialité des personnes autorisées ; mesures de sécurité (art. 32).
- Sous-traitance ultérieure soumise à autorisation ; liste des sous-traitants
  ultérieurs : [hébergeur, …].
- Assistance au responsable (droits des personnes, notifications de violation).
- Sort des données en fin de contrat : **restitution + suppression** (voir
  mécanismes techniques : export + effacement).
- Audits et mises à disposition des informations nécessaires.
- Localisation des données : [préciser région d'hébergement].

## 3. Mentions d'information (clients du garage) — [À FAIRE VALIDER PAR UN JURISTE]
> À afficher/remettre par le **Garage** à ses clients.

« Vos données (identité, coordonnées, véhicule, documents) sont traitées par
[Garage] pour la gestion de votre dossier d'atelier et la facturation, sur la
base de [base légale]. Elles sont conservées [durées], et peuvent être traitées
par notre prestataire logiciel [Éditeur] en qualité de sous-traitant. Vous
disposez d'un droit d'accès, de rectification, d'effacement, de limitation, de
portabilité et d'opposition, en écrivant à [contact]. Réclamation possible
auprès de la CNIL. »

## 4. Procédure de réponse aux demandes — [À FAIRE VALIDER PAR UN JURISTE]
1. Vérifier l'identité du demandeur.
2. **Accès/portabilité** : `GET /api/rgpd/subject/[clientId]/export`.
3. **Effacement** : `POST /api/rgpd/subject/[clientId]/erase` (anonymisation +
   suppression du portail ; documents comptables conservés/neutralisés).
4. Tracer la demande et la réponse (délai légal : 1 mois).
5. Fournir la **preuve** de l'action réalisée.

---
_Rien dans ces modèles ne doit être présenté comme validé juridiquement tant
qu'un juriste ne l'a pas relu et adapté au contexte réel du garage._
