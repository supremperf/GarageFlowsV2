# RGPD — cartographie des données & mécanismes techniques (état réel)

> La conformité RGPD suppose une **validation juridique/DPO** (**BLOCKED_EXTERNE**).
> Ce document cartographie les traitements et documente les **mécanismes
> techniques réellement implémentés**. Les modèles juridiques sont dans
> `docs/legal/` et portent la mention **[À FAIRE VALIDER PAR UN JURISTE]**.

## 1. Rôles
- **Garage** = responsable de traitement (il décide des finalités).
- **Éditeur GarageFlow** = sous-traitant (art. 28 RGPD) lorsqu'il héberge/opère
  (mode cloud). En desktop, les données restent **locales** au poste du garage.

## 2. Cartographie des données personnelles
| Catégorie | Données | Finalité | Base légale (à confirmer juriste) | Conservation |
|---|---|---|---|---|
| Clients | nom, téléphone, e-mail, adresse | gestion d'atelier, facturation | exécution contrat / intérêt légitime | durée relation + obligations |
| Véhicules | plaque, VIN, kilométrage | suivi entretien | exécution contrat | idem client |
| Documents | devis, factures (nom + montants) | facturation, comptabilité | obligation légale (comptable) | **~10 ans** (compta) |
| Rappels/RDV | nom, contact, échéances | relances, planning | intérêt légitime / consentement | durée utile |
| Portail client | e-mail, hash mdp, secret 2FA **chiffré** | accès self-service | consentement / contrat | durée du compte |
| Employés | e-mail, hash mdp, rôle | accès applicatif | contrat de travail | durée d'emploi |
| Journal d'audit | action, userId, IP | sécurité, traçabilité | intérêt légitime | durée limitée |

Aucune donnée **sensible** (art. 9) n'est prévue par défaut.

## 3. Mécanismes techniques IMPLÉMENTÉS (code + tests)
- **Droit d'accès / portabilité** : `GET /api/rgpd/subject/[clientId]/export`
  (propriétaire) → export structuré de toutes les données personnelles d'un
  client (`src/lib/rgpd/subject.ts`). Le hash de mot de passe / secret 2FA n'est
  jamais renvoyé.
- **Droit à l'effacement** : `POST /api/rgpd/subject/[clientId]/erase` →
  **anonymisation** des PII (client, véhicules, devis, factures, rappels, RDV)
  avec **conservation des documents comptables** (montants intacts) et
  **suppression du compte portail**. Transactionnel, scopé garageId.
- **Sécurité au repos** : mots de passe **hachés** (bcrypt), codes de récupération
  **hachés**, secrets TOTP **chiffrés** (AES-256-GCM), mot de passe SMTP
  **chiffré** (AES-256-GCM), sauvegardes **chiffrées**.
- **Isolation multi-tenant** par garageId, **prouvée par tests**.
- **Journalisation** des actions sensibles **sans données sensibles** (secrets
  redactés dans les logs).
- **Minimisation dans les réponses/journaux** : les secrets ne transitent jamais
  par l'API ni les logs.

## 4. Réserves (honnêteté)
- La **validation juridique** (registre, DPA, mentions, bases légales, durées)
  est **BLOCKED_EXTERNE** — les modèles doivent être relus par un juriste.
- L'effacement couvre les entités liées par `clientId`. Des **copies
  dénormalisées** dans certains documents non liés par `clientId` (ex. ordres de
  réparation historiques, inspections) peuvent nécessiter une **revue manuelle** ;
  ce point est documenté et non masqué.
- Le **transfert hors UE** éventuel (hébergeur cloud) doit être encadré
  (localisation à préciser dans le DPA).
