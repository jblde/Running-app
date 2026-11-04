import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatPace,
  haversineDistanceKm,
  interpolateReplayPoint,
  projectCoordinate,
} from '../utils/geoMath';
import { buildGeometricWaypoints } from '../services/routeGeneratorService';
import { evaluateHourlyWeatherSafety } from '../services/weatherService';
import { DEFAULT_SCHEDULE_PREFS, DEFAULT_WEATHER_THRESHOLDS } from '../services/supabaseService';
import {
  computeSmartRunRecommendations,
  findConflictingCalendarEvent,
} from '../services/calendarAndCoachService';
import { CalendarEvent, TelemetryPoint } from '../types/models';

describe('StrideSmart Core CS Algorithms & Domain Logic', () => {
  it('computes accurate great-circle Haversine distance and forward projection', () => {
    const start = { lat: 54.9069, lng: -1.3838 };
    const projectedNorth2Km = projectCoordinate(start, 0, 2.0);
    const dist = haversineDistanceKm(start, projectedNorth2Km);
    expect(dist).toBeGreaterThan(1.98);
    expect(dist).toBeLessThan(2.02);
  });

  it('synthesizes closed loop and out-and-back waypoints starting and ending at origin', () => {
    const origin = { lat: 54.9069, lng: -1.3838 };
    const loopWps = buildGeometricWaypoints(origin, 5.0, 'loop', 90);
    expect(loopWps.length).toBe(6);
    expect(loopWps[0]).toEqual(origin);
    expect(loopWps[loopWps.length - 1]).toEqual(origin);

    const outBackWps = buildGeometricWaypoints(origin, 5.0, 'out-and-back', 180);
    expect(outBackWps.length).toBe(4);
    expect(outBackWps[0]).toEqual(origin);
    expect(outBackWps[outBackWps.length - 1]).toEqual(origin);
  });

  it('interpolates GPS telemetry smoothly at arbitrary replay timestamps', () => {
    const pts: TelemetryPoint[] = [
      {
        lat: 54.9,
        lng: -1.38,
        ele: 10,
        timestamp: 1000,
        elapsedSec: 0,
        distanceFromStartKm: 0,
        paceSecPerKm: 300,
        heartRate: 140,
      },
      {
        lat: 54.91,
        lng: -1.39,
        ele: 30,
        timestamp: 101000,
        elapsedSec: 100,
        distanceFromStartKm: 0.5,
        paceSecPerKm: 320,
        heartRate: 160,
      },
    ];

    const mid = interpolateReplayPoint(pts, 50);
    expect(mid).not.toBeNull();
    expect(mid!.lat).toBeCloseTo(54.905, 5);
    expect(mid!.ele).toBe(20);
    expect(mid!.heartRate).toBe(150);
    expect(mid!.distanceFromStartKm).toBeCloseTo(0.25, 2);
  });

  it('flags unsafe cold, heat, wind, rain, and AQI conditions based on user thresholds', () => {
    const coldHour = evaluateHourlyWeatherSafety(
      {
        isoTime: new Date().toISOString(),
        tempC: -1,
        feelsLikeC: -5,
        precipProbPct: 10,
        precipMm: 0,
        windSpeedKph: 42,
        windGustKph: 55,
        humidityPct: 70,
        uvIndex: 1,
        aqi: 125,
        pm25: 35,
        conditionLabel: 'Freezing & Windy',
        weatherCode: 3,
      },
      DEFAULT_WEATHER_THRESHOLDS
    );

    const flagTypes = coldHour.flags.map((f) => f.type);
    expect(flagTypes).toContain('too_cold');
    expect(flagTypes).toContain('high_wind');
    expect(flagTypes).toContain('poor_aqi');
    expect(coldHour.isSafe).toBe(false);
  });

  it('detects Google Calendar conflicts including pre/post-meeting buffer gaps and suggests next-best slot', () => {
    const baseDay = new Date('2026-11-04T15:00:00.000Z');
    const slot15 = new Date(baseDay);
    const slot16 = new Date(baseDay.getTime() + 3600_000);
    const slot17 = new Date(baseDay.getTime() + 2 * 3600_000);

    const events: CalendarEvent[] = [
      {
        id: 'evt-clash',
        title: 'CS Lecture',
        startIso: slot15.toISOString(),
        endIso: slot16.toISOString(),
        source: 'google_oauth',
      },
    ];

    // A run starting at 16:05 violates the 15-minute post-meeting buffer after 16:00!
    const clashAt1605 = findConflictingCalendarEvent(
      slot16.getTime() + 5 * 60_000,
      slot16.getTime() + 50 * 60_000,
      events,
      DEFAULT_SCHEDULE_PREFS
    );
    expect(clashAt1605?.id).toBe('evt-clash');

    // A run starting at 16:30 respects the 15-minute post-meeting buffer!
    const freeAt1630 = findConflictingCalendarEvent(
      slot16.getTime() + 30 * 60_000,
      slot16.getTime() + 75 * 60_000,
      events,
      DEFAULT_SCHEDULE_PREFS
    );
    expect(freeAt1630).toBeUndefined();

    // Verify smart recommendation ranks free slot as best_overall and flags busy slot
    const hours = [slot15, slot16, slot17].map((d) =>
      evaluateHourlyWeatherSafety(
        {
          isoTime: d.toISOString(),
          tempC: 12,
          feelsLikeC: 11,
          precipProbPct: 5,
          precipMm: 0,
          windSpeedKph: 10,
          windGustKph: 14,
          humidityPct: 60,
          uvIndex: 2,
          aqi: 25,
          pm25: 6,
          conditionLabel: 'Dry',
          weatherCode: 1,
        },
        DEFAULT_WEATHER_THRESHOLDS
      )
    );

    const recs = computeSmartRunRecommendations(
      hours,
      events,
      { ...DEFAULT_SCHEDULE_PREFS, earliestHour: 0, latestHour: 23 },
      true
    );

    expect(recs.some((r) => r.rank === 'best_overall' && !r.hasConflict)).toBe(true);
    expect(recs.some((r) => r.rank === 'weather_best_but_busy' && r.hasConflict)).toBe(true);
  });

  it('formats pace and duration strings cleanly', () => {
    expect(formatPace(315)).toBe('5:15');
    expect(formatDuration(3665)).toBe('1:01:05');
  });
});
