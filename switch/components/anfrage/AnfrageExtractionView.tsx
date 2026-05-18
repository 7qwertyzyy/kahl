import Link from "next/link";
import type { TransportAnfrage } from "@/lib/types";

export default function AnfrageExtractionView({ anfrage }: { anfrage: TransportAnfrage }) {
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
    <section className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-300">Extrahierte Daten</h2>
        <Link href={`/planer?${qs}`} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded">
          Route im Planer öffnen
        </Link>
      </div>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Row label="Kunde" value={anfrage.kunde} />
        <Row label="Kontakt" value={anfrage.ansprechpartner || anfrage.email || anfrage.telefon} />
        <Row label="Start" value={anfrage.start_adresse || anfrage.startort} />
        <Row label="Ziel" value={anfrage.ziel_adresse || anfrage.zielort} />
        <Row label="Transportgut" value={anfrage.transportgut} />
        <Row label="Maße" value={[anfrage.laenge_m, anfrage.breite_m, anfrage.hoehe_m].some(Boolean) ? `${anfrage.laenge_m ?? "?"} x ${anfrage.breite_m ?? "?"} x ${anfrage.hoehe_m ?? "?"} m` : null} />
        <Row label="Gewicht" value={anfrage.gewicht_t != null ? `${anfrage.gewicht_t} t` : null} />
        <Row label="Achslast" value={anfrage.achslast_t != null ? `${anfrage.achslast_t} t` : null} />
        <Row label="Wunschdatum" value={anfrage.wunschdatum} />
        <Row label="Genehmigung" value={anfrage.schwertransport_relevant == null ? "unklar" : anfrage.schwertransport_relevant ? "wahrscheinlich erforderlich" : "nicht offensichtlich erforderlich"} />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-gray-500">{label}</dt>
      <dd className="text-gray-200">{value || "-"}</dd>
    </div>
  );
}
