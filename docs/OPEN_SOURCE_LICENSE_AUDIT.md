# Audit de compatibilité des licences open-source — GarageFlow

**Objet :** vérifier que la base de code GarageFlow (deux dépôts) peut être vendue et distribuée sous forme **propriétaire / closed-source** sans obligation de divulgation du code source imposée par une dépendance open-source.

**Périmètre :** dépendances directes et transitives des deux dépôts :
- **Desktop** — `GarageFlowsV2` (Electron + Next.js 14 + SQLite/Prisma)
- **Cloud** — `garagesite3` (Next.js 15 + PostgreSQL/Prisma)

**Méthode :** lecture directe des champs `license` des `package.json` installés dans `node_modules` et des manifestes committés (`package.json` / `package-lock.json`), le 2026-07-31. Ceci est une analyse basée sur les manifestes de paquets, pas une attestation juridique. La liste complète figure dans `../THIRD_PARTY_NOTICES.md` et `SBOM.md`.

---

## 1. Conclusion générale

- **Aucune dépendance sous licence GPL, AGPL ou SSPL** n'a été trouvée dans les arbres de dépendances des deux dépôts (directes comme transitives). C'est le résultat déterminant pour une vente propriétaire : aucune licence « copyleft fort » n'oblige à publier le code de GarageFlow.
- La très large majorité des dépendances sont sous licences **permissives** : MIT, ISC, Apache-2.0, BSD, MIT-0. Ces licences autorisent l'usage propriétaire moyennant conservation des mentions de copyright et des textes de licence (voir `THIRD_PARTY_NOTICES.md`).
- Quelques composants **copyleft faible / au niveau fichier** (LGPL-3.0, MPL-2.0) sont présents **uniquement de façon transitive** et dans des rôles qui ne déclenchent pas d'obligation de divulgation du code propriétaire (détaillés en §3).
- Un composant est **double-licencié** (`dompurify` : MPL-2.0 OR Apache-2.0) : GarageFlow peut retenir Apache-2.0, ce qui neutralise toute obligation copyleft.

**Verdict pour une cession propriétaire : compatible.** Les seules actions requises sont d'ordre attribution/notices, pas de divulgation de code.

---

## 2. Vérification « pas de copyleft fort » (GPL/AGPL/SSPL)

Un balayage des champs `license` sur l'ensemble des `package.json` présents dans `node_modules` des deux dépôts a été effectué. Recherche des motifs `GPL`, `AGPL`, `SSPL`, `CDDL`, `EPL`, `MPL`, `LGPL`.

**Résultat :**
- `GPL` / `AGPL` / `SSPL` : **aucune occurrence**.
- `LGPL` / `MPL` : occurrences uniquement transitives, listées ci-dessous.

---

## 3. Composants copyleft détectés (transitifs) et analyse d'usage

| Composant | Licence | Type | Présent dans | Usage réel | Obligation déclenchée ? |
|---|---|---|---|---|---|
| `@img/sharp-libvips-*` (libvips) | LGPL-3.0-or-later | Copyleft faible (bibliothèque) | Desktop + Cloud (transitif via `sharp`) | Bibliothèque native de traitement d'image chargée dynamiquement par `sharp`. Côté desktop, `sharp` sert uniquement à la **génération d'icônes au build** (`scripts/generate-icons.js`). Non modifiée. | **Non** — liaison dynamique d'une bibliothèque LGPL non modifiée ; la LGPL n'impose alors pas d'ouvrir le code de l'application. Obligation limitée : permettre le remplacement de la bibliothèque et fournir ses notices. |
| `lightningcss` (+ binaires plateforme) | MPL-2.0 | Copyleft au niveau fichier | Desktop + Cloud (transitif, chaîne Tailwind/Next) | Outillage CSS au **build uniquement**, non modifié, non redistribué au client final. | **Non** — MPL n'oblige à publier que les fichiers MPL *modifiés* ; ici non modifiés et non embarqués. |
| `axe-core` | MPL-2.0 | Copyleft au niveau fichier | Desktop + Cloud (transitif, outillage) | Outillage accessibilité/test, non embarqué dans le produit livré. | **Non** — non modifié, non distribué. |
| `dompurify` | MPL-2.0 **OR** Apache-2.0 | Double licence | Desktop (transitif via `jspdf`) | Assainissement HTML pour la génération PDF. | **Non** — GarageFlow **élit Apache-2.0** (permissive). Aucune obligation copyleft. |

### Note sur `sharp` / libvips
Le paquet `sharp` lui-même est **Apache-2.0**. Les binaires `@img/sharp-libvips-*` qu'il télécharge embarquent **libvips**, sous **LGPL-3.0-or-later**. La LGPL, en liaison dynamique et sans modification de libvips, **ne « contamine » pas** le code propriétaire. Côté desktop, `sharp` est une *devDependency* (génération d'icônes), donc non redistribuée dans le binaire livré ; l'exposition est encore plus faible. Côté cloud, `sharp` intervient de façon transitive (optimisation d'images Next.js).

### Note sur Electron (MIT)
Electron est MIT, mais **embarque Chromium et Node.js** dans le binaire distribué. Ces composants portent leurs propres licences OSS (BSD, MIT, et licences de composants tiers). L'obligation pratique est de **joindre les textes de licence Electron** à toute distribution du binaire — obligation d'attribution, pas de divulgation.

---

## 4. Licences dont le statut mérite confirmation

Aucune dépendance directe n'a de licence **absente ou non résoluble**. Les points à confirmer avant closing sont mineurs :

| Élément | Statut | Action recommandée |
|---|---|---|
| Textes de licence complets joints au binaire | Les fichiers `LICENSE` sont présents dans chaque `node_modules/<pkg>` mais aucun fichier de notices agrégé n'est encore embarqué dans l'installeur. | Générer et embarquer un fichier de notices agrégé (à partir de `THIRD_PARTY_NOTICES.md`) dans l'installeur NSIS. |
| `MIT-0` (nodemailer) | Variante MIT sans obligation d'attribution — confirmée, aucun risque. | Aucune. |
| Composants transitifs profonds non listés individuellement | L'audit couvre les licences déclarées ; une génération SBOM signée (CycloneDX) donnerait la couverture exhaustive machine-vérifiable. | Produire un SBOM CycloneDX signé (voir `SBOM.md`, actuellement généré depuis les manifestes). |

---

## 5. Recommandations avant cession

1. **Embarquer les notices** OSS agrégées dans l'installeur (obligation d'attribution MIT/ISC/Apache/BSD).
2. **Documenter le remplacement de libvips** (obligation LGPL de liaison dynamique) — trivial car `sharp` est déjà chargé dynamiquement.
3. **Produire un SBOM CycloneDX signé** pour une preuve exhaustive et automatisable (le SBOM actuel est dérivé des manifestes, non signé).
4. Conserver ce document et `THIRD_PARTY_NOTICES.md` dans la data-room comme preuve de diligence licences.

---
Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`.
