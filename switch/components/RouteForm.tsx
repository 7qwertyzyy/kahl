"use client";

import { useState, useCallback, useRef, useEffect, MutableRefObject } from "react";
import { MapPin, Navigation, Loader2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { geocodeAddress } from "@/lib/geocoding";
import type { RouteStop, VehicleParams, VehicleMode } from "@/lib/types";
import type { GeocodingResult } from "@/lib/types";

interface GeoInputProps {
  placeholder: string;
  value: string;
  onChange: (stop: RouteStop) => void;
  stopId: string;
  icon: React.ReactNode;
  mapFlyTo: MutableRefObject<((coords: [number, number]) => void) | null>;
}

function GeoInput({ placeholder, value, onChange, stopId, icon, mapFlyTo }: GeoInputProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const handleInput = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await geocodeAddress(q);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  const selectSuggestion = (r: GeocodingResult) => {
    setQuery(r.place_name.split(",")[0]);
    setSuggestions([]);
    setOpen(false);
    onChange({ id: stopId, label: r.place_name, coordinates: r.center });
    mapFlyTo.current?.(r.center);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {icon}
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-8 pr-8 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Loader2 size={14} className="animate-spin text-gray-400" />
          </span>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                onMouseDown={() => selectSuggestion(s)}
                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors truncate"
              >
                <span className="font-medium">{s.place_name.split(",")[0]}</span>
                <span className="text-gray-500 text-xs ml-1">
                  {s.place_name.split(",").slice(1).join(",").trim()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface RouteFormProps {
  vehicleMode: VehicleMode;
  vehicle: VehicleParams;
  onVehicleChange: (v: VehicleParams) => void;
  start: RouteStop;
  onStartChange: (s: RouteStop) => void;
  end: RouteStop;
  onEndChange: (s: RouteStop) => void;
  onCalculateRoute: () => void;
  isRouting: boolean;
  routeError: string | null;
  mapFlyTo: MutableRefObject<((coords: [number, number]) => void) | null>;
}

export default function RouteForm({
  vehicleMode,
  vehicle,
  onVehicleChange,
  start,
  onStartChange,
  end,
  onEndChange,
  onCalculateRoute,
  isRouting,
  routeError,
  mapFlyTo,
}: RouteFormProps) {
  const [vehicleOpen, setVehicleOpen] = useState(false);

  const setField = (field: keyof VehicleParams, value: number) => {
    onVehicleChange({ ...vehicle, [field]: value });
  };

  const canRoute = !!start.coordinates && !!end.coordinates;

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2.5 bg-gray-800 flex items-center gap-2">
        <Navigation size={15} className="text-blue-400" />
        <span className="text-sm font-medium">Routenplanung</span>
      </div>

      <div className="p-3 space-y-3 bg-gray-850">
        {/* Start */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Startort</label>
          <GeoInput
            stopId={start.id}
            placeholder="Startort eingeben…"
            value={start.label.split(",")[0]}
            onChange={onStartChange}
            icon={<MapPin size={14} className="text-green-400" />}
            mapFlyTo={mapFlyTo}
          />
        </div>

        {/* End */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Zielort</label>
          <GeoInput
            stopId={end.id}
            placeholder="Zielort eingeben…"
            value={end.label.split(",")[0]}
            onChange={onEndChange}
            icon={<MapPin size={14} className="text-red-400" />}
            mapFlyTo={mapFlyTo}
          />
        </div>

        {/* Vehicle params collapsible */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setVehicleOpen((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 bg-gray-800 text-xs text-gray-300 hover:bg-gray-750 transition-colors"
          >
            <span className="font-medium">Fahrzeugdaten</span>
            {vehicleOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          {vehicleOpen && (
            <div className="p-3 grid grid-cols-2 gap-2">
              {(
                [
                  { key: "width", label: "Breite (m)", step: 0.01, min: 0.5, max: 10 },
                  { key: "height", label: "Höhe (m)", step: 0.01, min: 1, max: 10 },
                  { key: "weight", label: "Gewicht (t)", step: 0.5, min: 1, max: 1000 },
                  { key: "axleload", label: "Achslast (t)", step: 0.5, min: 1, max: 100 },
                ] as const
              ).map(({ key, label, step, min, max }) => (
                <div key={key} className="space-y-0.5">
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    type="number"
                    value={vehicle[key]}
                    step={step}
                    min={min}
                    max={max}
                    onChange={(e) => setField(key, parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {vehicleMode === "ST" && (
          <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-700 rounded-lg px-2.5 py-2 text-xs text-yellow-300">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>Schwertransport (ST): Sondergenehmigung erforderlich. Route wird mit strengsten HGV-Restriktionen berechnet.</span>
          </div>
        )}

        {routeError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-2.5 py-2 text-xs text-red-300">
            {routeError}
          </div>
        )}

        <button
          onClick={onCalculateRoute}
          disabled={!canRoute || isRouting}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {isRouting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Berechne Route…
            </>
          ) : (
            <>
              <Navigation size={15} />
              Route planen
            </>
          )}
        </button>

        {!canRoute && !isRouting && (
          <p className="text-xs text-center text-gray-600">
            Bitte Start und Ziel angeben
          </p>
        )}
      </div>
    </div>
  );
}
