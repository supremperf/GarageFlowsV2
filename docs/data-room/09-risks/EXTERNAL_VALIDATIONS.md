# External Validations Required — ce que le code ne peut pas prouver seul

Ces éléments exigent une personne, un service ou un environnement EXTERNE. Ils
ne sont **pas** des défauts de code et ne doivent pas être requalifiés en
bloqueurs code — mais aucun ne doit être réputé acquis sans sa preuve.

## Juridique (conseil / DPO)
- CGV, CLUF/EULA, politique de confidentialité (AUD-015).
- DPA sous-traitants ; validation du registre art. 30 (projet fourni) ;
  qualification des bases légales ; arbitrage IP/user-agent sur signatures.
- Cession de droits PI formalisée (base factuelle : `docs/PROVENANCE.md`,
  AUD-016) ; attestations contributeurs (checklist §3 de l'audit licences).
- Revue des affirmations marketing de la vitrine (AUD-044).

## Comptable (expert-comptable)
- Validation de l'export FEC sur un exercice réel (structure et libellés testés
  côté code).
- Règles de conservation et de numérotation validées en contexte client.

## Facturation électronique (réglementaire)
- Contrat + raccordement à une plateforme agréée réelle, implémentation de
  l'adaptateur, homologation sandbox → production.
- PDF/A-3 (Factur-X complet) + exécution Schematron officiel + passage au
  validateur de référence (le XSD MINIMUM officiel est déjà passé, une fois).
- Décision sur l'évolution de schéma (SIREN acheteur BT-47, multi-taux,
  avoirs 381).

## Windows (poste opérateur + matériel)
- Certificat Authenticode au nom de l'exploitant, signature des installeurs,
  vérification SmartScreen (AUD-013).
- Protocole d'installation/upgrade/désinstallation sur Windows 10/11 physiques ;
  hash SHA-256 publiés par release ; coexistence PWA/EXE.
- Rendu WebKit/Safari réel (les gabarits mobiles sont émulés sous Chromium).

## Infrastructure (exploitant)
- Rotation effective des secrets compromis + sortie `verify:rotation` archivée
  (AUD-004) ; décision de purge d'historique git.
- Répétition de migration sur branche Neon de staging ; premier déploiement
  production (Vercel/équivalent) avec la validation d'env fail-closed.
- Exercice de restauration chronométré (transforme RPO/RTO d'objectifs en
  engagements) ; câblage alerting/APM/expédition de logs ; test de charge réel
  (scripts fournis, aucun chiffre inventé).
