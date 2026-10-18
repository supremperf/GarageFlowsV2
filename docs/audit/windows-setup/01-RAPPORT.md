<!-- doc-numbers: journal -->
# GarageFlows-Setup.exe — rapport de fabrication

**Validation en cours.** Le Setup final, sa taille et son SHA256 ne sont pas encore attestés pour ce lot. Ne pas confondre le candidat Windows précédemment construit et le nouveau contrat de livraison.

Audit préalable : [00-ARCHITECTURE-AVANT-MODIFICATION.md](00-ARCHITECTURE-AVANT-MODIFICATION.md). Architecture/commandes/protections/limites : [guide](../../WINDOWS_DISTRIBUTION.md).

Implémentation : NSIS offline Windowsx64, nom fixe, dist intermédiaire, release à un seul EXE, extraction/comparaison de chaque octet de charge, reçus séparés ; test réel install/relance/réinstallation/désinstallation en CI. Démarrage local authentifié par défi HMAC et fail-closed ; .env ignoré en packagé ; base existante illisible conservée, création initiale exclusive ; identité historique et PWA/PostgreSQL inchangées.

Aucune dépendance ajoutée/supprimée, aucune clé privée fournie ni embarquée, aucune protection désactivée et aucune publication production. Certificat Authenticode/clé de signature éditeur non disponibles : pas de signature prétendue, pas de nouvelle clé générée pour cela.

Premiers contrôles locaux : 38/38 tests ciblés Node, 49/49 Vitest ciblés, types/lint0. Une fixture du chargeur dotenv exigeait désormais un `app.isPackaged` explicite ; elle a été adaptée et complétée par le cas packagé sans filesystem. Les variables des nouveaux harnais CI ont été classées individuellement dans `platformProvided` et le registre généré, pas exposées comme paramètres client. Dernière suite Node :401/401. Une globale intermédiaire avait un nouveau défaut de manifeste en plus des trois TLS Prisma ; ce défaut a été corrigé, pas attribué au réseau.

La CI Windows du SHA exact et les reçus d’installation doivent compléter ce rapport avant toute affirmation de réussite de fabrication ou d’installation. La recette avec licence réelle et autorité de production, un PC Windows d’usine sans outils, les scénarios métier exhaustifs et la signature Authenticode ne sont pas attestés par une simple compilation.
