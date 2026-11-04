-- ============================================================================
-- StrideSmart — Supabase PostgreSQL Schema & Row-Level Security (RLS)
-- Run this inside the Supabase SQL Editor to create tables and privacy rules.
-- ============================================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- 1. SAVED ROUTES TABLE
create table if not exists public.saved_routes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  shape text not null check (shape in ('loop', 'out-and-back', 'custom')),
  distance_km numeric(6,2) not null,
  estimated_duration_sec integer not null,
  elevation_gain_m integer not null,
  is_favourite boolean not null default true,
  coordinates jsonb not null, -- Array of { lat, lng, ele }
  waypoints jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 2. COMPLETED RUNS TABLE
create table if not exists public.runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_sec integer not null,
  distance_km numeric(6,2) not null,
  avg_pace_sec_per_km integer not null,
  elevation_gain_m integer not null,
  calories integer not null,
  avg_heart_rate integer,
  resting_heart_rate integer,
  health_synced boolean not null default false,
  health_provider text,
  weather_snapshot jsonb,
  splits jsonb not null default '[]'::jsonb,
  route_points jsonb not null, -- Array of { lat, lng, ele, timestamp, paceSecPerKm, heartRate }
  created_at timestamptz not null default now()
);

-- 3. USER PREFERENCES & SAFETY THRESHOLDS TABLE
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unit_system text not null default 'metric',
  weather_thresholds jsonb not null default '{
    "minTempC": 2,
    "maxTempC": 28,
    "minFeelsLikeC": -2,
    "maxFeelsLikeC": 32,
    "maxWindKph": 35,
    "maxRainProbPct": 40,
    "maxAqi": 100
  }'::jsonb,
  schedule_prefs jsonb not null default '{
    "preferredDays": [1, 2, 3, 4, 5, 6, 0],
    "earliestHour": 6,
    "latestHour": 20,
    "targetDurationMin": 45,
    "bufferBeforeMeetingMin": 15,
    "bufferAfterMeetingMin": 15
  }'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- PRIVACY BY DESIGN: Row-Level Security (RLS)
-- Guarantees that users can ONLY select, insert, update, or delete their own rows.
-- ============================================================================

alter table public.saved_routes enable row level security;
alter table public.runs enable row level security;
alter table public.user_preferences enable row level security;

create policy "Users manage own routes"
  on public.saved_routes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own runs"
  on public.runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own preferences"
  on public.user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
