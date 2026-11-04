export type RouteShape = 'loop' | 'out-and-back' | 'custom';

export interface GeoPoint {
  lat: number;
  lng: number;
  ele?: number; // Elevation in meters above sea level
}

export interface TelemetryPoint extends GeoPoint {
  timestamp: number; // Epoch ms
  elapsedSec: number;
  distanceFromStartKm: number;
  paceSecPerKm: number;
  heartRate?: number;
  accuracyMeters?: number;
}

export interface RunSplit {
  kilometer: number;
  durationSec: number;
  paceSecPerKm: number;
  elevationDiffM: number;
  avgHeartRate?: number;
}

export interface SavedRoute {
  id: string;
  userId: string;
  name: string;
  shape: RouteShape;
  distanceKm: number;
  estimatedDurationSec: number;
  elevationGainM: number;
  elevationLossM: number;
  isFavourite: boolean;
  coordinates: GeoPoint[];
  waypoints: GeoPoint[];
  surfaceNote?: string;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  userId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  distanceKm: number;
  avgPaceSecPerKm: number;
  bestPaceSecPerKm: number;
  elevationGainM: number;
  calories: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  restingHeartRate?: number;
  cadenceSpm?: number;
  routeId?: string;
  routePoints: TelemetryPoint[];
  splits: RunSplit[];
  weatherSummary?: {
    tempC: number;
    feelsLikeC: number;
    condition: string;
    windKph: number;
    aqi: number;
  };
  healthSync?: {
    synced: boolean;
    provider: 'apple_healthkit' | 'google_health_connect' | null;
    syncedAt?: string;
  };
  syncedToCloud: boolean;
}

export interface WeatherThresholds {
  minTempC: number;
  maxTempC: number;
  minFeelsLikeC: number;
  maxFeelsLikeC: number;
  maxWindKph: number;
  maxRainProbPct: number;
  maxAqi: number;
}

export interface WeatherFlag {
  type: 'too_cold' | 'too_hot' | 'high_wind' | 'rain_risk' | 'poor_aqi';
  severity: 'warning' | 'unsafe';
  label: string;
  detail: string;
}

export interface HourlyWeather {
  isoTime: string;
  tempC: number;
  feelsLikeC: number;
  precipProbPct: number;
  precipMm: number;
  windSpeedKph: number;
  windGustKph: number;
  humidityPct: number;
  uvIndex: number;
  aqi: number;
  pm25: number;
  conditionLabel: string;
  weatherCode: number;
  safetyScore: number; // 0 to 100
  flags: WeatherFlag[];
  isSafe: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  location?: string;
  source: 'google_oauth' | 'demo_calendar';
}

export interface SchedulePreferences {
  preferredDays: number[]; // 0=Sun .. 6=Sat
  earliestHour: number; // e.g., 6 (06:00)
  latestHour: number; // e.g., 20 (20:00)
  targetDurationMin: number; // e.g., 45 min
  bufferBeforeMeetingMin: number; // e.g., 15 min
  bufferAfterMeetingMin: number; // e.g., 15 min
}

export interface RunWindowRecommendation {
  id: string;
  startIso: string;
  endIso: string;
  freeUntilIso: string;
  dayLabel: string;
  timeRangeLabel: string;
  weather: HourlyWeather;
  combinedScore: number; // 0 to 100
  hasConflict: boolean;
  conflictingEvent?: CalendarEvent;
  conflictExplanation?: string;
  notificationPreview: string;
  rank: 'best_overall' | 'weather_best_but_busy' | 'next_best_free' | 'alternative';
}

export interface HealthPermissionState {
  platform: 'ios_healthkit' | 'android_health_connect';
  connected: boolean;
  writeWorkoutsGranted: boolean;
  writeRouteGranted: boolean;
  readHeartRateGranted: boolean;
  readRestingHrGranted: boolean;
  lastSyncedAt?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  runnerPaceMinPerKm: number; // Used to estimate route completion time (e.g., 5.5 = 5:30/km)
  weightKg: number; // Used for MET calorie calculation
  authMode: 'supabase' | 'local_sandbox';
  createdAt: string;
}

export interface EdgeCaseSimulationState {
  gpsSignalLost: boolean;
  lowGpsAccuracy: boolean;
  offlineMode: boolean;
  calendarPermissionDenied: boolean;
  weatherApiDown: boolean;
}

export type AppTab = 'track' | 'routes' | 'coach' | 'history' | 'settings';
