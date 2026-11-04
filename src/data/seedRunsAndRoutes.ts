import { GeoPoint, RunRecord, SavedRoute, TelemetryPoint } from '../types/models';
import {
  calculateElevationMetrics,
  calculateTotalDistanceKm,
  computeSplitsFromTelemetry,
} from '../utils/geoMath';

// Default starting anchor: Sunderland Riverside / St Peter's Campus (54.9069° N, 1.3838° W)
export const DEFAULT_START_LOCATION: GeoPoint = {
  lat: 54.9069,
  lng: -1.3838,
  ele: 18,
};

function buildSeedLoopCoordinates(center: GeoPoint, radiusLat: number, radiusLng: number, count = 48): GeoPoint[] {
  const pts: GeoPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const ripple = Math.sin(angle * 3) * 0.0007;
    const lat = Number((center.lat + (Math.sin(angle) * radiusLat) + ripple).toFixed(6));
    const lng = Number((center.lng + (Math.cos(angle) * radiusLng) - ripple).toFixed(6));
    const ele = Math.round(14 + Math.sin(angle * 2) * 16 + Math.cos(angle * 3) * 6);
    pts.push({ lat, lng, ele });
  }
  return pts;
}

function buildTelemetryFromCoords(
  coords: GeoPoint[],
  startTimeEpochMs: number,
  targetAvgPaceSecPerKm = 310
): TelemetryPoint[] {
  const telemetry: TelemetryPoint[] = [];
  let cumulativeDistKm = 0;
  let elapsedSec = 0;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const dLat = ((curr.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((curr.lng - prev.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((prev.lat * Math.PI) / 180) *
          Math.cos((curr.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const segKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
      cumulativeDistKm += segKm;
      const gradeVariation = Math.sin((i / coords.length) * Math.PI * 4) * 14;
      const instantPace = Math.round(targetAvgPaceSecPerKm + gradeVariation);
      elapsedSec += Math.max(2, Math.round(segKm * instantPace));
    }

    const progress = i / Math.max(1, coords.length - 1);
    const hr = Math.round(142 + progress * 24 + Math.sin(progress * Math.PI * 6) * 5);
    const pace = Math.round(targetAvgPaceSecPerKm + Math.sin(progress * Math.PI * 4) * 15);

    telemetry.push({
      lat: coords[i].lat,
      lng: coords[i].lng,
      ele: coords[i].ele ?? 20,
      timestamp: startTimeEpochMs + elapsedSec * 1000,
      elapsedSec,
      distanceFromStartKm: Number(cumulativeDistKm.toFixed(2)),
      paceSecPerKm: pace,
      heartRate: hr,
      accuracyMeters: 4.5,
    });
  }
  return telemetry;
}

const rokerLoopCoords = buildSeedLoopCoordinates(
  { lat: 54.9145, lng: -1.3765, ele: 16 },
  0.0068,
  0.0115,
  64
);

const bridgesOutBackCoords: GeoPoint[] = (() => {
  const outbound: GeoPoint[] = [];
  const start = { lat: 54.9069, lng: -1.3838, ele: 18 };
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    outbound.push({
      lat: Number((start.lat + t * 0.0112 + Math.sin(t * Math.PI * 2) * 0.0005).toFixed(6)),
      lng: Number((start.lng + t * 0.0155).toFixed(6)),
      ele: Math.round(18 + Math.sin(t * Math.PI) * 26),
    });
  }
  const inbound = [...outbound].reverse().slice(1).map((p) => ({
    ...p,
    lat: Number((p.lat - 0.0003).toFixed(6)),
  }));
  return [...outbound, ...inbound];
})();

export const SEED_SAVED_ROUTES: SavedRoute[] = [
  {
    id: 'route-seed-1',
    userId: 'runner-local-01',
    name: 'Wearmouth Bridge & Roker Marina 5K Loop',
    shape: 'loop',
    distanceKm: calculateTotalDistanceKm(rokerLoopCoords),
    estimatedDurationSec: Math.round(calculateTotalDistanceKm(rokerLoopCoords) * 312),
    elevationGainM: calculateElevationMetrics(rokerLoopCoords).gainM,
    elevationLossM: calculateElevationMetrics(rokerLoopCoords).lossM,
    isFavourite: true,
    coordinates: rokerLoopCoords,
    waypoints: [
      rokerLoopCoords[0],
      rokerLoopCoords[16],
      rokerLoopCoords[32],
      rokerLoopCoords[48],
      rokerLoopCoords[rokerLoopCoords.length - 1],
    ],
    surfaceNote: 'Paved riverside promenade & coastal path',
    createdAt: new Date(Date.now() - 4 * 86400_000).toISOString(),
  },
  {
    id: 'route-seed-2',
    userId: 'runner-local-01',
    name: 'St Peter’s Pier Out-and-Back',
    shape: 'out-and-back',
    distanceKm: calculateTotalDistanceKm(bridgesOutBackCoords),
    estimatedDurationSec: Math.round(calculateTotalDistanceKm(bridgesOutBackCoords) * 305),
    elevationGainM: calculateElevationMetrics(bridgesOutBackCoords).gainM,
    elevationLossM: calculateElevationMetrics(bridgesOutBackCoords).lossM,
    isFavourite: true,
    coordinates: bridgesOutBackCoords,
    waypoints: [
      bridgesOutBackCoords[0],
      bridgesOutBackCoords[Math.floor(bridgesOutBackCoords.length / 2)],
      bridgesOutBackCoords[bridgesOutBackCoords.length - 1],
    ],
    surfaceNote: 'Flat fast tarmac — ideal for tempo threshold runs',
    createdAt: new Date(Date.now() - 9 * 86400_000).toISOString(),
  },
];

const run1Telemetry = buildTelemetryFromCoords(
  rokerLoopCoords,
  Date.now() - 26 * 3600_000,
  308
);
const run1Last = run1Telemetry[run1Telemetry.length - 1];

const run2Telemetry = buildTelemetryFromCoords(
  bridgesOutBackCoords,
  Date.now() - 78 * 3600_000,
  296
);
const run2Last = run2Telemetry[run2Telemetry.length - 1];

export const SEED_RUN_HISTORY: RunRecord[] = [
  {
    id: 'run-seed-1',
    userId: 'runner-local-01',
    title: 'Sunset Riverside 5K Loop',
    startedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    endedAt: new Date(Date.now() - 26 * 3600_000 + run1Last.elapsedSec * 1000).toISOString(),
    durationSec: run1Last.elapsedSec,
    distanceKm: run1Last.distanceFromStartKm,
    avgPaceSecPerKm: 308,
    bestPaceSecPerKm: 288,
    elevationGainM: calculateElevationMetrics(rokerLoopCoords).gainM,
    calories: Math.round(run1Last.distanceFromStartKm * 72 * 1.036),
    avgHeartRate: 156,
    maxHeartRate: 174,
    restingHeartRate: 54,
    cadenceSpm: 176,
    routeId: 'route-seed-1',
    routePoints: run1Telemetry,
    splits: computeSplitsFromTelemetry(run1Telemetry),
    weatherSummary: {
      tempC: 11,
      feelsLikeC: 10,
      condition: 'Dry & crisp',
      windKph: 12,
      aqi: 26,
    },
    healthSync: {
      synced: true,
      provider: 'google_health_connect',
      syncedAt: new Date(Date.now() - 25.5 * 3600_000).toISOString(),
    },
    syncedToCloud: true,
  },
  {
    id: 'run-seed-2',
    userId: 'runner-local-01',
    title: 'Morning Tempo Out-and-Back',
    startedAt: new Date(Date.now() - 78 * 3600_000).toISOString(),
    endedAt: new Date(Date.now() - 78 * 3600_000 + run2Last.elapsedSec * 1000).toISOString(),
    durationSec: run2Last.elapsedSec,
    distanceKm: run2Last.distanceFromStartKm,
    avgPaceSecPerKm: 296,
    bestPaceSecPerKm: 279,
    elevationGainM: calculateElevationMetrics(bridgesOutBackCoords).gainM,
    calories: Math.round(run2Last.distanceFromStartKm * 72 * 1.036),
    avgHeartRate: 162,
    maxHeartRate: 181,
    restingHeartRate: 53,
    cadenceSpm: 180,
    routeId: 'route-seed-2',
    routePoints: run2Telemetry,
    splits: computeSplitsFromTelemetry(run2Telemetry),
    weatherSummary: {
      tempC: 9,
      feelsLikeC: 7,
      condition: 'Partly cloudy',
      windKph: 16,
      aqi: 31,
    },
    healthSync: {
      synced: false,
      provider: null,
    },
    syncedToCloud: true,
  },
];
