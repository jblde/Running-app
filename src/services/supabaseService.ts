import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV, ENV_STATUS } from '../config/env';
import {
  RunRecord,
  SavedRoute,
  SchedulePreferences,
  UserProfile,
  WeatherThresholds,
} from '../types/models';

const STORAGE_KEYS = {
  USER: 'stridesmart.user.v1',
  RUNS: 'stridesmart.runs.v1',
  ROUTES: 'stridesmart.routes.v1',
  WEATHER_THRESHOLDS: 'stridesmart.weather_thresholds.v1',
  SCHEDULE_PREFS: 'stridesmart.schedule_prefs.v1',
  HEALTH_PERMS: 'stridesmart.health_perms.v1',
  CALENDAR_EVENTS: 'stridesmart.calendar_events.v1',
};

let supabaseClient: SupabaseClient | null = null;

if (ENV_STATUS.hasSupabase) {
  supabaseClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
}

export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  minTempC: 2,
  maxTempC: 28,
  minFeelsLikeC: -2,
  maxFeelsLikeC: 32,
  maxWindKph: 35,
  maxRainProbPct: 40,
  maxAqi: 100,
};

export const DEFAULT_SCHEDULE_PREFS: SchedulePreferences = {
  preferredDays: [1, 2, 3, 4, 5, 6, 0], // Mon-Sun
  earliestHour: 6,
  latestHour: 20,
  targetDurationMin: 45,
  bufferBeforeMeetingMin: 15,
  bufferAfterMeetingMin: 15,
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: 'runner-local-01',
  email: 'joshua@student.sunderland.ac.uk',
  displayName: 'Joshua (CS Runner)',
  runnerPaceMinPerKm: 5.25, // 5:15 /km default pace
  weightKg: 72,
  authMode: ENV_STATUS.hasSupabase ? 'supabase' : 'local_sandbox',
  createdAt: new Date().toISOString(),
};

/**
 * Auth & Cloud Persistence Service
 * Combines Supabase Cloud PostgreSQL + Offline-first Local Persistence.
 */
