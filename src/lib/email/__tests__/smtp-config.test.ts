/**
 * SMTP — résolution de configuration et diagnostic d'erreur.
 *
 * Reproduit le défaut signalé : fournisseur Gmail choisi, adresse, mot de passe
 * et expéditeur saisis, et pourtant « Configuration SMTP incomplète ».
 */
import { describe, it, expect } from 'vitest'
import { resolveSmtpTestConfig, smtpErrorMessage, type StoredSmtp } from '@/lib/email/smtp-config'

const EMPTY: StoredSmtp = {
  smtpHost: null, smtpPort: null, smtpUser: null,
  smtpPass: null, smtpFrom: null, smtpSecure: null,
}

const SAVED_GMAIL: StoredSmtp = {
  smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpUser: 'garage@gmail.com',
  smtpPass: 'chiffré:xxx', smtpFrom: 'Garage Dupont <garage@gmail.com>', smtpSecure: true,
}

/** Ce que le formulaire envoie pour Gmail. */
const GMAIL_FORM = {
  smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
  smtpUser: 'garage@gmail.com', smtpFrom: 'Garage Dupont <garage@gmail.com>',
}

describe('Reproduction du défaut signalé', () => {
  it('AVANT : rien d’enregistré et aucune valeur transmise → refus', () => {
    // C'est exactement ce que faisait « Tester » : {action:'test'} seul.
    const r = resolveSmtpTestConfig(EMPTY, {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(422)
  })

  it('APRÈS : le formulaire rempli mais NON enregistré est testable', () => {
    const r = resolveSmtpTestConfig(EMPTY, { ...GMAIL_FORM, smtpPass: 'abcd efgh ijkl mnop' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.host).toBe('smtp.gmail.com')
      expect(r.port).toBe(465)
      expect(r.secure).toBe(true)
      expect(r.user).toBe('garage@gmail.com')
      expect(r.from).toBe('Garage Dupont <garage@gmail.com>')
      expect(r.useStoredSecret).toBe(false)
      expect(r.password).toBe('abcd efgh ijkl mnop')
    }
  })
})

describe('Réutilisation du secret enregistré', () => {
  it('teste sans ressaisir le mot de passe quand rien n’a changé', () => {
    const r = resolveSmtpTestConfig(SAVED_GMAIL, GMAIL_FORM)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.useStoredSecret).toBe(true)
      expect(r.password).toBeNull()
    }
  })

  it('un mot de passe fraîchement saisi prime sur celui enregistré', () => {
    const r = resolveSmtpTestConfig(SAVED_GMAIL, { ...GMAIL_FORM, smtpPass: 'nouveau-mdp' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.useStoredSecret).toBe(false)
      expect(r.password).toBe('nouveau-mdp')
    }
  })

  it('SÉCURITÉ : le secret enregistré ne part jamais vers un autre hôte', () => {
    // Sans ce garde-fou, un test pointant vers un serveur arbitraire ferait
    // présenter le mot de passe du garage à ce serveur.
    const r = resolveSmtpTestConfig(SAVED_GMAIL, { ...GMAIL_FORM, smtpHost: 'smtp.attaquant.example' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('mot de passe')
  })

  it('SÉCURITÉ : ni vers un autre compte', () => {
    const r = resolveSmtpTestConfig(SAVED_GMAIL, { ...GMAIL_FORM, smtpUser: 'autre@gmail.com' })
    expect(r.ok).toBe(false)
  })

  it('adresse enregistrée SANS mot de passe → message explicite', () => {
    // Le cas qui faisait afficher « •••• déjà enregistré » à tort.
    const r = resolveSmtpTestConfig({ ...SAVED_GMAIL, smtpPass: null }, GMAIL_FORM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Aucun mot de passe enregistré')
  })
})

describe('Champs manquants — messages nommant le champ', () => {
  it('serveur manquant', () => {
    const r = resolveSmtpTestConfig(EMPTY, { smtpUser: 'a@b.fr', smtpPass: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Serveur SMTP manquant')
  })

  it('adresse manquante', () => {
    const r = resolveSmtpTestConfig(EMPTY, { smtpHost: 'smtp.gmail.com', smtpPass: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Adresse email manquante')
  })

  it('les chaînes vides ou blanches ne valent pas une valeur', () => {
    const r = resolveSmtpTestConfig(EMPTY, { smtpHost: '   ', smtpUser: 'a@b.fr', smtpPass: 'x' })
    expect(r.ok).toBe(false)
  })
})

describe('Ports et TLS', () => {
  it('465 implique SSL par défaut, 587 non', () => {
    const ssl = resolveSmtpTestConfig(EMPTY, { smtpHost: 'h', smtpUser: 'u', smtpPass: 'p', smtpPort: 465 })
    const starttls = resolveSmtpTestConfig(EMPTY, { smtpHost: 'h', smtpUser: 'u', smtpPass: 'p', smtpPort: 587 })
    expect(ssl.ok && ssl.secure).toBe(true)
    expect(starttls.ok && starttls.secure).toBe(false)
  })

  it('accepte un port transmis en chaîne (champ de formulaire)', () => {
    const r = resolveSmtpTestConfig(EMPTY, { smtpHost: 'h', smtpUser: 'u', smtpPass: 'p', smtpPort: '587' })
    expect(r.ok && r.port).toBe(587)
  })

  it('un choix explicite de SSL/TLS est respecté', () => {
    const r = resolveSmtpTestConfig(EMPTY, { smtpHost: 'h', smtpUser: 'u', smtpPass: 'p', smtpPort: 587, smtpSecure: true })
    expect(r.ok && r.secure).toBe(true)
  })

  it('l’expéditeur retombe sur l’adresse du compte', () => {
    const r = resolveSmtpTestConfig(EMPTY, { smtpHost: 'h', smtpUser: 'compte@ex.fr', smtpPass: 'p' })
    expect(r.ok && r.from).toBe('compte@ex.fr')
  })
})

describe('Messages d’erreur SMTP exploitables', () => {
  it('authentification refusée (Gmail) → mentionne le mot de passe d’application', () => {
    const msg = smtpErrorMessage({ code: 'EAUTH', responseCode: 535, message: 'Username and Password not accepted' }, 'smtp.gmail.com')
    expect(msg).toContain('authentification')
    expect(msg).toContain('Gmail')
    expect(msg).toContain('mot de passe d’application')
  })

  it('timeout', () => {
    expect(smtpErrorMessage({ code: 'ETIMEDOUT' }, 'smtp.gmail.com')).toContain('Délai dépassé')
  })

  it('hôte introuvable', () => {
    expect(smtpErrorMessage({ code: 'ENOTFOUND' }, 'smtp.inconnu.example')).toContain('introuvable')
  })

  it('connexion refusée', () => {
    expect(smtpErrorMessage({ code: 'ECONNREFUSED' }, 'smtp.ex.fr')).toContain('Connexion refusée')
  })

  it('erreur TLS', () => {
    expect(smtpErrorMessage({ message: 'wrong version number' }, 'smtp.ex.fr')).toContain('TLS/SSL')
  })

  it('formule correctement le complément (« auprès du », pas « auprès de le »)', () => {
    const generique = smtpErrorMessage({ code: 'EAUTH' }, 'smtp.mon-hebergeur.fr')
    expect(generique).toContain('auprès du serveur email')
    expect(generique).not.toContain('auprès de le')
    expect(smtpErrorMessage({ code: 'EAUTH' }, 'smtp.gmail.com')).toContain('auprès de Gmail')
  })

  it('ne divulgue jamais de trace interne', () => {
    const msg = smtpErrorMessage(new Error('boom\n    at Object.<anonymous> (/app/secret/path.js:1:1)'), 'smtp.ex.fr')
    expect(msg).not.toContain('at Object')
    expect(msg).not.toContain('/app/secret')
    expect(msg.length).toBeLessThanOrEqual(160)
  })

  it('tolère une erreur non structurée', () => {
    expect(smtpErrorMessage(null)).toBeTruthy()
    expect(smtpErrorMessage(undefined)).toBeTruthy()
  })
})
