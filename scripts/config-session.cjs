'use strict'
const { TARGETS } = require('./lib/config-cloud.cjs')
// Main preparation releases its lock BEFORE the independently consented storage
// change. A new preparation then re-inventories everything; never apply an old
// plan after storage connect/update has changed remote variables.
async function configureSession(api, options = {}, {
  manage = require('./config-manager.cjs').manage,
  setupBlob = require('./config-blob-setup.cjs').setupBlob,
} = {}) {
  const repaired = new Set()
  let report = await manage(api, options)
  while (!options.dryRun && !options.offline && report.nextAction?.type === 'connect-blob' && TARGETS.includes(report.nextAction.target)) {
    const target = report.nextAction.target
    if (repaired.has(target)) {
      console.log(`${target} : rattachement toujours non confirmé après réparation. Arrêt sans nouvelle tentative automatique ; vérifier le store et les droits Vercel.`)
      return { ...report, nextAction: undefined, status: 'INTERROMPU — RATTACHEMENT NON CONFIRMÉ APRÈS RÉPARATION' }
    }
    repaired.add(target)
    console.log(`Ouverture de l’assistant Blob pour ${target}. Aucune commande supplémentaire à taper ; ses confirmations restent obligatoires.`)
    const repair = await setupBlob(api, { target })
    if (!['RATTACHEMENT BLOB VÉRIFIÉ', 'RATTACHEMENT DÉJÀ CONFIRMÉ'].includes(repair?.status)) {
      console.log('Rattachement non appliqué : brouillons conservés. Pour reprendre plus tard dans CMD, taper exactement : node config (avec le g final).')
      return { ...report, nextAction: undefined, status: 'INTERROMPU — RATTACHEMENT NON APPLIQUÉ' }
    }
    if (options.rotateSessions) {
      console.log('Rattachement confirmé. La rotation explicite n’est pas rejouée automatiquement : relancer node config --rotate-session-secrets pour valider un nouveau plan.')
      return { ...report, nextAction: undefined, status: 'INTERROMPU — ROTATION EXPLICITE À REPRENDRE' }
    }
    if (!await api.yes('Rattachement confirmé : reprendre maintenant la configuration complète avec de nouveaux inventaires et les brouillons conservés')) {
      console.log('Configuration suspendue après réparation. Dans CMD, taper node config lorsque vous souhaitez reprendre.')
      return { ...report, nextAction: undefined, status: 'INTERROMPU — REPRISE DIFFÉRÉE APRÈS RATTACHEMENT' }
    }
    console.log('Reprise de node config dans la même session. Le projet et les trois environnements seront contrôlés à nouveau avant toute synchronisation.')
    report = await manage(api, options)
  }
  return report
}
module.exports = { configureSession }
