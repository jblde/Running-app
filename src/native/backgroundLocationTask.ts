/**
 * Native Mobile Background GPS Task (Expo Location + TaskManager)
 * ----------------------------------------------------------------------------
 * CS Architecture Note:
 * On iOS and Android, when the user locks their screen or switches to Spotify,
 * the foreground JS thread may be suspended by the OS scheduler.
 * Registering a top-level background task with `expo-task-manager` instructs
 * iOS (`UIBackgroundModes: ['location']`) and Android (`FOREGROUND_SERVICE_LOCATION`)
 * to wake up the task and append filtered GPS coordinates to our run buffer.
 */

export const BACKGROUND_RUN_LOCATION_TASK = 'STRIDESMART_BACKGROUND_GPS_TASK';

export interface NativeLocationSample {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number | null;
    speed: number | null;
  };
  timestamp: number;
}

/**
 * Kalman / Accuracy Gate Filter:
 * Rejects noisy GPS jumps (e.g., multipath reflection between tall buildings)
 * where horizontal uncertainty exceeds 25 meters.
 */
export function isReliableGpsSample(sample: NativeLocationSample, maxAccuracyMeters = 25): boolean {
  if (sample.coords.accuracy !== null && sample.coords.accuracy > maxAccuracyMeters) {
    return false;
  }
  return (
    Number.isFinite(sample.coords.latitude) &&
    Number.isFinite(sample.coords.longitude)
  );
}
