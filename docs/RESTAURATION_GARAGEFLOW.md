# Restauration GarageFlow — annuler / revenir en arrière

> **Document stable — remplace les anciennes notes `RESET_GARAGEFLOW_Vxxx`.**
> Complément direct de
> [REINITIALISATION_GARAGEFLOW.md](REINITIALISATION_GARAGEFLOW.md) : comment
> annuler une réinitialisation ou une rotation qui a mal tourné.

Aucune valeur secrète n'apparaît ici. Ne jamais lire `.env` pour en copier une
valeur.

---

## 1. Principe : des sauvegardes horodatées

Avant chaque modification, l'outil de réinitialisation
(`scripts/reset-garageflow.ps1`) et l'outil de configuration
(`scripts/configurer-api-garageflow.ps1`) créent une **copie horodatée** du
fichier concerné, à côté de l'original, sous la forme :

```
<fichier>.before-<horodatage>      ex. .env.before-20260803-181500
```

Ces copies couvrent notamment `.env`, `keys/server_config.json` et les routes
éventuellement patchées. Elles permettent un **retour à l'état précédent** sans
reconstruire l'environnement à la main.

---

## 2. Restaurer le `.env`

1. Repérer la sauvegarde voulue : `.env.before-<horodatage>` (la plus récente
   antérieure à l'incident).
2. Copier cette sauvegarde par-dessus `.env` (remplacer).
3. Vérifier le contenu **sans exposer les secrets** (présence des noms de
   variables, pas leurs valeurs), puis relancer `npm run env:check`.

> Ne modifiez pas les valeurs à la main : `env:check` puis `env:configure`
> réparent le format sans divulguer de secret.

---

## 3. Restaurer `keys/server_config.json`

1. Repérer `keys/server_config.json.before-<horodatage>`.
2. Le copier par-dessus `keys/server_config.json`.
3. **Cohérence obligatoire** avec `GARAGEFLOW_API_KEY` : la clé de ce fichier
   doit être **identique** à celle présente dans `.env` **et** dans Vercel. Si
   vous restaurez une ancienne `server_config.json`, restaurez aussi la
   `GARAGEFLOW_API_KEY` correspondante partout (voir la rotation
   transactionnelle dans [ROTATION_SECRETS.md](ROTATION_SECRETS.md)), sinon les
   appels `x-gf-key` échoueront en **401**.

> `keys/*.json` n'est pas suivi par git : la seule source de retour est la
> sauvegarde horodatée locale.

---

## 4. Précautions de production

- **Redéploiement requis** : restaurer une variable côté Vercel n'a d'effet
  qu'après un nouveau déploiement.
- **Cohérence des trois emplacements** : `GARAGEFLOW_API_KEY` doit rester
  identique dans `.env`, `keys/server_config.json` et Vercel. Restaurer un seul
  des trois recrée une incohérence.
- **Ne jamais** restaurer une base SQLite / valeur `file:` côté serveur web :
  `DATABASE_URL` production doit rester PostgreSQL Neon (poolée) + `DIRECT_URL`
  directe.
- **Secrets de données chiffrées** : si l'incident touche `GF_BACKUP_KEY`,
  `GF_DB_MAC_SECRET`, `DEVICE_TOKEN_PEPPER`, etc., restaurer l'**ancienne**
  valeur est souvent la seule façon de relire les données déjà écrites — d'où
  l'importance de ne jamais les avoir rotées sans sauvegarde
  ([ROTATION_SECRETS.md](ROTATION_SECRETS.md)).

---

## 5. Vérifier une sauvegarde avant de s'en servir

- **Existence et fraîcheur** : lister les fichiers `*.before-*` et retenir
  l'horodatage juste antérieur à l'incident.
- **Intégrité** : le fichier n'est pas vide et contient bien les **noms** de
  variables attendus (contrôle sur les clés, pas sur les valeurs).
- **Test à froid** : après restauration, lancer `npm run env:check` — il doit
  passer au vert. Puis, côté serveur, contrôler `GET /api/health` après
  redéploiement.
- **Sauvegardes chiffrées** (`GF_BACKUP_KEY`) : une sauvegarde n'est
  restaurable que si la clé qui l'a chiffrée est encore disponible ; vérifiez ce
  couplage **avant** de compter dessus.

---

## 6. Retour d'urgence (résumé)

1. Identifier la dernière sauvegarde saine (`*.before-<horodatage>`).
2. Restaurer `.env` et, si besoin, `keys/server_config.json` (cohérents entre
   eux).
3. `npm run env:check` (doit être vert).
4. Redéployer, puis valider `GET /api/health`.
