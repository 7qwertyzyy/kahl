"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { RouteResult, VehicleParams, RouteStop, VehicleMode } from "@/lib/types";
import type { TransportAnfrage } from "@/lib/types";
import { api } from "@/lib/api";
import { geocodeAddress } from "@/lib/geocoding";
import Sidebar from "@/components/Sidebar";
import Link from "next/link";

const MapView = dynamic(() => import("@/components/Map"), { ssr: false });

const DEFAULT_VEHICLE: VehicleParams = {
  width: 2.55,
  height: 4.0,
  weight: 40,
  axleload: 11.5,
};

const makeStop = (label = ""): RouteStop => ({
  id: crypto.randomUUID(),
  label,
  coordinates: null,
});

const parseDateParam = (value: string | null): Date => {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

function PlanerInner() {
  const searchParams = useSearchParams();

  const urlStart  = searchParams.get("start")   ?? "";
  const urlZiel   = searchParams.get("ziel")    ?? "";
  const urlBreite = parseFloat(searchParams.get("breite")   ?? "") || null;
  const urlHoehe  = parseFloat(searchParams.get("hoehe")    ?? "") || null;
  const urlGewicht= parseFloat(searchParams.get("gewicht")  ?? "") || null;
  const urlAchslast=parseFloat(searchParams.get("achslast") ?? "") || null;
  const urlDatum = searchParams.get("datum");
  const urlAnfrageId = searchParams.get("anfrage_id");

  const initialVehicle: VehicleParams = {
    width:    urlBreite   ?? DEFAULT_VEHICLE.width,
    height:   urlHoehe    ?? DEFAULT_VEHICLE.height,
    weight:   urlGewicht  ?? DEFAULT_VEHICLE.weight,
    axleload: urlAchslast ?? DEFAULT_VEHICLE.axleload,
  };

  const [vehicleMode, setVehicleMode] = useState<VehicleMode>("STD");
  const [vehicle,     setVehicle]     = useState<VehicleParams>(initialVehicle);
  const [start,       setStart]       = useState<RouteStop>(makeStop(urlStart));
  const [end,         setEnd]         = useState<RouteStop>(makeStop(urlZiel));
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeError,  setRouteError]  = useState<string | null>(null);
  const [isRouting,   setIsRouting]   = useState(false);
  const [showConstructions, setShowConstructions] = useState(true);
  const [showTraffic,       setShowTraffic]       = useState(false);
  const [filterDate,        setFilterDate]        = useState<Date>(parseDateParam(urlDatum));
  const [anfrage,           setAnfrage]           = useState<TransportAnfrage | null>(null);

  const mapFlyToRef = useRef<((coords: [number, number]) => void) | null>(null);

  // ── Core calculation function (no state deps → always stable) ──────────────
  const calculateRouteWithCoords = useCallback(async (
    startCoords: [number, number],
    endCoords:   [number, number],
    veh:         VehicleParams,
    date:        Date,
  ) => {
    setIsRouting(true);
    setRouteError(null);
    setRouteResult(null);
    try {
      const { calculateRoute } = await import("@/lib/openrouteservice");
      const result = await calculateRoute([startCoords, endCoords], veh, date);
      setRouteResult(result);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Unbekannter Fehler beim Routing.");
    } finally {
      setIsRouting(false);
    }
  }, []); // intentionally empty — only uses stable setters

  // ── "Route planen" button ──────────────────────────────────────────────────
  const handleCalculateRoute = useCallback(async () => {
    if (!start.coordinates || !end.coordinates) {
      setRouteError("Bitte Start und Ziel angeben.");
      return;
    }
    await calculateRouteWithCoords(start.coordinates, end.coordinates, vehicle, filterDate);
  }, [start, end, vehicle, filterDate, calculateRouteWithCoords]);

  // ── Geocode URL params and auto-calculate on navigation from permit page ───
  useEffect(() => {
    const newVehicle: VehicleParams = {
      width:    urlBreite   ?? DEFAULT_VEHICLE.width,
      height:   urlHoehe    ?? DEFAULT_VEHICLE.height,
      weight:   urlGewicht  ?? DEFAULT_VEHICLE.weight,
      axleload: urlAchslast ?? DEFAULT_VEHICLE.axleload,
    };
    const newFilterDate = parseDateParam(urlDatum);
    setVehicle(newVehicle);
    setFilterDate(newFilterDate);
    setRouteError(null);
    setRouteResult(null);

    if (!urlStart && !urlZiel) return;

    let cancelled = false;
    (async () => {
      const [startResults, endResults] = await Promise.all([
        urlStart ? geocodeAddress(urlStart).catch(() => []) : Promise.resolve([]),
        urlZiel  ? geocodeAddress(urlZiel).catch(()  => []) : Promise.resolve([]),
      ]);
      if (cancelled) return;

      const newStart: RouteStop = startResults.length > 0
        ? { id: crypto.randomUUID(), label: startResults[0].place_name, coordinates: startResults[0].center }
        : makeStop(urlStart);
      const newEnd: RouteStop = endResults.length > 0
        ? { id: crypto.randomUUID(), label: endResults[0].place_name, coordinates: endResults[0].center }
        : makeStop(urlZiel);

      setStart(newStart);
      setEnd(newEnd);

      if (newStart.coordinates && newEnd.coordinates) {
        await calculateRouteWithCoords(newStart.coordinates, newEnd.coordinates, newVehicle, newFilterDate);
      } else if (!cancelled) {
        setRouteError("Start oder Ziel konnte nicht automatisch gefunden werden. Bitte im Planer aus den Vorschlägen auswählen.");
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // ── Anfrage data ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!urlAnfrageId) {
      Promise.resolve().then(() => { if (!cancelled) setAnfrage(null); });
      return;
    }
    api.getAnfrage(Number(urlAnfrageId))
      .then(value  => { if (!cancelled) setAnfrage(value); })
      .catch(()    => { if (!cancelled) setAnfrage(null);  });
    return () => { cancelled = true; };
  }, [urlAnfrageId]);

  return (
    <div className="h-full w-full overflow-hidden relative">
      <Sidebar
        vehicleMode={vehicleMode}
        onVehicleModeChange={setVehicleMode}
        vehicle={vehicle}
        onVehicleChange={setVehicle}
        start={start}
        onStartChange={setStart}
        end={end}
        onEndChange={setEnd}
        onCalculateRoute={handleCalculateRoute}
        isRouting={isRouting}
        routeResult={routeResult}
        routeError={routeError}
        showConstructions={showConstructions}
        onShowConstructionsChange={setShowConstructions}
        showTraffic={showTraffic}
        onShowTrafficChange={setShowTraffic}
        filterDate={filterDate}
        onFilterDateChange={setFilterDate}
        mapFlyTo={mapFlyToRef}
      />
      <div className="fixed top-16 bottom-0 left-[380px] right-0">
        <MapView
          routeGeoJSON={routeResult?.geojson ?? null}
          showConstructions={showConstructions}
          showTraffic={showTraffic}
          filterDate={filterDate}
          mapFlyToRef={mapFlyToRef}
        />
      </div>
      {anfrage && (
        <div className="fixed right-4 top-20 z-20 w-72 rounded-lg border border-gray-700 bg-gray-900/95 p-4 shadow-xl">
          <h2 className="text-sm font-medium text-white">Anfrage #{anfrage.id}</h2>
          <p className="mt-1 text-xs text-gray-300">{anfrage.kunde || "Unbekannter Kunde"} | {anfrage.transportgut || "Transportgut"}</p>
          <p className="mt-2 text-xs text-gray-400">{anfrage.matches.length} ähnliche Genehmigungen</p>
          <Link href={`/anfrage/${anfrage.id}`} className="mt-3 inline-block rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500">
            Zurück zum Briefing
          </Link>
        </div>
      )}
    </div>
  );
}

export default function PlanerPage() {
  return (
    <Suspense>
      <PlanerInner />
    </Suspense>
  );
}
