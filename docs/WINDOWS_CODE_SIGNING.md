# Signature de code Windows

_État : **pipeline prêt à signer**, sans certificat dans le dépôt. L'acquisition
du certificat et la signature officielle sont **BLOCKED_EXTERNAL** (nécessitent
un achat + une entité juridique). Date : 2026-08-01._

## Ce qui est en place (dans le dépôt)

- `package.json` → `build.win` : `signingHashAlgorithms: ["sha256"]`,
  `rfc3161TimeStampServer` (horodatage), `signAndEditExecutable: true`. **Inertes**
  tant qu'aucun certificat n'est fourni (electron-builder ne signe que si un
  certificat est présent).
- `.github/workflows/windows-build.yml` : build Windows x64 + signature
  **conditionnelle** (secrets) + vérification + artefacts.
- `scripts/verify-windows-signature.ps1` : contrôle Authenticode (mode `-Strict`
  pour bloquer une release non signée).
- `scripts/test-windows-installation.ps1` : test install/désinstall silencieux.

## Configurer la signature (côté CI — aucun secret dans git)

electron-builder signe automatiquement si ces variables d'environnement sont
fournies (le workflow les mappe depuis des **secrets GitHub**) :

| Variable (env electron-builder) | Secret GitHub | Contenu |
|---|---|---|
| `CSC_LINK` | `WIN_CSC_LINK` | certificat **PFX** encodé base64 **ou** URL vers le PFX |
| `CSC_KEY_PASSWORD` | `WIN_CSC_KEY_PASSWORD` | mot de passe du PFX |

Encoder un PFX en base64 pour le secret :
```bash
base64 -w0 certificat.pfx        # Linux/macOS  → coller dans WIN_CSC_LINK
```

Sans ces secrets, le build reste **non signé** et est marqué
`dist/UNSIGNED_DEVELOPMENT_ONLY.txt` (« DEVELOPMENT ONLY — UNSIGNED »).

### Alternative : Azure Trusted Signing / service HSM
electron-builder supporte des signeurs personnalisés (`win.sign` = chemin d'un
script). Pour Azure Trusted Signing (pas de PFX à manipuler), fournir un script
de signature et configurer les identifiants Azure via secrets. À câbler lors de
la mise en place réelle (non fait ici, faute d'abonnement).

## Politique de release

- **Tag `v*` ou signature demandée** → le workflow **échoue** si aucun certificat
  n'est configuré (« release signée exigée mais secret absent »).
- **Build manuel de dev** → autorisé non signé, explicitement marqué.
- La vérification post-build (`verify-windows-signature.ps1 -Strict`) bloque une
  release dont un binaire n'est pas « Valid ».

## BLOCKED_EXTERNAL (action humaine requise)

| Action | Détail | Preuve attendue |
|---|---|---|
| Acheter un certificat de signature | OV ou **EV** (EV requis pour une réputation SmartScreen immédiate) auprès d'une AC (DigiCert, Sectigo…). Nécessite une entité juridique vérifiable. | Certificat PFX + facture |
| Réputation SmartScreen | Se construit avec le volume de téléchargements signés (immédiate avec EV). | Absence d'avertissement « éditeur inconnu » |
| Signer officiellement | Configurer `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` puis release. | `verify-windows-signature.ps1` = « Valid » |

**Aucune de ces actions n'a été réalisée** : aucun certificat n'est disponible
dans cet environnement. Le pipeline est prêt à les consommer.

_Voir aussi : `docs/WINDOWS_RELEASE_CHECKLIST.md`,
`docs/EXTERNAL_ACTIONS_REQUIRED.md`._
