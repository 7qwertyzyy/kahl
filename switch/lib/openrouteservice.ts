import type { RouteResult, VehicleParams } from "./types";
import { fetchPriorityRoadworks, isActiveAt, isRoadworkWidthConflict } from "./autobahn-api";

const ORS_BASE = "https://api.openrouteservice.org/v2";
const ROADWORK_BUFFER_METERS = 180;
const MAX_AVOID_POLYGONS = 80;

function metersToLatitudeDegrees(meters: number): number {
  return meters / 111_320;
}

function metersToLongitudeDegrees(meters: number, latitude: number): number {
  const latitudeRadians = latitude * Math.PI / 180;
  return meters / (111_320 * Math.max(Math.cos(latitudeRadians), 0.1));
}

function rectangleAroundBounds(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  bufferMeters = ROADWORK_BUFFER_METERS
): GeoJSON.Polygon {
  const centerLat = (minLat + maxLat) / 2;
  const latBuffer = metersToLatitudeDegrees(bufferMeters);
  const lngBuffer = metersToLongitudeDegrees(bufferMeters, centerLat);

  const west = minLng - lngBuffer;
  const east = maxLng + lngBuffer;
  const south = minLat - latBuffer;
  const north = maxLat + latBuffer;

  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function roadworkAvoidPolygon(roadwork: {
  extent?: string;
  coordinate?: { lat: string; long: string };
}): GeoJSON.Polygon | null {
  if (roadwork.extent) {
    const parts = roadwork.extent.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [lat1, lng1, lat2, lng2] = parts;
      return rectangleAroundBounds(
        Math.min(lng1, lng2),
        Math.min(lat1, lat2),
        Math.max(lng1, lng2),
        Math.max(lat1, lat2)
      );
    }
  }

  const lat = Number.parseFloat(roadwork.coordinate?.lat ?? "");
  const lng = Number.parseFloat(roadwork.coordinate?.long ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return rectangleAroundBounds(lng, lat, lng, lat);
}

async function buildAvoidPolygons(
  vehicle: VehicleParams,
  routeDate: Date
): Promise<GeoJSON.MultiPolygon | null> {
  const roadworks = await fetchPriorityRoadworks();
  const polygons = roadworks
    .filter((roadwork) => isActiveAt(roadwork, routeDate))
    .filter((roadwork) => roadwork.isBlocked || isRoadworkWidthConflict(roadwork, vehicle.width))
    .map(roadworkAvoidPolygon)
    .filter((polygon): polygon is GeoJSON.Polygon => polygon !== null)
    .slice(0, MAX_AVOID_POLYGONS);

  if (polygons.length === 0) return null;

  return {
    type: "MultiPolygon",
    coordinates: polygons.map((polygon) => polygon.coordinates),
  };
}

export async function calculateRoute(
  coordinates: [number, number][],
  vehicle: VehicleParams,
  routeDate = new Date()
): Promise<RouteResult> {
  const apiKey = process.env.NEXT_PUBLIC_ORS_API_KEY;
  if (!apiKey) throw new Error("ORS API-Key fehlt. Bitte NEXT_PUBLIC_ORS_API_KEY setzen.");

  const avoidPolygons = await buildAvoidPolygons(vehicle, routeDate).catch(() => null);

  const body = {
    coordinates,
    instructions: true,
    language: "de",
    units: "m",
    continue_straight: true,
    options: {
      profile_params: {
        restrictions: {
          width: vehicle.width,
          height: vehicle.height,
          weight: vehicle.weight,
          axleload: vehicle.axleload,
        },
      },
      ...(avoidPolygons ? { avoid_polygons: avoidPolygons } : {}),
    },
  };

  const res = await fetch(`${ORS_BASE}/directions/driving-hgv/geojson`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ORS Fehler ${res.status}: ${err}`);
  }

  const geojson = await res.json();

  const summary = geojson.features?.[0]?.properties?.summary;
  const segments = geojson.features?.[0]?.properties?.segments ?? [];

  return {
    geojson,
    distance: summary?.distance ?? 0,
    duration: summary?.duration ?? 0,
    segments: segments.map((seg: {
      distance: number;
      duration: number;
      steps?: Array<{
        distance: number;
        duration: number;
        instruction: string;
        name: string;
        type: number;
        way_points: [number, number];
      }>;
    }) => ({
      distance: seg.distance,
      duration: seg.duration,
      steps: (seg.steps ?? []).map((step) => ({
        distance: step.distance,
        duration: step.duration,
        instruction: step.instruction,
        name: step.name,
        type: step.type,
        way_points: step.way_points,
      })),
    })),
  };
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} Std. ${m} Min.`;
  return `${m} Min.`;
}
