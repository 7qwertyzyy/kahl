// ─── Existing Planer Types ────────────────────────────────────────────────────

export type VehicleMode = "STD" | "GST" | "ST";

export interface VehicleParams {
  width: number;
  height: number;
  weight: number;
  axleload: number;
}

export interface RouteStop {
  id: string;
  label: string;
  coordinates: [number, number] | null;
}

export interface RouteResult {
  geojson: GeoJSON.FeatureCollection;
  distance: number;
  duration: number;
  segments: RouteSegment[];
}

export interface RouteSegment {
  distance: number;
  duration: number;
  steps: RouteStep[];
}

export interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  type: number;
  way_points: [number, number];
}

export interface Roadwork {
  identifier: string;
  title: string;
  description: string[];
  coordinate: { lat: string; long: string };
  extent?: string;
  startTimestamp: string;
  endTimestamp?: string;
  isBlocked: boolean;
  subtitle?: string;
  footer?: string;
  icon?: string;
  point?: { lat: string; long: string };
  display_type?: string;
  lorryParkingFeatureIcons?: unknown[];
  future?: boolean;
  abnormalTransportGuide?: boolean;
  causeDelay?: boolean;
}

export interface AutobahnRoadworksResponse {
  roadworks: Roadwork[];
}

export interface GeocodingResult {
  place_name: string;
  center: [number, number];
}

export interface MapPopupInfo {
  coordinates: [number, number];
  title: string;
  description: string;
  type: "construction" | "restriction";
}

// ─── Permit System Types ──────────────────────────────────────────────────────

export interface Permit {
  id: number;
  dateiname: string | null;
  dateityp: "pdf" | "xml" | null;
  genehmigungsnummer: string | null;
  antragsnummer: string | null;
  genehmigungsart: string | null;
  kunde: string | null;
  startort: string | null;
  start_adresse: string | null;
  start_bundesland: string | null;
  zielort: string | null;
  ziel_adresse: string | null;
  ziel_bundesland: string | null;
  gueltig_von: string | null;
  gueltig_bis: string | null;
  fahrzeug_laenge_m: number | null;
  fahrzeug_breite_m: number | null;
  fahrzeug_hoehe_m: number | null;
  gesamtgewicht_t: number | null;
  achslast_t: number | null;
  kennzeichen: string[];
  strecke: string[];
  erkannte_strassen: string[];
  auflagen: string[];
  auflagen_kurzfassung: string | null;
  behoerden: string[];
  besonderheiten: string[];
  begleitfahrzeug_erforderlich: boolean;
  polizei_erforderlich: boolean;
  nachtfahrt_erforderlich: boolean;
  auflagenstaerke: number;
  auflagenstaerke_stufe: string;
  risikostufe: "niedrig" | "mittel" | "hoch" | "kritisch";
  risiko_begruendung: string | null;
  ki_zusammenfassung: string | null;
  fahrer_hinweise: string | null;
  dispo_hinweise: string | null;
  confidence: number;
  status: "needs_review" | "verified" | "error";
  original_datei_pfad: string | null;
  extraktions_modell: string | null;
  erstellt_am: string | null;
  aktualisiert_am: string | null;
  geprueft_von: string | null;
  geprueft_am: string | null;
  kommentare: string | null;
}

export interface TransportRequest {
  kunde?: string;
  startort: string;
  zielort: string;
  laenge_m?: number;
  breite_m?: number;
  hoehe_m?: number;
  gewicht_t?: number;
  achslast_t?: number;
  transportgut?: string;
  wunschdatum?: string;
}

export interface MatchResult {
  permit: Permit;
  similarity_score: number;
  match_grund: string[];
  empfehlung: string;
}

export interface KalkulationsBriefing {
  zusammenfassung: string;
  anfrage_bewertung: string;
  strecken_einschaetzung: string;
  genehmigungshinweis: string;
  erkenntnisse_aus_altfaellen: string;
  risiko_zusammenfassung: string;
  fehlende_informationen: string[];
  empfohlene_naechste_schritte: string[];
  hinweis_kalkulation: string;
  hinweis_genehmigung: string;
  hinweis_disposition: string;
}

export interface AnfrageMatch {
  id: number;
  permit_id: number;
  permit: Permit;
  similarity_score: number;
  match_gruende: string[];
  empfehlung: string | null;
  auflagen_aus_altfall: string[];
  risiken_aus_altfall: string[];
  begleitpflicht_in_altfall: boolean;
  polizei_in_altfall: boolean;
  nachtfahrt_in_altfall: boolean;
  erkannte_strassen_altfall: string[];
}

export interface TransportAnfrage {
  id: number;
  eingabe_typ: "formular" | "freitext" | "email" | "pdf";
  eingabe_rohtext: string | null;
  eingabe_datei_pfad: string | null;
  kunde: string | null;
  ansprechpartner: string | null;
  email: string | null;
  telefon: string | null;
  startort: string | null;
  start_adresse: string | null;
  zielort: string | null;
  ziel_adresse: string | null;
  transportgut: string | null;
  laenge_m: number | null;
  breite_m: number | null;
  hoehe_m: number | null;
  gewicht_t: number | null;
  achslast_t: number | null;
  fahrzeugtyp: string | null;
  anzahl_fahrten: number | null;
  wunschdatum: string | null;
  frist_angebot: string | null;
  besonderheiten: string[];
  fehlende_infos: string[];
  schwertransport_relevant: boolean | null;
  geschaetzte_komplexitaet: "einfach" | "mittel" | "komplex" | "sehr_komplex" | null;
  ki_einschaetzung: string | null;
  kalkulations_briefing: KalkulationsBriefing | null;
  risiko_zusammenfassung: string | null;
  auflagen_zusammenfassung: string | null;
  empfohlene_naechste_schritte: string[];
  kundenantwort_entwurf: string | null;
  status: "neu" | "in_bearbeitung" | "angebot_erstellt" | "abgeschlossen" | "storniert";
  zugewiesen_an: string | null;
  prioritaet: "niedrig" | "normal" | "hoch" | "dringend";
  interne_notizen: string | null;
  erstellt_am: string;
  aktualisiert_am: string;
  matches: AnfrageMatch[];
  match_count: number;
}

export interface AnfragenStats {
  total: number;
  neu: number;
  in_bearbeitung: number;
  dringend: number;
  diese_woche: number;
}

export interface PaginatedPermits {
  items: Permit[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface DashboardStats {
  total_permits: number;
  active_permits: number;
  expiring_soon: number;
  needs_review: number;
  expired: number;
  critical_risk: number;
}

export interface PermitSearchParams {
  q?: string;
  status?: string;
  valid_from?: string;
  valid_to?: string;
  expiring_days?: number;
  min_width?: number;
  max_width?: number;
  min_height?: number;
  min_weight?: number;
  max_weight?: number;
  start_city?: string;
  destination_city?: string;
  road?: string;
  escort_required?: boolean;
  police_required?: boolean;
  risk_level?: string;
  sort?: string;
  page?: number;
  limit?: number;
}
