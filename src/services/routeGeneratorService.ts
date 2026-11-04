import { GeoPoint, RouteShape } from '../types/models';
import {
  calculateElevationMetrics,
  calculateTotalDistanceKm,
  projectCoordinate,
} from '../utils/geoMath';

/**
 * Empirical road-network winding factor (tortuosity).
 * Real pedestrian streets and trails wind ~1.25x longer than straight-line Euclidean chords.
 */
const ROAD_WINDING_FACTOR = 1.25;

export interface GeneratedRouteResult {
  shape: RouteShape;
  waypoints: GeoPoint[];
  coordinates: GeoPoint[];
  distanceKm: number;
  estimatedDurationSec: number;
  elevationGainM: number;
  elevationLossM: number;
  usedLiveRouter: boolean;
}

/**
 * Synthesizes geometric waypoints from a starting location, target distance (km),
 * shape ('loop' or 'out-and-back'), and initial compass heading (degrees).
 */
export function buildGeometricWaypoints(
  start: GeoPoint,
  targetDistanceKm: number,
  shape: RouteShape,
  headingDeg = 45
): GeoPoint[] {
  if (shape === 'out-and-back') {
    // Out-and-back reaches a turnaround point at half the target distance,
    // scaled down by the road winding factor so road routing lands near targetDistanceKm.
    const turnaroundLegKm = Math.max(0.3, targetDistanceKm / (2 * ROAD_WINDING_FACTOR));
    const midOut = projectCoordinate(start, headingDeg, turnaroundLegKm * 0.5);
    const turnaround = projectCoordinate(start, headingDeg, turnaroundLegKm);
    return [start, midOut, turnaround, start];
  }

  // Loop Shape:
  // Imagine a circle of circumference C = targetDistanceKm / ROAD_WINDING_FACTOR
  // whose rim passes directly through `start`.
  // The circle's center sits at distance R = C / (2 * PI) along `headingDeg`.
  const effectiveCircumference = Math.max(0.8, targetDistanceKm / ROAD_WINDING_FACTOR);
  const radiusKm = effectiveCircumference / (2 * Math.PI);
  const center = projectCoordinate(start, headingDeg, radiusKm);

  // Sample 5 waypoints around the circle starting and ending at `start`
  const reverseBearing = (headingDeg + 180) % 360;
  const wp1 = projectCoordinate(center, (reverseBearing + 72) % 360, radiusKm);
  const wp2 = projectCoordinate(center, (reverseBearing + 144) % 360, radiusKm);
  const wp3 = projectCoordinate(center, (reverseBearing + 216) % 360, radiusKm);
  const wp4 = projectCoordinate(center, (reverseBearing + 288) % 360, radiusKm);

  return [start, wp1, wp2, wp3, wp4, start];
}

/**
 * Adds realistic terrain elevation profile to a coordinate path when offline
 * or before enriching with the Open-Meteo Digital Elevation Model API.
 */
function applySyntheticElevation(points: GeoPoint[], baseEle = 42): GeoPoint[] {
  return points.map((pt, idx) => {
    const progress = idx / Math.max(1, points.length - 1);
    const hillWave =
      Math.sin(progress * Math.PI * 2) * 14 +
      Math.cos(progress * Math.PI * 5) * 5;
    return {
      ...pt,
      ele: Math.round(baseEle + hillWave),
    };
  });
}

/**
 * Fetches real terrain elevation (meters above sea level) from Open-Meteo Elevation API.
 */
