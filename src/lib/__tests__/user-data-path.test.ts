/**
 * Épinglage du dossier de données historique (%APPDATA%/GarageFlow) — preuve :
 *  - le chemin épinglé conserve le dossier HISTORIQUE (compat installations) ;
 *  - un échec de setPath est DÉTECTÉ et signalé (jamais silencieux) ;
 *  - un épinglage qui « ne prend pas » (userData effectif ≠ attendu) est détecté ;
 *  - un appData vide est refusé.
 * Le module est pur (app injecté) → testable sans Electron.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
const { LEGACY_DATA_DIR_NAME, legacyUserDataPath, pinUserDataToLegacyDir } = require('../../../electron/user-data-path.js')

type FakeApp = {
  getPath: (name: string) => string
  setPath: (name: string, value: string) => void
}

function fakeApp(appData: string): FakeApp & { paths: Record<string, string> } {
  const paths: Record<string, string> = { appData, userData: path.join(appData, 'WrongDefault') }
  return {
    paths,
    getPath: (name) => paths[name],
    setPath: (name, value) => { paths[name] = value },
  }
}

describe('user-data-path (Electron) — aucun échec silencieux', () => {
  it('épingle userData sur le dossier HISTORIQUE GarageFlow', () => {
    const app = fakeApp('/fake/AppData/Roaming')
    const r = pinUserDataToLegacyDir(app)
    expect(r.ok).toBe(true)
    expect(r.path).toBe(path.join('/fake/AppData/Roaming', LEGACY_DATA_DIR_NAME))
    expect(app.paths.userData).toBe(r.path)
    expect(LEGACY_DATA_DIR_NAME).toBe('GarageFlow') // compat : ne JAMAIS renommer
  })

  it('signale un échec de setPath (exception) au lieu de l\'avaler', () => {
    const app = fakeApp('/fake/AppData/Roaming')
    app.setPath = () => { throw new Error('EACCES') }
    const r = pinUserDataToLegacyDir(app)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('setPath')
    expect(r.error).toContain('EACCES')
  })

  it('détecte un épinglage qui n\'a pas pris (userData effectif divergent)', () => {
    const app = fakeApp('/fake/AppData/Roaming')
    app.setPath = () => { /* ignore silencieusement (simule un hôte défaillant) */ }
    const r = pinUserDataToLegacyDir(app)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('≠')
  })

  it('refuse un appData vide/indisponible', () => {
    expect(legacyUserDataPath('').ok).toBe(false)
    const app = fakeApp('/x')
    app.getPath = () => { throw new Error('no appData') }
    const r = pinUserDataToLegacyDir(app)
    expect(r.ok).toBe(false)
  })
})
