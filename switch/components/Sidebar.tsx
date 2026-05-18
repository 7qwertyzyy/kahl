"use client";

import { MutableRefObject } from "react";
import { Truck, Radio } from "lucide-react";
import type { RouteResult, RouteStop, VehicleMode, VehicleParams } from "@/lib/types";
import VehicleModeToggle from "./VehicleModeToggle";
import RouteForm from "./RouteForm";
import ConstructionPanel from "./ConstructionPanel";
import RouteResultPanel from "./RouteResult";
import SimilarPermitsPanel from "./permits/SimilarPermitsPanel";

interface SidebarProps {
  vehicleMode: VehicleMode;
  onVehicleModeChange: (m: VehicleMode) => void;
  vehicle: VehicleParams;
  onVehicleChange: (v: VehicleParams) => void;
  start: RouteStop;
  onStartChange: (s: RouteStop) => void;
  end: RouteStop;
  onEndChange: (s: RouteStop) => void;
  onCalculateRoute: () => void;
  isRouting: boolean;
  routeResult: RouteResult | null;
  routeError: string | null;
  showConstructions: boolean;
  onShowConstructionsChange: (v: boolean) => void;
  showTraffic: boolean;
  onShowTrafficChange: (v: boolean) => void;
  filterDate: Date;
  onFilterDateChange: (d: Date) => void;
  mapFlyTo: MutableRefObject<((coords: [number, number]) => void) | null>;
}

export default function Sidebar({
  vehicleMode,
  onVehicleModeChange,
  vehicle,
  onVehicleChange,
  start,
  onStartChange,
  end,
  onEndChange,
  onCalculateRoute,
  isRouting,
  routeResult,
  routeError,
  showConstructions,
  onShowConstructionsChange,
  showTraffic,
  onShowTrafficChange,
  filterDate,
  onFilterDateChange,
  mapFlyTo,
}: SidebarProps) {
  return (
    <aside className="fixed top-16 bottom-0 left-0 w-[380px] flex flex-col bg-gray-900 border-r border-gray-700 z-20">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-700 bg-gray-900 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/20">
            <Truck size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">
              Schwertransport-Planer
            </h1>
            <p className="text-xs text-gray-500">Kahl Schwerlast</p>
          </div>
        </div>
        <VehicleModeToggle mode={vehicleMode} onChange={onVehicleModeChange} />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll px-3 py-3 space-y-3">
        <ConstructionPanel
          show={showConstructions}
          onShowChange={onShowConstructionsChange}
          filterDate={filterDate}
          onFilterDateChange={onFilterDateChange}
        />

        <RouteForm
          vehicleMode={vehicleMode}
          vehicle={vehicle}
          onVehicleChange={onVehicleChange}
          start={start}
          onStartChange={onStartChange}
          end={end}
          onEndChange={onEndChange}
          onCalculateRoute={onCalculateRoute}
          isRouting={isRouting}
          routeError={routeError}
          mapFlyTo={mapFlyTo}
        />

        {routeResult && <RouteResultPanel result={routeResult} />}

        {routeResult && (
          <SimilarPermitsPanel
            startLabel={start.label}
            endLabel={end.label}
            vehicle={vehicle}
          />
        )}

        {/* Traffic toggle */}
        <div className="border border-gray-700 rounded-lg px-3 py-2.5 bg-gray-800">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showTraffic}
              onChange={(e) => onShowTrafficChange(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500"
            />
            <Radio size={14} className="text-green-400" />
            <span className="text-sm text-gray-300">Live-Verkehrslage</span>
          </label>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-800 shrink-0">
        <p className="text-xs text-gray-600 text-center">
          Routing: OpenRouteService · Baustellen: Autobahn GmbH
        </p>
      </div>
    </aside>
  );
}
