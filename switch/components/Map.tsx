"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState, MutableRefObject } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { roadworksToGeoJSON, fetchPriorityRoadworks } from "@/lib/autobahn-api";
import type { Roadwork } from "@/lib/types";
import {
  SOURCE_ROUTE,
  SOURCE_CONSTRUCTIONS,
  LAYER_ROUTE_OUTLINE,
  LAYER_CONSTRUCTION_LINES,
  LAYER_CONSTRUCTION_POINTS,
  addRouteLayers,
  addConstructionLayers,
} from "@/lib/mapLayers";
import RestrictionLegend from "./RestrictionLegend";

interface MapProps {
  routeGeoJSON: GeoJSON.FeatureCollection | null;
  showConstructions: boolean;
  showTraffic: boolean;
  filterDate: Date;
  mapFlyToRef: MutableRefObject<((coords: [number, number]) => void) | null>;
}

// Session-level cache for roadworks
let roadworksCache: Roadwork[] | null = null;
let roadworksFetchPromise: Promise<Roadwork[]> | null = null;

async function getRoadworks(): Promise<Roadwork[]> {
  if (roadworksCache) return roadworksCache;
  if (!roadworksFetchPromise) {
    roadworksFetchPromise = fetchPriorityRoadworks().then((data) => {
      roadworksCache = data;
      return data;
    });
  }
  return roadworksFetchPromise;
}

