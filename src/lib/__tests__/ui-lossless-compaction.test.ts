import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { UI } from '../i18n/ui'
import { LANGUAGES, translations } from '../i18n/translations'
import reference from '../../../tests/fixtures/ui-content-sha256.json'

describe('lossless translation row compaction', () => {
  it('matches the explicitly approved UI translation snapshot byte-for-byte', () => {
    expect(Object.keys(UI)).toHaveLength(reference.keys)
    expect(createHash('sha256').update(JSON.stringify(UI)).digest('hex')).toBe(reference.approved)
  })
  it('retains all fourteen languages for every UI entry and merged translation', () => {
    for (const [key, row] of Object.entries(UI)) {
      expect(Object.keys(row)).toEqual(reference.languages)
      for (const { code } of LANGUAGES) {
        expect(typeof row[code]).toBe('string')
        expect(translations[code][key as keyof typeof UI]).toBe(row[code])
      }
    }
  })
})
