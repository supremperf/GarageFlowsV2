/**
 * GF-021 — horaires d'atelier : demi-heures, et une grille qui les respecte.
 *
 * Deux défauts traités ensemble :
 *  1. les bornes n'existaient qu'en HEURES PLEINES — un atelier ouvrant à 8 h 30
 *     ne pouvait pas le déclarer, et les listes n'offraient même que 6 h–18 h
 *     pour l'ouverture, 12 h–24 h pour la fermeture ;
 *  2. le planning ne les LISAIT PAS : `ScheduleBoard` calculait sa grille depuis
 *     les constantes `WORKSHOP_START_HOUR` / `WORKSHOP_END_HOUR`, évaluées au
 *     chargement du module. Un garage ouvrant à 7 h enregistrait son horaire et
 *     voyait toujours 8 h – 18 h ; ses interventions matinales tombaient hors
 *     grille.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  CRENEAUX_30MIN, CRENEAUX_FERMETURE, creneauEnMinutes, minutesEnCreneau,
  bornesAtelier, enHeureEtMinute, DEBUT_PAR_DEFAUT, FIN_PAR_DEFAUT,
} from '@/lib/planning/horaires'

describe('créneaux de 30 minutes (§14)', () => {
  it('la journée entière est proposée, de 00h00 à 23h30', () => {
    expect(CRENEAUX_30MIN).toHaveLength(48)
    expect(CRENEAUX_30MIN[0]).toBe('00:00')
    expect(CRENEAUX_30MIN[1]).toBe('00:30')
    expect(CRENEAUX_30MIN[2]).toBe('01:00')
    expect(CRENEAUX_30MIN[CRENEAUX_30MIN.length - 1]).toBe('23:30')
  })

  it('chaque créneau est bien à la demi-heure', () => {
    for (const c of CRENEAUX_30MIN) {
      const m = creneauEnMinutes(c)
      expect(m, `créneau illisible : ${c}`).not.toBeNull()
      expect(m! % 30).toBe(0)
    }
  })

  it('la fermeture peut aller jusqu’à minuit', () => {
    expect(CRENEAUX_FERMETURE[CRENEAUX_FERMETURE.length - 1]).toBe('24:00')
    expect(CRENEAUX_FERMETURE).not.toContain('00:00')
    expect(creneauEnMinutes('24:00')).toBe(1440)
  })

  it('conversions aller-retour', () => {
    expect(creneauEnMinutes('08:30')).toBe(510)
    expect(minutesEnCreneau(510)).toBe('08:30')
    expect(enHeureEtMinute(510)).toEqual({ heure: 8, minute: 30 })
    expect(enHeureEtMinute(1080)).toEqual({ heure: 18, minute: 0 })
  })

  it('un créneau qui n’est pas à la demi-heure est refusé', () => {
    expect(creneauEnMinutes('08:15')).toBeNull()
    expect(creneauEnMinutes('8h30')).toBeNull()
    expect(creneauEnMinutes('')).toBeNull()
    expect(creneauEnMinutes(null)).toBeNull()
  })
})

describe('bornes effectives de l’atelier', () => {
  it('lit les minutes, pas seulement les heures', () => {
    expect(bornesAtelier({
      workshopStartHour: 8, workshopStartMinute: 30,
      workshopEndHour: 18, workshopEndMinute: 30,
    })).toEqual({ debut: 510, fin: 1110 })
  })

  it('tolère les valeurs en chaîne (formulaires)', () => {
    expect(bornesAtelier({
      workshopStartHour: '7', workshopStartMinute: '0',
      workshopEndHour: '19', workshopEndMinute: '30',
    })).toEqual({ debut: 420, fin: 1170 })
  })

  it('retombe sur 8 h – 18 h quand rien n’est renseigné', () => {
    expect(bornesAtelier(null)).toEqual({ debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT })
    expect(bornesAtelier({})).toEqual({ debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT })
  })

  it('refuse une grille inversée ou trop courte plutôt que de l’afficher', () => {
    // Une grille vide ou négative rendrait le planning inutilisable ; le repli
    // est préférable à un écran cassé.
    expect(bornesAtelier({ workshopStartHour: 18, workshopEndHour: 8 }))
      .toEqual({ debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT })
    expect(bornesAtelier({ workshopStartHour: 8, workshopStartMinute: 30, workshopEndHour: 8, workshopEndMinute: 30 }))
      .toEqual({ debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT })
  })

  it('accepte une amplitude large (atelier de nuit, dépannage)', () => {
    expect(bornesAtelier({ workshopStartHour: 0, workshopEndHour: 24 })).toEqual({ debut: 0, fin: 1440 })
  })
})

describe('le planning LIT les horaires du garage', () => {
  const RACINE = path.resolve(__dirname, '../../../..')
  const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')
  /** ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. */
  const sansCommentaires = (s: string) => s
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')

  it('la grille ne dérive plus de constantes de module', () => {
    const src = sansCommentaires(lire('src/components/ScheduleBoard.tsx'))
    expect(src, 'les constantes figeaient la grille à 8 h – 18 h').not.toMatch(/\bWORKSHOP_(START|END)_HOUR\b/)
    expect(src, 'les bornes doivent venir des réglages').toContain('bornesAtelier')
  })

  it('les réglages du garage alimentent réellement le magasin', () => {
    const store = sansCommentaires(lire('src/store/schedule-store.ts'))
    expect(store).toContain('fetchHoraires')
    expect(store).toMatch(/workshopStartMinute/)
    const page = sansCommentaires(lire('src/app/page.tsx'))
    expect(page, 'le démarrage doit charger les horaires').toContain('fetchHoraires')
  })

  it('l’écran des réglages propose bien des demi-heures', () => {
    const onglet = sansCommentaires(lire('src/components/settings/CompanyTab.tsx'))
    expect(onglet).toContain('CRENEAUX_30MIN')
    expect(onglet).toContain('CRENEAUX_FERMETURE')
    expect(onglet, 'les anciennes listes d’heures pleines doivent avoir disparu')
      .not.toMatch(/Array\.from\(\{ length: 13 \}/)
  })
})
