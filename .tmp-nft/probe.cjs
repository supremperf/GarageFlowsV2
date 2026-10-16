const os = require('os'); const fs = require('fs'); const path = require('path')
// reproduction de la forme incriminée : lecture d'un dossier dérivé du profil
fs.readdirSync(os.homedir())
fs.statSync(path.join(os.homedir(), 'inconnu.txt'))
