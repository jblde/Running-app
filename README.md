# StrideSmart — GPS Running, Route Planner & Smart Weather/Calendar Coach

A cross-platform Strava-style running application built with **React Native (Expo) + TypeScript + Web (Vite/Leaflet) + Supabase PostgreSQL**.

## Core Features Across All 8 Build Phases

1. **Phase 1 — Project Setup, Auth & Navigation**
   - Supabase PostgreSQL schema with **Row-Level Security (RLS)** (`supabase/schema.sql`) + offline-first local persistence (`src/services/supabaseService.ts`).
   - Environment variable loader (`src/config/env.ts`) that never hardcodes secrets in code (`.env.example` provided).
   - 5-tab navigation (`Run Tracker`, `Routes`, `Smart Coach`, `History`, `Privacy & Auth`).

2. **Phase 2 — Live GPS Run Tracking & Run History**
   - Real-time distance (spherical **Haversine formula**), current/average pace, kilometer splits, elevation gain, and live neon polyline rendering (`src/utils/geoMath.ts`, `src/components/InteractiveMap.tsx`).
   - Includes both live device GPS (`navigator.geolocation` / `expo-location` + `expo-task-manager` background service in `src/native/backgroundLocationTask.ts`) and an **Indoor GPS Run Simulator (`1x`, `5x`, `15x`)** for instant desktop/indoors testing.

3. **Phase 3 — Smart Route Generation, Manual Drawing & Animated Run Replay**
   - **Loop & Out-and-Back Generator** (`src/services/routeGeneratorService.ts`): Uses forward spherical projection with an empirical road-winding tortuosity factor ($\tau = 1.25$), snaps waypoints to pedestrian footpaths via **OSRM Foot Routing**, and enriches terrain altitude via the **Open-Meteo Digital Elevation Model (DEM) API**.
   - **Manual Map Drawing**: Click directly on the map to place/undo custom waypoints or close a loop.
   - **Post-Run Animated Replay** (`src/components/RunReplayModal.tsx`): 60fps `requestAnimationFrame` replay moving a live marker along the recorded GPS track with `1x / 5x / 15x / 30x` speed controls, interactive timeline scrubber, and synchronized elevation profile cursor.

4. **Phase 4 — Weather & Air Quality Integration + Configurable Thresholds**
   - Queries **Google Maps Platform Weather API** (when configured in `.env`) with automatic zero-key fallback to **Open-Meteo Forecast + Air Quality APIs** (`src/services/weatherService.ts`).
   - Evaluates hourly Temperature, "Feels Like" (Apparent Temp), Rain Probability/mm, Wind Speed/Gusts, and US AQI against user-configurable safety sliders.

5. **Phase 5 — Google Calendar OAuth & Conflict Detection**
   - Connects with least-privilege `https://www.googleapis.com/auth/calendar.readonly` scope (`src/services/calendarAndCoachService.ts`).
   - Enforces configurable pre-meeting and post-meeting buffer gaps (`0–45 min`).

6. **Phase 6 — Smart Run-Time Recommendation Engine & Push Notifications**
   - Combines 72-hour weather safety scores with Google Calendar free/busy blocks and preferred run hours.
   - Generates actionable push notifications (e.g., *"Best time to run today: 4:30pm, 11°C, dry, you're free until 6pm"*).
   - Explicitly flags when the #1 weather window clashes with a calendar event and promotes the next-best conflict-free slot.

7. **Phase 7 — Apple Health (HealthKit) & Google Health Connect Sync**
   - Just-in-time permission modal (`src/components/HealthPermissionModal.tsx`) explaining why each scope is requested.
   - Exports completed workouts (distance, duration, active calories, GPS route points) and optionally reads back Heart Rate & Resting Heart Rate (`src/services/healthSyncService.ts`).

8. **Phase 8 — Edge-Case Lab, Privacy & Automated Unit Tests**
   - Interactive **Edge-Case Lab** in the top header to simulate *No GPS Signal*, *Low GPS Accuracy*, *No Internet (Offline Queue)*, *Calendar Permission Denied*, and *Weather API 503 Down*.
   - Full Privacy & Data Deletion controls (`Delete All My Data` & one-click integration disconnect).

---

## Quick Start

```bash
# Install dependencies
npm install

# Run unit tests (Vitest)
npm test

# Start the development server on http://localhost:5173
npm run dev
```
