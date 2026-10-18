<!-- doc-numbers: journal -->
# Audit préalable — installateur unique Windows

Audit réalisé avant les modifications applicatives de cette mission. HEAD et branche distante : f56e759, arena/55edbdc1-garageflowsv2, arbre propre ; main e3ac5f5 demeure ancienne. Aucun reset de données ni écrasement de travail utilisateur. La mise à jour GitHub précédente est déjà publiée ; travail sur la seule branche de session.

## Lecture et architecture observées

package.json intégral (258 lignes), electron/main.js intégral (4460), preload intégral (153), next.config.mjs (117), afterPack, post-build, NSIS, preflight, standalone/installer/artifact/secrets/fuses, ressources Prisma, signature de mises à jour et workflow Windows lus. Le runtime est Electron41.10.6, Next15.5.27/React18.3, Prisma5.22 résolu, Node22/npm11.16 de build, electron-builder26.15.3/NSIS. Pas de configuration electron-builder secondaire ; package.json est l’autorité. Pas de dossier dist/release local à l’entrée. Un ancien artefact GitHub Windows complet existe (run39133705536, artifact12139033341, archive206247487octets), ce n’est pas le livrable de cette mission.

- Standalone : racine de tracing verrouillée ; postbuild copie static/public, client Prisma natif, schéma et template vide validé, public.pem puis release-manifest. Vercel court-circuite les opérations desktop ; PWA/PostgreSQL conservés.
- Electron : ASAR pour main/preload/HTML/modules, ressources standalone hors ASAR, moteur Windows Node-API, icon.ico. utilityProcess.fork utilise le Node d’Electron, pas un Node client. Host127.0.0.1 ; origine renderer localhost forcée vers127.0.0.1 à cause des redirections Next.
- userData épinglé à **GarageFlow**, pas GarageFlows : base garageflow.db, photos, backups, licence chiffrée et secrets d’installation persistants. Conserver ce nom, appIdcom.garageflow.app et les registres NSIS existants. Installation per-user, aucun besoin administrateur.
- Démarrage : secrets locaux, manifeste d’intégrité enforced, SQLite depuis template si absence, sauvegarde pré-migration, ECDSA/HWID/autorité distante, cookies, serveur embarqué, migration interne SQLite puis session locale et fenêtre métier. PostgreSQL n’est pas migré par Electron.
- Licences : ancres publiques P256 embarquées ; privés et outils Python jamais requis chez le client. Générateur/core/GUI restent outils éditeur, pas fonctionnalités desktop à inclure. Aucun privé présent dans ce checkout ; keys/public.pem ignoré par Git peut être restauré depuis les ancres publiques concordantes sans générer une paire.
- Updates : protocole existant Ed25519 + SHA256 + taille + versions/canal, URL HTTPS autorisées et anti-downgrade ; pas electron-updater. Conserver ce protocole et les clés publiques. Clés privées éditeur et certificat Authenticode non fournis au dépôt : ne pas les générer/remplacer pour ce build. Signature de manifeste/release production reste une opération autorisée séparée.
- Les 14 langues sont dans les bundles Next ; aucun retrait de composants, API ou dépendances prévu. Les routes serveur-only conservent leurs gardes PostgreSQL.

## Écarts observés

1. NSIS produit `GarageFlows Setup 1.1.0.exe` dans dist avec win-unpacked, blockmap et fichiers de builder ; aucune sortie client dédiée. Le nom désiré doit être fixé au build et vérifié, pas simplement renommer un ancien EXE.
2. verify-installer ne lit que MZ/taille et le dossier voisin win-unpacked : ce n’est pas une preuve que CET EXE contient CETTE charge utile. Ajouter extraction NSIS et comparaison de la charge réelle avant la copie finale.
3. Le workflow archive dist/*.exe/*.blockmap/*.yml ensemble. Séparer le livrable client unique des preuves/métadonnées d’opérateur.
4. Pas de recette installation/désinstallation du vrai Setup ; le packaging réussi ne certifie pas le lancement installé ni la conservation des données.
5. waitForServer n’a pas de timeout par requête, accepte une identité même HTTP503, et startNextServer résout même après expiration. Corriger sans ouvrir de port LAN ni désactiver une licence.
6. Le chargeur dotenv est également tenté en packagé alors que la distribution doit fonctionner sans .env. Empêcher cette lecture/écriture en packagé ; conserver le comportement dev.
7. Sign-release guide par nom versionné dans dist ; le nouveau nom fixe doit rester compatible avec la version de package.json et les manifests signés, sans altérer l’autorité de signature.
8. Limites préexistantes non résolues par un packaging : alertes sécurité/CodeQL et E2E authentifié encore bloquants (rapport security-151). Certaines intégrations nécessitent comptes/configurations métier autorisés ; autonome ne signifie pas services cloud inclus ou licence gratuite. Ne pas annoncer une recette métier licenciée sans licence/autorité réellement validées.

## Architecture retenue

Conserver Electron + Next standalone + Prisma SQLite, NSIS offline x64/ASAR. Builder écrit dans dist (intermédiaire). Après vérification réelle de l’EXE et des protections, une publication locale atomique copie **uniquement release/GarageFlows-Setup.exe**. Hash/taille/version/commit et preuves restent sous artifacts/windows-delivery (ignorés), pas dans release. Le dossier release refuse les fichiers étrangers au lieu de les supprimer. Aucun changement Vercel, PostgreSQL, des règles métier ou des clés.

CI Windows : conserver les contrôles existants ; installer réellement le Setup sur le runner éphémère, démarrer depuis un CWD vide avec PATH sans outils développeur, attendre la fenêtre d’activation sécurisée, vérifier la DB créée dans userData, y poser une donnée sentinelle de test uniquement, relancer/réinstaller/désinstaller et vérifier sa persistance. Ne pas retirer un contrôle de licence pour atteindre un écran métier. Tests API/native existants en complément, pas une fausse activation de production. Publier l’EXE comme artefact candidat, jamais une release production automatique.
