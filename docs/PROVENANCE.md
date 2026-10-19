# Provenance du code & contribution assistée par IA — data room PI

> Document de due diligence de propriété intellectuelle (AUD-016). Objet :
> tracer l'origine du code et la part de développement assisté par IA, afin
> qu'un acquéreur puisse évaluer la titularité et les garanties de
> non-contrefaçon. Ce document décrit des FAITS techniques observables dans le
> dépôt ; il ne constitue pas un avis juridique.

## 1. Titularité revendiquée

Le code des deux dépôts (GarageFlowsV2, garagesite3) est propriétaire — voir
`LICENSE` (« Tous droits réservés ») et le champ `"license": "UNLICENSED"` des
`package.json`. Aucune concession de droits n'est accordée sans accord écrit.

## 2. Développement assisté par IA

Le développement a été mené avec l'assistance d'un agent IA (Claude, Anthropic).
Traces observables dans l'historique :

- Branches de travail nommées `claude/garageflow-*` (ex. la branche courante
  `claude/garageflow-final-unified-merge-ub0l67`, et historiquement
  `claude/garageflow-security-production-*`, `claude/garageflow-pwa-*`,
  `claude/garageflow-hardening-production-*`).
- Empreinte des commits `Co-Authored-By: Claude` et `Claude-Session:` dans les
  messages de commit d'audit.

### Position juridique à établir (conseil PI)

Le régime de titularité du code produit par assistance IA doit être confirmé par
un conseil, notamment :

- **Cession/titularité** : le code généré ou co-écrit avec un outil IA est, dans
  les faits, dirigé et intégré par l'éditeur ; la documentation contractuelle
  (conditions d'utilisation de l'outil, cession des contributions humaines)
  doit être rassemblée pour affirmer une chaîne de titularité claire.
- **Garantie de non-contrefaçon** : évaluation standard de due diligence — aucun
  composant tiers copyleft fort n'a été détecté (voir
  `docs/sbom/LICENSE_INVENTORY.md`), ce qui réduit le risque d'obligation de
  divulgation ; la garantie contractuelle reste à formaliser.
- **Registre des contributions** : à maintenir (contributeurs humains, outils IA
  utilisés, périodes) pour la data room.

## 3. Composants tiers

Inventaire complet et notices : `THIRD_PARTY_NOTICES.md` (chaque dépôt) et
`docs/sbom/LICENSE_INVENTORY.md`. SBOM CycloneDX régénérable
(`docs/sbom/*.cdx.json`).

## 4. Éléments à préparer pour la data room (assignation)

| Élément | Responsable | État |
|---|---|---|
| SBOM CycloneDX (2 dépôts) | audit technique | **fait** (`docs/sbom/`) |
| THIRD_PARTY_NOTICES | audit technique | **fait** (généré, reproductible) |
| Inventaire des licences + analyse LGPL | audit technique | **fait** (`LICENSE_INVENTORY.md`) |
| `LICENSE` propriétaire + champ `license` | audit technique | **fait** (à valider par conseil) |
| CLUF/EULA, CGV opposables | conseil PI + éditeur | à faire |
| Cession de droits / registre contributions IA | conseil PI + éditeur | à faire |
| Garantie de non-contrefaçon | conseil PI | à faire |
