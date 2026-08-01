# Checklist traitement des données (RGPD) — pilote

> **MODÈLE — NON SIGNÉ.** Cadre de conformité à valider par un responsable/juriste
> avant tout traitement de données réelles. Ne remplace pas un avis juridique
> (voir `../EXTERNAL_ACTIONS_REQUIRED.md` §7).

## Avant le pilote
- [ ] Rôles définis : le Garage est **responsable de traitement** ; l'Éditeur est
      **sous-traitant** (art. 28 RGPD).
- [ ] Accord de sous-traitance / clauses DPA signés.
- [ ] Finalités et base légale documentées (gestion d'atelier, facturation).
- [ ] Catégories de données : clients, véhicules, factures (pas de données
      sensibles au sens RGPD sauf nécessité justifiée).
- [ ] Localisation des données : desktop = **local** (poste du garage) ; cloud =
      [hébergeur/région à préciser].
- [ ] Durées de conservation définies ; procédure de suppression en fin de pilote.

## Sécurité (déjà en place — vérifier)
- [ ] Secrets TOTP **chiffrés au repos** ; mots de passe hachés ; codes de
      récupération hachés.
- [ ] Sauvegardes chiffrées ; transport HTTPS ; headers de sécurité/CSP.
- [ ] Isolation multi-tenant (par garage) prouvée par tests.
- [ ] Journal d'audit des actions sensibles.
- [ ] Redaction des secrets/PII dans les logs et rapports de crash (opt-in).

## Droits des personnes
- [ ] Procédure d'accès / rectification / effacement / export documentée.
- [ ] Information des clients du garage (mentions) prévue par le Garage.

## Fin de pilote
- [ ] Export des données du Garage fourni.
- [ ] Suppression des données sur demande, avec **preuve** de suppression.
- [ ] Registre du traitement mis à jour.

## Réserves
- La **validation juridique/DPO** est **BLOCKED_EXTERNAL** : cette checklist
  prépare la conformité mais ne la garantit pas.