export default function Map({
  routeGeoJSON,
  showConstructions,
  showTraffic,
  filterDate,
  mapFlyToRef,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const trafficLayerAdded = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  // Update construction layer data
  const updateConstructions = useCallback(
    async (map: mapboxgl.Map, show: boolean, date: Date) => {
      const source = map.getSource(SOURCE_CONSTRUCTIONS) as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;

      if (!show) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      try {
        const roadworks = await getRoadworks();
        const geojson = roadworksToGeoJSON(roadworks, date);
        source.setData(geojson);
      } catch {
        // silently ignore — network issues shouldn't break the map
      }
    },
    []
  );

  // Initialize map
  useLayoutEffect(() => {
    if (mapRef.current) return;

    if (!token) {
      setMapError("NEXT_PUBLIC_MAPBOX_TOKEN fehlt in .env.local — Dev-Server neu starten!");
      return;
    }

    let rafId: number;
    let map: mapboxgl.Map | null = null;

    rafId = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;

      console.log("[Map] container size:", el.clientWidth, "x", el.clientHeight);
      console.log("[Map] token prefix:", token.slice(0, 10));

      mapboxgl.accessToken = token;

      try {
        map = new mapboxgl.Map({
          container: el,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [10.0, 51.0],
          zoom: 6,
        });
      } catch (e) {
        setMapError(`Mapbox init fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      map.on("error", (e) => {
        console.error("[Map] error:", e);
        setMapError(`Mapbox Fehler: ${e.error?.message ?? JSON.stringify(e)}`);
      });

      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-right");

      map.on("load", () => {
        if (!map) return;
        map.resize();
        setMapLoaded(true);
        addRouteLayers(map);
        addConstructionLayers(map);

        updateConstructions(map, showConstructions, filterDate);

        const popup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: false,
          maxWidth: "280px",
        });
        popupRef.current = popup;

        const showPopup = (
          e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }
        ) => {
          if (!e.features?.length) return;
          const feature = e.features[0];
          const coords =
            (feature.geometry as GeoJSON.Point | GeoJSON.LineString).type === "Point"
              ? ((feature.geometry as GeoJSON.Point).coordinates as [number, number])
              : (e.lngLat.toArray() as [number, number]);

          const props = feature.properties ?? {};
          const title = props.title ?? "Baustelle";
          const desc = (props.description ?? "").replace(/<[^>]*>/g, "");
          const start = props.start ? new Date(props.start).toLocaleDateString("de-DE") : "";
          const end = props.end ? new Date(props.end).toLocaleDateString("de-DE") : "offen";
          const blocked = props.isBlocked ? "<span style='color:#ef4444'>⚠ Gesperrt</span>" : "";

          popup
            .setLngLat(coords)
            .setHTML(
              `<strong style="font-size:0.85rem">${title}</strong>${blocked ? `<br>${blocked}` : ""}` +
                (desc ? `<p style="margin:4px 0 0;color:#9ca3af;white-space:pre-wrap;max-height:100px;overflow:auto">${desc}</p>` : "") +
                (start ? `<p style="margin:4px 0 0;color:#6b7280;font-size:0.75rem">${start} – ${end}</p>` : "")
            )
            .addTo(map!);
        };

        map.on("click", LAYER_CONSTRUCTION_POINTS, showPopup);
        map.on("click", LAYER_CONSTRUCTION_LINES, showPopup);

        map.on("mouseenter", LAYER_CONSTRUCTION_POINTS, () => { map!.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", LAYER_CONSTRUCTION_POINTS, () => { map!.getCanvas().style.cursor = ""; });
        map.on("mouseenter", LAYER_CONSTRUCTION_LINES, () => { map!.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", LAYER_CONSTRUCTION_LINES, () => { map!.getCanvas().style.cursor = ""; });
      });

      mapRef.current = map;
      mapFlyToRef.current = (coords: [number, number]) => {
        map?.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 12) });
      };
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (map) {
        map.remove();
        map = null;
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Update route on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource(SOURCE_ROUTE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    // Clear existing start/end markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!routeGeoJSON) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    source.setData(routeGeoJSON);

    // Fit map to route bounds
    const coords: [number, number][] = [];
    for (const feature of routeGeoJSON.features) {
      if (feature.geometry.type === "LineString") {
        coords.push(...(feature.geometry.coordinates as [number, number][]));
      }
    }

    if (coords.length > 0) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }

    // Add start/end markers from route waypoints
    const waypoints = routeGeoJSON.features[0]?.properties?.way_points;
    const routeCoords = routeGeoJSON.features[0]?.geometry.type === "LineString"
      ? (routeGeoJSON.features[0].geometry as GeoJSON.LineString).coordinates
      : [];

    if (routeCoords.length > 0) {
      const startIdx = waypoints?.[0] ?? 0;
      const endIdx = waypoints?.[waypoints.length - 1] ?? routeCoords.length - 1;

      const startCoord = routeCoords[startIdx] as [number, number];
      const endCoord = routeCoords[endIdx] as [number, number];

      const startEl = document.createElement("div");
      startEl.className = "w-4 h-4 rounded-full border-2 border-white bg-green-500 shadow-lg";
      markersRef.current.push(new mapboxgl.Marker({ element: startEl }).setLngLat(startCoord).addTo(map));

      const endEl = document.createElement("div");
      endEl.className = "w-4 h-4 rounded-full border-2 border-white bg-red-500 shadow-lg";
      markersRef.current.push(new mapboxgl.Marker({ element: endEl }).setLngLat(endCoord).addTo(map));
    }
  }, [routeGeoJSON, mapLoaded]);

  // Toggle construction visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    updateConstructions(map, showConstructions, filterDate);
  }, [showConstructions, filterDate, updateConstructions]);

  // Toggle traffic layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (showTraffic && !trafficLayerAdded.current) {
      if (!map.getSource("mapbox-traffic")) {
        map.addSource("mapbox-traffic", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-traffic-v1",
        });
      }
      if (!map.getLayer("traffic-layer")) {
        map.addLayer(
          {
            id: "traffic-layer",
            type: "line",
            source: "mapbox-traffic",
            "source-layer": "traffic",
            paint: {
              "line-color": [
                "match",
                ["get", "congestion"],
                "low", "#22c55e",
                "moderate", "#eab308",
                "heavy", "#f97316",
                "severe", "#ef4444",
                "#aaa",
              ],
              "line-width": 3,
              "line-opacity": 0.8,
            },
          },
          LAYER_ROUTE_OUTLINE
        );
      }
      trafficLayerAdded.current = true;
    } else if (!showTraffic && trafficLayerAdded.current) {
      if (map.getLayer("traffic-layer")) map.removeLayer("traffic-layer");
      if (map.getSource("mapbox-traffic")) map.removeSource("mapbox-traffic");
      trafficLayerAdded.current = false;
    }
  }, [showTraffic]);

  return (
    <div className="w-full h-full relative bg-gray-200">
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading spinner until map fires 'load' */}
      {!mapLoaded && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600 text-sm">Karte wird geladen…</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 max-w-md text-center space-y-2">
            <p className="text-red-200 font-semibold text-sm">Karte konnte nicht geladen werden</p>
            <p className="text-red-300 text-xs leading-relaxed">{mapError}</p>
            <p className="text-red-400 text-xs mt-2">
              → Dev-Server stoppen (<code className="bg-red-800 px-1 rounded">Ctrl+C</code>) und neu starten:{" "}
              <code className="bg-red-800 px-1 rounded">npm run dev</code>
            </p>
          </div>
        </div>
      )}

      {mapLoaded && <RestrictionLegend />}
    </div>
  );
}