async function enrichWithOpenMeteoElevation(points: GeoPoint[]): Promise<GeoPoint[]> {
  if (points.length === 0) return points;
  try {
    // Sample up to 60 coordinates to stay well within URL query limits
    const step = Math.max(1, Math.floor(points.length / 55));
    const sampledIndices: number[] = [];
    for (let i = 0; i < points.length; i += step) {
      sampledIndices.push(i);
    }
    if (sampledIndices[sampledIndices.length - 1] !== points.length - 1) {
      sampledIndices.push(points.length - 1);
    }

    const lats = sampledIndices.map((idx) => points[idx].lat.toFixed(5)).join(',');
    const lngs = sampledIndices.map((idx) => points[idx].lng.toFixed(5)).join(',');

    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`
    );
    if (!res.ok) return applySyntheticElevation(points);

    const data = (await res.json()) as { elevation?: number[] };
    if (!data.elevation || data.elevation.length !== sampledIndices.length) {
      return applySyntheticElevation(points);
    }

    // Interpolate elevation across all dense coordinates
    const enriched = points.map((pt) => ({ ...pt }));
    for (let s = 0; s < sampledIndices.length - 1; s++) {
      const i0 = sampledIndices[s];
      const i1 = sampledIndices[s + 1];
      const e0 = data.elevation[s];
      const e1 = data.elevation[s + 1];
      for (let k = i0; k <= i1; k++) {
        const ratio = i1 === i0 ? 0 : (k - i0) / (i1 - i0);
        enriched[k].ele = Math.round(e0 + (e1 - e0) * ratio);
      }
    }
    return enriched;
  } catch {
    return applySyntheticElevation(points);
  }
}

/**
 * Generates a realistic dense path between waypoints when offline or if OSRM is unreachable.
 */
function buildOfflineDensePath(waypoints: GeoPoint[], shape: RouteShape): GeoPoint[] {
  if (waypoints.length < 2) return waypoints;
  const dense: GeoPoint[] = [];

  if (shape === 'out-and-back' && waypoints.length >= 3) {
    // Route out to turnaround and retrace back with micro street-grid offsets
    const outboundWaypoints = waypoints.slice(0, waypoints.length - 1);
    const outboundDense: GeoPoint[] = [];
    for (let i = 0; i < outboundWaypoints.length - 1; i++) {
      const a = outboundWaypoints[i];
      const b = outboundWaypoints[i + 1];
      const steps = 16;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const jitter = Math.sin(t * Math.PI * 2) * 0.00022;
        outboundDense.push({
          lat: Number((a.lat + (b.lat - a.lat) * t + jitter).toFixed(6)),
          lng: Number((a.lng + (b.lng - a.lng) * t - jitter).toFixed(6)),
        });
      }
    }
    outboundDense.push(outboundWaypoints[outboundWaypoints.length - 1]);
    const inboundDense = [...outboundDense].reverse().slice(1);
    return applySyntheticElevation([...outboundDense, ...inboundDense]);
  }

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const steps = 14;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const curve = Math.sin(t * Math.PI) * 0.00028 * (i % 2 === 0 ? 1 : -1);
      dense.push({
        lat: Number((a.lat + (b.lat - a.lat) * t + curve).toFixed(6)),
        lng: Number((a.lng + (b.lng - a.lng) * t - curve).toFixed(6)),
      });
    }
  }
  dense.push(waypoints[waypoints.length - 1]);
  return applySyntheticElevation(dense);
}

/**
 * Snaps waypoints to pedestrian footpaths/streets via OSRM Foot Routing API,
 * or falls back gracefully to deterministic local path generation when offline.
 */
export async function routeThroughWaypoints(
  waypoints: GeoPoint[],
  shape: RouteShape,
  runnerPaceMinPerKm = 5.25,
  forceOffline = false
): Promise<GeneratedRouteResult> {
  if (waypoints.length < 2) {
    return {
      shape,
      waypoints,
      coordinates: waypoints,
      distanceKm: 0,
      estimatedDurationSec: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      usedLiveRouter: false,
    };
  }

  if (!forceOffline) {
    try {
      const coordQuery = waypoints.map((p) => `${p.lng},${p.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/foot/${coordQuery}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      if (response.ok) {
        const json = (await response.json()) as {
          routes?: Array<{
            distance: number;
            geometry: { coordinates: [number, number][] };
          }>;
        };
        const route = json.routes?.[0];
        if (route && route.geometry.coordinates.length > 1) {
          const rawCoords: GeoPoint[] = route.geometry.coordinates.map(([lng, lat]) => ({
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
          }));
          const withElevation = await enrichWithOpenMeteoElevation(rawCoords);
          const distanceKm = Number((route.distance / 1000).toFixed(2));
          const { gainM, lossM } = calculateElevationMetrics(withElevation);
          // Grade-Adjusted Pace estimation: +8 sec per 10m of elevation gain
          const estimatedDurationSec = Math.round(
            distanceKm * runnerPaceMinPerKm * 60 + (gainM / 10) * 8
          );
          return {
            shape,
            waypoints,
            coordinates: withElevation,
            distanceKm,
            estimatedDurationSec,
            elevationGainM: gainM,
            elevationLossM: lossM,
            usedLiveRouter: true,
          };
        }
      }
    } catch {
      // Fall through to offline path builder
    }
  }

  const fallbackCoords = buildOfflineDensePath(waypoints, shape);
  const distanceKm = calculateTotalDistanceKm(fallbackCoords);
  const { gainM, lossM } = calculateElevationMetrics(fallbackCoords);
  const estimatedDurationSec = Math.round(
    distanceKm * runnerPaceMinPerKm * 60 + (gainM / 10) * 8
  );

  return {
    shape,
    waypoints,
    coordinates: fallbackCoords,
    distanceKm,
    estimatedDurationSec,
    elevationGainM: gainM,
    elevationLossM: lossM,
    usedLiveRouter: false,
  };
}

/**
 * Generates a Loop or Out-and-Back route for a target distance (e.g., 5 km)
 * and compass heading from the user's current location.
 */
export async function generateSmartRoute(
  start: GeoPoint,
  targetDistanceKm: number,
  shape: 'loop' | 'out-and-back',
  headingDeg: number,
  runnerPaceMinPerKm: number,
  forceOffline = false
): Promise<GeneratedRouteResult> {
  const waypoints = buildGeometricWaypoints(start, targetDistanceKm, shape, headingDeg);
  return routeThroughWaypoints(waypoints, shape, runnerPaceMinPerKm, forceOffline);
}
