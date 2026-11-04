import { ENV, ENV_STATUS } from '../config/env';
import {
  CalendarEvent,
  HourlyWeather,
  RunWindowRecommendation,
  SchedulePreferences,
} from '../types/models';

const CALENDAR_STORAGE_KEY = 'stridesmart.calendar_events.v1';

/**
 * Generates realistic default Google Calendar events anchored to today & tomorrow
 * so conflict detection, pre/post meeting buffers, and "free until 6pm" notifications
 * can be demonstrated immediately.
 */
export function buildDefaultCalendarEvents(): CalendarEvent[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 3600_000);

  const makeIso = (base: Date, hour: number, minute = 0) => {
    const d = new Date(base);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  return [
    {
      id: 'cal-evt-1',
      title: 'CS304 Mobile Systems & Algorithms Lecture',
      startIso: makeIso(today, 14, 30), // 2:30 PM - 4:00 PM (clashes with 3:00 PM sunny slot!)
      endIso: makeIso(today, 16, 0),
      location: 'David Goldman Informatics Centre',
      source: 'google_oauth',
    },
    {
      id: 'cal-evt-2',
      title: 'Project Group Sync & Code Review',
      startIso: makeIso(today, 18, 0), // 6:00 PM - 7:00 PM (creates a 4:15 PM - 6:00 PM free window!)
      endIso: makeIso(today, 19, 0),
      location: 'Google Meet',
      source: 'google_oauth',
    },
    {
      id: 'cal-evt-3',
      title: 'Database Systems Lab Session',
      startIso: makeIso(tomorrow, 10, 0),
      endIso: makeIso(tomorrow, 12, 0),
      location: 'Lab 204',
      source: 'google_oauth',
    },
    {
      id: 'cal-evt-4',
      title: 'Dissertation Supervisor Check-in',
      startIso: makeIso(tomorrow, 15, 0),
      endIso: makeIso(tomorrow, 16, 0),
      location: 'Room 312',
      source: 'google_oauth',
    },
  ];
}

export function loadSavedCalendarEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(CALENDAR_STORAGE_KEY);
    if (!raw) {
      const defaults = buildDefaultCalendarEvents();
      localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    return JSON.parse(raw) as CalendarEvent[];
  } catch {
    return buildDefaultCalendarEvents();
  }
}

export function saveCalendarEvents(events: CalendarEvent[]): void {
  localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events));
}

/**
 * Fetches live Google Calendar events using an OAuth 2.0 Bearer token
 * with least-privilege scope: `https://www.googleapis.com/auth/calendar.readonly`
 */
export async function fetchGoogleCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
    timeMin
  )}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Google Calendar API returned ${res.status}`);
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };

  return (data.items ?? [])
    .filter((item) => Boolean(item.start?.dateTime && item.end?.dateTime))
    .map((item) => ({
      id: item.id,
      title: item.summary || 'Busy Event',
      startIso: item.start!.dateTime!,
      endIso: item.end!.dateTime!,
      location: item.location,
      source: 'google_oauth' as const,
    }));
}

export function getGoogleOAuthAuthorizeUrl(): string | null {
  if (!ENV_STATUS.hasGoogleOAuth) return null;
  const redirectUri = window.location.origin;
  const scope = 'https://www.googleapis.com/auth/calendar.readonly';
  return (
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(ENV.GOOGLE_OAUTH_CLIENT_ID_WEB)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(scope)}` +
    `&include_granted_scopes=true`
  );
}

function formatShortTime(date: Date): string {
  const hours24 = date.getHours();
  const mins = date.getMinutes();
  const period = hours24 >= 12 ? 'pm' : 'am';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  if (mins === 0) return `${hours12}${period}`;
  return `${hours12}:${mins.toString().padStart(2, '0')}${period}`;
}

