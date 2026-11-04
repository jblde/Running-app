import { GeoPoint, RunSplit, TelemetryPoint } from '../types/models';

const EARTH_RADIUS_KM = 6371.0088;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Haversine Formula: Calculates great-circle distance (in km) between two GPS points.
 * CS Note: Accounts for Earth's spherical curvature rather than flat Euclidean distance.
 */
export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Total polyline distance in kilometers across an ordered array of coordinates.
 */
export function calculateTotalDistanceKm(points: GeoPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceKm(points[i - 1], points[i]);
  }
  return Number(total.toFixed(2));
}

/**
 * Forward Spherical Projection:
 * Given a starting coordinate, compass bearing (degrees, 0 = North, 90 = East),
 * and distance in km, computes the destination coordinate.
 */
export function projectCoordinate(
  origin: GeoPoint,
  bearingDeg: number,
  distanceKm: number
): GeoPoint {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearingRad = toRadians(bearingDeg);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAd = Math.sin(angularDistance);
  const cosAd = Math.cos(angularDistance);

  const lat2 = Math.asin(
    sinLat1 * cosAd + cosLat1 * sinAd * Math.cos(bearingRad)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * sinAd * cosLat1,
      cosAd - sinLat1 * Math.sin(lat2)
    );

  return {
    lat: Number(toDegrees(lat2).toFixed(6)),
    lng: Number(toDegrees(lng2).toFixed(6)),
    ele: origin.ele,
  };
}

/**
 * Computes positive and negative elevation change (in meters) across a coordinate array.
 */
export function calculateElevationMetrics(points: GeoPoint[]): {
  gainM: number;
  lossM: number;
} {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    const prevEle = points[i - 1].ele ?? 0;
    const currEle = points[i].ele ?? 0;
    const diff = currEle - prevEle;
    if (diff > 0.4) gain += diff;
    if (diff < -0.4) loss += Math.abs(diff);
  }
  return {
    gainM: Math.round(gain),
    lossM: Math.round(loss),
  };
}

/**
 * Formats pace (seconds per km) into "M:SS /km" (e.g., 315 -> "5:15").
 */
export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) {
    return '--:--';
  }
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats duration in seconds into "HH:MM:SS" or "MM:SS".
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Computes per-kilometer splits from a telemetry array.
 */
export function computeSplitsFromTelemetry(points: TelemetryPoint[]): RunSplit[] {
  if (points.length < 2) return [];
  const splits: RunSplit[] = [];
  let targetKm = 1;
  let splitStartIdx = 0;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartKm >= targetKm) {
      const startPt = points[splitStartIdx];
      const endPt = points[i];
      const durationSec = Math.max(1, endPt.elapsedSec - startPt.elapsedSec);
      const distChunk = Math.max(0.1, endPt.distanceFromStartKm - startPt.distanceFromStartKm);
      const paceSecPerKm = Math.round(durationSec / distChunk);
      const eleDiff = Math.round((endPt.ele ?? 0) - (startPt.ele ?? 0));

      let hrSum = 0;
      let hrCount = 0;
      for (let j = splitStartIdx; j <= i; j++) {
        if (points[j].heartRate) {
          hrSum += points[j].heartRate!;
          hrCount++;
        }
      }

      splits.push({
        kilometer: targetKm,
        durationSec,
        paceSecPerKm,
        elevationDiffM: eleDiff,
        avgHeartRate: hrCount > 0 ? Math.round(hrSum / hrCount) : undefined,
      });

      targetKm += 1;
      splitStartIdx = i;
    }
  }
  return splits;
}

/**
 * Linear interpolation along a recorded GPS telemetry stream for smooth 60fps Run Replay.
 * Given a target elapsed time in seconds, returns the exact interpolated position & telemetry.
 */
export function interpolateReplayPoint(
  points: TelemetryPoint[],
  targetElapsedSec: number
): TelemetryPoint | null {
  if (points.length === 0) return null;
  if (points.length === 1 || targetElapsedSec <= points[0].elapsedSec) {
    return points[0];
  }
  const last = points[points.length - 1];
  if (targetElapsedSec >= last.elapsedSec) {
    return last;
  }

  // Binary search for the segment containing targetElapsedSec (O(log N))
  let low = 0;
  let high = points.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (points[mid].elapsedSec <= targetElapsedSec) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const p0 = points[low];
  const p1 = points[high];
  const span = Math.max(0.001, p1.elapsedSec - p0.elapsedSec);
  const ratio = Math.min(1, Math.max(0, (targetElapsedSec - p0.elapsedSec) / span));

  return {
    lat: p0.lat + (p1.lat - p0.lat) * ratio,
    lng: p0.lng + (p1.lng - p0.lng) * ratio,
    ele: Math.round((p0.ele ?? 35) + ((p1.ele ?? 35) - (p0.ele ?? 35)) * ratio),
    timestamp: Math.round(p0.timestamp + (p1.timestamp - p0.timestamp) * ratio),
    elapsedSec: targetElapsedSec,
    distanceFromStartKm: Number(
      (p0.distanceFromStartKm + (p1.distanceFromStartKm - p0.distanceFromStartKm) * ratio).toFixed(2)
    ),
    paceSecPerKm: Math.round(p0.paceSecPerKm + (p1.paceSecPerKm - p0.paceSecPerKm) * ratio),
    heartRate:
      p0.heartRate && p1.heartRate
        ? Math.round(p0.heartRate + (p1.heartRate - p0.heartRate) * ratio)
        : p0.heartRate,
  };
}
