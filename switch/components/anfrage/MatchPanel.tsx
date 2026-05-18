import Link from "next/link";
import type { AnfrageMatch, TransportAnfrage } from "@/lib/types";
import RiskBadge from "@/components/shared/RiskBadge";

export default function MatchPanel({ anfrage }: { anfrage: TransportAnfrage }) {
  if (anfrage.matches.length === 0) {
    return <div className="bg-gray-900 rounded-lg p-6 text-sm text-gray-400">Keine ähnlichen Genehmigungen gefunden.</div>;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-gray-300">{anfrage.matches.length} ähnliche Genehmigungen</h2>
      {anfrage.matches.map((match) => (
        <MatchCard key={match.id} match={match} anfrage={anfrage} />
      ))}
    </div>
  );
}

function MatchCard({ match, anfrage }: { match: AnfrageMatch; anfrage: TransportAnfrage }) {
  const p = match.permit;
  const qs = new URLSearchParams({
    ...(anfrage.start_adresse || anfrage.startort ? { start: anfrage.start_adresse || anfrage.startort || "" } : {}),
    ...(anfrage.ziel_adresse || anfrage.zielort ? { ziel: anfrage.ziel_adresse || anfrage.zielort || "" } : {}),
    ...(anfrage.breite_m != null ? { breite: String(anfrage.breite_m) } : {}),
    ...(anfrage.hoehe_m != null ? { hoehe: String(anfrage.hoehe_m) } : {}),
    ...(anfrage.gewicht_t != null ? { gewicht: String(anfrage.gewicht_t) } : {}),
    ...(anfrage.achslast_t != null ? { achslast: String(anfrage.achslast_t) } : {}),
    ...(anfrage.wunschdatum ? { datum: anfrage.wunschdatum } : {}),
    anfrage_id: String(anfrage.id),
  }).toString();
  return (
    <article className="bg-gray-900 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/genehmigungen/${p.id}`} className="text-blue-400 hover:underline font-medium">
            {p.genehmigungsnummer || `Genehmigung #${p.id}`}
          </Link>
          <p className="text-xs text-gray-400 mt-1">
            {p.startort || "?"} &rarr; {p.zielort || "?"} | {p.fahrzeug_breite_m ?? "?"} m | {p.gesamtgewicht_t ?? "?"} t
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-green-300">{Math.round(match.similarity_score)}%</div>
          <RiskBadge level={p.risikostufe} size="sm" />
        </div>
      </div>
      {match.match_gruende.length > 0 && (
        <ul className="text-sm text-gray-300 space-y-1">
          {match.match_gruende.map((reason) => (
            <li key={reason}>- {reason}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-blue-300">{match.empfehlung}</p>
      <p className="text-xs text-gray-400">
        Auflagen: {[match.begleitpflicht_in_altfall && "Begleitung", match.polizei_in_altfall && "Polizei", match.nachtfahrt_in_altfall && "Nachtfahrt"].filter(Boolean).join(", ") || "keine Flags"}
      </p>
      <div className="flex gap-2">
        <Link href={`/genehmigungen/${p.id}`} className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded">
          Detail öffnen
        </Link>
        <Link href={`/planer?${qs}`} className="bg-blue-700 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded">
          Route vergleichen
        </Link>
      </div>
    </article>
  );
}