function formatDayBadge(date: Date): string {
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (date.toDateString() === todayStr) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Checks whether a candidate run window [runStartMs, runEndMs] overlaps with any
 * calendar event when padded by [bufferAfterMeetingMin, bufferBeforeMeetingMin].
 */
export function findConflictingCalendarEvent(
  runStartMs: number,
  runEndMs: number,
  events: CalendarEvent[],
  prefs: SchedulePreferences
): CalendarEvent | undefined {
  const preMeetingBufferMs = prefs.bufferBeforeMeetingMin * 60_000;
  const postMeetingBufferMs = prefs.bufferAfterMeetingMin * 60_000;

  return events.find((evt) => {
    const evtStartMs = new Date(evt.startIso).getTime() - preMeetingBufferMs;
    const evtEndMs = new Date(evt.endIso).getTime() + postMeetingBufferMs;
    return runStartMs < evtEndMs && runEndMs > evtStartMs;
  });
}

/**
 * Computes when the user's next calendar commitment starts after `runStartMs`.
 */
function findFreeUntilIso(
  runStartMs: number,
  events: CalendarEvent[],
  prefs: SchedulePreferences
): string {
  const upcoming = events
    .map((e) => new Date(e.startIso).getTime())
    .filter((startMs) => startMs > runStartMs)
    .sort((a, b) => a - b);

  if (upcoming.length > 0) {
    return new Date(upcoming[0]).toISOString();
  }

  const endOfWindow = new Date(runStartMs);
  endOfWindow.setHours(prefs.latestHour, 0, 0, 0);
  return endOfWindow.toISOString();
}

/**
 * Core Smart Recommendation Engine (Phase 6):
 * Combines 72-hour weather safety scores with Google Calendar events, preferred run hours,
 * and pre/post-meeting buffer gaps to rank the best running slots and surface conflicts.
 */
export function computeSmartRunRecommendations(
  forecastHours: HourlyWeather[],
  calendarEvents: CalendarEvent[],
  prefs: SchedulePreferences,
  calendarConnected = true
): RunWindowRecommendation[] {
  if (forecastHours.length === 0) return [];

  const activeEvents = calendarConnected ? calendarEvents : [];
  const runDurationMs = prefs.targetDurationMin * 60_000;
  const candidates: RunWindowRecommendation[] = [];

  for (const hourWeather of forecastHours) {
    const slotHourDate = new Date(hourWeather.isoTime);
    const dayOfWeek = slotHourDate.getDay();
    const hourOfDay = slotHourDate.getHours();

    // Respect user's preferred days and earliest/latest run hours
    if (!prefs.preferredDays.includes(dayOfWeek)) continue;
    if (hourOfDay < prefs.earliestHour || hourOfDay >= prefs.latestHour) continue;

    // Evaluate both on-the-hour (e.g. 16:00) and half-past (e.g. 16:30) if a meeting ends at :00
    for (const minuteOffset of [0, 30]) {
      const candidateStart = new Date(slotHourDate);
      candidateStart.setMinutes(minuteOffset, 0, 0);
      const startMs = candidateStart.getTime();
      const endMs = startMs + runDurationMs;

      const conflict = findConflictingCalendarEvent(startMs, endMs, activeEvents, prefs);
      const freeUntilIso = findFreeUntilIso(startMs, activeEvents, prefs);
      const freeUntilDate = new Date(freeUntilIso);

      // Bonus score for afternoon circadian peak (15:00 - 17:30) and dry conditions
      const circadianBonus = hourOfDay >= 15 && hourOfDay <= 17 ? 6 : 0;
      const combinedScore = Math.min(100, hourWeather.safetyScore + circadianBonus);

      const dayLabel = formatDayBadge(candidateStart);
      const startLabel = formatShortTime(candidateStart);
      const endLabel = formatShortTime(new Date(endMs));
      const freeUntilLabel = formatShortTime(freeUntilDate);
      const dryOrRainLabel =
        hourWeather.precipProbPct < 25
          ? 'dry'
          : `${hourWeather.precipProbPct}% rain chance`;

      const notificationPreview = `Best time to run ${dayLabel.toLowerCase()}: ${startLabel}, ${Math.round(
        hourWeather.tempC
      )}°C, ${dryOrRainLabel}, you're free until ${freeUntilLabel}`;

      let conflictExplanation: string | undefined;
      if (conflict) {
        const evtStartStr = formatShortTime(new Date(conflict.startIso));
        const evtEndStr = formatShortTime(new Date(conflict.endIso));
        conflictExplanation = `Clashes with "${conflict.title}" (${evtStartStr}–${evtEndStr}) including your ${prefs.bufferAfterMeetingMin}m meeting buffer.`;
      }

      candidates.push({
        id: `rec-${candidateStart.toISOString()}`,
        startIso: candidateStart.toISOString(),
        endIso: new Date(endMs).toISOString(),
        freeUntilIso,
        dayLabel,
        timeRangeLabel: `${startLabel} – ${endLabel}`,
        weather: hourWeather,
        combinedScore,
        hasConflict: Boolean(conflict),
        conflictingEvent: conflict,
        conflictExplanation,
        notificationPreview,
        rank: 'alternative',
      });
    }
  }

  // Sort by combined weather + schedule score descending
  const sortedByWeather = [...candidates].sort((a, b) => b.combinedScore - a.combinedScore);
  const freeCandidates = sortedByWeather.filter((c) => !c.hasConflict);
  const busyHighWeatherCandidates = sortedByWeather.filter((c) => c.hasConflict);

  const results: RunWindowRecommendation[] = [];

  if (freeCandidates.length > 0) {
    const topFree = { ...freeCandidates[0], rank: 'best_overall' as const };
    results.push(topFree);
  }

  // If there is a weather window that scored >= topFree (or near the top) but had a calendar conflict,
  // explicitly surface it so the user sees the conflict and why the next-best free slot was chosen!
  if (busyHighWeatherCandidates.length > 0) {
    const topBusy = {
      ...busyHighWeatherCandidates[0],
      rank: 'weather_best_but_busy' as const,
    };
    results.push(topBusy);
  }

  // Add the next-best conflict-free slots (deduplicated by hour so we show diverse windows)
  const usedHours = new Set(results.map((r) => r.startIso.slice(0, 13)));
  for (const cand of freeCandidates.slice(1)) {
    const hourKey = cand.startIso.slice(0, 13);
    if (usedHours.has(hourKey)) continue;
    usedHours.add(hourKey);
    results.push({
      ...cand,
      rank: results.length === 2 ? 'next_best_free' : 'alternative',
    });
    if (results.length >= 6) break;
  }

  return results;
}

/**
 * Triggers a native browser / OS notification for the recommended running window.
 */
export async function triggerRunWindowNotification(message: string): Promise<{
  deliveredToOs: boolean;
  message: string;
}> {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification('StrideSmart Run Coach', {
          body: message,
        });
        return { deliveredToOs: true, message };
      }
      if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification('StrideSmart Run Coach', {
            body: message,
          });
          return { deliveredToOs: true, message };
        }
      }
    } catch {
      // Fallback to in-app push toast banner
    }
  }
  return { deliveredToOs: false, message };
}
