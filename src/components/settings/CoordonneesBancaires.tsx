'use client'

/**
 * Coordonnées bancaires du garage — recherche de banque, BIC, IBAN (GF-023).
 *
 * ─── Ce qui existait ────────────────────────────────────────────────────────
 * Trois champs de texte libre, validés par `max(34)` et `max(11)`. Un IBAN
 * amputé d'un chiffre ou un BIC de six lettres était accepté, enregistré, puis
 * IMPRIMÉ au pied de chaque facture. Le garage l'apprenait quand le virement de
 * son client était rejeté.
 *
 * ─── Règle absolue : ne JAMAIS inventer un BIC (§17) ────────────────────────
 * Dans les réseaux fédérés — Crédit Agricole, Caisse d'Épargne, Banque
 * Populaire, Crédit Mutuel — le BIC dépend de la caisse régionale. Proposer
 * celui « de la marque » y serait faux la plupart du temps. Pour ces
 * établissements, RIEN n'est proposé et l'écran demande de recopier le BIC
 * depuis le RIB. Le champ reste modifiable dans tous les cas.
 *
 * La vérification de l'IBAN est locale (clé de contrôle modulo 97) : elle dit
 * que la saisie est BIEN FORMÉE. Elle ne dit pas que le compte existe — aucun
 * contrôle local ne le peut, et l'écran ne le laisse pas croire.
 */
import { useMemo, useState } from 'react'
import { Landmark, Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GarageSettings } from './types'
import { chercherEtablissements, type Etablissement } from '@/lib/banque/etablissements'
import { verifierIban, verifierBic, formaterIban, paysCoherents } from '@/lib/banque/iban'

interface Props {
  s: GarageSettings
  set: <K extends keyof GarageSettings>(k: K, v: GarageSettings[K]) => void
}

const CHAMP = 'w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600'

export function CoordonneesBancaires({ s, set }: Props) {
  const [ouvert, setOuvert] = useState(false)

  const propositions = useMemo(() => chercherEtablissements(s.bankName), [s.bankName])
  const verdictIban = useMemo(() => verifierIban(s.iban), [s.iban])
  const verdictBic = useMemo(() => verifierBic(s.bic), [s.bic])
  const memePays = useMemo(() => paysCoherents(s.iban, s.bic), [s.iban, s.bic])

  /** L'établissement retenu impose-t-il de recopier le BIC depuis le RIB ? */
  const [bicVariable, setBicVariable] = useState(false)

  function choisir(e: Etablissement) {
    set('bankName', e.nom)
    setOuvert(false)
    if (e.bic) {
      set('bic', e.bic)
      setBicVariable(false)
    } else {
      // On ne remplace PAS ce que l'utilisateur a déjà saisi : on l'avertit.
      setBicVariable(Boolean(e.bicVariable))
    }
  }

  return (
    <div className="border-t border-white/[0.07] pt-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Coordonnées bancaires</p>

      {/* ── Banque : recherche par nom, sigle ou groupe (§16) ─────────────── */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="gf-banque">
          Banque<span className="ml-1 text-slate-600">(optionnel)</span>
        </label>
        <input
          id="gf-banque"
          value={s.bankName}
          onChange={(e) => { set('bankName', e.target.value); setOuvert(true); setBicVariable(false) }}
          onFocus={() => setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 150)}
          placeholder="BNP, SG, Crédit Agricole…"
          autoComplete="off"
          role="combobox"
          aria-expanded={ouvert && propositions.length > 0}
          // `aria-controls` doit désigner la liste MÊME quand elle est fermée :
          // c'est ce lien qui permet au lecteur d'écran d'annoncer les
          // propositions à l'ouverture.
          aria-controls="gf-banque-propositions"
          aria-autocomplete="list"
          className={CHAMP}
        />
        {ouvert && propositions.length > 0 && (
          <div id="gf-banque-propositions" role="listbox" aria-label="Établissements proposés" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/15 bg-[#1a2235] shadow-2xl">
            {propositions.map((e) => (
              <button
                key={e.nom}
                type="button"
                role="option"
                aria-selected={e.nom === s.bankName}
                onMouseDown={(ev) => { ev.preventDefault(); choisir(e) }}
                className="flex w-full items-start gap-2 border-b border-white/[0.05] px-3 py-2 text-left last:border-0 hover:bg-white/[0.06]"
              >
                <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-200">{e.nom}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {e.groupe ? `Groupe ${e.groupe} · ` : ''}
                    {e.bic ? `BIC ${e.bic}` : 'BIC selon votre agence'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        {/* ── IBAN ──────────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="gf-iban">
            IBAN<span className="ml-1 text-slate-600">(optionnel)</span>
          </label>
          <input
            id="gf-iban"
            value={s.iban}
            onChange={(e) => set('iban', e.target.value)}
            // Mise au propre à la SORTIE du champ : reformater à chaque frappe
            // déplacerait le curseur sous les doigts de l'utilisateur.
            onBlur={() => { if (s.iban.trim()) set('iban', formaterIban(s.iban)) }}
            placeholder="FR76 3000 6000 0112 3456 7890 189"
            autoComplete="off"
            aria-invalid={Boolean(s.iban.trim()) && !verdictIban.valide}
            aria-describedby="gf-iban-etat"
            className={cn(CHAMP, s.iban.trim() && !verdictIban.valide && 'border-amber-500/50')}
          />
          <p id="gf-iban-etat" className="mt-1 text-[10px] leading-snug">
            {!s.iban.trim() ? (
              <span className="text-slate-600">Figurera sur vos factures.</span>
            ) : verdictIban.valide ? (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Check className="h-3 w-3" aria-hidden="true" />
                Clé de contrôle correcte{verdictIban.pays ? ` (${verdictIban.pays})` : ''}.
              </span>
            ) : (
              <span className="inline-flex items-start gap-1 text-amber-300">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                {verdictIban.message}
              </span>
            )}
          </p>
        </div>

        {/* ── BIC ───────────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="gf-bic">
            BIC<span className="ml-1 text-slate-600">(optionnel)</span>
          </label>
          <input
            id="gf-bic"
            value={s.bic}
            onChange={(e) => set('bic', e.target.value.toUpperCase())}
            placeholder="BNPAFRPP"
            autoComplete="off"
            aria-invalid={Boolean(s.bic.trim()) && !verdictBic.valide}
            aria-describedby="gf-bic-etat"
            className={cn(CHAMP, s.bic.trim() && !verdictBic.valide && 'border-amber-500/50')}
          />
          <p id="gf-bic-etat" className="mt-1 text-[10px] leading-snug">
            {bicVariable ? (
              <span className="inline-flex items-start gap-1 text-amber-300">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                Ce réseau a un BIC différent par agence : recopiez celui de votre RIB.
              </span>
            ) : !s.bic.trim() ? (
              <span className="text-slate-600">8 ou 11 caractères.</span>
            ) : !verdictBic.valide ? (
              <span className="inline-flex items-start gap-1 text-amber-300">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                {verdictBic.message}
              </span>
            ) : memePays === false ? (
              <span className="inline-flex items-start gap-1 text-amber-300">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                Ce BIC ne désigne pas le même pays que l’IBAN.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Check className="h-3 w-3" aria-hidden="true" />
                Format valide.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
