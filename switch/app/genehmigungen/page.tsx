"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Permit, PaginatedPermits, PermitSearchParams } from "@/lib/types";
import RiskBadge from "@/components/shared/RiskBadge";
import StatusBadge from "@/components/shared/StatusBadge";

const INITIAL_PARAMS: PermitSearchParams = { page: 1, limit: 25 };

export default function GenehmigungsListe() {
  const router = useRouter();
  const [result, setResult] = useState<PaginatedPermits | null>(null);
  const [params, setParams] = useState<PermitSearchParams>(INITIAL_PARAMS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [escortFilter, setEscortFilter] = useState<boolean | undefined>(undefined);
  const [policeFilter, setPoliceFilter] = useState<boolean | undefined>(undefined);

  const load = useCallback((p: PermitSearchParams) => {
    setLoading(true);
    api
      .getPermits(p)
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(params);
  }, [params, load]);

  function applySearch() {
    const next: PermitSearchParams = {
      ...INITIAL_PARAMS,
      q: search || undefined,
      status: statusFilter || undefined,
      risk_level: riskFilter || undefined,
      escort_required: escortFilter,
      police_required: policeFilter,
    };
    setParams(next);
  }

  function openInPlaner(p: Permit) {
    const qs = new URLSearchParams({
      ...(p.start_adresse || p.startort ? { start: p.start_adresse || p.startort || "" } : {}),
      ...(p.ziel_adresse || p.zielort ? { ziel: p.ziel_adresse || p.zielort || "" } : {}),
      ...(p.fahrzeug_breite_m != null ? { breite: String(p.fahrzeug_breite_m) } : {}),
      ...(p.fahrzeug_hoehe_m != null ? { hoehe: String(p.fahrzeug_hoehe_m) } : {}),
      ...(p.gesamtgewicht_t != null ? { gewicht: String(p.gesamtgewicht_t) } : {}),
      ...(p.achslast_t != null ? { achslast: String(p.achslast_t) } : {}),
      ...(p.gueltig_von ? { datum: p.gueltig_von } : {}),
    }).toString();
    router.push(`/planer?${qs}`);
  }

  const permits: Permit[] = result?.items ?? [];
  const total = result?.total ?? 0;
  const pages = result?.pages ?? 1;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Genehmigungen</h1>
        <Link
          href="/genehmigungen/upload"
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded transition-colors"
        >
          + Upload
        </Link>
      </div>

      {/* Filter-Bar */}
      <div className="bg-gray-900 rounded-lg p-4 space-y-3">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="Suche nach Nummer, Kunde, Strecke, Straße..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
          />
          <button
            onClick={applySearch}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm transition-colors"
          >
            Suchen
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-gray-200"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Status: Alle</option>
            <option value="needs_review">Zu prüfen</option>
            <option value="verified">Geprüft</option>
            <option value="error">Fehler</option>
          </select>
          <select
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-gray-200"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
          >
            <option value="">Risiko: Alle</option>
            <option value="niedrig">Niedrig</option>
            <option value="mittel">Mittel</option>
            <option value="hoch">Hoch</option>
            <option value="kritisch">Kritisch</option>
          </select>
          <label className="flex items-center gap-1.5 text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={escortFilter === true}
              onChange={(e) =>
                setEscortFilter(e.target.checked ? true : undefined)
              }
            />
            Begleitpflicht
          </label>
          <label className="flex items-center gap-1.5 text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={policeFilter === true}
              onChange={(e) =>
                setPoliceFilter(e.target.checked ? true : undefined)
              }
            />
            Polizeipflicht
          </label>
          {(statusFilter || riskFilter || search || escortFilter || policeFilter) && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setRiskFilter("");
                setEscortFilter(undefined);
                setPoliceFilter(undefined);
                setParams(INITIAL_PARAMS);
              }}
              className="text-gray-400 hover:text-white text-xs underline"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">Lade...</div>
      ) : (
        <>
          <div className="text-xs text-gray-500">{total} Genehmigung(en)</div>

          <div className="overflow-x-auto bg-gray-900 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700">
                  <th className="px-4 py-3">Nr.</th>
                  <th className="px-4 py-3">Genehm.-Nr.</th>
                  <th className="px-4 py-3">Kunde</th>
                  <th className="px-4 py-3">Start → Ziel</th>
                  <th className="px-4 py-3">Maße</th>
                  <th className="px-4 py-3">Gültig bis</th>
                  <th className="px-4 py-3">Risiko</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {permits.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                      Keine Genehmigungen gefunden.
                    </td>
                  </tr>
                ) : (
                  permits.map((p) => (
                    <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                      <td className="px-4 py-3 text-gray-400 text-xs">{p.id}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/genehmigungen/${p.id}`}
                          className="text-blue-400 hover:underline"
                        >
                          {p.genehmigungsnummer || "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-300 max-w-32 truncate">
                        {p.kunde || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs">
                        {p.startort && p.zielort
                          ? `${p.startort} → ${p.zielort}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {[
                          p.fahrzeug_breite_m != null && `${p.fahrzeug_breite_m}m`,
                          p.fahrzeug_hoehe_m != null && `${p.fahrzeug_hoehe_m}m`,
                          p.gesamtgewicht_t != null && `${p.gesamtgewicht_t}t`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">
                        {p.gueltig_bis || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <RiskBadge level={p.risikostufe} size="sm" />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} size="sm" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Link
                            href={`/genehmigungen/${p.id}`}
                            className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded"
                          >
                            Detail
                          </Link>
                          <button
                            onClick={() => openInPlaner(p)}
                            className="bg-blue-800 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded"
                          >
                            Karte
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                disabled={params.page === 1}
                onClick={() => setParams((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}
                className="px-3 py-1 text-sm bg-gray-700 rounded disabled:opacity-40 hover:bg-gray-600"
              >
                Zurück
              </button>
              <span className="text-sm text-gray-400">
                {params.page} / {pages}
              </span>
              <button
                disabled={params.page === pages}
                onClick={() => setParams((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}
                className="px-3 py-1 text-sm bg-gray-700 rounded disabled:opacity-40 hover:bg-gray-600"
              >
                Weiter
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
