'use client'

/**
 * Page de repli hors-ligne servie par le Service Worker lorsqu'une navigation
 * échoue faute de réseau. Volontairement autonome (aucune donnée, aucune session)
 * et exemptée du middleware de licence/authentification.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#0f1629] flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 shadow-xl shadow-blue-600/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="GarageFlow" width={40} height={40} className="rounded-xl" />
        </div>
        <h1 className="text-xl font-semibold text-slate-100">Vous êtes hors ligne</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Impossible de contacter GarageFlow pour le moment. Vérifiez votre connexion
          Internet&nbsp;: l’application se rechargera automatiquement dès qu’elle sera
          rétablie.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          Réessayer
        </button>
      </div>
    </div>
  )
}
