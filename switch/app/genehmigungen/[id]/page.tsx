"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Permit } from "@/lib/types";
import RiskBadge from "@/components/shared/RiskBadge";
import StatusBadge from "@/components/shared/StatusBadge";

const STATUS_LABELS: Record<string, string> = {
  needs_review: "Zu prüfen",
  verified: "Geprüft",
  error: "Fehler",
};

export default function PermitDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [permit, setPermit] = useState<Permit | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Permit>>({});

  useEffect(() => {
    api
      .getPermit(Number(id))
      .then((p) => { setPermit(p); setEdit(p); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    if (!permit) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await api.updatePermit(permit.id, edit);
      setPermit(updated);
      setEdit(updated);
      setSaveMsg("Gespeichert.");
    } catch (e) {
      setSaveMsg(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    if (!permit) return;
    setSaving(true);
    try {
      const updated = await api.updatePermitStatus(permit.id, "verified");
      setPermit(updated);
      setEdit(updated);
      setSaveMsg("Als geprüft markiert.");
    } catch (e) {
      setSaveMsg(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!permit || !confirm("Genehmigung wirklich löschen?")) return;
    await api.deletePermit(permit.id);
    router.push("/genehmigungen");
  }

  function openInPlaner() {
    if (!permit) return;
    const qs = new URLSearchParams({
      ...(permit.start_adresse || permit.startort ? { start: permit.start_adresse || permit.startort || "" } : {}),
      ...(permit.ziel_adresse || permit.zielort ? { ziel: permit.ziel_adresse || permit.zielort || "" } : {}),
      ...(permit.fahrzeug_breite_m != null ? { breite: String(permit.fahrzeug_breite_m) } : {}),
      ...(permit.fahrzeug_hoehe_m != null ? { hoehe: String(permit.fahrzeug_hoehe_m) } : {}),
      ...(permit.gesamtgewicht_t != null ? { gewicht: String(permit.gesamtgewicht_t) } : {}),
      ...(permit.achslast_t != null ? { achslast: String(permit.achslast_t) } : {}),
      ...(permit.gueltig_von ? { datum: permit.gueltig_von } : {}),
    }).toString();
    router.push(`/planer?${qs}`);
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Lade...</div>;
  if (error) return <div className="p-6 text-red-400 text-sm">{error}</div>;
  if (!permit) return null;

  const p = permit;
  const flagCount = [p.begleitfahrzeug_erforderlich, p.polizei_erforderlich, p.nachtfahrt_erforderlich].filter(Boolean).length;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/genehmigungen" className="text-gray-400 hover:text-white text-sm">
            ← Zurück
          </Link>
          <h1 className="text-xl font-semibold text-white">
            {p.genehmigungsnummer || `Genehmigung #${p.id}`}
          </h1>
          <StatusBadge status={p.status} />
          <RiskBadge level={p.risikostufe} />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={openInPlaner}
            className="bg-blue-700 hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded"
          >
            Route im Planer
          </button>
          {p.status !== "verified" && (
            <button
              onClick={handleVerify}
              disabled={saving}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
            >
              Als geprüft markieren
            </button>
          )}
          <button
            onClick={handleDelete}
            className="bg-red-800 hover:bg-red-700 text-white text-sm px-3 py-1.5 rounded"
          >
            Löschen
          </button>
        </div>
      </div>

      {saveMsg && (
        <div className={`text-sm px-3 py-2 rounded ${saveMsg.startsWith("Fehler") ? "bg-red-900/40 text-red-300" : "bg-green-900/40 text-green-300"}`}>
          {saveMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Stamm- und Transportdaten */}
        <div className="space-y-4">
          <Section title="Identifikation">
            <Field label="Genehmigungsnr.">
              <input
                className={INPUT_CLS}
                value={edit.genehmigungsnummer ?? ""}
                onChange={(e) => setEdit({ ...edit, genehmigungsnummer: e.target.value })}
              />
            </Field>
            <Field label="Antragsnr.">
              <input
                className={INPUT_CLS}
                value={edit.antragsnummer ?? ""}
                onChange={(e) => setEdit({ ...edit, antragsnummer: e.target.value })}
              />
            </Field>
            <Field label="Genehmigungsart">
              <input
                className={INPUT_CLS}
                value={edit.genehmigungsart ?? ""}
                onChange={(e) => setEdit({ ...edit, genehmigungsart: e.target.value })}
              />
            </Field>
            <Field label="Kunde">
              <input
                className={INPUT_CLS}
                value={edit.kunde ?? ""}
                onChange={(e) => setEdit({ ...edit, kunde: e.target.value })}
              />
            </Field>
            <Field label="Konfidenz">
              <span className="text-gray-300 text-sm">{(p.confidence * 100).toFixed(0)}%</span>
            </Field>
          </Section>

          <Section title="Strecke">
            <Field label="Startort">
              <input
                className={INPUT_CLS}
                value={edit.startort ?? ""}
                onChange={(e) => setEdit({ ...edit, startort: e.target.value })}
              />
            </Field>
            <Field label="Bundesland Start">
              <input
                className={INPUT_CLS}
                value={edit.start_bundesland ?? ""}
                onChange={(e) => setEdit({ ...edit, start_bundesland: e.target.value })}
              />
            </Field>
            <Field label="Zielort">
              <input
                className={INPUT_CLS}
                value={edit.zielort ?? ""}
                onChange={(e) => setEdit({ ...edit, zielort: e.target.value })}
              />
            </Field>
            <Field label="Bundesland Ziel">
              <input
                className={INPUT_CLS}
                value={edit.ziel_bundesland ?? ""}
                onChange={(e) => setEdit({ ...edit, ziel_bundesland: e.target.value })}
              />
            </Field>
            {p.erkannte_strassen.length > 0 && (
              <Field label="Erkannte Straßen">
                <div className="flex flex-wrap gap-1">
                  {p.erkannte_strassen.map((s) => (
                    <span key={s} className="bg-gray-700 text-gray-200 text-xs px-2 py-0.5 rounded">
                      {s}
                    </span>
                  ))}
                </div>
              </Field>
            )}
          </Section>

          <Section title="Gültigkeit">
            <Field label="Gültig von">
              <input
                type="date"
                className={INPUT_CLS}
                value={edit.gueltig_von ?? ""}
                onChange={(e) => setEdit({ ...edit, gueltig_von: e.target.value })}
              />
            </Field>
            <Field label="Gültig bis">
              <input
                type="date"
                className={INPUT_CLS}
                value={edit.gueltig_bis ?? ""}
                onChange={(e) => setEdit({ ...edit, gueltig_bis: e.target.value })}
              />
            </Field>
          </Section>
        </div>

        {/* Right: Fahrzeug, Auflagen, KI */}
        <div className="space-y-4">
          <Section title="Fahrzeugdaten">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Breite (m)">
                <input
                  type="number"
                  step="0.01"
                  className={INPUT_CLS}
                  value={edit.fahrzeug_breite_m ?? ""}
                  onChange={(e) => setEdit({ ...edit, fahrzeug_breite_m: parseFloat(e.target.value) || null })}
                />
              </Field>
              <Field label="Höhe (m)">
                <input
                  type="number"
                  step="0.01"
                  className={INPUT_CLS}
                  value={edit.fahrzeug_hoehe_m ?? ""}
                  onChange={(e) => setEdit({ ...edit, fahrzeug_hoehe_m: parseFloat(e.target.value) || null })}
                />
              </Field>
              <Field label="Länge (m)">
                <input
                  type="number"
                  step="0.01"
                  className={INPUT_CLS}
                  value={edit.fahrzeug_laenge_m ?? ""}
                  onChange={(e) => setEdit({ ...edit, fahrzeug_laenge_m: parseFloat(e.target.value) || null })}
                />
              </Field>
              <Field label="Gewicht (t)">
                <input
                  type="number"
                  step="0.1"
                  className={INPUT_CLS}
                  value={edit.gesamtgewicht_t ?? ""}
                  onChange={(e) => setEdit({ ...edit, gesamtgewicht_t: parseFloat(e.target.value) || null })}
                />
              </Field>
              <Field label="Achslast (t)">
                <input
                  type="number"
                  step="0.1"
                  className={INPUT_CLS}
                  value={edit.achslast_t ?? ""}
                  onChange={(e) => setEdit({ ...edit, achslast_t: parseFloat(e.target.value) || null })}
                />
              </Field>
            </div>
          </Section>

          <Section title={`Auflagen (${p.auflagenstaerke_stufe}, ${p.auflagenstaerke} Punkte)`}>
            <div className="flex gap-3 mb-2">
              <Flag active={p.begleitfahrzeug_erforderlich} label="Begleitfahrzeug" />
              <Flag active={p.polizei_erforderlich} label="Polizei" />
              <Flag active={p.nachtfahrt_erforderlich} label="Nachtfahrt" />
            </div>
            {p.auflagen.length > 0 ? (
              <ul className="space-y-1 text-sm text-gray-300">
                {p.auflagen.map((a, i) => {
                  const match = a.match(/^\[(.+?)\]\s*(.*)/);
                  return (
                    <li key={i} className="flex gap-2">
                      {match ? (
                        <>
                          <span className="bg-gray-700 text-gray-300 text-xs px-1.5 rounded shrink-0 h-fit mt-0.5">
                            {match[1]}
                          </span>
                          <span>{match[2]}</span>
                        </>
                      ) : (
                        <span>{a}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-gray-500 text-sm">Keine Auflagen extrahiert.</p>
            )}
          </Section>

          <Section title="KI-Zusammenfassung">
            {p.ki_zusammenfassung ? (
              <p className="text-gray-300 text-sm italic">{p.ki_zusammenfassung}</p>
            ) : (
              <p className="text-gray-500 text-sm">Keine Zusammenfassung verfügbar.</p>
            )}
          </Section>

          <Section title="Risiko">
            <div className="flex items-center gap-2 mb-2">
              <RiskBadge level={p.risikostufe} />
              <span className="text-sm text-gray-400">{p.risiko_begruendung || "—"}</span>
            </div>
          </Section>

          <Section title="Status">
            <div className="flex items-center gap-3">
              <select
                className={INPUT_CLS + " w-auto"}
                value={edit.status ?? p.status}
                onChange={(e) => setEdit({ ...edit, status: e.target.value as Permit["status"] })}
              >
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {p.geprueft_von && (
                <span className="text-xs text-gray-500">
                  von {p.geprueft_von} am {p.geprueft_am?.slice(0, 10)}
                </span>
              )}
            </div>
          </Section>

          <Section title="Kommentare">
            <textarea
              rows={3}
              className={INPUT_CLS + " resize-none"}
              placeholder="Interne Notizen..."
              value={edit.kommentare ?? ""}
              onChange={(e) => setEdit({ ...edit, kommentare: e.target.value })}
            />
          </Section>
        </div>
      </div>

      <div className="flex gap-3 pb-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2 rounded text-sm font-medium"
        >
          {saving ? "Speichern..." : "Änderungen speichern"}
        </button>
        <Link
          href="/anfrage"
          className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm"
        >
          Ähnliche Anfragen suchen
        </Link>
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function Flag({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`text-xs px-2 py-1 rounded font-medium ${
        active ? "bg-red-800 text-red-200" : "bg-gray-800 text-gray-500"
      }`}
    >
      {label}
    </span>
  );
}
