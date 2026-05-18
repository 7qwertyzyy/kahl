import type { Roadwork, AutobahnRoadworksResponse } from "./types";

const BASE = "https://verkehr.autobahn.de/o/autobahn";

// Priority highways to load on startup
export const PRIORITY_ROADS = [
  "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9",
  "A40", "A42", "A43", "A44", "A45", "A46", "A57", "A59", "A61",
];

export async function fetchAllRoads(): Promise<string[]> {
  const res = await fetch(`${BASE}/`);
  if (!res.ok) throw new Error(`Autobahn-API Fehler: ${res.status}`);
  const data = await res.json();
  return data.roads ?? [];
}

export async function fetchRoadworks(roadId: string): Promise<Roadwork[]> {
  const res = await fetch(`${BASE}/${roadId}/services/roadworks`);
  if (res.status === 204 || res.status === 404) return [];
  if (!res.ok) throw new Error(`Autobahn-API Fehler für ${roadId}: ${res.status}`);
  const data: AutobahnRoadworksResponse = await res.json();
  return data.roadworks ?? [];
}

export async function fetchPriorityRoadworks(): Promise<Roadwork[]> {
  const results = await Promise.allSettled(
    PRIORITY_ROADS.map((road) => fetchRoadworks(road))
  );

  const all: Roadwork[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    }
  }
  // Deduplicate by identifier
  const seen = new Set<string>();
  return all.filter((rw) => {
    if (seen.has(rw.identifier)) return false;
    seen.add(rw.identifier);
    return true;
  });
}

export function isActiveAt(roadwork: Roadwork, dateTime: Date): boolean {
  const start = new Date(roadwork.startTimestamp);
  const end = roadwork.endTimestamp
    ? new Date(roadwork.endTimestamp)
    : new Date("2099-12-31");
  return dateTime >= start && dateTime <= end;
}

export function getRoadworkMaxWidth(roadwork: Roadwork): number | null {
  const text = [
    roadwork.title,
    roadwork.subtitle,
    Array.isArray(roadwork.description) ? roadwork.description.join(" ") : roadwork.description,
    roadwork.footer,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");

  const widthPatterns = [
    /(?:max(?:\.|imal(?:e|er|en)?)?|bis|zul(?:\.|aessig(?:e|er|en)?))\s*(?:fahrzeug)?\s*breite\s*(?:von|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i,
    /(?:breite|durchfahrtsbreite|fahrstreifenbreite)\s*(?:max(?:\.|imal)?|bis|<=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i,
    /(\d+(?:[,.]\d+)?)\s*m\s*(?:max(?:\.|imal(?:e|er|en)?)?)?\s*(?:fahrzeug)?\s*breite/i,
  ];

  for (const pattern of widthPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const width = Number.parseFloat(match[1].replace(",", "."));
    if (Number.isFinite(width) && width > 0 && width < 20) return width;
  }

  return null;
}

export function isRoadworkWidthConflict(roadwork: Roadwork, vehicleWidth: number): boolean {
  const maxWidth = getRoadworkMaxWidth(roadwork);
  return maxWidth !== null && vehicleWidth > maxWidth;
}

export function roadworksToGeoJSON(
  roadworks: Roadwork[],
  filterDate: Date
): GeoJSON.FeatureCollection {
  const active = roadworks.filter((rw) => isActiveAt(rw, filterDate));

  const features: GeoJSON.Feature[] = [];

  for (const rw of active) {
    const props = {
      identifier: rw.identifier,
      title: rw.title,
      description: Array.isArray(rw.description)
        ? rw.description.join("\n")
        : String(rw.description ?? ""),
      maxWidth: getRoadworkMaxWidth(rw),
      isBlocked: rw.isBlocked,
      start: rw.startTimestamp,
      end: rw.endTimestamp ?? null,
    };

    // Line feature if extent is available
    if (rw.extent) {
      const parts = rw.extent.split(",").map(Number);
      if (parts.length === 4) {
        const [lat1, lng1, lat2, lng2] = parts;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [lng1, lat1],
              [lng2, lat2],
            ],
          },
          properties: { ...props, featureType: "line" },
        });
      }
    }

    // Point feature
    const lat = parseFloat(rw.coordinate?.lat ?? "");
    const lng = parseFloat(rw.coordinate?.long ?? "");
    if (!isNaN(lat) && !isNaN(lng)) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: { ...props, featureType: "point" },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
