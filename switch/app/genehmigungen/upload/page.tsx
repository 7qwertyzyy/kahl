"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Permit } from "@/lib/types";
import RiskBadge from "@/components/shared/RiskBadge";
import StatusBadge from "@/components/shared/StatusBadge";

type UploadState = "idle" | "uploading" | "done" | "error";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<UploadState>("idle");
  const [results, setResults] = useState<Permit[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    setFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...selected]);
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setState("uploading");
    setResults([]);
    setErrors([]);

    const newResults: Permit[] = [];
    const newErrors: string[] = [];

    for (const file of files) {
      try {
        const permit = await api.uploadPDF(file);
        newResults.push(permit);
      } catch (e) {
        newErrors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    setResults(newResults);
    setErrors(newErrors);
    setState("done");
    setFiles([]);
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/genehmigungen" className="text-gray-400 hover:text-white text-sm">
          ← Zurück
        </Link>
        <h1 className="text-xl font-semibold text-white">Genehmigungen hochladen</h1>
      </div>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-900/20"
            : "border-gray-600 hover:border-gray-400 bg-gray-900"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <div className="text-4xl mb-3">📄</div>
        <p className="text-gray-300 font-medium">PDF-Dateien hierher ziehen</p>
        <p className="text-gray-500 text-sm mt-1">oder klicken zum Auswählen</p>
      </div>

      {/* Selected Files */}
      {files.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">
              {files.length} Datei(en) ausgewählt
            </span>
            <button
              onClick={() => setFiles([])}
              className="text-xs text-gray-500 hover:text-white"
            >
              Alle entfernen
            </button>
          </div>
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">{f.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-gray-600 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={handleUpload}
            disabled={state === "uploading"}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded text-sm font-medium transition-colors"
          >
            {state === "uploading" ? "Verarbeite..." : `${files.length} PDF(s) verarbeiten`}
          </button>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-red-300 text-sm">{e}</p>
          ))}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-gray-300">
            {results.length} Genehmigung(en) verarbeitet — bitte prüfen:
          </h2>
          {results.map((p) => (
            <div key={p.id} className="bg-gray-900 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{p.dateiname}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    Konfidenz: {(p.confidence * 100).toFixed(0)}%
                  </span>
                  <StatusBadge status={p.status} size="sm" />
                  <RiskBadge level={p.risikostufe} size="sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <Row label="Genehmigungsnr." value={p.genehmigungsnummer} />
                  <Row label="Kunde" value={p.kunde} />
                  <Row
                    label="Strecke"
                    value={
                      p.startort && p.zielort
                        ? `${p.startort} → ${p.zielort}`
                        : null
                    }
                  />
                  <Row
                    label="Gültig"
                    value={
                      p.gueltig_von && p.gueltig_bis
                        ? `${p.gueltig_von} – ${p.gueltig_bis}`
                        : null
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Row
                    label="Maße"
                    value={
                      [
                        p.fahrzeug_breite_m && `B: ${p.fahrzeug_breite_m}m`,
                        p.fahrzeug_hoehe_m && `H: ${p.fahrzeug_hoehe_m}m`,
                        p.fahrzeug_laenge_m && `L: ${p.fahrzeug_laenge_m}m`,
                      ]
                        .filter(Boolean)
                        .join(", ") || null
                    }
                  />
                  <Row
                    label="Gewicht"
                    value={p.gesamtgewicht_t ? `${p.gesamtgewicht_t} t` : null}
                  />
                  <Row
                    label="Straßen"
                    value={
                      p.erkannte_strassen.length > 0
                        ? p.erkannte_strassen.join(", ")
                        : null
                    }
                  />
                  <Row
                    label="Auflagen"
                    value={
                      p.auflagen.length > 0
                        ? `${p.auflagen.length} Auflagen`
                        : null
                    }
                  />
                </div>
              </div>

              {p.status === "error" && p.besonderheiten.length > 0 && (
                <div className="bg-red-900/30 border border-red-700 rounded p-2">
                  <p className="text-xs text-red-300 font-medium mb-1">Extraktionsfehler:</p>
                  {p.besonderheiten.map((b, i) => (
                    <p key={i} className="text-xs text-red-400">{b}</p>
                  ))}
                </div>
              )}

              {p.ki_zusammenfassung && (
                <p className="text-xs text-gray-400 italic border-t border-gray-700 pt-2">
                  {p.ki_zusammenfassung}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <Link
                  href={`/genehmigungen/${p.id}`}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded"
                >
                  Detailansicht & Prüfung
                </Link>
                <button
                  onClick={() => {
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
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded"
                >
                  Route im Planer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-gray-200">{value || "—"}</span>
    </div>
  );
}