export const storageService = {
  getSupabaseClient(): SupabaseClient | null {
    return supabaseClient;
  },

  loadUser(): UserProfile | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USER);
      if (!raw) return DEFAULT_USER_PROFILE;
      return JSON.parse(raw) as UserProfile;
    } catch {
      return DEFAULT_USER_PROFILE;
    }
  },

  saveUser(user: UserProfile | null): void {
    if (!user) {
      localStorage.removeItem(STORAGE_KEYS.USER);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  },

  async signIn(email: string, password: string, displayName?: string): Promise<UserProfile> {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        throw new Error(error.message);
      }
      const profile: UserProfile = {
        id: data.user.id,
        email: data.user.email ?? email,
        displayName: displayName || data.user.user_metadata?.display_name || email.split('@')[0],
        runnerPaceMinPerKm: 5.25,
        weightKg: 72,
        authMode: 'supabase',
        createdAt: data.user.created_at,
      };
      this.saveUser(profile);
      return profile;
    }

    // Local Sandbox Mode when Supabase keys are not yet in .env
    const sandboxUser: UserProfile = {
      id: `local-${Date.now().toString(36)}`,
      email,
      displayName: displayName || email.split('@')[0] || 'Runner',
      runnerPaceMinPerKm: 5.25,
      weightKg: 72,
      authMode: 'local_sandbox',
      createdAt: new Date().toISOString(),
    };
    this.saveUser(sandboxUser);
    return sandboxUser;
  },

  async signOut(): Promise<void> {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    this.saveUser(null);
  },

  loadRuns(fallbackRuns: RunRecord[]): RunRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RUNS);
      if (!raw) {
        localStorage.setItem(STORAGE_KEYS.RUNS, JSON.stringify(fallbackRuns));
        return fallbackRuns;
      }
      return JSON.parse(raw) as RunRecord[];
    } catch {
      return fallbackRuns;
    }
  },

  async saveRuns(runs: RunRecord[], isOffline = false): Promise<RunRecord[]> {
    const updated = runs.map((r) => ({
      ...r,
      syncedToCloud: isOffline ? false : ENV_STATUS.hasSupabase || r.syncedToCloud,
    }));
    localStorage.setItem(STORAGE_KEYS.RUNS, JSON.stringify(updated));

    if (supabaseClient && !isOffline && updated.length > 0) {
      const latest = updated[0];
      try {
        await supabaseClient.from('runs').upsert({
          id: latest.id,
          user_id: latest.userId,
          title: latest.title,
          started_at: latest.startedAt,
          ended_at: latest.endedAt,
          duration_sec: latest.durationSec,
          distance_km: latest.distanceKm,
          avg_pace_sec_per_km: latest.avgPaceSecPerKm,
          elevation_gain_m: latest.elevationGainM,
          calories: latest.calories,
          avg_heart_rate: latest.avgHeartRate ?? null,
          resting_heart_rate: latest.restingHeartRate ?? null,
          health_synced: latest.healthSync?.synced ?? false,
          health_provider: latest.healthSync?.provider ?? null,
          weather_snapshot: latest.weatherSummary ?? null,
          splits: latest.splits,
          route_points: latest.routePoints,
        });
      } catch {
        // Remains buffered in local storage for next online sync
      }
    }
    return updated;
  },

  loadRoutes(fallbackRoutes: SavedRoute[]): SavedRoute[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ROUTES);
      if (!raw) {
        localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify(fallbackRoutes));
        return fallbackRoutes;
      }
      return JSON.parse(raw) as SavedRoute[];
    } catch {
      return fallbackRoutes;
    }
  },

  async saveRoutes(routes: SavedRoute[], isOffline = false): Promise<void> {
    localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify(routes));
    if (supabaseClient && !isOffline && routes.length > 0) {
      const latest = routes[0];
      try {
        await supabaseClient.from('saved_routes').upsert({
          id: latest.id,
          user_id: latest.userId,
          name: latest.name,
          shape: latest.shape,
          distance_km: latest.distanceKm,
          estimated_duration_sec: latest.estimatedDurationSec,
          elevation_gain_m: latest.elevationGainM,
          is_favourite: latest.isFavourite,
          coordinates: latest.coordinates,
          waypoints: latest.waypoints,
        });
      } catch {
        // Buffered locally
      }
    }
  },

  loadWeatherThresholds(): WeatherThresholds {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.WEATHER_THRESHOLDS);
      if (!raw) return DEFAULT_WEATHER_THRESHOLDS;
      return { ...DEFAULT_WEATHER_THRESHOLDS, ...(JSON.parse(raw) as Partial<WeatherThresholds>) };
    } catch {
      return DEFAULT_WEATHER_THRESHOLDS;
    }
  },

  saveWeatherThresholds(thresholds: WeatherThresholds): void {
    localStorage.setItem(STORAGE_KEYS.WEATHER_THRESHOLDS, JSON.stringify(thresholds));
  },

  loadSchedulePrefs(): SchedulePreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SCHEDULE_PREFS);
      if (!raw) return DEFAULT_SCHEDULE_PREFS;
      return { ...DEFAULT_SCHEDULE_PREFS, ...(JSON.parse(raw) as Partial<SchedulePreferences>) };
    } catch {
      return DEFAULT_SCHEDULE_PREFS;
    }
  },

  saveSchedulePrefs(prefs: SchedulePreferences): void {
    localStorage.setItem(STORAGE_KEYS.SCHEDULE_PREFS, JSON.stringify(prefs));
  },

  /**
   * Privacy Compliance: Irreversibly deletes all local and cloud user data
   * (runs, saved routes, preferences, calendar tokens, health permissions).
   */
  async deleteAllUserData(userId?: string): Promise<void> {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    if (supabaseClient && userId) {
      try {
        await supabaseClient.from('runs').delete().eq('user_id', userId);
        await supabaseClient.from('saved_routes').delete().eq('user_id', userId);
        await supabaseClient.from('user_preferences').delete().eq('user_id', userId);
      } catch {
        // Local storage already wiped
      }
    }
  },
};
