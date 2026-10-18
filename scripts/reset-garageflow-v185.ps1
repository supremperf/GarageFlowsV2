#requires -Version 5.1
# Wrapper de compatibilite — le script canonique est reset-garageflow.ps1.
# Conserve pour les references/lanceurs existants au nom « v185 ».
& (Join-Path $PSScriptRoot 'reset-garageflow.ps1') @args
exit $LASTEXITCODE
