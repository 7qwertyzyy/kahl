/* src/app/page.tsx */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  MapPin,
  Moon,
  Navigation,
  PencilRuler,
  Plus,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Sun,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";
import maplibregl, { Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// >>> Preset/Builder (bereits angelegt)
import { buildPlanBody, DEFAULT_PLAN_PRESET } from "../lib/planPreset";

type Coords = [number, number];
type Suggestion = { label: string; coord: Coords; raw: any };
type MapControlPoint = {
  id: string;
  coord: Coords;
  label: string | null;
  anchorMeasureM: number;
  anchorCoord: Coords;
  guideBefore: Coords;
  guideAfter: Coords;
};

const sToMin = (s: number) => Math.round((s || 0) / 60);
const MAX_ROUTE_CONTROL_POINTS = 2;
const MIN_CONTROL_POINT_DISTANCE_M = 250;
const CONTROL_POINT_MIN_MOVE_M = 70;
const CONTROL_POINT_GUIDE_WINDOW_M = 1500;
const CONTROL_POINT_ROUTE_PROXIMITY_M = 450;
const CONTROL_POINT_DISTANCE_RATIO_LIMIT = 1.7;

// -------------------- Helpers --------------------
function parseLonLat(input: string): Coords | null {
  const parts = input.split(",").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

async function geocode(addr: string): Promise<Coords | null> {
  const u = new URL("/api/geocode", window.location.origin);
  u.searchParams.set("q", addr);
  const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  const j = await r.json();
  const lon = Number(j?.lon);
  const lat = Number(j?.lat);
  if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
  return null;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatSuggestion(row: any): string | null {
  const a = row?.address || {};
  const road =
    a.road ||
    a.pedestrian ||
    a.footway ||
    a.path ||
    a.cycleway ||
    a.residential ||
    a.neighbourhood;
  const housenr = a.house_number || "";
  const postcode = a.postcode || "";
  const city =
    a.city ||
    a.town ||
    a.village ||
    a.municipality ||
    a.suburb ||
    a.hamlet ||
    a.county ||
    "";
  if (!road && !postcode && !city) return null;
  const streetPart = [road, housenr].filter(Boolean).join(" ").trim();
  const placePart = [postcode, city].filter(Boolean).join(", ").trim();
  return [streetPart, placePart].filter(Boolean).join(", ");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeStreetName(name: string): string | null {
  const value = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(die|der|den)\s+/i, "");
  if (!value) return null;
  if (/^(richtung|rechte(?:n)? seite|linke(?:n)? seite|der rechte(?:n)? seite|der linke(?:n)? seite|rechts|links)$/i.test(value)) return null;
  if (/^[A-ZÄÖÜa-zäöüß-]+(?:\/[A-ZÄÖÜa-zäöüß-]+)+$/.test(value)) return null;
  return value;
}

function looksLikeRoadOrPlaceName(name: string): boolean {
  const value = String(name ?? "").trim();
  if (!value) return false;
  if (value.includes("/") && !/\([^)]*\/[^)]*\)/.test(value) && !/^(A|B|L|K)\d+(?:\/\d+)?\b/i.test(value)) {
    return false;
  }
  return (
    /^(A|B|L|K)\d+\b/i.test(value) ||
    /^Unter den [A-ZÄÖÜ]/.test(value) ||
    /^Anschlussstelle\b/i.test(value) ||
    /(straße|str\.?|gasse|platz|ring|weg|damm|allee|brücke|markt|tor|ufer|wall|kai|chaussee|steig|berg|bogen|kreisel)\b/i.test(value)
  );
}

function isLikelyDirectionFragment(name: string): boolean {
  return (
    /^(hh-|du-|berlin|hamburg|dortmund|bremen|osnabrück|essen|lübeck|potsdam|friedrichshain|tiergarten)(?:\/|$)/i.test(name) ||
    (name.includes("/") && !looksLikeRoadOrPlaceName(name)) ||
    /\b(zentrum|centrum|flughafen|hafen|messe|cch)\b/i.test(name)
  );
}

function inferStreetNamesFromInstruction(instruction: string): string[] {
  const text = String(instruction ?? "").trim();
  if (!text) return [];

  const patterns = [
    { kind: "road", pattern: /\bauf\s+(.+?)(?=\s+in Richtung\b|\s+Richtung\b|\s+nach\b|\. Fahren Sie\b|\.?$)/i },
    { kind: "arrival", pattern: /\bSie erreichen\s+(.+?)(?=\.|\s+Ihr Ziel\b|$)/i },
  ];

  const names: string[] = [];
  for (const entry of patterns) {
    const match = text.match(entry.pattern);
    const raw = match?.[1] ?? "";
    const value = normalizeStreetName(raw);
    if (!value) continue;
    if (entry.kind === "arrival") {
      if (!looksLikeRoadOrPlaceName(value)) continue;
    } else {
      if (isLikelyDirectionFragment(value)) continue;
      if (value.length > 80) continue;
    }
    if (!names.includes(value)) names.push(value);
  }

  return names;
}

function inferTailDestinationName(instruction: string): string[] {
  const text = String(instruction ?? "").trim();
  if (!text) return [];

  const patterns = [
    /\bin Richtung\s+(.+?)(?=\.|\s+Fahren Sie\b|$)/i,
    /\bSie erreichen\s+(.+?)(?=\.|\s+Ihr Ziel\b|$)/i,
  ];

  const names: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = normalizeStreetName(match?.[1] ?? "");
    if (!value) continue;
    if (!looksLikeRoadOrPlaceName(value)) continue;
    if (isLikelyDirectionFragment(value)) continue;
    if (!names.includes(value)) names.push(value);
  }
  return names;
}

function buildStreetSequence(feature: any): string[] {
  const direct = Array.isArray(feature?.properties?.streets_sequence)
    ? feature.properties.streets_sequence
        .map((name: unknown) => (typeof name === "string" ? normalizeStreetName(name) : null))
        .filter(Boolean)
    : [];

  const maneuvers = Array.isArray(feature?.properties?.maneuvers) ? feature.properties.maneuvers : [];
  const derived = maneuvers.flatMap((step: any) => {
    const explicitNames = Array.isArray(step?.street_names)
      ? step.street_names
          .map((name: unknown) => (typeof name === "string" ? normalizeStreetName(name) : null))
          .filter(Boolean)
      : [];
    if (explicitNames.length > 0) return explicitNames;
    return inferStreetNamesFromInstruction(String(step?.instruction ?? ""));
  });

  // Force-append valid names from the final maneuvers because `streets_sequence`
  // from the backend can be truncated near the destination.
  const tailExtras = maneuvers.slice(-8).flatMap((step: any) => {
    const instruction = String(step?.instruction ?? "");
    return [...inferStreetNamesFromInstruction(instruction), ...inferTailDestinationName(instruction)];
  });

  if (direct.length > 0) {
    const merged = [...direct];
    for (const name of tailExtras) {
      const key = name.toLowerCase();
      const tailWindow = merged.slice(-10).map((entry: string) => entry.toLowerCase());
      if (merged[merged.length - 1] === name) continue;
      if (tailWindow.includes(key)) continue;
      merged.push(name);
    }
    return merged.filter((name: string, index: number) => index === 0 || name !== merged[index - 1]);
  }

  const merged = [...derived, ...tailExtras];
  return merged.filter((name: string, index: number) => index === 0 || name !== merged[index - 1]);
}

function buildUniqueStreetSequence(streetNames: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of streetNames) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

function coordsEqualApprox(a: Coords | null | undefined, b: Coords | null | undefined, epsilon = 1e-6) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
}

function formatCoordLabel(coord: Coords) {
  return `${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}`;
}

function makeControlPointId() {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractRouteLineCoords(feature: any): Coords[] {
  const geometry = feature?.geometry;
  if (!geometry) return [];

  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.filter(
      (coord: unknown): coord is Coords =>
        Array.isArray(coord) &&
        coord.length >= 2 &&
        Number.isFinite(Number(coord[0])) &&
        Number.isFinite(Number(coord[1]))
    );
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    const merged: Coords[] = [];
    for (const line of geometry.coordinates) {
      if (!Array.isArray(line)) continue;
      for (const rawCoord of line) {
        if (
          !Array.isArray(rawCoord) ||
          rawCoord.length < 2 ||
          !Number.isFinite(Number(rawCoord[0])) ||
          !Number.isFinite(Number(rawCoord[1]))
        ) {
          continue;
        }
        const coord: Coords = [Number(rawCoord[0]), Number(rawCoord[1])];
        const prev = merged[merged.length - 1];
        if (prev && coordsEqualApprox(prev, coord)) continue;
        merged.push(coord);
      }
    }
    return merged;
  }

  return [];
}

function simplifyRouteFeatureForMap(feature: any, extraProps?: Record<string, unknown>) {
  const coords = extractRouteLineCoords(feature);
  if (coords.length < 2) return null;

  return {
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: coords,
    },
    properties: {
      leg_index: typeof feature?.properties?.leg_index === "number" ? feature.properties.leg_index : 0,
      ...(Array.isArray(feature?.properties?.bbox) ? { bbox: feature.properties.bbox } : {}),
      ...(extraProps ?? {}),
    },
  };
}

function projectPointToRoute(point: Coords, routeCoords: Coords[]): { measureM: number; snapped: Coords } | null {
  if (routeCoords.length < 2) return null;

  let cumulativeM = 0;
  let best:
    | {
        measureM: number;
        snapped: Coords;
        distanceSq: number;
      }
    | null = null;

  for (let index = 0; index < routeCoords.length - 1; index += 1) {
    const a = routeCoords[index];
    const b = routeCoords[index + 1];
    const refLat = ((a[1] + b[1] + point[1]) / 3) * (Math.PI / 180);
    const lonScale = 111_320 * Math.cos(refLat);
    const latScale = 110_540;

    const ax = a[0] * lonScale;
    const ay = a[1] * latScale;
    const bx = b[0] * lonScale;
    const by = b[1] * latScale;
    const px = point[0] * lonScale;
    const py = point[1] * latScale;

    const vx = bx - ax;
    const vy = by - ay;
    const segLenSq = vx * vx + vy * vy;
    if (segLenSq <= 0) continue;

    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / segLenSq));
    const projX = ax + vx * t;
    const projY = ay + vy * t;
    const dx = px - projX;
    const dy = py - projY;
    const distanceSq = dx * dx + dy * dy;
    const segLenM = Math.sqrt(segLenSq);
    const snapped: Coords = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

    if (!best || distanceSq < best.distanceSq) {
      best = {
        measureM: cumulativeM + segLenM * t,
        snapped,
        distanceSq,
      };
    }

    cumulativeM += segLenM;
  }

  return best ? { measureM: best.measureM, snapped: best.snapped } : null;
}

function routeCoordAtMeasure(routeCoords: Coords[], measureM: number): Coords | null {
  if (routeCoords.length === 0) return null;
  if (routeCoords.length === 1) return routeCoords[0];
  if (measureM <= 0) return routeCoords[0];

  let cumulativeM = 0;
  for (let index = 0; index < routeCoords.length - 1; index += 1) {
    const a = routeCoords[index];
    const b = routeCoords[index + 1];
    const segLenM = haversine(a[1], a[0], b[1], b[0]);
    if (segLenM <= 0) continue;
    if (measureM <= cumulativeM + segLenM) {
      const t = Math.max(0, Math.min(1, (measureM - cumulativeM) / segLenM));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    cumulativeM += segLenM;
  }

  return routeCoords[routeCoords.length - 1];
}

function controlPointMoved(point: MapControlPoint) {
  return haversine(point.coord[1], point.coord[0], point.anchorCoord[1], point.anchorCoord[0]) >= CONTROL_POINT_MIN_MOVE_M;
}

function distancePointToRouteM(point: Coords, routeCoords: Coords[]) {
  const projection = projectPointToRoute(point, routeCoords);
  if (!projection) return null;
  return haversine(point[1], point[0], projection.snapped[1], projection.snapped[0]);
}

function expandControlPointToVias(point: MapControlPoint): Coords[] {
  const candidates: Coords[] = [point.guideBefore, point.coord, point.guideAfter];
  return candidates.filter((coord, index) => {
    if (index === 0) return true;
    return !coordsEqualApprox(coord, candidates[index - 1], 1e-5);
  });
}

function orderViasWithMapControls(routeCoords: Coords[], formVias: Coords[], mapControls: MapControlPoint[]): Coords[] {
  if (mapControls.length === 0) return formVias;
  const effectiveControls = mapControls.filter(controlPointMoved);
  if (effectiveControls.length === 0) return formVias;
  if (routeCoords.length < 2) return [...formVias, ...effectiveControls.flatMap(expandControlPointToVias)];

  const items = [
    ...formVias.map((coord, index) => ({ coord, kind: "form" as const, index })),
    ...effectiveControls.map((point, index) => ({ point, kind: "map" as const, index })),
  ].map((item) => {
    const projection =
      item.kind === "form"
        ? projectPointToRoute(item.coord, routeCoords)
        : { measureM: item.point.anchorMeasureM, snapped: item.point.anchorCoord };
    return {
      ...item,
      measureM:
        projection?.measureM ??
        (item.kind === "form" ? item.index * 10_000 : 1_000_000 + item.index * 10_000),
    };
  });

  items.sort((a, b) => {
    if (a.measureM !== b.measureM) return a.measureM - b.measureM;
    if (a.kind !== b.kind) return a.kind === "form" ? -1 : 1;
    return a.index - b.index;
  });

  return items.flatMap((item) =>
    item.kind === "form" ? [item.coord] : expandControlPointToVias(item.point)
  );
}

function insertControlPointByRoutePosition(
  currentPoints: MapControlPoint[],
  nextPoint: MapControlPoint,
  routeCoords: Coords[]
) {
  if (currentPoints.length === 0 || routeCoords.length < 2) return [...currentPoints, nextPoint];

  const nextMeasure = nextPoint.anchorMeasureM;
  let insertAt = currentPoints.length;

  for (let index = 0; index < currentPoints.length; index += 1) {
    const currentMeasure = currentPoints[index].anchorMeasureM ?? Number.POSITIVE_INFINITY;
    if (nextMeasure < currentMeasure) {
      insertAt = index;
      break;
    }
  }

  return [
    ...currentPoints.slice(0, insertAt),
    nextPoint,
    ...currentPoints.slice(insertAt),
  ];
}

// -------------------- Autocomplete --------------------
function AutocompleteInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onSelect: (s: Suggestion) => void;
  getMapInfo: () => {
    center?: { lat: number; lon: number };
    bounds?: { left: number; top: number; right: number; bottom: number };
  };
}) {
  const { value, onChange, placeholder, onSelect, getMapInfo } = props;
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
        abortRef.current?.abort();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!focused) {
      setOpen(false);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    if (value.trim().length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const aborter = new AbortController();
      abortRef.current = aborter;
      const myReqId = ++reqIdRef.current;

      try {
        setLoading(true);
        const info = getMapInfo();
        const u = new URL("/api/geocode", window.location.origin);
        u.searchParams.set("q", value.trim());
        u.searchParams.set("suggest", "1");
        u.searchParams.set("size", "10");
        if (info.center) {
          u.searchParams.set("focus_lat", String(info.center.lat));
          u.searchParams.set("focus_lon", String(info.center.lon));
        }
        if (info.bounds) {
          const { left, top, right, bottom } = info.bounds;
          u.searchParams.set("left", String(left));
          u.searchParams.set("top", String(top));
          u.searchParams.set("right", String(right));
          u.searchParams.set("bottom", String(bottom));
        }
        const r = await fetch(u.toString(), { headers: { Accept: "application/json" }, signal: aborter.signal });
        const j = await r.json();
        if (reqIdRef.current !== myReqId) return;

        let list: Suggestion[] = Array.isArray(j?.items)
          ? (j
              .items
              .map((row: any) => {
                const label = row?.label || formatSuggestion(row?.raw);
                if (!label) return null;
                return {
                  label,
                  coord: [Number(row.lon), Number(row.lat)] as Coords,
                  raw: row,
                };
              })
              .filter(Boolean) as Suggestion[])
          : [];

        const ctr = info.center;
        const b = info.bounds;
        const inBox = (s: Suggestion) =>
          b
            ? s.coord[0] >= b.left &&
              s.coord[0] <= b.right &&
              s.coord[1] >= b.bottom &&
              s.coord[1] <= b.top
            : false;

        list = list
          .map((s) => {
            const dist = ctr
              ? haversine(ctr.lat, ctr.lon, s.coord[1], s.coord[0])
              : Number.POSITIVE_INFINITY;
            const rank = typeof s.raw?.place_rank === "number" ? s.raw.place_rank : 0;
            const imp = typeof s.raw?.importance === "number" ? s.raw.importance : 0;
            return {
              s,
              key: [inBox(s) ? 0 : 1, Math.round(dist), -rank, -imp, s.label.toLowerCase()],
            };
          })
          .sort((a: any, b2: any) => {
            for (let i = 0; i < a.key.length; i++) {
              const av = a.key[i];
              const bv = b2.key[i];
              if (av === bv) continue;
              if (typeof av === "number" && typeof bv === "number") return av - bv;
              return String(av).localeCompare(String(bv), "de");
            }
            return 0;
          })
          .map((x: any) => x.s);

        setItems(list);
        setHi(0);
        setOpen(focused && list.length > 0);
      } catch (err) {
        if ((err as any)?.name !== "AbortError") {
          setItems([]);
          setOpen(false);
        }
      } finally {
        if (reqIdRef.current === myReqId) setLoading(false);
      }
    }, 220) as unknown as number;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, getMapInfo]);

  const selectIdx = (idx: number) => {
    const s = items[idx];
    if (!s) return;
    onSelect(s);
    setOpen(false);
    setFocused(false);
    abortRef.current?.abort();
  };

  return (
    <div ref={wrapRef} className="autocomplete">
      <input
        className="inp"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((p) => Math.min(items.length - 1, p + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((p) => Math.max(0, p - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            selectIdx(hi);
          } else if (e.key === "Escape") {
            setOpen(false);
            setFocused(false);
            abortRef.current?.abort();
          }
        }}
      />
      {open && (
        <div className="autocomplete-menu">
          {loading && <div className="autocomplete-state">Suche…</div>}
          {!loading &&
            items.map((it, i) => (
              <div
                key={i}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectIdx(i);
                }}
                className={`autocomplete-item ${i === hi ? "is-active" : ""}`}
              >
                {it.label}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// -------------------- Page --------------------
export default function Page() {
  const [startInput, setStartInput] = useState("6.9603, 50.9375");
  const [endInput, setEndInput] = useState("7.4653, 51.5136");
  const [startPick, setStartPick] = useState<Suggestion | null>(null);
  const [endPick, setEndPick] = useState<Suggestion | null>(null);
  const [viaInputs, setViaInputs] = useState<string[]>([]);
  const [viaPicks, setViaPicks] = useState<(Suggestion | null)[]>([]);

  const [width, setWidth] = useState(3);
  const [height, setHeight] = useState(4);
  const [weight, setWeight] = useState(40);
  const [axle, setAxle] = useState(10);
  const [heavyTransport, setHeavyTransport] = useState(false);

  // Telemetrie vom Planer
  const [planMeta, setPlanMeta] = useState<null | {
    // Restrictions-Telemetrie (aus data.roadworks / data.restrictions)
    restrictions_status?: string;
    restrictions_fetched?: number;
    restrictions_used?: number;
    restrictions_notes?: string | null;
    // Routing-Telemetrie (aus data.meta)
    iterations?: number;
    avoids_applied?: number;
    // Legacy-Felder (ältere Planner-Version, immer undefined – nur für Kompatibilität)
    after_merge?: number;
    cell_m?: number;
    grid_cells?: number;
    limit_hit?: boolean;
  }>(null);

  const [showRoadworks, setShowRoadworks] = useState(true);
  const [rwLoading, setRwLoading] = useState(true);
  const [rwCount, setRwCount] = useState(0);
  const [rwState, setRwState] = useState<{
    status: "OK" | "FAILED" | "UNKNOWN";
    error?: string | null;
    fetched?: number;
    used?: number;
  }>({ status: "UNKNOWN" });

  // >>> Blockade/Warn-Info aus /api/route/plan
  const [planBlocked, setPlanBlocked] = useState<null | {
    error?: string | null;
    warnings?: any[];
    meta?: any;
  }>(null);
  const [showAllWarnings, setShowAllWarnings] = useState(false);

  // >>> HERE routing notices (Restriktionsverletzungen laut HERE API)
  const [routingNotices, setRoutingNotices] = useState<{ title: string; code?: string; severity?: string }[]>([]);

  const [whenIsoLocal, setWhenIsoLocal] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  const mapRef = useRef<Map | null>(null);
  const mapLoadedRef = useRef(false);
  const rwAbortRef = useRef<AbortController | null>(null);
  const rwDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRwBboxRef = useRef<[number, number, number, number] | null>(null);
  const permitRouteAbortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlMarkersRef = useRef<maplibregl.Marker[]>([]);
  const skipNextFitRef = useRef(false);
  const [geojson, setGeojson] = useState<any | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [steps, setSteps] = useState<
    { instruction: string; distance_km: number; duration_s: number; street_names: string[] }[]
  >([]);
  const [streets, setStreets] = useState<string[]>([]);
  const [similarPermits, setSimilarPermits] = useState<any[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [selectedPermitId, setSelectedPermitId] = useState<number | null>(null);
  const [permitRouteLoading, setPermitRouteLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [startCoord, setStartCoord] = useState<Coords | null>(null);
  const [endCoord, setEndCoord] = useState<Coords | null>(null);
  const [viaCoords, setViaCoords] = useState<Coords[]>([]);
  const [mapControlPoints, setMapControlPoints] = useState<MapControlPoint[]>([]);
  const [routeEditMode, setRouteEditMode] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    document.documentElement.classList.toggle("dark", isDark);
    Promise.resolve().then(() => setDarkMode(isDark));
  }, []);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  // --- SAFE setData helper (verhindert setData-crash wenn Source noch nicht da ist) ---
  const safeSetGeoJSONSource = (map: Map, sourceId: string, data: any) => {
    if (!mapLoadedRef.current || !map.isStyleLoaded()) return false;
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src || typeof (src as any).setData !== "function") return false;
    try {
      (src as any).setData(data);
      return true;
    } catch (error) {
      console.error(`[MAP] setData failed for source "${sourceId}"`, error);
      return false;
    }
  };

  const emptyFC = { type: "FeatureCollection" as const, features: [] as any[] };

  // Robust: akzeptiere auch Tippfehler "geojosn" aus Backend
  const pickGeojson = (data: any) => data?.geojson ?? data?.geojosn ?? data?.geoJson ?? null;
  const currentActiveRoute = () => {
    const features: any[] = Array.isArray(geojson?.features) ? geojson.features : [];
    return features[activeIdx] ?? features[0] ?? null;
  };
  const currentRouteCoords = () => extractRouteLineCoords(currentActiveRoute());
  const currentRouteDistanceKm = () => {
    const active = currentActiveRoute();
    return Number(active?.properties?.summary?.distance_km ?? 0);
  };
  const validateAdjustedRoute = (gj: any, previousDistanceKm: number, mapControls: MapControlPoint[]) => {
    const effectiveControls = mapControls.filter(controlPointMoved);
    if (effectiveControls.length === 0) {
      return { ok: true as const };
    }

    const features: any[] = Array.isArray(gj?.features) ? gj.features : [];
    const coords = extractRouteLineCoords(features[0]);
    if (coords.length < 2) {
      return { ok: false as const, reason: "Die angepasste Route konnte nicht sauber berechnet werden." };
    }

    for (const point of effectiveControls) {
      const distanceToRouteM = distancePointToRouteM(point.coord, coords);
      if (distanceToRouteM == null || distanceToRouteM > CONTROL_POINT_ROUTE_PROXIMITY_M) {
        return {
          ok: false as const,
          reason:
            "Die gezogene Anpassung führt hier zu keinem sinnvollen Verlauf. Ziehe den Punkt näher an die gewünschte Straße.",
        };
      }
    }

    const newDistanceKm = Number(features[0]?.properties?.summary?.distance_km ?? 0);
    if (previousDistanceKm > 0 && Number.isFinite(newDistanceKm)) {
      const detourBudgetKm = effectiveControls.reduce((sum, point) => {
        const dragKm = haversine(
          point.coord[1],
          point.coord[0],
          point.anchorCoord[1],
          point.anchorCoord[0]
        ) / 1000;
        return sum + Math.max(2.5, dragKm * 4.25);
      }, 0);
      const absoluteLimitKm = previousDistanceKm + detourBudgetKm + 8;
      if (newDistanceKm > Math.max(previousDistanceKm * CONTROL_POINT_DISTANCE_RATIO_LIMIT, absoluteLimitKm)) {
        return {
          ok: false as const,
          reason:
            "Diese Ziehbewegung erzeugt einen unplausiblen Umweg. Bitte den Griffpunkt näher an die gewünschte Alternativstrecke setzen.",
        };
      }
    }

    return { ok: true as const };
  };

  const updateControlPointLabel = (id: string, coord: Coords, label: string | null) => {
    setMapControlPoints((current) =>
      current.map((point) =>
        point.id === id && coordsEqualApprox(point.coord, coord, 1e-5)
          ? { ...point, label: label?.trim() || formatCoordLabel(coord) }
          : point
      )
    );
  };

  const hydrateControlPointLabel = async (id: string, coord: Coords) => {
    try {
      const url = new URL("/api/geocode", window.location.origin);
      url.searchParams.set("lon", String(coord[0]));
      url.searchParams.set("lat", String(coord[1]));
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => null);
      const label = typeof data?.label === "string" ? data.label : null;
      updateControlPointLabel(id, coord, label);
    } catch {
      updateControlPointLabel(id, coord, formatCoordLabel(coord));
    }
  };

  const resetPlannerFeedback = () => {
    setPlanBlocked(null);
    setShowAllWarnings(false);
    setRoutingNotices([]);
    setRouteError(null);
  };

  const applyPlannerResponse = (data: any, options?: { preserveView?: boolean }) => {
    const rw = data?.roadworks || data?.restrictions || {};
    setPlanMeta({
      restrictions_status: rw.status,
      restrictions_fetched: typeof rw.fetched === "number" ? rw.fetched : undefined,
      restrictions_used: typeof rw.used === "number" ? rw.used : undefined,
      restrictions_notes: rw.notes ?? null,
      iterations: data?.meta?.iterations,
      avoids_applied: data?.meta?.avoids_applied,
    });

    const gj = pickGeojson(data);
    if (!gj) {
      setGeojson(null);
      setActiveIdx(0);
      setSteps([]);
      setStreets([]);
      setRouteEditMode(false);
      setPlanBlocked({
        error: "Backend hat kein GeoJSON geliefert (erwartet: geojson/geojosn).",
        warnings: Array.isArray(data?.blocking_warnings) ? data.blocking_warnings : [],
        meta: data?.meta ?? null,
      });
      return false;
    }

    if (options?.preserveView) {
      skipNextFitRef.current = true;
    }

    if (data?.meta?.status === "BLOCKED") {
      setGeojson(gj);
      setPlanBlocked({
        error: data?.meta?.error ?? "Route ist blockiert.",
        warnings: Array.isArray(data?.blocking_warnings) ? data.blocking_warnings : [],
        meta: data?.meta ?? null,
      });
    } else {
      setGeojson(gj);

      if (data?.meta?.status === "WARN") {
        setPlanBlocked({
          error: data?.meta?.error ?? "Route hat blockierende Stellen (Best-Effort).",
          warnings: Array.isArray(data?.blocking_warnings) ? data.blocking_warnings : [],
          meta: data?.meta ?? null,
        });
      } else {
        setPlanBlocked(null);
      }

      const hereNotices = Array.isArray(data?.meta?.notices) ? data.meta.notices : [];
      setRoutingNotices(hereNotices);
    }

    setActiveIdx(0);
    mapRef.current?.resize();
    refreshRoadworks();
    return true;
  };

  const buildRequestVias = (resolvedInputVias: Coords[], mapControls: MapControlPoint[]) => {
    if (mapControls.length === 0) return resolvedInputVias;
    if (resolvedInputVias.length === 0) return mapControls.flatMap(expandControlPointToVias);
    return orderViasWithMapControls(currentRouteCoords(), resolvedInputVias, mapControls);
  };

  const requestPlan = async (
    start: Coords,
    end: Coords,
    resolvedInputVias: Coords[],
    mapControls: MapControlPoint[],
    options?: { preserveView?: boolean }
  ) => {
    resetPlannerFeedback();
    const previousDistanceKm = currentRouteDistanceKm();

    const body = buildPlanBody(start, end, DEFAULT_PLAN_PRESET, {
      ts: toUtcIso(whenIsoLocal),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
      vehicle: { width_m: width, height_m: height, weight_t: weight, axleload_t: axle },
      directions_language: "de-DE",
      require_clean: true,
      heavy_transport: heavyTransport,
      vias: buildRequestVias(resolvedInputVias, mapControls),
    });
    if (mapControls.length > 0) {
      (body as any).via_mode = "pass_through";
    }

    const res = await fetch("/api/route/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setRouteError("Planner-Fehler: " + JSON.stringify(data?.error || data));
      setPlanMeta(null);
      return false;
    }

    if (mapControls.length > 0) {
      const gj = pickGeojson(data);
      const validation = validateAdjustedRoute(gj, previousDistanceKm, mapControls);
      if (!validation.ok) {
        setRouteError(validation.reason);
        return false;
      }
    }

    return applyPlannerResponse(data, options);
  };

  async function loadBridgeRestrictions(map: Map) {
    try {
      const res = await fetch("/api/restrictions/bridges", { cache: "no-store" });
      const data = await res.json().catch(() => emptyFC);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const features = Array.isArray(data?.features) ? data.features : [];
      const heavyCount = features.filter((feature: any) => feature?.properties?.no_heavy_transport === true).length;
      const numericOnlyCount = features.length - heavyCount;
      console.log("[MAP] bridge restrictions loaded", {
        total: features.length,
        heavy_transport_bans: heavyCount,
        numeric_only: numericOnlyCount,
        sample: features.slice(0, 5).map((feature: any) => ({
          external_id: feature?.properties?.external_id ?? null,
          title: feature?.properties?.title ?? null,
          no_heavy_transport: feature?.properties?.no_heavy_transport ?? null,
        })),
      });
      safeSetGeoJSONSource(map, "bridge-restrictions", {
        type: "FeatureCollection",
        features,
      });
    } catch (e) {
      console.error("bridge restrictions fetch failed", e);
      safeSetGeoJSONSource(map, "bridge-restrictions", emptyFC);
    }
  }

  // -------------------- Map init --------------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const containerEl = containerRef.current;

    console.log("[MAP INIT] creating map", new Date().toISOString());
    const map = new maplibregl.Map({
      container: containerEl,
      style: {
        version: 8,
        glyphs: "/api/map/glyphs/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "/api/map/tiles/{z}/{x}/{y}",
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
          "route-active": { type: "geojson", data: emptyFC },
          "route-alts": { type: "geojson", data: emptyFC },
          "permit-route": { type: "geojson", data: emptyFC },
          points: { type: "geojson", data: emptyFC },
          "bridge-restrictions": { type: "geojson", data: emptyFC },

          // Linien-Quelle
          "roadworks-lines": { type: "geojson", data: emptyFC },

          // Punkt-Quelle für einzelne Baustellenpunkte
          "roadworks-icons": { type: "geojson", data: emptyFC },
        },
        layers: [
          { id: "osm", type: "raster", source: "osm" },

          // Referenz-Route aus Genehmigung (unter aktiver Route)
          {
            id: "permit-route-casing",
            type: "line",
            source: "permit-route",
            paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.85 },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "permit-route-line",
            type: "line",
            source: "permit-route",
            paint: { "line-color": "#F59E0B", "line-width": 5, "line-dasharray": [6, 3] },
            layout: { "line-join": "round", "line-cap": "round" },
          },

          // Routen-Layer (DICK mit Outline)
          {
            id: "route-active-casing",
            type: "line",
            source: "route-active",
            paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "route-active-line",
            type: "line",
            source: "route-active",
            paint: { "line-color": "#1E90FF", "line-width": 6 },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "route-alts-line",
            type: "line",
            source: "route-alts",
            paint: { "line-color": "#666", "line-width": 5, "line-opacity": 0.9, "line-dasharray": [2, 2] },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "points-circle",
            type: "circle",
            source: "points",
            paint: {
              "circle-radius": 6,
              "circle-color": ["match", ["get", "role"], "start", "#00A651", "via", "#E67E22", "#D84A4A"],
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            },
          },
          // Roadworks-Linien
          {
            id: "roadworks-line-casing",
            type: "line",
            source: "roadworks-lines",
            paint: {
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 5, 10, 7, 15, 10],
              "line-opacity": 0.92,
            },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "roadworks-line",
            type: "line",
            source: "roadworks-lines",
            paint: {
              "line-color": "#E67E22",
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 4.5, 15, 7],
              "line-opacity": 0.95,
            },
            layout: { "line-join": "round", "line-cap": "round" },
          },

          {
            id: "roadworks-icon-fallback",
            type: "circle",
            source: "roadworks-icons",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.75, 8, 5.25, 12, 7.25, 17, 10.5],
              "circle-color": "#E67E22",
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 1.25, 12, 1.8, 17, 2.2],
              "circle-stroke-color": "#FFFFFF",
              "circle-opacity": 0.97,
            },
          },
          {
            id: "bridge-restrictions-circle",
            type: "circle",
            source: "bridge-restrictions",
            layout: {
              "circle-sort-key": ["case", ["==", ["get", "no_heavy_transport"], true], 2, 1],
            },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4.5, 8, 6, 12, 7.5, 15, 8.5],
              "circle-color": [
                "case",
                ["==", ["get", "no_heavy_transport"], true],
                "#DC2626",
                "#EAB308",
              ],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "no_heavy_transport"], true],
                "#991B1B",
                "#A16207",
              ],
              "circle-stroke-width": 1.35,
              "circle-opacity": 0.92,
            },
          },
        ],
      },
      center: [7.1, 51.1],
      zoom: 8.2,
      maxZoom: 19,
    });

    mapRef.current = map;
    (window as any).maplibreMap = map;
    const resizeMap = () => {
      try {
        map.resize();
      } catch {}
    };
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resizeMap())
        : null;
    resizeObserver?.observe(containerEl);
    const resizeTimeoutA = window.setTimeout(resizeMap, 0);
    const resizeTimeoutB = window.setTimeout(resizeMap, 250);
    const resizeTimeoutC = window.setTimeout(resizeMap, 1000);
    document.fonts?.ready?.then(() => resizeMap()).catch(() => {});

    map.on("load", async () => {
      mapLoadedRef.current = true;
      setMapReady(true);
      resizeMap();

      await loadBridgeRestrictions(map);
      refreshRoadworks();
    });

    map.on("mouseenter", "route-alts-line", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "route-alts-line", () => (map.getCanvas().style.cursor = ""));
    map.on("click", "route-alts-line", (e: maplibregl.MapLayerMouseEvent) => {
      const idx = e.features?.[0]?.properties?.idx;
      if (typeof idx === "number") setActiveIdx(idx);
    });

    // Popups für Straßenarbeiten
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: "planner-popup",
      maxWidth: "380px",
    });

    const openRoadworkPopup = (f: maplibregl.MapGeoJSONFeature) => {
      const p: any = f.properties || {};

      const fmtNum = (v: any, unit: string, digits = 2) => {
        if (v === null || v === undefined || v === "") return "unbekannt";
        const n =
          typeof v === "number"
            ? v
            : typeof v === "string"
              ? Number(v.replace(",", "."))
              : NaN;
        return Number.isFinite(n) ? `${n.toFixed(digits)} ${unit}` : "unbekannt";
      };

      const fmtBool = (v: any) => (v === true ? "JA" : v === false ? "NEIN" : "unbekannt");
      const fmtDays = (v: any) => (Array.isArray(v) ? v.join(",") : "-");
      const popupText = `${p.title ?? ""} ${p.description ?? ""} ${p.reason ?? ""} ${p.subtitle ?? ""}`;
      const parseTextLimit = (patterns: RegExp[]) => {
        for (const pattern of patterns) {
          const match = popupText.match(pattern);
          if (!match?.[1]) continue;
          const value = Number(String(match[1]).replace(",", "."));
          if (Number.isFinite(value)) return value;
        }
        return null;
      };
      const widthValue =
        p.max_width_m ??
        p.max_width ??
        parseTextLimit([
          /(?:Breite|Durchfahrtsbreite|Fahrstreifenbreite|width)[^0-9]*([0-9]+(?:[.,][0-9]+)?)\s*m/i,
          /([0-9]+(?:[.,][0-9]+)?)\s*m\s*(?:Breite|Durchfahrtsbreite|Fahrstreifenbreite|width)/i,
        ]);
      const heightValue =
        p.max_height_m ??
        p.max_height ??
        parseTextLimit([/(?:Höhe|Hoehe|height|Durchfahrtshöhe)[^0-9]*([0-9]+(?:[.,][0-9]+)?)\s*m/i]);
      const weightValue =
        p.max_weight_t ??
        p.max_weight ??
        parseTextLimit([/(?:Gewicht|weight|Gesamtgewicht|Last)[^0-9]*([0-9]+(?:[.,][0-9]+)?)\s*t/i]);
      const axleValue =
        p.max_axle_t ??
        p.max_axleload_t ??
        parseTextLimit([/(?:Achslast|axle)[^0-9]*([0-9]+(?:[.,][0-9]+)?)\s*t/i]);
      const widthText = fmtNum(widthValue, "m", 2);
      const heightText = fmtNum(heightValue, "m", 2);
      const weightText = fmtNum(weightValue, "t", 1);
      const axleText = fmtNum(axleValue, "t", 1);
      const displayLimit = (value: string) => value === "unbekannt" ? "nicht gemeldet" : value;
      const restrictionsHtml = `
        <div class="map-popup__row"><span>Max. Breite / Durchfahrtsbreite</span><strong>${escapeHtml(displayLimit(widthText))}</strong></div>
        <div class="map-popup__row"><span>Max. Höhe / Durchfahrtshöhe</span><strong>${escapeHtml(displayLimit(heightText))}</strong></div>
        <div class="map-popup__row"><span>Max. Gewicht / Gesamtgewicht</span><strong>${escapeHtml(displayLimit(weightText))}</strong></div>
        <div class="map-popup__row"><span>Max. Achslast / Last pro Achse</span><strong>${escapeHtml(displayLimit(axleText))}</strong></div>
      `;

      const html = `
        <div class="map-popup">
          <div class="map-popup__eyebrow">Baustelle</div>
          <div class="map-popup__title">${escapeHtml(p.title ?? "Baustelle")}</div>
          <div class="map-popup__badge map-popup__badge--roadwork">Aktive Verkehrsmaßnahme</div>
          <div class="map-popup__section">
            <div class="map-popup__row"><span>ID</span><strong>${escapeHtml(p.external_id ?? "-")}</strong></div>
            <div class="map-popup__row"><span>Gültig</span><strong>${escapeHtml(p.valid_from ?? "-")} – ${escapeHtml(p.valid_to ?? "-")}</strong></div>
            <div class="map-popup__row"><span>Fenster</span><strong>${escapeHtml(p.start_time ?? "-")}–${escapeHtml(p.end_time ?? "-")} · ${escapeHtml(fmtDays(p.days))}</strong></div>
            <div class="map-popup__row"><span>Länge</span><strong>${
              typeof p.length_m === "number" ? `${(p.length_m / 1000).toFixed(2)} km` : "-"
            }</strong></div>
            <div class="map-popup__row"><span>Quelle</span><strong>${escapeHtml(p.source ?? "–")}</strong></div>
          </div>
          <div class="map-popup__section">
            <div class="map-popup__section-title">Beschränkungen</div>
            ${restrictionsHtml}
            <div class="map-popup__row"><span>Hard-Block</span><strong>${escapeHtml(fmtBool(p._hard_block))}</strong></div>
          </div>
        </div>
      `;

      const g: any = f.geometry;
      let center: [number, number] | undefined;

      if (g?.type === "Point") center = g.coordinates as [number, number];
      if (!center && g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length) {
        center = g.coordinates[Math.floor(g.coordinates.length / 2)] as [number, number];
      }

      if (center) popup.setLngLat(center).setHTML(html).addTo(map);
    };

    map.on("click", "roadworks-line", (e) => {
      const f = e.features?.[0];
      if (f) openRoadworkPopup(f);
    });
    map.on("click", "roadworks-icon-fallback", (e) => {
      const f = e.features?.[0];
      if (f) openRoadworkPopup(f);
    });
    map.on("mouseenter", "roadworks-icon-fallback", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "roadworks-icon-fallback", () => (map.getCanvas().style.cursor = ""));

    map.on("mouseenter", "bridge-restrictions-circle", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "bridge-restrictions-circle", () => (map.getCanvas().style.cursor = ""));
    map.on("click", "bridge-restrictions-circle", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p: any = f.properties || {};
      const coords = (f.geometry as any)?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return;

      const fmtVal = (value: any, unit: string) =>
        typeof value === "number" ? `${value} ${unit}` : "unbekannt";

      const limitRows = [
        typeof p.max_weight_t === "number" ? `<div class="map-popup__row"><span>Max. Gewicht</span><strong>${escapeHtml(fmtVal(p.max_weight_t, "t"))}</strong></div>` : "",
        typeof p.max_axle_t === "number" ? `<div class="map-popup__row"><span>Max. Achslast</span><strong>${escapeHtml(fmtVal(p.max_axle_t, "t"))}</strong></div>` : "",
        typeof p.max_width_m === "number" ? `<div class="map-popup__row"><span>Max. Breite</span><strong>${escapeHtml(fmtVal(p.max_width_m, "m"))}</strong></div>` : "",
        typeof p.max_height_m === "number" ? `<div class="map-popup__row"><span>Max. Höhe</span><strong>${escapeHtml(fmtVal(p.max_height_m, "m"))}</strong></div>` : "",
      ]
        .filter(Boolean)
        .join("");

      const heavyTransportBadge = p.no_heavy_transport === true
        ? `<div class="map-popup__badge map-popup__badge--danger">⛔ Schwertransportverbot</div>`
        : `<div class="map-popup__badge map-popup__badge--warn">Schwertransport grundsätzlich erlaubt</div>`;

      const html = `
        <div class="map-popup">
          <div class="map-popup__eyebrow">Brückenrestriktion</div>
          <div class="map-popup__title">${escapeHtml(p.title ?? "Brücke")}</div>
          ${heavyTransportBadge}
          <div class="map-popup__section">
            ${
              limitRows ||
              `<div class="map-popup__empty">Keine numerischen Grenzwerte hinterlegt</div>`
            }
          </div>
          <div class="map-popup__section">
            ${
              p.description
                ? `<div class="map-popup__copy">${escapeHtml(p.description)}</div>`
                : `<div class="map-popup__copy">Keine Zusatzbeschreibung vorhanden.</div>`
            }
            <div class="map-popup__row"><span>Quelle</span><strong>${escapeHtml(p.source ?? "unbekannt")}</strong></div>
          </div>
        </div>
      `;

      popup.setLngLat([Number(coords[0]), Number(coords[1])]).setHTML(html).addTo(map);
    });

    const onResize = () => resizeMap();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      window.clearTimeout(resizeTimeoutA);
      window.clearTimeout(resizeTimeoutB);
      window.clearTimeout(resizeTimeoutC);
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !map.isStyleLoaded() || !map.getLayer("route-active-line")) return;

    const onEnter = () => {
      if (routeEditMode && !loading) {
        map.getCanvas().style.cursor = "crosshair";
      }
    };

    const onLeave = () => {
      if (map.getCanvas().style.cursor === "crosshair") {
        map.getCanvas().style.cursor = "";
      }
    };

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!routeEditMode || loading || !startCoord || !endCoord || !geojson) return;
      if (mapControlPoints.length >= MAX_ROUTE_CONTROL_POINTS) {
        alert(`Es sind maximal ${MAX_ROUTE_CONTROL_POINTS} Kontrollpunkte gleichzeitig sinnvoll.`);
        return;
      }

      const routeCoords = currentRouteCoords();
      const projection = projectPointToRoute([e.lngLat.lng, e.lngLat.lat], routeCoords);
      if (!projection) return;

      const nearbyCoords = [startCoord, endCoord, ...viaCoords, ...mapControlPoints.map((point) => point.anchorCoord)];
      const tooClose = nearbyCoords.some(
        (coord) => haversine(projection.snapped[1], projection.snapped[0], coord[1], coord[0]) < MIN_CONTROL_POINT_DISTANCE_M
      );
      if (tooClose) return;

      const guideBefore =
        routeCoordAtMeasure(routeCoords, Math.max(0, projection.measureM - CONTROL_POINT_GUIDE_WINDOW_M)) ??
        routeCoords[0];
      const guideAfter =
        routeCoordAtMeasure(routeCoords, projection.measureM + CONTROL_POINT_GUIDE_WINDOW_M) ??
        routeCoords[routeCoords.length - 1];

      const nextPoint: MapControlPoint = {
        id: makeControlPointId(),
        coord: projection.snapped,
        label: "Auf Route platziert – jetzt ziehen",
        anchorMeasureM: projection.measureM,
        anchorCoord: projection.snapped,
        guideBefore,
        guideAfter,
      };
      const nextControls = insertControlPointByRoutePosition(mapControlPoints, nextPoint, routeCoords);
      setMapControlPoints(nextControls);
    };

    map.on("mouseenter", "route-active-line", onEnter);
    map.on("mouseleave", "route-active-line", onLeave);
    map.on("click", "route-active-line", onClick);

    return () => {
      map.off("mouseenter", "route-active-line", onEnter);
      map.off("mouseleave", "route-active-line", onLeave);
      map.off("click", "route-active-line", onClick);
      if (map.getCanvas().style.cursor === "crosshair") {
        map.getCanvas().style.cursor = "";
      }
    };
  }, [routeEditMode, loading, mapControlPoints, startCoord, endCoord, viaCoords, geojson, activeIdx, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    controlMarkersRef.current.forEach((marker) => marker.remove());
    controlMarkersRef.current = [];

    if (mapControlPoints.length === 0) return;

    mapControlPoints.forEach((point, index) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `Kontrollpunkt ${index + 1}`);
      el.title = routeEditMode
        ? `${point.label ?? `Kontrollpunkt ${index + 1}`} verschieben`
        : point.label ?? `Kontrollpunkt ${index + 1}`;
      el.style.width = "24px";
      el.style.height = "24px";
      el.style.borderRadius = "999px";
      el.style.border = "3px solid #ffffff";
      el.style.background = "#F97316";
      el.style.color = "#ffffff";
      el.style.fontSize = "12px";
      el.style.fontWeight = "800";
      el.style.boxShadow = "0 3px 10px rgba(15, 23, 42, 0.26)";
      el.style.cursor = routeEditMode ? "grab" : "default";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.padding = "0";
      el.style.lineHeight = "1";
      el.textContent = String(index + 1);

      const marker = new maplibregl.Marker({
        element: el,
        draggable: routeEditMode,
        anchor: "center",
      })
        .setLngLat(point.coord)
        .addTo(map);

      if (routeEditMode) {
        marker.on("dragstart", () => {
          el.style.cursor = "grabbing";
          el.style.transform = "scale(1.08)";
        });
        marker.on("dragend", () => {
          el.style.cursor = "grab";
          el.style.transform = "";
          const lngLat = marker.getLngLat();
          const nextCoord: Coords = [Number(lngLat.lng), Number(lngLat.lat)];
          const previousControls = mapControlPoints;
          const nextControls = mapControlPoints.map((existing) =>
            existing.id === point.id ? { ...existing, coord: nextCoord, label: null } : existing
          );
          setMapControlPoints(nextControls);
          void hydrateControlPointLabel(point.id, nextCoord);
          void rerouteWithMapControls(nextControls).then((ok) => {
            if (!ok) {
              setMapControlPoints(previousControls);
              marker.setLngLat(point.coord);
            }
          });
        });
      }

      controlMarkersRef.current.push(marker);
    });

    return () => {
      controlMarkersRef.current.forEach((marker) => marker.remove());
      controlMarkersRef.current = [];
    };
  }, [mapControlPoints, routeEditMode, geojson, startCoord, endCoord, viaCoords, mapReady]);

  // -------------------- Punkte immer zeichnen (auch ohne Route) --------------------
  useEffect(() => {
    const map = mapRef.current;
    const pts: any[] = [];
    if (startCoord)
      pts.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: startCoord },
        properties: { role: "start" },
      });
    for (const coord of viaCoords) {
      pts.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: coord },
        properties: { role: "via" },
      });
    }
    if (endCoord)
      pts.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: endCoord },
        properties: { role: "end" },
      });

    if (!map || !mapReady || !mapLoadedRef.current || !map.isStyleLoaded()) return;

    safeSetGeoJSONSource(map, "points", { type: "FeatureCollection", features: pts });
  }, [startCoord, viaCoords, endCoord, mapReady]);

  // -------------------- Route zeichnen --------------------
  useEffect(() => {
    if (!geojson) {
      const map = mapRef.current;
      if (map && mapReady && mapLoadedRef.current && map.isStyleLoaded()) {
        safeSetGeoJSONSource(map, "route-active", emptyFC);
        safeSetGeoJSONSource(map, "route-alts", emptyFC);
        safeSetGeoJSONSource(map, "permit-route", emptyFC);
      }
      setSteps([]);
      setStreets([]);
      setSelectedPermitId(null);
      return;
    }

    const features: any[] = Array.isArray(geojson?.features) ? geojson.features : [];
    const active = features[activeIdx] ?? features[0];

    if (!active) {
      const map = mapRef.current;
      if (map && mapReady && mapLoadedRef.current && map.isStyleLoaded()) {
        safeSetGeoJSONSource(map, "route-active", emptyFC);
        safeSetGeoJSONSource(map, "route-alts", emptyFC);
        safeSetGeoJSONSource(map, "permit-route", emptyFC);
      }
      setSteps([]);
      setStreets([]);
      setSelectedPermitId(null);
      return;
    }

    const maneuvers = Array.isArray(active?.properties?.maneuvers) ? active.properties.maneuvers : [];
    setSteps(maneuvers);
    setStreets(buildStreetSequence(active));

    const map = mapRef.current;
    if (!map || !mapReady || !mapLoadedRef.current || !map.isStyleLoaded()) return;

    const activeRenderable = simplifyRouteFeatureForMap(active);
    const alts = features
      .map((f: any, i: number) => (i === activeIdx ? null : simplifyRouteFeatureForMap(f, { idx: i })))
      .filter(Boolean);

    safeSetGeoJSONSource(map, "route-active", {
      type: "FeatureCollection",
      features: activeRenderable ? [activeRenderable] : [],
    });
    safeSetGeoJSONSource(map, "route-alts", {
      type: "FeatureCollection",
      features: alts,
    });

    const bbox: [number, number, number, number] | undefined = active?.properties?.bbox;
    if (bbox) {
      if (skipNextFitRef.current) {
        skipNextFitRef.current = false;
      } else {
        map.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: { top: 40, right: 40, bottom: 40, left: 360 } }
        );
      }
      return;
    }

    if (activeRenderable?.geometry?.coordinates?.length >= 2 && !skipNextFitRef.current) {
      const bounds = new maplibregl.LngLatBounds(
        activeRenderable.geometry.coordinates[0] as [number, number],
        activeRenderable.geometry.coordinates[0] as [number, number]
      );
      for (const coord of activeRenderable.geometry.coordinates.slice(1)) {
        bounds.extend(coord as [number, number]);
      }
      map.fitBounds(bounds, { padding: { top: 40, right: 40, bottom: 40, left: 360 } });
      return;
    }

    if (skipNextFitRef.current) {
      skipNextFitRef.current = false;
    }
  }, [geojson, activeIdx, mapReady]);

  // -------------------- Ähnliche Genehmigungen --------------------
  useEffect(() => {
    if (!geojson || streets.length === 0) {
      setSimilarPermits([]);
      return;
    }

    const roadPattern = /^[AaBbKkLl]\s*\d+$/;
    const normalizeRoad = (r: string) => r.replace(/^([A-Za-z])\s+(\d)/, "$1$2").toUpperCase();
    const roads = [...new Set(
      streets
        .filter((s) => roadPattern.test(s.trim()))
        .map(normalizeRoad)
    )];

    const extractCity = (input: string): string => {
      const parts = input.split(",");
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i].trim().replace(/^\d{4,5}\s*/, "");
        if (part.length > 1) return part;
      }
      return input.trim();
    };

    const body = {
      start_city: startInput ? extractCity(startInput) : null,
      destination_city: endInput ? extractCity(endInput) : null,
      roads,
      width_m: width,
      height_m: height,
      weight_t: weight,
    };

    setSimilarLoading(true);
    fetch("/api/permits/find-similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => setSimilarPermits(Array.isArray(data?.matches) ? data.matches : []))
      .catch(() => setSimilarPermits([]))
      .finally(() => setSimilarLoading(false));
  }, [streets, geojson]);

  // -------------------- Roadworks fetch + draw --------------------
  function getLiveRoadworksMap(expectedMap?: Map | null) {
    const map = mapRef.current;
    if (!map || (expectedMap && map !== expectedMap) || !mapLoadedRef.current || !map.isStyleLoaded()) {
      return null;
    }
    return map;
  }

  function clearRoadworkSources(map: Map) {
    const empty = { type: "FeatureCollection", features: [] as any[] };
    const lineSrc = map.getSource("roadworks-lines") as maplibregl.GeoJSONSource | undefined;
    if (lineSrc) lineSrc.setData(empty as any);
    const iconSrc = map.getSource("roadworks-icons") as maplibregl.GeoJSONSource | undefined;
    if (iconSrc) iconSrc.setData(empty as any);
  }

  async function refreshRoadworks() {
    const map = getLiveRoadworksMap();
    if (!map) return;

    // Cancel any in-flight request so only the latest call completes.
    rwAbortRef.current?.abort();
    const ctrl = new AbortController();
    rwAbortRef.current = ctrl;

    if (!showRoadworks) {
      clearRoadworkSources(map);
      setRwCount(0);
      return;
    }

    const b = map.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];

    // BBox-Cache: nur neu laden wenn die Karte weit genug bewegt wurde (~1km bei mittlerem Zoom)
    const prev = lastRwBboxRef.current;
    if (prev) {
      const moved =
        Math.abs(prev[0] - bbox[0]) > 0.01 ||
        Math.abs(prev[1] - bbox[1]) > 0.01 ||
        Math.abs(prev[2] - bbox[2]) > 0.01 ||
        Math.abs(prev[3] - bbox[3]) > 0.01;
      if (!moved) return;
    }
    lastRwBboxRef.current = bbox;

    const local = new Date(whenIsoLocal);
    const ts = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";

    setRwLoading(true);
    try {
      const res = await fetch("/api/roadworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ts, tz, bbox }),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const data = await res.json();
      if (ctrl.signal.aborted) return;
      if (!res.ok) throw new Error(data?.error || "HTTP " + res.status);
      const meta = data?.meta ?? {};
      const liveMap = getLiveRoadworksMap(map);
      if (!liveMap || ctrl.signal.aborted) return;

      const fc = data as { type: string; features: any[]; meta: any };
      const allFeatures = Array.isArray(fc.features) ? fc.features : [];
      const lineFeatures = allFeatures.filter((f: any) => {
        const g = f?.geometry;
        return g?.type === "LineString" || g?.type === "MultiLineString";
      });
      const lineIds = new Set(
        lineFeatures
          .map((f: any) => String(f?.properties?.external_id ?? f?.properties?.id ?? ""))
          .filter(Boolean)
      );
      const pointFeatures = allFeatures.filter((f: any) => {
        const g = f?.geometry;
        const p = f?.properties || {};
        const id = String(p.external_id ?? p.id ?? "");
        if (id && lineIds.has(id)) return false;
        return (
          (typeof p._icon_lon === "number" && typeof p._icon_lat === "number") ||
          (g?.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2)
        );
      });

      const lineSrc = liveMap.getSource("roadworks-lines") as maplibregl.GeoJSONSource | undefined;
      if (lineSrc) {
        lineSrc.setData({ type: "FeatureCollection", features: lineFeatures } as any);
      }

      const pointFeats = pointFeatures
        .map((f: any) => {
          const p = f.properties || {};
          if (typeof p._icon_lon === "number" && typeof p._icon_lat === "number") {
            return { type: "Feature", geometry: { type: "Point", coordinates: [p._icon_lon, p._icon_lat] }, properties: p };
          }
          const g = f.geometry;
          if (g?.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
            return { type: "Feature", geometry: { type: "Point", coordinates: g.coordinates }, properties: p };
          }
          return null;
        })
        .filter(Boolean) as any[];

      const iconSrc = liveMap.getSource("roadworks-icons") as maplibregl.GeoJSONSource | undefined;
      if (iconSrc) iconSrc.setData({ type: "FeatureCollection", features: pointFeats } as any);

      setRwCount(fc?.features?.length ?? 0);
      setRwState({
        status: meta?.status === "OK" ? "OK" : "FAILED",
        error: meta?.error ?? null,
        fetched: typeof meta?.fetched === "number" ? meta.fetched : undefined,
        used: typeof meta?.used === "number" ? meta.used : undefined,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return; // Superseded by a newer call — ignore silently.
      console.error("roadworks fetch failed", e);
      setRwCount(0);
      setRwState({
        status: "FAILED",
        error: String(e?.message ?? e ?? "Baustellendaten konnten nicht geladen werden."),
      });

      const liveMap = getLiveRoadworksMap(map);
      if (liveMap) clearRoadworkSources(liveMap);
    } finally {
      if (!ctrl.signal.aborted) setRwLoading(false);
    }
  }

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const handler = () => {
      if (rwDebounceRef.current) clearTimeout(rwDebounceRef.current);
      rwDebounceRef.current = setTimeout(() => refreshRoadworks(), 300);
    };
    m.on("moveend", handler);
    // BBox-Cache invalidieren wenn Zeit oder Sichtbarkeit sich ändert
    lastRwBboxRef.current = null;
    const t = setTimeout(() => refreshRoadworks(), 600);
    return () => {
      m.off("moveend", handler);
      clearTimeout(t);
      if (rwDebounceRef.current) clearTimeout(rwDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoadworks, whenIsoLocal]);

  // -------------------- Routing --------------------
  function toUtcIso(isoLocal: string) {
    const d = new Date(isoLocal);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  }

  async function rerouteWithMapControls(nextControls: MapControlPoint[]) {
    if (!startCoord || !endCoord) return;

    setLoading(true);
    document.body.style.cursor = "progress";
    try {
      return await requestPlan(startCoord, endCoord, viaCoords, nextControls, { preserveView: true });
    } catch (e: any) {
      alert(String(e));
      return false;
    } finally {
      setLoading(false);
      document.body.style.cursor = "auto";
    }
  }

  async function removeMapControlPoint(id: string) {
    const nextControls = mapControlPoints.filter((point) => point.id !== id);
    setMapControlPoints(nextControls);
    if (!startCoord || !endCoord) return;
    const ok = await rerouteWithMapControls(nextControls);
    if (!ok) setMapControlPoints(mapControlPoints);
  }

  async function resetMapControlPoints() {
    setMapControlPoints([]);
    if (!startCoord || !endCoord) return;
    const ok = await rerouteWithMapControls([]);
    if (!ok) setMapControlPoints(mapControlPoints);
  }

  async function selectPermitRoute(p: any) {
    const map = mapRef.current;

    // Toggle deselect on second click
    if (selectedPermitId === p.permit_id) {
      setSelectedPermitId(null);
      if (map) safeSetGeoJSONSource(map, "permit-route", emptyFC);
      permitRouteAbortRef.current?.abort();
      return;
    }

    setSelectedPermitId(p.permit_id);
    setPermitRouteLoading(true);
    permitRouteAbortRef.current?.abort();
    const ctrl = new AbortController();
    permitRouteAbortRef.current = ctrl;

    if (map) safeSetGeoJSONSource(map, "permit-route", emptyFC);

    try {
      const [startCoords, endCoords] = await Promise.all([
        geocode(p.start_city || ""),
        geocode(p.destination_city || ""),
      ]);
      if (ctrl.signal.aborted) return;
      if (!startCoords || !endCoords) return;

      const body = {
        start: startCoords,
        end: endCoords,
        alternates: 0,
        require_clean: false,
        avoid_target_max: 0,
        routing_max_avoids: 0,
        corridor: { mode: "soft", width_m: 0 },
        roadworks: { buffer_m: 0, only_motorways: false },
        vehicle: {
          width_m: p.width_m ?? 3,
          height_m: p.height_m ?? 4,
          weight_t: p.weight_t ?? 40,
        },
      };

      const res = await fetch("/api/route/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted || !res.ok) return;

      const data = await res.json();
      if (ctrl.signal.aborted) return;

      const gj = pickGeojson(data);
      if (!gj || !map) return;

      const features: any[] = Array.isArray(gj?.features) ? gj.features : [];
      const active = features[0];
      if (!active) return;

      const simplified = simplifyRouteFeatureForMap(active);
      safeSetGeoJSONSource(map, "permit-route", {
        type: "FeatureCollection",
        features: simplified ? [simplified] : [],
      });

      const bbox: [number, number, number, number] | undefined = active?.properties?.bbox;
      if (bbox) {
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
          padding: { top: 40, right: 40, bottom: 40, left: 360 },
        });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error("[permit route]", e);
    } finally {
      if (!ctrl.signal.aborted) setPermitRouteLoading(false);
    }
  }

  async function planRoute() {
    setLoading(true);
    setRouteError(null);
    document.body.style.cursor = "progress";

    const toCoords = async (input: string, pick: Suggestion | null): Promise<Coords> => {
      if (pick && input.trim() === pick.label.trim()) return pick.coord;
      const ll = parseLonLat(input.trim());
      if (ll) return ll;
      const g = await geocode(input.trim());
      if (!g) throw new Error(`Konnte nicht geocodieren: "${input}"`);
      return g as Coords;
    };

    try {
      const start = await toCoords(startInput, startPick);
      const end = await toCoords(endInput, endPick);
      const viaResolved = await Promise.all(
        viaInputs
          .map((value, index) => ({ value: value.trim(), pick: viaPicks[index] ?? null }))
          .filter((entry) => entry.value.length > 0)
          .map((entry) => toCoords(entry.value, entry.pick))
      );

      const routeChanged =
        !coordsEqualApprox(start, startCoord) || !coordsEqualApprox(end, endCoord);
      const nextMapControls = routeChanged ? [] : mapControlPoints;

      setStartCoord(start);
      setViaCoords(viaResolved);
      setEndCoord(end);
      if (routeChanged && mapControlPoints.length > 0) {
        setMapControlPoints([]);
        setRouteEditMode(false);
      }

      await requestPlan(start, end, viaResolved, nextMapControls);
    } catch (e: any) {
      setRouteError(String(e?.message ?? e));
    } finally {
      setLoading(false);
      document.body.style.cursor = "auto";
    }
  }

  // -------------------- UI --------------------
  const routeFeatureCount = Array.isArray(geojson?.features) ? geojson.features.length : 0;
  const activeFeature = currentActiveRoute();
  const activeSummary = activeFeature?.properties?.summary ?? null;
  const activeDistanceKm = Number(activeSummary?.distance_km ?? 0);
  const activeDurationS = Number(activeSummary?.duration_s ?? 0);
  const canPlan = startInput.trim().length > 0 && endInput.trim().length > 0 && !loading;

  function setVehiclePreset(kind: "std" | "heavy") {
    if (kind === "std") {
      setWidth(2.55);
      setHeight(4);
      setWeight(40);
      setAxle(11.5);
      setHeavyTransport(false);
      return;
    }
    setWidth(3);
    setHeight(4.2);
    setWeight(60);
    setAxle(12);
    setHeavyTransport(true);
  }

  function swapRouteEnds() {
    setStartInput(endInput);
    setEndInput(startInput);
    setStartPick(endPick);
    setEndPick(startPick);
    setStartCoord(endCoord);
    setEndCoord(startCoord);
    setMapControlPoints([]);
    setRouteEditMode(false);
  }

  function resetRouteForm() {
    setStartInput("");
    setEndInput("");
    setStartPick(null);
    setEndPick(null);
    setViaInputs([]);
    setViaPicks([]);
    setStartCoord(null);
    setEndCoord(null);
    setViaCoords([]);
    setMapControlPoints([]);
    setRouteEditMode(false);
    setGeojson(null);
    setActiveIdx(0);
    resetPlannerFeedback();
  }

  function exportTxt() {
    const f = geojson?.features?.[activeIdx];
    if (!f) return;
    const distKm = Number(f.properties?.summary?.distance_km ?? 0);
    const timeS = Number(f.properties?.summary?.duration_s ?? 0);
    const lines: string[] = [];
    lines.push("Route – Zusammenfassung");
    lines.push(`Distanz: ${distKm.toFixed(1)} km • Dauer: ${sToMin(timeS)} min`);
    lines.push("");
    lines.push("Anweisungen:");
    (f.properties?.maneuvers ?? []).forEach((s: any, i: number) =>
      lines.push(`${i + 1}. ${s.instruction}  (${s.distance_km.toFixed(1)} km, ${sToMin(s.duration_s)} min)`)
    );
    lines.push("");
    lines.push("Befahrene Straßen:");
    const orderedStreets = buildStreetSequence(f);
    orderedStreets.forEach((name: string, i: number) => lines.push(`${i + 1}. ${name}`));
    lines.push("");
    lines.push("Befahrene Straßen (dedupliziert):");
    buildUniqueStreetSequence(orderedStreets).forEach((name: string, i: number) => lines.push(`${i + 1}. ${name}`));
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "route.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const getMapInfo = () => {
    const m = mapRef.current;
    if (!m) return {};
    const c = m.getCenter();
    const b = m.getBounds();
    return {
      center: { lat: c.lat, lon: c.lng },
      bounds: { left: b.getWest(), top: b.getNorth(), right: b.getEast(), bottom: b.getSouth() },
    };
  };

  return (
    <div className="app-shell">
      <button
        type="button"
        className="planner-theme-toggle"
        onClick={toggleTheme}
        aria-label={darkMode ? "Light Mode aktivieren" : "Dark Mode aktivieren"}
        title={darkMode ? "Light Mode" : "Dark Mode"}
      >
        {darkMode ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <aside className="control-rail">
        <div className="control-rail__inner">
          <section className="hero-card">
            <div className="eyebrow"><Truck size={15} /> Schwertransport-Planer</div>
            <h1>Route, Restriktionen und Baustellen in einer Ansicht</h1>
            <p>
              Sichere Strecken mit Brückenrestriktionen, Schwertransportverboten und Baustellen auf einen Blick.
            </p>
            <div className="hero-stats">
              <div className="hero-stat">
                <span className="hero-stat__value">{rwLoading ? "…" : rwCount}</span>
                <span className="hero-stat__label">Baustellen sichtbar</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat__value">{heavyTransport ? "HT" : "STD"}</span>
                <span className="hero-stat__label">Fahrzeugmodus</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat__value">{steps.length > 0 ? steps.length : "—"}</span>
                <span className="hero-stat__label">Manöver</span>
              </div>
            </div>
            {geojson && (
              <div className="route-kpi-strip">
                <div>
                  <span>{activeDistanceKm > 0 ? `${activeDistanceKm.toFixed(1)} km` : "Route aktiv"}</span>
                  <small>Distanz</small>
                </div>
                <div>
                  <span>{activeDurationS > 0 ? `${sToMin(activeDurationS)} min` : `${routeFeatureCount} Variante${routeFeatureCount === 1 ? "" : "n"}`}</span>
                  <small>Fahrzeit</small>
                </div>
                <div>
                  <span>{mapControlPoints.length}</span>
                  <small>Ziehpunkte</small>
                </div>
              </div>
            )}
          </section>

        {routeError && (
          <div className="notice-card notice-card--danger">
            <div className="notice-title"><XCircle size={16} /> Routenplanung fehlgeschlagen</div>
            <div className="notice-copy">{routeError}</div>
          </div>
        )}

        {/* HERE Routing Notices (Restriktionsverletzungen laut HERE-Kartendaten) */}
        {routingNotices.length > 0 && (
          <div className="notice-card notice-card--warn">
            <div className="notice-title"><AlertTriangle size={16} /> HERE Routing-Hinweise</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--amber)" }}>
              {routingNotices.map((n, i) => (
                <li key={i}>
                  <b>{n.title}</b>
                  {n.code && n.code !== n.title ? ` (${n.code})` : ""}
                  {n.severity ? ` – Schweregrad: ${n.severity}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Validierungsstatus: Restriktionen nicht geladen (Fail-Open-Warnung) */}
        {!loading && !planBlocked && geojson &&
          planMeta?.restrictions_status &&
          planMeta.restrictions_status !== "OK" && (
          <div
            style={{
              padding: 10,
              border: "1px solid var(--amber-line)",
              background: "var(--amber-bg)",
              borderRadius: 10,
              marginBottom: 8,
              fontSize: 13,
              color: "var(--amber)",
            }}
          >
            <b>⚠ Restriktionsdaten unvollständig (Status: {planMeta.restrictions_status})</b>
            <div style={{ marginTop: 4 }}>
              Route konnte nicht vollständig gegen alle Einschränkungen geprüft werden.
              {planMeta.restrictions_fetched === 0
                ? " Keine Restriktionsdaten geladen — bitte Server-Logs prüfen."
                : ` Geladen: ${planMeta.restrictions_fetched ?? "?"}, genutzt: ${planMeta.restrictions_used ?? "?"}.`}
              {planMeta.restrictions_notes ? ` (${planMeta.restrictions_notes})` : ""}
            </div>
          </div>
        )}

        {/* Validierungsstatus: Route sauber */}
        {!loading && !planBlocked && geojson &&
          (!planMeta?.restrictions_status || planMeta.restrictions_status === "OK") && (
          <div className="notice-card notice-card--success">
            <div className="notice-title"><CheckCircle2 size={16} />
              Route ist nach aktueller Datenlage frei von erkannten Konflikten
            </div>
            <div className="notice-copy">
              Bitte die angezeigte Route vor Fahrtantritt trotzdem manuell prüfen. Karten- und
              Restriktionsdaten können unvollständig oder veraltet sein.
            </div>
          </div>
        )}

        {/* WARN/BLOCKED Box */}
        {planBlocked && (
          <div
            style={{
              padding: 10,
              border: planBlocked?.meta?.status === "WARN" ? "1px solid var(--amber-line)" : "1px solid var(--red-line)",
              background: planBlocked?.meta?.status === "WARN" ? "var(--amber-bg)" : "var(--red-bg)",
              borderRadius: 10,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {planBlocked?.meta?.status === "WARN"
                ? "Route gefunden — mit Einschränkungen"
                : "Keine sichere Route gefunden"}
            </div>
            <div style={{ fontSize: 13, color: planBlocked?.meta?.status === "WARN" ? "var(--amber)" : "var(--red)", marginBottom: 8 }}>
              {planBlocked.error || "Die Route ist für dieses Fahrzeug nicht vollständig fahrbar."}
            </div>

            {!String(planBlocked.error ?? "").includes("Bitte die angezeigte Route vor Fahrtantritt manuell prüfen.") && (
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: planBlocked?.meta?.status === "WARN" ? "var(--amber)" : "var(--red)",
                  background: "var(--surface-translucent)",
                  border: `1px solid ${planBlocked?.meta?.status === "WARN" ? "var(--amber-line)" : "var(--red-line)"}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  marginBottom: 10,
                }}
              >
                Bitte die angezeigte Route vor Fahrtantritt manuell prüfen. Karten- und Restriktionsdaten können unvollständig oder veraltet sein.
              </div>
            )}

            {Array.isArray(planBlocked.warnings) && planBlocked.warnings.length > 0 && (
              <div style={{ fontSize: 13, color: "var(--text)" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Problemstellen ({planBlocked.warnings.length}):
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(showAllWarnings ? planBlocked.warnings : planBlocked.warnings.slice(0, 6)).map((w: any, idx: number) => (
                    <li key={idx} style={{ marginBottom: 8 }}>
                      {w.no_heavy_transport === true && (
                        <div
                          style={{
                            display: "inline-block",
                            marginBottom: 4,
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: "var(--red-bg)",
                            color: "var(--red)",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          ⛔ Schwertransportverbot
                        </div>
                      )}
                      <div style={{ fontWeight: 600 }}>
                        {w.network === "autobahn" ? "BAB " : ""}
                        {w.title || "Restriktion"}
                        {w.restriction_kind
                          ? <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 4 }}>({w.restriction_kind})</span>
                          : null}
                      </div>
                      {w.limits && (
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {typeof w.limits.axle === "number" && (
                            <span>
                              Max. Achslast: <b style={{ color: "var(--red)" }}>{w.limits.axle.toFixed(1)} t</b>
                              {typeof w.vehicle_value === "number" && w.block_reason === "AXLE"
                                ? <span style={{ color: "var(--muted)" }}> · Fahrzeug: {w.vehicle_value.toFixed(1)} t</span>
                                : null}
                              {typeof w.severity === "number" && w.block_reason === "AXLE"
                                ? <span style={{ color: "var(--red)", marginLeft: 4 }}>(+{w.severity.toFixed(1)} t)</span>
                                : null}
                            </span>
                          )}
                          {typeof w.limits.width === "number" && (
                            <span style={{ marginLeft: typeof w.limits.axle === "number" ? 8 : 0 }}>
                              Max. Breite: <b style={{ color: "var(--red)" }}>{w.limits.width.toFixed(2)} m</b>
                              {typeof w.vehicle_value === "number" && w.block_reason === "WIDTH"
                                ? <span style={{ color: "var(--muted)" }}> · Fahrzeug: {w.vehicle_value.toFixed(2)} m</span>
                                : null}
                              {typeof w.severity === "number" && w.block_reason === "WIDTH"
                                ? <span style={{ color: "var(--red)", marginLeft: 4 }}>(+{w.severity.toFixed(1)} m)</span>
                                : null}
                            </span>
                          )}
                          {typeof w.limits.weight === "number" && (
                            <span style={{ marginLeft: typeof w.limits.width === "number" || typeof w.limits.axle === "number" ? 8 : 0 }}>
                              Max. Gewicht: <b style={{ color: "var(--red)" }}>{w.limits.weight} t</b>
                              {typeof w.vehicle_value === "number" && w.block_reason === "WEIGHT"
                                ? <span style={{ color: "var(--muted)" }}> · Fahrzeug: {w.vehicle_value} t</span>
                                : null}
                              {typeof w.severity === "number" && w.block_reason === "WEIGHT"
                                ? <span style={{ color: "var(--red)", marginLeft: 4 }}>(+{w.severity.toFixed(1)} t)</span>
                                : null}
                            </span>
                          )}
                          {typeof w.limits.height === "number" && (
                            <span style={{ marginLeft: 8 }}>
                              Max. Höhe: <b style={{ color: "var(--red)" }}>{w.limits.height.toFixed(2)} m</b>
                              {typeof w.vehicle_value === "number" && w.block_reason === "HEIGHT"
                                ? <span style={{ color: "var(--muted)" }}> · Fahrzeug: {w.vehicle_value.toFixed(2)} m</span>
                                : null}
                              {typeof w.severity === "number" && w.block_reason === "HEIGHT"
                                ? <span style={{ color: "var(--red)", marginLeft: 4 }}>(+{w.severity.toFixed(1)} m)</span>
                                : null}
                            </span>
                          )}
                        </div>
                      )}
                      {w.block_reason && !w.limits && (
                        <div style={{ fontSize: 12, color: "var(--red)" }}>{w.block_reason}</div>
                      )}
                    </li>
                  ))}
                </ul>
                {planBlocked.warnings.length > 6 && (
                  <button
                    onClick={() => setShowAllWarnings((v) => !v)}
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: "var(--blue-strong)",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {showAllWarnings
                      ? "▲ Weniger anzeigen"
                      : `▼ Alle ${planBlocked.warnings.length} Problemstellen anzeigen`}
                  </button>
                )}
              </div>
            )}

            {planBlocked?.meta?.iterations != null && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                {planBlocked.meta.iterations} Routing-Iteration(en) · {planBlocked.meta.avoids_applied ?? 0} Avoid-Polygon(e)
              </div>
            )}
          </div>
        )}

        <section className="panel-card">
          <div className="card-head">
            <div>
              <div className="card-title"><MapPin size={16} /> Live-Verkehrslage</div>
              <div className="card-subtitle">Aktive Baustellen für den gewählten Zeitpunkt</div>
            </div>
            <div className="count-pill">
              {rwLoading ? "Lade…" : rwState.status === "FAILED" ? "Fehler" : `${rwCount} sichtbar`}
            </div>
          </div>
          {rwState.status === "FAILED" && (
            <div
              style={{
                marginTop: 6,
                marginBottom: 8,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--red-line)",
                background: "var(--red-bg)",
                color: "var(--red)",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              Baustellendaten sind aktuell nicht verfügbar. Die Karte zeigt deshalb möglicherweise nicht alle aktiven Baustellen.
              {rwState.error ? ` (${rwState.error})` : ""}
            </div>
          )}
          <div className="toggle-row">
            <input id="chk-rw" type="checkbox" checked={showRoadworks} onChange={(e) => setShowRoadworks(e.target.checked)} />
            <label htmlFor="chk-rw"><b>Baustellen (aktiv) anzeigen</b></label>
          </div>
          <div style={{ marginTop: 6 }}>
            <label>Zeitpunkt (lokal)</label>
            <input className="inp" type="datetime-local" value={whenIsoLocal} onChange={(e) => setWhenIsoLocal(e.target.value)} />
            <small className="field-note">
              Aktiv gefiltert aus <code>get_active_roadworks_geojson</code> und <code>road_restrictions</code>
            </small>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="ghost-button" onClick={refreshRoadworks}><RefreshCw size={15} /> Baustellen neu laden</button>
          </div>
        </section>

        <section className="panel-card route-form-card">
          <div className="card-head">
            <div>
              <div className="card-title"><RouteIcon size={16} /> Route planen</div>
              <div className="card-subtitle">Start, Ziel und Fahrzeugprofil für die Berechnung</div>
            </div>
          </div>

          <div className="form-toolbar">
            <button type="button" className="ghost-button" onClick={swapRouteEnds} disabled={!startInput.trim() && !endInput.trim()}>
              <ArrowLeftRight size={15} /> Start/Ziel tauschen
            </button>
            <button type="button" className="ghost-button" onClick={resetRouteForm}>
              <RotateCcw size={15} /> Zurücksetzen
            </button>
          </div>

          <label>Start</label>
          <AutocompleteInput
            value={startInput}
            onChange={(value) => {
              setStartInput(value);
              setStartPick(null);
            }}
            placeholder="Straße Hausnr, PLZ Ort"
            onSelect={(s) => { setStartInput(s.label); setStartPick(s); }}
            getMapInfo={getMapInfo}
          />

          <label>Ziel</label>
          <AutocompleteInput
            value={endInput}
            onChange={(value) => {
              setEndInput(value);
              setEndPick(null);
            }}
            placeholder="Straße Hausnr, PLZ Ort"
            onSelect={(s) => { setEndInput(s.label); setEndPick(s); }}
            getMapInfo={getMapInfo}
          />

          <div style={{ marginTop: 10 }}>
            <div className="card-subtitle" style={{ marginBottom: 8 }}>Zwischenstopps (optional)</div>
            {viaInputs.map((viaInput, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <AutocompleteInput
                    value={viaInput}
                    onChange={(value) => {
                      setViaInputs((current) => current.map((entry, i) => i === index ? value : entry));
                      setViaPicks((current) => current.map((entry, i) => i === index ? null : entry));
                    }}
                    placeholder={`Zwischenstopp ${index + 1}`}
                    onSelect={(s) => {
                      setViaInputs((current) => current.map((entry, i) => i === index ? s.label : entry));
                      setViaPicks((current) => current.map((entry, i) => i === index ? s : entry));
                    }}
                    getMapInfo={getMapInfo}
                  />
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setViaInputs((current) => current.filter((_, i) => i !== index));
                    setViaPicks((current) => current.filter((_, i) => i !== index));
                    setViaCoords((current) => current.filter((_, i) => i !== index));
                  }}
                  style={{ whiteSpace: "nowrap" }}
                >
                  <Trash2 size={14} /> Entfernen
                </button>
              </div>
            ))}
            {viaInputs.length < 4 && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setViaInputs((current) => [...current, ""]);
                  setViaPicks((current) => [...current, null]);
                }}
              >
                <Plus size={14} /> Zwischenstopp hinzufügen
              </button>
            )}
          </div>

          {(geojson || mapControlPoints.length > 0) && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 16,
                border: routeEditMode ? "1px solid var(--blue-soft-line)" : "1px solid var(--line-soft)",
                background: routeEditMode ? "var(--blue-soft-bg)" : "var(--surface-muted)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px" }}>
                  <div className="card-subtitle" style={{ marginTop: 0, color: "var(--text)" }}>
                    Route interaktiv anpassen
                  </div>
                  <small className="field-note">
                    Klicke im Bearbeitungsmodus direkt auf die blaue Route, um einen Ziehpunkt
                    zu setzen. Danach kannst du ihn an die gewünschte Straße ziehen. Wir rechnen
                    erst nach dem Loslassen neu.
                  </small>
                </div>
                <div className="count-pill">
                  {mapControlPoints.length} Kontrollpunkt{mapControlPoints.length === 1 ? "" : "e"}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setRouteEditMode((current) => !current)}
                  disabled={!geojson}
                >
                  <PencilRuler size={15} /> {routeEditMode ? "Bearbeitung beenden" : "Route anpassen"}
                </button>
                {mapControlPoints.length > 0 && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void resetMapControlPoints()}
                  >
                    <Trash2 size={15} /> Kontrollpunkte entfernen
                  </button>
                )}
              </div>

              {routeEditMode && (
                <small className="field-note" style={{ marginTop: 10 }}>
                  Tipp: Ein oder zwei Ziehpunkte genügen fast immer. Wenn eine Ziehbewegung einen
                  unplausiblen Umweg erzeugt, behalten wir die letzte sinnvolle Route bei.
                </small>
              )}

              {mapControlPoints.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  {mapControlPoints.map((point, index) => (
                    <div
                      key={point.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: "1px solid var(--orange-line)",
                        background: "var(--orange-soft-bg)",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "0.86rem", fontWeight: 800 }}>
                          Ziehpunkt {index + 1}
                        </div>
                        <small className="field-note">{point.label ?? formatCoordLabel(point.coord)}</small>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void removeMapControlPoint(point.id)}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        <Trash2 size={14} /> Entfernen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="row" style={{ marginTop: 6 }}>
            <div className="col">
              <label>Breite (m)</label>
              <input className="inp" type="number" min="0.5" step="0.01" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </div>
            <div className="col">
              <label>Höhe (m)</label>
              <input className="inp" type="number" min="1" step="0.01" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </div>
          </div>

          <div className="row">
            <div className="col">
              <label>Gewicht (t)</label>
              <input className="inp" type="number" min="1" step="0.5" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
            </div>
            <div className="col">
              <label>Achs-last (t)</label>
              <input className="inp" type="number" min="1" step="0.5" value={axle} onChange={(e) => setAxle(Number(e.target.value))} />
            </div>
          </div>

          <div className="preset-row">
            <button type="button" className={!heavyTransport ? "preset-chip is-active" : "preset-chip"} onClick={() => setVehiclePreset("std")}>
              Standard-LKW
            </button>
            <button type="button" className={heavyTransport ? "preset-chip is-active" : "preset-chip"} onClick={() => setVehiclePreset("heavy")}>
              Schwertransport
            </button>
          </div>

          <div className="heavy-toggle-card">
            <label className="toggle-row heavy-toggle-label">
            <input
              id="chk-heavy-transport"
              type="checkbox"
              checked={heavyTransport}
              onChange={(e) => setHeavyTransport(e.target.checked)}
            />
              <span>Schwertransport (Sondergenehmigung erforderlich)</span>
            </label>
          </div>

          <div className="route-actions">
            <button className={`primary ${loading ? "loading" : ""}`} onClick={planRoute} disabled={!canPlan}>
              {loading ? "Plane…" : <><Navigation size={17} /> Route planen</>}
            </button>
          </div>
        </section>

        {steps.length > 0 && (
          <>
            <div className="legend modern-legend">
              <span><span className="dot blue" /> Aktive Route</span>
              <span><span className="dot gray" /> Alternativen (anklickbar)</span>
              {selectedPermitId !== null && (
                <span><span className="dot" style={{ background: "#F59E0B" }} /> Referenz-Route (Genehmigung)</span>
              )}
              <span><span className="dot" style={{ background: "#DC2626" }} /> Schwertransport verboten</span>
              <span><span className="dot" style={{ background: "#EAB308" }} /> Restriktion, aber kein Verbot</span>
              <span><span className="dot" style={{ background: "#E67E22" }} /> Baustellenabschnitte</span>
            </div>

            <div className="directions">
              <div className="head">
                <b>Anweisungen</b>
                <span className="spacer" />
                <button className="ghost-button" onClick={exportTxt}><Download size={15} /> Als TXT exportieren</button>
              </div>
              <ol>
                {steps.map((s, i) => (
                  <li key={i}>
                    <div>{s.instruction}</div>
                    <small>{s.distance_km.toFixed(1)} km · {sToMin(s.duration_s)} min</small>
                    {!!s.street_names?.length && <div className="muted">Straßen (Manöver): {s.street_names.join(", ")}</div>}
                  </li>
                ))}
              </ol>
            </div>

            <div className="directions">
              <div className="head"><b>Befahrene Straßen</b></div>
              <ol>{buildUniqueStreetSequence(streets).map((n, i) => <li key={i}><div>{n}</div></li>)}</ol>
            </div>
          </>
        )}

        {/* Ähnliche Genehmigungen */}
        {(similarLoading || similarPermits.length > 0) && (
          <section className="panel-card" style={{ marginTop: 12 }}>
            <div className="card-head">
              <div>
                <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={16} /> Ähnliche Genehmigungen
                </div>
                <div className="card-subtitle">
                  Aus der Datenbank — basierend auf Strecke und Fahrzeugprofil
                </div>
              </div>
              <div className="count-pill">
                {similarLoading ? "Suche…" : `${similarPermits.length} Treffer`}
              </div>
            </div>

            {similarLoading && (
              <div style={{ fontSize: 13, color: "var(--muted)", padding: "8px 0" }}>
                Durchsuche Genehmigungsdatenbank…
              </div>
            )}

            {!similarLoading && similarPermits.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                Genehmigung anklicken um deren Route auf der Karte einzublenden.
              </div>
            )}

            {!similarLoading && similarPermits.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--muted)", padding: "8px 0" }}>
                Keine ähnlichen Genehmigungen gefunden (Score &lt; 25).
              </div>
            )}

            {!similarLoading && similarPermits.map((p: any) => {
              const isSelected = selectedPermitId === p.permit_id;
              return (
              <div
                key={p.permit_id}
                onClick={() => void selectPermitRoute(p)}
                title={isSelected ? "Klicken zum Ausblenden" : "Klicken um Route auf Karte anzuzeigen"}
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  cursor: "pointer",
                  transition: "box-shadow 0.15s, border-color 0.15s",
                  border: isSelected
                    ? "2px solid #F59E0B"
                    : p.status === "aktiv"
                    ? "1px solid var(--green-line, #86efac)"
                    : "1px solid var(--line-soft)",
                  background: isSelected
                    ? "rgba(245,158,11,0.08)"
                    : p.status === "aktiv"
                    ? "var(--green-bg, rgba(134,239,172,0.08))"
                    : "var(--surface-muted)",
                  boxShadow: isSelected ? "0 0 0 3px rgba(245,158,11,0.18)" : undefined,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{p.permit_number}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: p.status === "aktiv" ? "var(--green-bg, #dcfce7)" : "var(--surface-muted)",
                        color: p.status === "aktiv" ? "var(--green, #16a34a)" : "var(--muted)",
                        border: p.status === "aktiv" ? "1px solid var(--green-line, #86efac)" : "1px solid var(--line-soft)",
                      }}
                    >
                      {p.status === "aktiv" ? "Aktiv" : "Abgelaufen"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background:
                          p.risikostufe === "kritisch" ? "var(--red-bg, rgba(220,38,38,0.1))"
                          : p.risikostufe === "hoch" ? "rgba(245,158,11,0.12)"
                          : p.risikostufe === "mittel" ? "rgba(234,179,8,0.12)"
                          : "rgba(22,163,74,0.1)",
                        color:
                          p.risikostufe === "kritisch" ? "var(--red, #DC2626)"
                          : p.risikostufe === "hoch" ? "#B45309"
                          : p.risikostufe === "mittel" ? "#A16207"
                          : "var(--green, #16a34a)",
                        border: "1px solid var(--line-soft)",
                      }}
                    >
                      {p.risikostufe ?? "niedrig"}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{p.route_summary}</div>

                {p.valid_until && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    Gültig bis: {p.valid_until}
                  </div>
                )}

                <div style={{ fontSize: 12, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {p.width_m != null && (
                    <span style={{ padding: "1px 6px", borderRadius: 6, background: "var(--surface-muted)", border: "1px solid var(--line-soft)" }}>
                      {Number(p.width_m).toFixed(2)} m breit
                    </span>
                  )}
                  {p.height_m != null && (
                    <span style={{ padding: "1px 6px", borderRadius: 6, background: "var(--surface-muted)", border: "1px solid var(--line-soft)" }}>
                      {Number(p.height_m).toFixed(2)} m hoch
                    </span>
                  )}
                  {p.weight_t != null && (
                    <span style={{ padding: "1px 6px", borderRadius: 6, background: "var(--surface-muted)", border: "1px solid var(--line-soft)" }}>
                      {Number(p.weight_t).toFixed(0)} t
                    </span>
                  )}
                </div>

                {Array.isArray(p.match_reasons) && p.match_reasons.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
                    {p.match_reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                )}

                {Array.isArray(p.key_conditions) && p.key_conditions.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                    <b>Auflagen:</b> {p.key_conditions.slice(0, 3).join(" · ")}
                  </div>
                )}

                {isSelected && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#92400e", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                    {permitRouteLoading && selectedPermitId === p.permit_id
                      ? "Route wird geladen…"
                      : "Route auf Karte aktiv — nochmals klicken zum Ausblenden"}
                  </div>
                )}
              </div>
              );
            })}
          </section>
        )}
        </div>
      </aside>

      <main className="map-stage">
        <div className="map-frame">
          <div className="map-topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Link
                href="/"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 12, border: "1px solid var(--line-soft)",
                  background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 700,
                  textDecoration: "none", boxShadow: "0 1px 2px rgba(60,64,67,0.08)",
                  whiteSpace: "nowrap",
                }}
              >
                <ArrowLeft size={15} /> Zurück
              </Link>
              <div>
                <div className="map-topbar__label">Kartenansicht</div>
                <div className="map-topbar__title">Brückenrestriktionen, Baustellen und Routen im Blick</div>
              </div>
            </div>
            <div className="map-status-badges">
              <span className="status-badge status-badge--danger">Rot = Schwertransport verboten</span>
              <span className="status-badge status-badge--warn">Gelb = Restriktion ohne Verbot</span>
              <span className="status-badge status-badge--roadwork">Orange = Baustellenabschnitt</span>
            </div>
          </div>
          <div ref={containerRef} className="map-canvas" />
        </div>
      </main>
    </div>
  );
}
