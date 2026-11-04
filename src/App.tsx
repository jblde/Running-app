import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  CloudOff,
  CloudRain,
  Compass,
  Cpu,
  Database,
  Flame,
  Heart,
  History,
  Lock,
  MapPin,
  Mountain,
  Navigation,
  Pause,
  PenTool,
  Play,
  Plus,
  RefreshCw,
  Route,
  Save,
  Shield,
  Sliders,
  Sparkles,
  Square,
  Star,
  Sun,
  Trash2,
  Undo2,
  User,
  WifiOff,
  Wind,
  Zap,
} from 'lucide-react';
import { ENV_STATUS } from './config/env';
import { HealthPermissionModal } from './components/HealthPermissionModal';
import { InteractiveMap } from './components/InteractiveMap';
import { RunReplayModal } from './components/RunReplayModal';
import {
  DEFAULT_START_LOCATION,
  SEED_RUN_HISTORY,
  SEED_SAVED_ROUTES,
} from './data/seedRunsAndRoutes';
import {
  computeSmartRunRecommendations,
  fetchGoogleCalendarEvents,
  getGoogleOAuthAuthorizeUrl,
  loadSavedCalendarEvents,
  saveCalendarEvents,
  triggerRunWindowNotification,
} from './services/calendarAndCoachService';
import {
  disconnectHealthIntegration,
  loadHealthPermissions,
  saveHealthPermissions,
  syncRunWithHealthPlatform,
} from './services/healthSyncService';
import {
  generateSmartRoute,
  routeThroughWaypoints,
} from './services/routeGeneratorService';
import {
  DEFAULT_SCHEDULE_PREFS,
  DEFAULT_WEATHER_THRESHOLDS,
  storageService,
} from './services/supabaseService';
import { fetchRunningForecast } from './services/weatherService';
import {
  AppTab,
  CalendarEvent,
  EdgeCaseSimulationState,
  GeoPoint,
  HealthPermissionState,
  HourlyWeather,
  RouteShape,
  RunRecord,
  SavedRoute,
  SchedulePreferences,
  TelemetryPoint,
  UserProfile,
  WeatherThresholds,
} from './types/models';
import {
  calculateElevationMetrics,
  calculateTotalDistanceKm,
  computeSplitsFromTelemetry,
  formatDuration,
  formatPace,
  haversineDistanceKm,
} from './utils/geoMath';

export const App: React.FC = () => {
  // Navigation & User Auth State (Phase 1)
  const [activeTab, setActiveTab] = useState<AppTab>('track');
  const [user, setUser] = useState<UserProfile | null>(() => storageService.loadUser());
  const [authEmailInput, setAuthEmailInput] = useState('joshua@student.sunderland.ac.uk');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authNameInput, setAuthNameInput] = useState('Joshua (CS Runner)');
  const [authStatusMsg, setAuthStatusMsg] = useState<string | null>(null);

  // Edge Case Simulator State (Phase 8)
  const [edgeCases, setEdgeCases] = useState<EdgeCaseSimulationState>({
    gpsSignalLost: false,
    lowGpsAccuracy: false,
    offlineMode: false,
    calendarPermissionDenied: false,
    weatherApiDown: false,
  });
  const [showEdgeCaseBar, setShowEdgeCaseBar] = useState<boolean>(false);

  // Toast / Push Notification Banner
  const [toastBanner, setToastBanner] = useState<{
    title: string;
    body: string;
    tone: 'lime' | 'cyan' | 'amber' | 'rose';
  } | null>(null);

  const showToast = (
    title: string,
    body: string,
    tone: 'lime' | 'cyan' | 'amber' | 'rose' = 'lime'
  ) => {
    setToastBanner({ title, body, tone });
  };

  // Current GPS Location & Saved Routes / Runs (Phase 2 & 3)
  const [currentLocation, setCurrentLocation] = useState<GeoPoint>(DEFAULT_START_LOCATION);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() =>
    storageService.loadRoutes(SEED_SAVED_ROUTES)
  );
  const [runHistory, setRunHistory] = useState<RunRecord[]>(() =>
    storageService.loadRuns(SEED_RUN_HISTORY)
  );

  // Active Guide Route for Run Tracker
  const [activeGuideRoute, setActiveGuideRoute] = useState<SavedRoute | null>(
    () => SEED_SAVED_ROUTES[0] ?? null
  );

  // Live GPS Run Tracking State (Phase 2)
  const [isTrackingRun, setIsTrackingRun] = useState<boolean>(false);
  const [isRunPaused, setIsRunPaused] = useState<boolean>(false);
  const [useSimulatedGps, setUseSimulatedGps] = useState<boolean>(true);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState<number>(5);
  const [liveTelemetry, setLiveTelemetry] = useState<TelemetryPoint[]>([]);
  const [liveElapsedSec, setLiveElapsedSec] = useState<number>(0);
  const [runTitleInput, setRunTitleInput] = useState<string>('Afternoon Riverside Run');
  const [selectedReplayRun, setSelectedReplayRun] = useState<RunRecord | null>(null);
  const simCursorRef = useRef<number>(0);
  const geoWatchIdRef = useRef<number | null>(null);

  // Route Planner State (Phase 3)
  const [plannerMode, setPlannerMode] = useState<'generator' | 'draw'>('generator');
  const [targetDistanceKm, setTargetDistanceKm] = useState<number>(5.0);
  const [routeShape, setRouteShape] = useState<'loop' | 'out-and-back'>('loop');
  const [compassHeading, setCompassHeading] = useState<number>(45);
  const [plannerRouteCoords, setPlannerRouteCoords] = useState<GeoPoint[]>(
    () => SEED_SAVED_ROUTES[0]?.coordinates ?? []
  );
  const [plannerWaypoints, setPlannerWaypoints] = useState<GeoPoint[]>(
    () => SEED_SAVED_ROUTES[0]?.waypoints ?? []
  );
  const [plannerStats, setPlannerStats] = useState<{
    distanceKm: number;
    durationSec: number;
    gainM: number;
    lossM: number;
    usedLiveRouter: boolean;
  }>({
    distanceKm: SEED_SAVED_ROUTES[0]?.distanceKm ?? 5.0,
    durationSec: SEED_SAVED_ROUTES[0]?.estimatedDurationSec ?? 1560,
    gainM: SEED_SAVED_ROUTES[0]?.elevationGainM ?? 42,
    lossM: SEED_SAVED_ROUTES[0]?.elevationLossM ?? 42,
    usedLiveRouter: true,
  });
  const [isGeneratingRoute, setIsGeneratingRoute] = useState<boolean>(false);
  const [newRouteName, setNewRouteName] = useState<string>('Custom 5K Loop');
  const [plannerFitKey, setPlannerFitKey] = useState<string>('init-plan');

  // Weather & Safety Thresholds State (Phase 4)
  const [weatherThresholds, setWeatherThresholds] = useState<WeatherThresholds>(() =>
    storageService.loadWeatherThresholds()
  );
  const [forecastHours, setForecastHours] = useState<HourlyWeather[]>([]);
  const [weatherProviderName, setWeatherProviderName] = useState<string>('Loading...');
  const [weatherWarningBanner, setWeatherWarningBanner] = useState<string | undefined>();
  const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);

  // Google Calendar & Smart Coach State (Phase 5 & 6)
  const [calendarConnected, setCalendarConnected] = useState<boolean>(true);
  const [googleAccessToken, setGoogleAccessToken] = useState<string>('');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() =>
    loadSavedCalendarEvents()
  );
  const [schedulePrefs, setSchedulePrefs] = useState<SchedulePreferences>(() =>
    storageService.loadSchedulePrefs()
  );
  const [newEventTitle, setNewEventTitle] = useState<string>('Study Group Meeting');
  const [newEventStartHour, setNewEventStartHour] = useState<number>(17);
  const [newEventDurationMin, setNewEventDurationMin] = useState<number>(60);

  // Apple HealthKit & Google Health Connect State (Phase 7)
  const [healthPermissions, setHealthPermissions] = useState<HealthPermissionState>(() =>
    loadHealthPermissions()
  );
  const [pendingHealthSyncRun, setPendingHealthSyncRun] = useState<RunRecord | null>(null);
  const [showHealthModal, setShowHealthModal] = useState<boolean>(false);

  // Fetch Weather & Air Quality whenever location, thresholds, or edge cases change
  useEffect(() => {
    let cancelled = false;
    setIsLoadingWeather(true);
    fetchRunningForecast(currentLocation, weatherThresholds, {
      simulateApiDown: edgeCases.weatherApiDown,
      simulateOffline: edgeCases.offlineMode,
    })
      .then((res) => {
        if (cancelled) return;
        setForecastHours(res.hours);
        setWeatherProviderName(res.providerName);
        setWeatherWarningBanner(res.errorBanner);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingWeather(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentLocation.lat,
    currentLocation.lng,
    weatherThresholds,
    edgeCases.weatherApiDown,
    edgeCases.offlineMode,
  ]);

  // Compute Smart Run-Time Recommendations (Phase 6)
  const recommendations = useMemo(
    () =>
      computeSmartRunRecommendations(
        forecastHours,
        calendarEvents,
        schedulePrefs,
        calendarConnected && !edgeCases.calendarPermissionDenied
      ),
    [
      forecastHours,
      calendarEvents,
      schedulePrefs,
      calendarConnected,
      edgeCases.calendarPermissionDenied,
    ]
  );

  const topRecommendation = useMemo(
    () => recommendations.find((r) => r.rank === 'best_overall') ?? recommendations[0],
    [recommendations]
  );

  const conflictedTopWeatherSlot = useMemo(
    () => recommendations.find((r) => r.rank === 'weather_best_but_busy'),
    [recommendations]
  );

  // Live GPS Tracking Timer & Location Stream (Phase 2)
  useEffect(() => {
    if (!isTrackingRun || isRunPaused) return;

    const guideCoords =
      activeGuideRoute && activeGuideRoute.coordinates.length > 2
        ? activeGuideRoute.coordinates
        : SEED_SAVED_ROUTES[0].coordinates;

    const intervalMs = 1000;
    const timer = window.setInterval(() => {
      // Edge case: If GPS signal is lost, elapsed clock ticks but no new GPS fixes arrive
      if (edgeCases.gpsSignalLost) {
        setLiveElapsedSec((prev) => prev + 1);
        return;
      }

      if (useSimulatedGps) {
        setLiveElapsedSec((prevElapsed) => {
          const nextElapsed = prevElapsed + simSpeedMultiplier;
          setLiveTelemetry((prevPts) => {
            const nextIdx = Math.min(
              guideCoords.length - 1,
              simCursorRef.current + 1
            );
            simCursorRef.current =
              nextIdx >= guideCoords.length - 1 ? 0 : nextIdx;

            const baseCoord = guideCoords[nextIdx];
            // If lowGpsAccuracy edge case is active, inject 38m accuracy noise (which gets flagged)
            const accuracyMeters = edgeCases.lowGpsAccuracy ? 42 : 4.2;
            const prevPt = prevPts[prevPts.length - 1];
            const segKm = prevPt ? haversineDistanceKm(prevPt, baseCoord) : 0;
            const totalKm = Number(
              ((prevPt?.distanceFromStartKm ?? 0) + segKm).toFixed(2)
            );
            const instantPace = Math.round(305 + Math.sin(nextIdx * 0.4) * 16);
            const simHr = Math.round(146 + Math.min(28, totalKm * 4) + Math.sin(nextIdx) * 4);

            const sample: TelemetryPoint = {
              lat: baseCoord.lat,
              lng: baseCoord.lng,
              ele: baseCoord.ele ?? 20,
              timestamp: Date.now(),
              elapsedSec: nextElapsed,
              distanceFromStartKm: totalKm,
              paceSecPerKm: instantPace,
              heartRate: simHr,
              accuracyMeters,
            };

            setCurrentLocation({
              lat: sample.lat,
              lng: sample.lng,
              ele: sample.ele,
            });
            return [...prevPts, sample];
          });
          return nextElapsed;
        });
      } else {
        setLiveElapsedSec((prev) => prev + 1);
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [
    isTrackingRun,
    isRunPaused,
    useSimulatedGps,
    simSpeedMultiplier,
    activeGuideRoute,
    edgeCases.gpsSignalLost,
    edgeCases.lowGpsAccuracy,
  ]);

  // Real Browser/Device Geolocation Watcher when useSimulatedGps is false
  useEffect(() => {
    if (!isTrackingRun || isRunPaused || useSimulatedGps) {
      if (geoWatchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      showToast(
        'Geolocation Unavailable',
        'Switching to Indoor GPS Simulator so you can test run tracking.',
        'amber'
      );
      setUseSimulatedGps(true);
      return;
    }

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (edgeCases.gpsSignalLost) return;
        const acc = pos.coords.accuracy ?? 8;
        // Reject wildly inaccurate points (> 30m)
        if (acc > 30 && !edgeCases.lowGpsAccuracy) return;

        const pt: GeoPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          ele: pos.coords.altitude ? Math.round(pos.coords.altitude) : 22,
        };
        setCurrentLocation(pt);
        setLiveTelemetry((prev) => {
          const last = prev[prev.length - 1];
          const segKm = last ? haversineDistanceKm(last, pt) : 0;
          const distKm = Number(((last?.distanceFromStartKm ?? 0) + segKm).toFixed(2));
          const dt = last ? Math.max(1, (Date.now() - last.timestamp) / 1000) : 1;
          const pace = segKm > 0.001 ? Math.round(dt / segKm) : last?.paceSecPerKm ?? 310;
          return [
            ...prev,
            {
              ...pt,
              timestamp: Date.now(),
              elapsedSec: liveElapsedSec,
              distanceFromStartKm: distKm,
              paceSecPerKm: pace,
              heartRate: 152,
              accuracyMeters: acc,
            },
          ];
        });
      },
      () => {
        showToast(
          'GPS Permission Denied or Unavailable',
          'Switched to Simulated GPS stream so you can continue testing.',
          'amber'
        );
        setUseSimulatedGps(true);
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );

    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
    };
  }, [isTrackingRun, isRunPaused, useSimulatedGps, edgeCases.gpsSignalLost]);

  // Derived Live Run Metrics
  const liveMetrics = useMemo(() => {
    if (liveTelemetry.length === 0) {
      return {
        distanceKm: 0,
        currentPaceSec: 0,
        avgPaceSec: 0,
        elevationGainM: 0,
        calories: 0,
        heartRate: 0,
      };
    }
    const last = liveTelemetry[liveTelemetry.length - 1];
    const distKm = last.distanceFromStartKm;
    const avgPaceSec = distKm > 0.03 ? Math.round(liveElapsedSec / distKm) : last.paceSecPerKm;
    const { gainM } = calculateElevationMetrics(liveTelemetry);
    const weightKg = user?.weightKg ?? 72;
    const calories = Math.max(1, Math.round(distKm * weightKg * 1.036));
    return {
      distanceKm: distKm,
      currentPaceSec: last.paceSecPerKm,
      avgPaceSec,
      elevationGainM: gainM,
      calories,
      heartRate: last.heartRate ?? 150,
    };
  }, [liveTelemetry, liveElapsedSec, user?.weightKg]);

  // Start / Finish Live Run Handlers
  const handleStartRun = () => {
    simCursorRef.current = 0;
    const startCoord =
      activeGuideRoute?.coordinates[0] ?? currentLocation ?? DEFAULT_START_LOCATION;
    const initialPoint: TelemetryPoint = {
      lat: startCoord.lat,
      lng: startCoord.lng,
      ele: startCoord.ele ?? 18,
      timestamp: Date.now(),
      elapsedSec: 0,
      distanceFromStartKm: 0,
      paceSecPerKm: 310,
      heartRate: 132,
      accuracyMeters: 4,
    };
    setLiveTelemetry([initialPoint]);
    setLiveElapsedSec(0);
    setIsRunPaused(false);
    setIsTrackingRun(true);
  };

  const handleFinishRun = async () => {
    if (liveTelemetry.length < 2) {
      setIsTrackingRun(false);
      showToast('Run Discarded', 'Run was too short to record telemetry.', 'amber');
      return;
    }

    const nowIso = new Date().toISOString();
    const startIso = new Date(Date.now() - liveElapsedSec * 1000).toISOString();
    const currentWeather = forecastHours[0];
    const paces = liveTelemetry.map((p) => p.paceSecPerKm).filter((p) => p > 120);
    const bestPace = paces.length > 0 ? Math.min(...paces) : liveMetrics.avgPaceSec;

    const newRun: RunRecord = {
      id: `run-${Date.now().toString(36)}`,
      userId: user?.id ?? 'runner-local-01',
      title: runTitleInput.trim() || 'Tracked GPS Run',
      startedAt: startIso,
      endedAt: nowIso,
      durationSec: Math.max(1, liveElapsedSec),
      distanceKm: Math.max(0.05, liveMetrics.distanceKm),
      avgPaceSecPerKm: liveMetrics.avgPaceSec || 310,
      bestPaceSecPerKm: bestPace || 290,
      elevationGainM: liveMetrics.elevationGainM,
      calories: liveMetrics.calories,
      avgHeartRate: liveMetrics.heartRate,
      maxHeartRate: liveMetrics.heartRate + 16,
      restingHeartRate: 54,
      cadenceSpm: 175,
      routeId: activeGuideRoute?.id,
      routePoints: liveTelemetry,
      splits: computeSplitsFromTelemetry(liveTelemetry),
      weatherSummary: currentWeather
        ? {
            tempC: currentWeather.tempC,
            feelsLikeC: currentWeather.feelsLikeC,
            condition: currentWeather.conditionLabel,
            windKph: currentWeather.windSpeedKph,
            aqi: currentWeather.aqi,
          }
        : undefined,
      healthSync: {
        synced: false,
        provider: null,
      },
      syncedToCloud: !edgeCases.offlineMode,
    };

    const updatedList = await storageService.saveRuns(
      [newRun, ...runHistory],
      edgeCases.offlineMode
    );
    setRunHistory(updatedList);
    setIsTrackingRun(false);
    setSelectedReplayRun(newRun);

    if (edgeCases.offlineMode) {
      showToast(
        'Saved to Offline Queue',
        'Run saved locally on device and will auto-sync to Supabase when online.',
        'amber'
      );
    } else {
      showToast(
        'Run Completed!',
        `Recorded ${newRun.distanceKm.toFixed(2)} km in ${formatDuration(newRun.durationSec)}. Opening animated replay!`,
        'lime'
      );
    }
  };

  // Route Generation & Manual Drawing Handlers (Phase 3)
  const handleGenerateSmartRoute = async () => {
    setIsGeneratingRoute(true);
    try {
      const pace = user?.runnerPaceMinPerKm ?? 5.25;
      const result = await generateSmartRoute(
        currentLocation,
        targetDistanceKm,
        routeShape,
        compassHeading,
        pace,
        edgeCases.offlineMode
      );
      setPlannerWaypoints(result.waypoints);
      setPlannerRouteCoords(result.coordinates);
      setPlannerStats({
        distanceKm: result.distanceKm,
        durationSec: result.estimatedDurationSec,
        gainM: result.elevationGainM,
        lossM: result.elevationLossM,
        usedLiveRouter: result.usedLiveRouter,
      });
      setNewRouteName(
        `${result.distanceKm.toFixed(1)}K ${
          routeShape === 'loop' ? 'Loop' : 'Out-and-Back'
        } (${compassHeading}°)`
      );
      setPlannerFitKey(`gen-${Date.now()}`);
    } finally {
      setIsGeneratingRoute(false);
    }
  };

  const handleMapClickAddWaypoint = async (point: GeoPoint) => {
    const nextWaypoints = [...plannerWaypoints, point];
    setPlannerWaypoints(nextWaypoints);
    if (nextWaypoints.length >= 2) {
      const result = await routeThroughWaypoints(
        nextWaypoints,
        'custom',
        user?.runnerPaceMinPerKm ?? 5.25,
        edgeCases.offlineMode
      );
      setPlannerRouteCoords(result.coordinates);
      setPlannerStats({
        distanceKm: result.distanceKm,
        durationSec: result.estimatedDurationSec,
        gainM: result.elevationGainM,
        lossM: result.elevationLossM,
        usedLiveRouter: result.usedLiveRouter,
      });
    } else {
      setPlannerRouteCoords(nextWaypoints);
    }
  };

  const handleSavePlannedRoute = async () => {
    if (plannerRouteCoords.length < 2) return;
    const saved: SavedRoute = {
      id: `route-${Date.now().toString(36)}`,
      userId: user?.id ?? 'runner-local-01',
      name: newRouteName.trim() || `${plannerStats.distanceKm.toFixed(1)} km Route`,
      shape: plannerMode === 'draw' ? 'custom' : routeShape,
      distanceKm: plannerStats.distanceKm,
      estimatedDurationSec: plannerStats.durationSec,
      elevationGainM: plannerStats.gainM,
      elevationLossM: plannerStats.lossM,
      isFavourite: true,
      coordinates: plannerRouteCoords,
      waypoints: plannerWaypoints,
      surfaceNote: plannerStats.usedLiveRouter
        ? 'Snapped to pedestrian footpaths via OSRM + DEM Elevation'
        : 'Offline geometric route',
      createdAt: new Date().toISOString(),
    };
    const updated = [saved, ...savedRoutes];
    setSavedRoutes(updated);
    await storageService.saveRoutes(updated, edgeCases.offlineMode);
    setActiveGuideRoute(saved);
    showToast(
      'Favourite Route Saved',
      `"${saved.name}" (${saved.distanceKm} km, +${saved.elevationGainM}m) saved & loaded into Run Tracker.`,
      'lime'
    );
  };

  // Health Sync Flow with Just-in-Time Permission Check (Phase 7)
  const handleInitiateHealthSync = async (run: RunRecord) => {
    if (!healthPermissions.connected || !healthPermissions.writeWorkoutsGranted) {
      setPendingHealthSyncRun(run);
      setShowHealthModal(true);
      return;
    }
    await executeHealthSync(run, healthPermissions);
  };

  const executeHealthSync = async (
    run: RunRecord,
    perms: HealthPermissionState
  ) => {
    const { updatedRun, payload } = await syncRunWithHealthPlatform(run, perms);
    const nextRuns = runHistory.map((r) => (r.id === updatedRun.id ? updatedRun : r));
    setRunHistory(nextRuns);
    await storageService.saveRuns(nextRuns, edgeCases.offlineMode);
    if (selectedReplayRun?.id === updatedRun.id) {
      setSelectedReplayRun(updatedRun);
    }
    showToast(
      `Synced to ${
        perms.platform === 'ios_healthkit' ? 'Apple HealthKit' : 'Google Health Connect'
      }`,
      `Wrote ${payload.distanceMeters}m, ${payload.activeEnergyBurnedKcal} kcal & ${
        payload.routePointsCount
      } GPS points. ${
        payload.readBackMetrics
          ? `Read Avg HR ${payload.readBackMetrics.avgHeartRateBpm} bpm (Resting ${payload.readBackMetrics.restingHeartRateBpm} bpm).`
          : ''
      }`,
      'cyan'
    );
  };

  // Locate User via Browser GPS
  const handleUseMyRealLocation = () => {
    if (!('geolocation' in navigator)) {
      showToast('GPS Not Supported', 'Browser does not expose geolocation.', 'amber');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: GeoPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          ele: pos.coords.altitude ? Math.round(pos.coords.altitude) : 24,
        };
        setCurrentLocation(loc);
        setPlannerFitKey(`loc-${Date.now()}`);
        showToast(
          'GPS Location Locked',
          `Centered at ${loc.lat.toFixed(4)}°, ${loc.lng.toFixed(4)}°`,
          'cyan'
        );
      },
      () => {
        showToast(
          'Location Permission Denied',
          'Using default Sunderland Riverside coordinates (54.9069°N, 1.3838°W).',
          'amber'
        );
      }
    );
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0B0F17',
        color: '#F8FAFC',
        fontFamily: 'Inter, system-ui, sans-serif',
        paddingBottom: '92px',
      }}
    >
      {/* Top App Bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          backgroundColor: 'rgba(11, 15, 23, 0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #1E293B',
          padding: '12px 20px',
        }}
      >
        <div
          style={{
            maxWidth: '1180px',
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #CCFF00 0%, #10B981 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0B0F17',
                fontWeight: 900,
              }}
            >
              <Zap size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '-0.02em' }}>
                  StrideSmart
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    background: '#1E293B',
                    color: '#CCFF00',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontWeight: 700,
                  }}
                >
                  GPS • Weather • Calendar • Health
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                {user ? `Signed in as ${user.displayName}` : 'Guest Mode (Local Storage)'}
              </div>
            </div>
          </div>

          {/* Live System Status & Edge Case Lab Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={handleUseMyRealLocation}
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                color: '#00E5FF',
                borderRadius: '999px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <MapPin size={13} /> Locate Me
            </button>

            <button
              onClick={() => setShowEdgeCaseBar((prev) => !prev)}
              style={{
                background:
                  Object.values(edgeCases).some(Boolean)
                    ? 'rgba(245, 158, 11, 0.18)'
                    : '#111827',
                border: Object.values(edgeCases).some(Boolean)
                  ? '1px solid #F59E0B'
                  : '1px solid #334155',
                color: Object.values(edgeCases).some(Boolean) ? '#F59E0B' : '#CBD5E1',
                borderRadius: '999px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Cpu size={14} />
              Edge-Case Lab
              {Object.values(edgeCases).filter(Boolean).length > 0 &&
                ` (${Object.values(edgeCases).filter(Boolean).length} active)`}
            </button>
          </div>
        </div>

        {/* Collapsible Edge-Case Simulator Bar (Phase 8 requirement) */}
        {showEdgeCaseBar && (
          <div
            style={{
              maxWidth: '1180px',
              margin: '12px auto 0',
              background: '#111827',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '12px 16px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', marginBottom: '8px' }}>
              🧪 CS Edge-Case Resilience Simulator — Toggle failure modes to verify graceful fallback behavior:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { key: 'gpsSignalLost', label: 'No GPS Signal (Tunnel / Drop)' },
                { key: 'lowGpsAccuracy', label: 'Noisy GPS (>35m Multipath)' },
                { key: 'offlineMode', label: 'No Internet (Offline Queue)' },
                { key: 'calendarPermissionDenied', label: 'Calendar Permission Denied' },
                { key: 'weatherApiDown', label: 'Weather API 503 Down' },
              ].map((item) => {
                const k = item.key as keyof EdgeCaseSimulationState;
                const active = edgeCases[k];
                return (
                  <button
                    key={item.key}
                    onClick={() =>
                      setEdgeCases((prev) => ({ ...prev, [k]: !prev[k] }))
                    }
                    style={{
                      background: active ? 'rgba(244, 63, 94, 0.2)' : '#0B0F17',
                      border: active ? '1px solid #F43F5E' : '1px solid #1E293B',
                      color: active ? '#FDA4AF' : '#94A3B8',
                      borderRadius: '8px',
                      padding: '6px 11px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {active ? '⚠️ ' : '○ '}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Active Edge Case Alert Banners */}
      <div style={{ maxWidth: '1180px', margin: '12px auto 0', padding: '0 20px' }}>
        {edgeCases.gpsSignalLost && (
          <div
            style={{
              background: 'rgba(244, 63, 94, 0.14)',
              border: '1px solid #F43F5E',
              color: '#FECDD3',
              padding: '10px 14px',
              borderRadius: '12px',
              marginBottom: '8px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangle size={16} color="#F43F5E" />
            <strong>GPS Signal Lost:</strong> Waiting for satellite lock. Run timer continues; distance calculation paused to prevent phantom straight-line jumps.
          </div>
        )}

        {edgeCases.offlineMode && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid #F59E0B',
              color: '#FDE68A',
              padding: '10px 14px',
              borderRadius: '12px',
              marginBottom: '8px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <WifiOff size={16} color="#F59E0B" />
            <strong>Offline Mode Active:</strong> GPS tracking works without cell data. Completed runs and routes are saved to local device storage and queued for Supabase sync.
          </div>
        )}

        {/* Toast / Push Notification Preview Banner */}
        {toastBanner && (
          <div
            style={{
              background: '#111827',
              borderLeft: `4px solid ${
                toastBanner.tone === 'lime'
                  ? '#CCFF00'
                  : toastBanner.tone === 'cyan'
                    ? '#00E5FF'
                    : toastBanner.tone === 'amber'
                      ? '#F59E0B'
                      : '#F43F5E'
              }`,
              borderTop: '1px solid #1E293B',
              borderRight: '1px solid #1E293B',
              borderBottom: '1px solid #1E293B',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bell size={18} color="#CCFF00" />
              <div>
                <div style={{ fontWeight: 700, fontSize: '13px' }}>{toastBanner.title}</div>
                <div style={{ fontSize: '13px', color: '#CBD5E1' }}>{toastBanner.body}</div>
              </div>
            </div>
            <button
              onClick={() => setToastBanner(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Main Content Container */}
      <main style={{ maxWidth: '1180px', margin: '14px auto', padding: '0 20px' }}>
        {/* ===================================================================
            TAB 1: LIVE GPS RUN TRACKER (Phase 2)
           =================================================================== */}
        {activeTab === 'track' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Quick Smart Coach Banner at Top of Tracker */}
            {topRecommendation && (
              <div
                style={{
                  background: 'linear-gradient(90deg, rgba(204,255,0,0.12) 0%, rgba(0,229,255,0.08) 100%)',
                  border: '1px solid rgba(204, 255, 0, 0.3)',
                  borderRadius: '16px',
                  padding: '14px 18px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Sparkles size={22} color="#CCFF00" />
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#CCFF00', textTransform: 'uppercase' }}>
                      Smart Run Coach • Weather + Google Calendar
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '2px' }}>
                      “{topRecommendation.notificationPreview}”
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('coach')}
                  style={{
                    background: '#111827',
                    color: '#CCFF00',
                    border: '1px solid rgba(204,255,0,0.4)',
                    borderRadius: '10px',
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  View Full Schedule & Weather →
                </button>
              </div>
            )}

            {/* Large High-Contrast Telemetry Readout */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: edgeCases.gpsSignalLost
                        ? '#F43F5E'
                        : isTrackingRun
                          ? '#CCFF00'
                          : '#10B981',
                      boxShadow: isTrackingRun ? '0 0 12px #CCFF00' : 'none',
                    }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#CBD5E1' }}>
                    {edgeCases.gpsSignalLost
                      ? 'GPS SIGNAL LOST'
                      : isTrackingRun
                        ? isRunPaused
                          ? 'RUN PAUSED'
                          : 'LIVE GPS TRACKING ACTIVE'
                        : 'READY TO TRACK RUN'}
                  </span>
                  {edgeCases.lowGpsAccuracy && (
                    <span
                      style={{
                        fontSize: '11px',
                        background: 'rgba(245,158,11,0.2)',
                        color: '#F59E0B',
                        padding: '2px 8px',
                        borderRadius: '999px',
                      }}
                    >
                      Low GPS Accuracy (±42m)
                    </span>
                  )}
                </div>

                {/* GPS Source Selector (Device GPS vs Indoor Simulator) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '12px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={useSimulatedGps}
                      onChange={(e) => setUseSimulatedGps(e.target.checked)}
                      style={{ accentColor: '#CCFF00' }}
                    />
                    Indoor GPS Simulator
                  </label>
                  {useSimulatedGps && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[1, 5, 15].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => setSimSpeedMultiplier(spd)}
                          style={{
                            background: simSpeedMultiplier === spd ? '#00E5FF' : '#0B0F17',
                            color: simSpeedMultiplier === spd ? '#0B0F17' : '#94A3B8',
                            border: '1px solid #1E293B',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 5 Giant Telemetry Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
                  gap: '12px',
                  marginBottom: '18px',
                }}
              >
                <div style={{ background: '#0B0F17', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>
                    Distance
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '38px',
                      fontWeight: 800,
                      color: '#CCFF00',
                      marginTop: '4px',
                    }}
                  >
                    {liveMetrics.distanceKm.toFixed(2)}
                    <span style={{ fontSize: '15px', color: '#94A3B8', marginLeft: '4px' }}>km</span>
                  </div>
                </div>

                <div style={{ background: '#0B0F17', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>
                    Current Pace
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '38px',
                      fontWeight: 800,
                      color: '#F8FAFC',
                      marginTop: '4px',
                    }}
                  >
                    {isTrackingRun ? formatPace(liveMetrics.currentPaceSec) : '5:10'}
                    <span style={{ fontSize: '15px', color: '#94A3B8', marginLeft: '4px' }}>/km</span>
                  </div>
                </div>

                <div style={{ background: '#0B0F17', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>
                    Elapsed Time
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '38px',
                      fontWeight: 800,
                      color: '#F8FAFC',
                      marginTop: '4px',
                    }}
                  >
                    {formatDuration(liveElapsedSec)}
                  </div>
                </div>

                <div style={{ background: '#0B0F17', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>
                    Elevation Gain
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '34px',
                      fontWeight: 800,
                      color: '#00E5FF',
                      marginTop: '6px',
                    }}
                  >
                    +{liveMetrics.elevationGainM}
                    <span style={{ fontSize: '15px', marginLeft: '4px' }}>m</span>
                  </div>
                </div>

                <div style={{ background: '#0B0F17', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>
                    Live Heart Rate
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '34px',
                      fontWeight: 800,
                      color: '#FB7185',
                      marginTop: '6px',
                    }}
                  >
                    {isTrackingRun ? liveMetrics.heartRate : 134}
                    <span style={{ fontSize: '15px', marginLeft: '4px' }}>bpm</span>
                  </div>
                </div>
              </div>

              {/* Live GPS Map */}
              <InteractiveMap
                center={currentLocation}
                routeCoords={
                  isTrackingRun
                    ? liveTelemetry
                    : activeGuideRoute?.coordinates ?? []
                }
                guideRouteCoords={
                  isTrackingRun ? activeGuideRoute?.coordinates : undefined
                }
                currentPosition={currentLocation}
                height="390px"
                fitBoundsKey={activeGuideRoute?.id ?? 'default-track'}
              />

              {/* Run Controls Bar */}
              <div
                style={{
                  marginTop: '16px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={runTitleInput}
                    onChange={(e) => setRunTitleInput(e.target.value)}
                    placeholder="Run title..."
                    style={{
                      background: '#0B0F17',
                      border: '1px solid #334155',
                      color: '#F8FAFC',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      fontSize: '13px',
                      minWidth: '210px',
                    }}
                  />

                  <select
                    value={activeGuideRoute?.id ?? ''}
                    onChange={(e) => {
                      const found = savedRoutes.find((r) => r.id === e.target.value) ?? null;
                      setActiveGuideRoute(found);
                    }}
                    style={{
                      background: '#0B0F17',
                      border: '1px solid #334155',
                      color: '#CBD5E1',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      fontSize: '13px',
                    }}
                  >
                    <option value="">Free Run (No Guide Route)</option>
                    {savedRoutes.map((rt) => (
                      <option key={rt.id} value={rt.id}>
                        Guide: {rt.name} ({rt.distanceKm} km)
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {!isTrackingRun ? (
                    <button
                      onClick={handleStartRun}
                      style={{
                        background: '#CCFF00',
                        color: '#0B0F17',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px 24px',
                        fontSize: '15px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 0 24px rgba(204, 255, 0, 0.35)',
                      }}
                    >
                      <Play size={18} fill="#0B0F17" /> Start Live GPS Run
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsRunPaused((p) => !p)}
                        style={{
                          background: '#1E293B',
                          color: '#F8FAFC',
                          border: '1px solid #334155',
                          borderRadius: '12px',
                          padding: '12px 18px',
                          fontSize: '14px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {isRunPaused ? <Play size={16} /> : <Pause size={16} />}
                        {isRunPaused ? 'Resume' : 'Pause'}
                      </button>

                      <button
                        onClick={handleFinishRun}
                        style={{
                          background: '#F97316',
                          color: '#0B0F17',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '12px 22px',
                          fontSize: '14px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Square size={16} fill="#0B0F17" /> Finish Run & View Replay
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: ROUTE CREATION & FAVOURITES (Phase 3)
           =================================================================== */}
        {activeTab === 'routes' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '18px',
            }}
          >
            {/* Left Column: Route Generator / Manual Drawing Controls & Map */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
                gridColumn: 'span 2',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '16px',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>
                    Smart Route Builder & Footpath Mapper
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94A3B8' }}>
                    Generate a road-snapped Loop or Out-and-Back from your location, or draw custom waypoints directly on the map.
                  </p>
                </div>

                {/* Mode Switcher */}
                <div style={{ display: 'flex', background: '#0B0F17', padding: '4px', borderRadius: '12px', border: '1px solid #1E293B' }}>
                  <button
                    onClick={() => setPlannerMode('generator')}
                    style={{
                      background: plannerMode === 'generator' ? '#CCFF00' : 'transparent',
                      color: plannerMode === 'generator' ? '#0B0F17' : '#94A3B8',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Compass size={14} /> Auto-Generate
                  </button>
                  <button
                    onClick={() => {
                      setPlannerMode('draw');
                      if (plannerWaypoints.length > 4) {
                        setPlannerWaypoints([currentLocation]);
                        setPlannerRouteCoords([currentLocation]);
                      }
                    }}
                    style={{
                      background: plannerMode === 'draw' ? '#00E5FF' : 'transparent',
                      color: plannerMode === 'draw' ? '#0B0F17' : '#94A3B8',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <PenTool size={14} /> Draw on Map
                  </button>
                </div>
              </div>

              {/* Generator Controls vs Manual Draw Controls */}
              {plannerMode === 'generator' ? (
                <div
                  style={{
                    background: '#0B0F17',
                    border: '1px solid #1E293B',
                    borderRadius: '14px',
                    padding: '16px',
                    marginBottom: '16px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '16px',
                    alignItems: 'end',
                  }}
                >
                  <div>
                    <label style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>
                      Target Distance: <strong style={{ color: '#CCFF00' }}>{targetDistanceKm.toFixed(1)} km</strong>
                    </label>
                    <input
                      type="range"
                      min={1.5}
                      max={21.1}
                      step={0.5}
                      value={targetDistanceKm}
                      onChange={(e) => setTargetDistanceKm(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#CCFF00', marginTop: '8px' }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      {[3, 5, 8, 10, 15].map((km) => (
                        <button
                          key={km}
                          onClick={() => setTargetDistanceKm(km)}
                          style={{
                            background: targetDistanceKm === km ? '#CCFF00' : '#111827',
                            color: targetDistanceKm === km ? '#0B0F17' : '#94A3B8',
                            border: '1px solid #334155',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {km}K
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600, marginBottom: '8px' }}>
                      Route Geometry Shape
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button
                        onClick={() => setRouteShape('loop')}
                        style={{
                          padding: '10px',
                          borderRadius: '10px',
                          border: routeShape === 'loop' ? '2px solid #CCFF00' : '1px solid #334155',
                          background: routeShape === 'loop' ? 'rgba(204,255,0,0.1)' : '#111827',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        🔄 Loop Circuit
                      </button>
                      <button
                        onClick={() => setRouteShape('out-and-back')}
                        style={{
                          padding: '10px',
                          borderRadius: '10px',
                          border:
                            routeShape === 'out-and-back'
                              ? '2px solid #00E5FF'
                              : '1px solid #334155',
                          background:
                            routeShape === 'out-and-back'
                              ? 'rgba(0,229,255,0.1)'
                              : '#111827',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        ↔️ Out-and-Back
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>
                      Compass Direction ({compassHeading}°)
                    </label>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {[
                        { label: 'N', deg: 0 },
                        { label: 'NE', deg: 45 },
                        { label: 'E', deg: 90 },
                        { label: 'SE', deg: 135 },
                        { label: 'S', deg: 180 },
                        { label: 'SW', deg: 225 },
                        { label: 'W', deg: 270 },
                        { label: 'NW', deg: 315 },
                      ].map((dir) => (
                        <button
                          key={dir.label}
                          onClick={() => setCompassHeading(dir.deg)}
                          style={{
                            background: compassHeading === dir.deg ? '#00E5FF' : '#111827',
                            color: compassHeading === dir.deg ? '#0B0F17' : '#CBD5E1',
                            border: '1px solid #334155',
                            borderRadius: '6px',
                            padding: '6px 8px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {dir.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleGenerateSmartRoute}
                    disabled={isGeneratingRoute}
                    style={{
                      background: '#CCFF00',
                      color: '#0B0F17',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 18px',
                      fontWeight: 800,
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    <RefreshCw size={16} />
                    {isGeneratingRoute ? 'Routing Footpaths...' : 'Generate Route'}
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    background: '#0B0F17',
                    border: '1px solid #00E5FF',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    marginBottom: '16px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#CBD5E1' }}>
                    <strong>Manual Map Drawing Active:</strong> Click anywhere on the map below to place waypoints ({plannerWaypoints.length} placed). Each click automatically snaps to pedestrian footpaths and calculates elevation!
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={async () => {
                        if (plannerWaypoints.length <= 1) return;
                        const trimmed = plannerWaypoints.slice(0, -1);
                        setPlannerWaypoints(trimmed);
                        const res = await routeThroughWaypoints(
                          trimmed,
                          'custom',
                          user?.runnerPaceMinPerKm ?? 5.25,
                          edgeCases.offlineMode
                        );
                        setPlannerRouteCoords(res.coordinates);
                        setPlannerStats({
                          distanceKm: res.distanceKm,
                          durationSec: res.estimatedDurationSec,
                          gainM: res.elevationGainM,
                          lossM: res.elevationLossM,
                          usedLiveRouter: res.usedLiveRouter,
                        });
                      }}
                      style={{
                        background: '#1E293B',
                        color: '#F8FAFC',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <Undo2 size={14} /> Undo Last Pin
                    </button>

                    <button
                      onClick={async () => {
                        if (plannerWaypoints.length < 2) return;
                        const closed = [...plannerWaypoints, plannerWaypoints[0]];
                        setPlannerWaypoints(closed);
                        const res = await routeThroughWaypoints(
                          closed,
                          'loop',
                          user?.runnerPaceMinPerKm ?? 5.25,
                          edgeCases.offlineMode
                        );
                        setPlannerRouteCoords(res.coordinates);
                        setPlannerStats({
                          distanceKm: res.distanceKm,
                          durationSec: res.estimatedDurationSec,
                          gainM: res.elevationGainM,
                          lossM: res.elevationLossM,
                          usedLiveRouter: res.usedLiveRouter,
                        });
                      }}
                      style={{
                        background: '#1E293B',
                        color: '#00E5FF',
                        border: '1px solid #00E5FF',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Close Loop Back to Start
                    </button>

                    <button
                      onClick={() => {
                        setPlannerWaypoints([currentLocation]);
                        setPlannerRouteCoords([currentLocation]);
                        setPlannerStats({
                          distanceKm: 0,
                          durationSec: 0,
                          gainM: 0,
                          lossM: 0,
                          usedLiveRouter: true,
                        });
                      }}
                      style={{
                        background: 'rgba(244,63,94,0.15)',
                        color: '#FDA4AF',
                        border: '1px solid #F43F5E',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Reset Canvas
                    </button>
                  </div>
                </div>
              )}

              {/* Interactive Route Planner Map */}
              <InteractiveMap
                center={currentLocation}
                routeCoords={plannerRouteCoords}
                waypoints={plannerWaypoints}
                interactiveDrawMode={plannerMode === 'draw'}
                onMapClickAddPoint={handleMapClickAddWaypoint}
                height="380px"
                fitBoundsKey={plannerFitKey}
              />

              {/* Planned Route Summary & Save Bar */}
              <div
                style={{
                  marginTop: '14px',
                  background: '#0B0F17',
                  border: '1px solid #1E293B',
                  borderRadius: '14px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontFamily: 'JetBrains Mono, monospace' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>ROUTE DISTANCE</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#CCFF00' }}>
                      {plannerStats.distanceKm.toFixed(2)} km
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>EST. TIME (@ {formatPace((user?.runnerPaceMinPerKm ?? 5.25) * 60)}/km)</div>
                    <div style={{ fontSize: '20px', fontWeight: 800 }}>
                      {formatDuration(plannerStats.durationSec)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>ELEVATION GAIN / LOSS</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#00E5FF' }}>
                      +{plannerStats.gainM}m / -{plannerStats.lossM}m
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={newRouteName}
                    onChange={(e) => setNewRouteName(e.target.value)}
                    placeholder="Route name..."
                    style={{
                      background: '#111827',
                      border: '1px solid #334155',
                      color: '#F8FAFC',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      fontSize: '13px',
                    }}
                  />
                  <button
                    onClick={handleSavePlannedRoute}
                    style={{
                      background: '#10B981',
                      color: '#0B0F17',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '10px 16px',
                      fontWeight: 800,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Star size={15} fill="#0B0F17" /> Save Favourite Route
                  </button>
                </div>
              </div>
            </div>

            {/* Saved Favourite Routes List */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
                gridColumn: 'span 2',
              }}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: '17px', fontWeight: 800 }}>
                ⭐ Saved Favourite Routes ({savedRoutes.length})
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                  gap: '12px',
                }}
              >
                {savedRoutes.map((rt) => (
                  <div
                    key={rt.id}
                    style={{
                      background: '#0B0F17',
                      border:
                        activeGuideRoute?.id === rt.id
                          ? '1px solid #CCFF00'
                          : '1px solid #1E293B',
                      borderRadius: '14px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: rt.shape === 'loop' ? '#CCFF00' : '#00E5FF',
                          }}
                        >
                          {rt.shape}
                        </span>
                        <button
                          onClick={async () => {
                            const next = savedRoutes.filter((r) => r.id !== rt.id);
                            setSavedRoutes(next);
                            await storageService.saveRoutes(next, edgeCases.offlineMode);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748B',
                            cursor: 'pointer',
                          }}
                          title="Delete Route"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '15px', marginTop: '4px' }}>
                        {rt.name}
                      </div>
                      {rt.surfaceNote && (
                        <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
                          {rt.surfaceNote}
                        </div>
                      )}
                    </div>

                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '13px',
                          padding: '8px 0',
                          borderTop: '1px solid #1E293B',
                        }}
                      >
                        <span style={{ color: '#CCFF00', fontWeight: 700 }}>
                          {rt.distanceKm.toFixed(2)} km
                        </span>
                        <span>Est. {formatDuration(rt.estimatedDurationSec)}</span>
                        <span style={{ color: '#00E5FF' }}>+{rt.elevationGainM}m</span>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                        <button
                          onClick={() => {
                            setPlannerRouteCoords(rt.coordinates);
                            setPlannerWaypoints(rt.waypoints);
                            setPlannerStats({
                              distanceKm: rt.distanceKm,
                              durationSec: rt.estimatedDurationSec,
                              gainM: rt.elevationGainM,
                              lossM: rt.elevationLossM,
                              usedLiveRouter: true,
                            });
                            setPlannerFitKey(`view-${rt.id}-${Date.now()}`);
                          }}
                          style={{
                            flex: 1,
                            background: '#1E293B',
                            color: '#F8FAFC',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Preview on Map
                        </button>
                        <button
                          onClick={() => {
                            setActiveGuideRoute(rt);
                            setRunTitleInput(rt.name);
                            setActiveTab('track');
                          }}
                          style={{
                            flex: 1,
                            background: '#CCFF00',
                            color: '#0B0F17',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px',
                            fontSize: '12px',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Run This Route →
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 3: SMART COACH — WEATHER + CALENDAR + NOTIFICATIONS (Phases 4, 5, 6)
           =================================================================== */}
        {activeTab === 'coach' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {weatherWarningBanner && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid #F59E0B',
                  color: '#FDE68A',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  fontSize: '13px',
                }}
              >
                ⚠️ <strong>Weather Service Fallback:</strong> {weatherWarningBanner}
              </div>
            )}

            {edgeCases.calendarPermissionDenied && (
              <div
                style={{
                  background: 'rgba(244, 63, 94, 0.15)',
                  border: '1px solid #F43F5E',
                  color: '#FECDD3',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  fontSize: '13px',
                }}
              >
                🔒 <strong>Google Calendar Permission Denied:</strong> Recommendations are currently ranked by weather & preferred run hours only. Re-authorize Google Calendar read-only access below to re-enable meeting conflict detection.
              </div>
            )}

            {/* Hero #1 Best Run Window & Notification Card */}
            {topRecommendation && (
              <div
                style={{
                  background: 'linear-gradient(135deg, #111827 0%, #0F172A 100%)',
                  border: '2px solid #CCFF00',
                  borderRadius: '20px',
                  padding: '22px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '14px',
                  }}
                >
                  <div>
                    <span
                      style={{
                        background: '#CCFF00',
                        color: '#0B0F17',
                        fontSize: '11px',
                        fontWeight: 800,
                        padding: '4px 10px',
                        borderRadius: '999px',
                        textTransform: 'uppercase',
                      }}
                    >
                      #1 Best Conflict-Free Run Window • Score {topRecommendation.combinedScore}/100
                    </span>
                    <h2 style={{ margin: '10px 0 4px', fontSize: '24px', fontWeight: 800 }}>
                      {topRecommendation.dayLabel} at {topRecommendation.timeRangeLabel}
                    </h2>
                    <div
                      style={{
                        marginTop: '8px',
                        background: '#0B0F17',
                        border: '1px solid #334155',
                        borderRadius: '12px',
                        padding: '10px 14px',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '13px',
                        color: '#CCFF00',
                      }}
                    >
                      📲 Push Notification: "{topRecommendation.notificationPreview}"
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      const res = await triggerRunWindowNotification(
                        topRecommendation.notificationPreview
                      );
                      showToast(
                        res.deliveredToOs
                          ? 'Push Notification Sent (OS + In-App)'
                          : 'Push Notification Dispatched',
                        res.message,
                        'lime'
                      );
                    }}
                    style={{
                      background: '#CCFF00',
                      color: '#0B0F17',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 18px',
                      fontWeight: 800,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Bell size={16} /> Send Push Notification Now
                  </button>
                </div>

                {/* Weather Conflict Explanation Alert if a peak weather slot clashed with a meeting */}
                {conflictedTopWeatherSlot && (
                  <div
                    style={{
                      marginTop: '14px',
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.5)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      fontSize: '13px',
                      color: '#FDE68A',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                    }}
                  >
                    <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong>Calendar Conflict Detected & Resolved:</strong> The{' '}
                      <strong>
                        {conflictedTopWeatherSlot.dayLabel} {conflictedTopWeatherSlot.timeRangeLabel}
                      </strong>{' '}
                      window has great weather ({conflictedTopWeatherSlot.weather.tempC}°C,{' '}
                      {conflictedTopWeatherSlot.weather.conditionLabel}), but{' '}
                      {conflictedTopWeatherSlot.conflictExplanation} We automatically promoted{' '}
                      <strong>{topRecommendation.timeRangeLabel}</strong> as your best conflict-free slot!
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Next-Best Slots & Conflict Breakdown Grid */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
              }}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: '17px', fontWeight: 800 }}>
                Recommended Run Windows & Calendar Conflict Analysis (Next 72 Hours)
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(275px, 1fr))',
                  gap: '12px',
                }}
              >
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      background: '#0B0F17',
                      border: rec.hasConflict
                        ? '1px solid #F59E0B'
                        : rec.rank === 'best_overall'
                          ? '1px solid #CCFF00'
                          : '1px solid #1E293B',
                      borderRadius: '14px',
                      padding: '14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: rec.hasConflict
                            ? '#F59E0B'
                            : rec.rank === 'best_overall'
                              ? '#CCFF00'
                              : '#00E5FF',
                          textTransform: 'uppercase',
                        }}
                      >
                        {rec.rank === 'best_overall'
                          ? '★ Best Free Window'
                          : rec.hasConflict
                            ? '⚠️ Weather Peak • Calendar Conflict'
                            : rec.rank === 'next_best_free'
                              ? 'Next-Best Free Slot'
                              : 'Alternative Free Slot'}
                      </span>
                      <span
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#F8FAFC',
                        }}
                      >
                        {rec.combinedScore}/100
                      </span>
                    </div>

                    <div style={{ fontWeight: 800, fontSize: '16px', margin: '6px 0 4px' }}>
                      {rec.dayLabel} • {rec.timeRangeLabel}
                    </div>

                    <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '8px' }}>
                      {rec.weather.tempC}°C (feels {rec.weather.feelsLikeC}°C) •{' '}
                      {rec.weather.conditionLabel} • Wind {rec.weather.windSpeedKph} km/h • AQI{' '}
                      {rec.weather.aqi}
                    </div>

                    {rec.hasConflict && rec.conflictExplanation ? (
                      <div
                        style={{
                          fontSize: '12px',
                          background: 'rgba(245, 158, 11, 0.12)',
                          color: '#FDE68A',
                          padding: '8px',
                          borderRadius: '8px',
                        }}
                      >
                        {rec.conflictExplanation}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#10B981',
                          background: 'rgba(16, 185, 129, 0.1)',
                          padding: '8px',
                          borderRadius: '8px',
                        }}
                      >
                        ✓ Calendar free (including {schedulePrefs.bufferBeforeMeetingMin}m pre /{' '}
                        {schedulePrefs.bufferAfterMeetingMin}m post-meeting buffer)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Two-Column: Google Calendar Integration + Configurable Weather Thresholds */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: '18px',
              }}
            >
              {/* Google Calendar OAuth & Schedule Preferences (Phase 5) */}
              <div
                style={{
                  background: '#111827',
                  border: '1px solid #1E293B',
                  borderRadius: '20px',
                  padding: '20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={18} color="#00E5FF" />
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
                      Google Calendar & Schedule Rules
                    </h3>
                  </div>
                  <button
                    onClick={() => setCalendarConnected((c) => !c)}
                    style={{
                      background: calendarConnected ? 'rgba(16,185,129,0.15)' : '#1E293B',
                      color: calendarConnected ? '#10B981' : '#94A3B8',
                      border: calendarConnected ? '1px solid #10B981' : '1px solid #334155',
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {calendarConnected ? '● Connected (calendar.readonly)' : '○ Disconnected'}
                  </button>
                </div>

                {/* Optional Live Google OAuth Token Fetch */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  <input
                    type="password"
                    value={googleAccessToken}
                    onChange={(e) => setGoogleAccessToken(e.target.value)}
                    placeholder="Optional: Paste Google OAuth Bearer Token..."
                    style={{
                      flex: 1,
                      background: '#0B0F17',
                      border: '1px solid #334155',
                      color: '#F8FAFC',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      fontSize: '12px',
                    }}
                  />
                  <button
                    onClick={async () => {
                      if (!googleAccessToken.trim()) {
                        const url = getGoogleOAuthAuthorizeUrl();
                        if (url) {
                          window.open(url, '_blank');
                        } else {
                          showToast(
                            'Google Calendar Sandbox Active',
                            'Using synced university & sprint calendar events below. Add EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB in .env for live OAuth.',
                            'cyan'
                          );
                        }
                        return;
                      }
                      try {
                        const liveEvts = await fetchGoogleCalendarEvents(googleAccessToken.trim());
                        setCalendarEvents(liveEvts);
                        saveCalendarEvents(liveEvts);
                        showToast('Google Calendar Synced', `Loaded ${liveEvts.length} upcoming events.`, 'lime');
                      } catch (err) {
                        showToast('OAuth Token Error', (err as Error).message, 'rose');
                      }
                    }}
                    style={{
                      background: '#00E5FF',
                      color: '#0B0F17',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Sync OAuth
                  </button>
                </div>

                {/* Preferred Run Window & Buffer Gap Controls */}
                <div
                  style={{
                    background: '#0B0F17',
                    border: '1px solid #1E293B',
                    borderRadius: '12px',
                    padding: '12px',
                    marginBottom: '14px',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                  }}
                >
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Preferred Hours: <strong>{schedulePrefs.earliestHour}:00 – {schedulePrefs.latestHour}:00</strong>
                    </label>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <input
                        type="number"
                        min={4}
                        max={14}
                        value={schedulePrefs.earliestHour}
                        onChange={(e) => {
                          const updated = { ...schedulePrefs, earliestHour: Number(e.target.value) };
                          setSchedulePrefs(updated);
                          storageService.saveSchedulePrefs(updated);
                        }}
                        style={{ width: '60px', background: '#111827', color: '#F8FAFC', border: '1px solid #334155', borderRadius: '6px', padding: '4px 6px' }}
                      />
                      <input
                        type="number"
                        min={15}
                        max={23}
                        value={schedulePrefs.latestHour}
                        onChange={(e) => {
                          const updated = { ...schedulePrefs, latestHour: Number(e.target.value) };
                          setSchedulePrefs(updated);
                          storageService.saveSchedulePrefs(updated);
                        }}
                        style={{ width: '60px', background: '#111827', color: '#F8FAFC', border: '1px solid #334155', borderRadius: '6px', padding: '4px 6px' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Target Run Duration: <strong>{schedulePrefs.targetDurationMin} min</strong>
                    </label>
                    <input
                      type="range"
                      min={20}
                      max={120}
                      step={5}
                      value={schedulePrefs.targetDurationMin}
                      onChange={(e) => {
                        const updated = {
                          ...schedulePrefs,
                          targetDurationMin: Number(e.target.value),
                        };
                        setSchedulePrefs(updated);
                        storageService.saveSchedulePrefs(updated);
                      }}
                      style={{ width: '100%', accentColor: '#CCFF00', marginTop: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Gap Before Meeting: <strong>{schedulePrefs.bufferBeforeMeetingMin} min</strong>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={45}
                      step={5}
                      value={schedulePrefs.bufferBeforeMeetingMin}
                      onChange={(e) => {
                        const updated = {
                          ...schedulePrefs,
                          bufferBeforeMeetingMin: Number(e.target.value),
                        };
                        setSchedulePrefs(updated);
                        storageService.saveSchedulePrefs(updated);
                      }}
                      style={{ width: '100%', accentColor: '#00E5FF' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Gap After Meeting: <strong>{schedulePrefs.bufferAfterMeetingMin} min</strong>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={45}
                      step={5}
                      value={schedulePrefs.bufferAfterMeetingMin}
                      onChange={(e) => {
                        const updated = {
                          ...schedulePrefs,
                          bufferAfterMeetingMin: Number(e.target.value),
                        };
                        setSchedulePrefs(updated);
                        storageService.saveSchedulePrefs(updated);
                      }}
                      style={{ width: '100%', accentColor: '#00E5FF' }}
                    />
                  </div>
                </div>

                {/* Upcoming Calendar Events List + Quick Add to test conflicts */}
                <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: '#CBD5E1' }}>
                  Synced Calendar Events ({calendarEvents.length}):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                  {calendarEvents.map((evt) => (
                    <div
                      key={evt.id}
                      style={{
                        background: '#0B0F17',
                        border: '1px solid #1E293B',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{evt.title}</div>
                        <div style={{ color: '#94A3B8', fontSize: '11px' }}>
                          {new Date(evt.startIso).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          –{' '}
                          {new Date(evt.endIso).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {evt.location ? ` • ${evt.location}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const next = calendarEvents.filter((e) => e.id !== evt.id);
                          setCalendarEvents(next);
                          saveCalendarEvents(next);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#64748B',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Test Calendar Event to See Live Conflict Re-Calculation */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={newEventTitle}
                    onChange={(e) => setNewEventTitle(e.target.value)}
                    placeholder="Event title..."
                    style={{
                      flex: 1,
                      background: '#0B0F17',
                      border: '1px solid #334155',
                      color: '#F8FAFC',
                      borderRadius: '8px',
                      padding: '7px 10px',
                      fontSize: '12px',
                    }}
                  />
                  <select
                    value={newEventStartHour}
                    onChange={(e) => setNewEventStartHour(Number(e.target.value))}
                    style={{
                      background: '#0B0F17',
                      border: '1px solid #334155',
                      color: '#F8FAFC',
                      borderRadius: '8px',
                      padding: '7px',
                      fontSize: '12px',
                    }}
                  >
                    {Array.from({ length: 14 }, (_, i) => i + 7).map((h) => (
                      <option key={h} value={h}>
                        Today {h}:00
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const start = new Date();
                      start.setHours(newEventStartHour, 0, 0, 0);
                      const end = new Date(start.getTime() + newEventDurationMin * 60_000);
                      const created: CalendarEvent = {
                        id: `evt-${Date.now()}`,
                        title: newEventTitle.trim() || 'Busy Block',
                        startIso: start.toISOString(),
                        endIso: end.toISOString(),
                        source: 'google_oauth',
                      };
                      const next = [...calendarEvents, created];
                      setCalendarEvents(next);
                      saveCalendarEvents(next);
                    }}
                    style={{
                      background: '#1E293B',
                      color: '#00E5FF',
                      border: '1px solid #00E5FF',
                      borderRadius: '8px',
                      padding: '7px 12px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    + Add Event
                  </button>
                </div>
              </div>

              {/* Configurable Weather & Air Quality Safety Thresholds (Phase 4) */}
              <div
                style={{
                  background: '#111827',
                  border: '1px solid #1E293B',
                  borderRadius: '20px',
                  padding: '20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sliders size={18} color="#CCFF00" />
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
                      Weather & Air Quality Thresholds
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      setWeatherThresholds(DEFAULT_WEATHER_THRESHOLDS);
                      storageService.saveWeatherThresholds(DEFAULT_WEATHER_THRESHOLDS);
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid #334155',
                      color: '#94A3B8',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Reset Defaults
                  </button>
                </div>

                <p style={{ fontSize: '12px', color: '#94A3B8', margin: '0 0 12px' }}>
                  Source: <strong style={{ color: '#CBD5E1' }}>{weatherProviderName}</strong>. Any forecast hour violating these limits is flagged as Too Cold, Heat Stress, High Wind, Rain Risk, or Poor AQI.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span>Too Cold Threshold (Min Temp / Feels Like)</span>
                      <strong style={{ color: '#00E5FF' }}>
                        {weatherThresholds.minTempC}°C / Feels {weatherThresholds.minFeelsLikeC}°C
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={-10}
                      max={12}
                      value={weatherThresholds.minTempC}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const next = {
                          ...weatherThresholds,
                          minTempC: val,
                          minFeelsLikeC: val - 3,
                        };
                        setWeatherThresholds(next);
                        storageService.saveWeatherThresholds(next);
                      }}
                      style={{ width: '100%', accentColor: '#00E5FF' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span>Too Hot Threshold (Max Temp / Feels Like)</span>
                      <strong style={{ color: '#F97316' }}>
                        {weatherThresholds.maxTempC}°C / Feels {weatherThresholds.maxFeelsLikeC}°C
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={18}
                      max={38}
                      value={weatherThresholds.maxTempC}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const next = {
                          ...weatherThresholds,
                          maxTempC: val,
                          maxFeelsLikeC: val + 4,
                        };
                        setWeatherThresholds(next);
                        storageService.saveWeatherThresholds(next);
                      }}
                      style={{ width: '100%', accentColor: '#F97316' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span>Max Safe Wind Speed</span>
                      <strong style={{ color: '#CCFF00' }}>{weatherThresholds.maxWindKph} km/h</strong>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={60}
                      step={5}
                      value={weatherThresholds.maxWindKph}
                      onChange={(e) => {
                        const next = {
                          ...weatherThresholds,
                          maxWindKph: Number(e.target.value),
                        };
                        setWeatherThresholds(next);
                        storageService.saveWeatherThresholds(next);
                      }}
                      style={{ width: '100%', accentColor: '#CCFF00' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span>Max Rain Probability</span>
                      <strong style={{ color: '#00E5FF' }}>{weatherThresholds.maxRainProbPct}%</strong>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={80}
                      step={5}
                      value={weatherThresholds.maxRainProbPct}
                      onChange={(e) => {
                        const next = {
                          ...weatherThresholds,
                          maxRainProbPct: Number(e.target.value),
                        };
                        setWeatherThresholds(next);
                        storageService.saveWeatherThresholds(next);
                      }}
                      style={{ width: '100%', accentColor: '#00E5FF' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span>Max Air Quality Index (US AQI)</span>
                      <strong style={{ color: '#10B981' }}>AQI {weatherThresholds.maxAqi}</strong>
                    </div>
                    <input
                      type="range"
                      min={40}
                      max={180}
                      step={10}
                      value={weatherThresholds.maxAqi}
                      onChange={(e) => {
                        const next = {
                          ...weatherThresholds,
                          maxAqi: Number(e.target.value),
                        };
                        setWeatherThresholds(next);
                        storageService.saveWeatherThresholds(next);
                      }}
                      style={{ width: '100%', accentColor: '#10B981' }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Hourly Weather Forecast Strip with Safety Flags */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
              }}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 800 }}>
                Hourly Weather, Feels-Like, Wind, Rain & Air Quality Forecast
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: '10px',
                }}
              >
                {forecastHours.slice(0, 12).map((hr) => (
                  <div
                    key={hr.isoTime}
                    style={{
                      background: '#0B0F17',
                      border:
                        hr.flags.length === 0
                          ? '1px solid #1E293B'
                          : hr.flags.some((f) => f.severity === 'unsafe')
                            ? '1px solid #F43F5E'
                            : '1px solid #F59E0B',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>
                        {new Date(hr.isoTime).toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span
                        style={{
                          color: hr.safetyScore >= 75 ? '#10B981' : hr.safetyScore >= 55 ? '#F59E0B' : '#F43F5E',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {hr.safetyScore}pts
                      </span>
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, margin: '4px 0', fontFamily: 'JetBrains Mono, monospace' }}>
                      {hr.tempC}°C{' '}
                      <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 500 }}>
                        (feels {hr.feelsLikeC}°C)
                      </span>
                    </div>
                    <div style={{ color: '#94A3B8', fontSize: '11px' }}>
                      💧 {hr.precipProbPct}% • 💨 {hr.windSpeedKph} km/h • AQI {hr.aqi}
                    </div>
                    {hr.flags.length > 0 ? (
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {hr.flags.map((fl, i) => (
                          <span
                            key={i}
                            title={fl.detail}
                            style={{
                              background:
                                fl.severity === 'unsafe'
                                  ? 'rgba(244,63,94,0.2)'
                                  : 'rgba(245,158,11,0.2)',
                              color: fl.severity === 'unsafe' ? '#FDA4AF' : '#FDE68A',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 700,
                            }}
                          >
                            {fl.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ marginTop: '6px', fontSize: '10px', color: '#10B981', fontWeight: 700 }}>
                        ✓ Safe Running Conditions
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 4: RUN HISTORY & REPLAY ANIMATION (Phase 2 & 3)
           =================================================================== */}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Aggregate Lifetime Stats */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
              }}
            >
              <div style={{ background: '#111827', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Total Runs</div>
                <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#CCFF00' }}>
                  {runHistory.length}
                </div>
              </div>
              <div style={{ background: '#111827', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Total Distance</div>
                <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>
                  {runHistory.reduce((acc, r) => acc + r.distanceKm, 0).toFixed(2)} km
                </div>
              </div>
              <div style={{ background: '#111827', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Total Elevation Gain</div>
                <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#00E5FF' }}>
                  +{runHistory.reduce((acc, r) => acc + r.elevationGainM, 0)} m
                </div>
              </div>
              <div style={{ background: '#111827', padding: '16px', borderRadius: '16px', border: '1px solid #1E293B' }}>
                <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Total Active Calories</div>
                <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#F97316' }}>
                  {runHistory.reduce((acc, r) => acc + r.calories, 0)} kcal
                </div>
              </div>
            </div>

            {/* Run History Cards */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
              }}
            >
              <h2 style={{ margin: '0 0 14px', fontSize: '19px', fontWeight: 800 }}>
                Completed Run Log & Animated Replays
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {runHistory.map((run) => (
                  <div
                    key={run.id}
                    style={{
                      background: '#0B0F17',
                      border: '1px solid #1E293B',
                      borderRadius: '16px',
                      padding: '16px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '14px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: '17px' }}>{run.title}</span>
                        {run.healthSync?.synced && (
                          <span
                            style={{
                              fontSize: '11px',
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#10B981',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: 600,
                            }}
                          >
                            ✓ Health Synced
                          </span>
                        )}
                        {!run.syncedToCloud && (
                          <span
                            style={{
                              fontSize: '11px',
                              background: 'rgba(245, 158, 11, 0.15)',
                              color: '#F59E0B',
                              padding: '2px 8px',
                              borderRadius: '999px',
                            }}
                          >
                            Offline Queued
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '4px' }}>
                        {new Date(run.startedAt).toLocaleString('en-GB', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {run.weatherSummary &&
                          ` • ${run.weatherSummary.tempC}°C ${run.weatherSummary.condition}`}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: '18px',
                          marginTop: '10px',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '14px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>
                          <strong style={{ color: '#CCFF00' }}>{run.distanceKm.toFixed(2)} km</strong>
                        </span>
                        <span>
                          Pace: <strong>{formatPace(run.avgPaceSecPerKm)} /km</strong>
                        </span>
                        <span>
                          Time: <strong>{formatDuration(run.durationSec)}</strong>
                        </span>
                        <span style={{ color: '#00E5FF' }}>+{run.elevationGainM}m</span>
                        <span style={{ color: '#F97316' }}>{run.calories} kcal</span>
                        {run.avgHeartRate && (
                          <span style={{ color: '#FB7185' }}>
                            ♥ {run.avgHeartRate} bpm{' '}
                            {run.restingHeartRate ? `(Rest ${run.restingHeartRate})` : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleInitiateHealthSync(run)}
                        style={{
                          background: '#1E293B',
                          color: '#10B981',
                          border: '1px solid #10B981',
                          borderRadius: '10px',
                          padding: '10px 14px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {run.healthSync?.synced ? 'Re-Sync Health' : 'Sync to Health'}
                      </button>

                      <button
                        onClick={() => setSelectedReplayRun(run)}
                        style={{
                          background: '#CCFF00',
                          color: '#0B0F17',
                          border: 'none',
                          borderRadius: '10px',
                          padding: '10px 16px',
                          fontSize: '12px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Play size={14} fill="#0B0F17" /> Replay Run & Map
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 5: AUTH, HEALTH INTEGRATIONS & PRIVACY CENTER (Phases 1, 7, 8)
           =================================================================== */}
        {activeTab === 'settings' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '18px',
            }}
          >
            {/* Supabase Auth & Runner Profile */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <User size={18} color="#CCFF00" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
                  Runner Account & Supabase Auth
                </h3>
              </div>

              <div
                style={{
                  background: '#0B0F17',
                  border: '1px solid #1E293B',
                  borderRadius: '12px',
                  padding: '12px',
                  marginBottom: '14px',
                  fontSize: '12px',
                }}
              >
                <div>
                  <strong>Auth Mode:</strong>{' '}
                  <span style={{ color: ENV_STATUS.hasSupabase ? '#10B981' : '#00E5FF' }}>
                    {ENV_STATUS.hasSupabase
                      ? 'Supabase PostgreSQL Cloud + RLS'
                      : 'Local-First Sandbox (Add EXPO_PUBLIC_SUPABASE_URL in .env for cloud sync)'}
                  </span>
                </div>
                {user && (
                  <div style={{ marginTop: '4px', color: '#94A3B8' }}>
                    Active User ID: <code>{user.id}</code> ({user.email})
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input
                  type="text"
                  value={authNameInput}
                  onChange={(e) => setAuthNameInput(e.target.value)}
                  placeholder="Display Name"
                  style={{
                    background: '#0B0F17',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontSize: '13px',
                  }}
                />
                <input
                  type="email"
                  value={authEmailInput}
                  onChange={(e) => setAuthEmailInput(e.target.value)}
                  placeholder="Email address"
                  style={{
                    background: '#0B0F17',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontSize: '13px',
                  }}
                />
                <input
                  type="password"
                  value={authPasswordInput}
                  onChange={(e) => setAuthPasswordInput(e.target.value)}
                  placeholder="Password (for live Supabase Auth)"
                  style={{
                    background: '#0B0F17',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontSize: '13px',
                  }}
                />

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={async () => {
                      try {
                        const signedIn = await storageService.signIn(
                          authEmailInput,
                          authPasswordInput,
                          authNameInput
                        );
                        setUser(signedIn);
                        setAuthStatusMsg(`Signed in as ${signedIn.displayName}`);
                        showToast('Authenticated', `Welcome, ${signedIn.displayName}!`, 'lime');
                      } catch (err) {
                        setAuthStatusMsg((err as Error).message);
                      }
                    }}
                    style={{
                      flex: 1,
                      background: '#CCFF00',
                      color: '#0B0F17',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '10px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Sign In / Update Profile
                  </button>

                  {user && (
                    <button
                      onClick={async () => {
                        await storageService.signOut();
                        setUser(null);
                        showToast('Signed Out', 'Session cleared.', 'cyan');
                      }}
                      style={{
                        background: '#1E293B',
                        color: '#F8FAFC',
                        border: '1px solid #334155',
                        borderRadius: '10px',
                        padding: '10px 14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Sign Out
                    </button>
                  )}
                </div>
                {authStatusMsg && (
                  <div style={{ fontSize: '12px', color: '#10B981' }}>{authStatusMsg}</div>
                )}
              </div>
            </div>

            {/* Apple HealthKit & Google Health Connect Management */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Heart size={18} color="#FB7185" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
                  Apple HealthKit & Google Health Connect
                </h3>
              </div>

              <p style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.5 }}>
                Configure how StrideSmart writes completed runs (distance, duration, route, calories) and reads Heart Rate & Resting HR on iOS and Android.
              </p>

              <div
                style={{
                  background: '#0B0F17',
                  border: '1px solid #1E293B',
                  borderRadius: '12px',
                  padding: '12px',
                  marginBottom: '14px',
                  fontSize: '12px',
                }}
              >
                <div>
                  <strong>Active Bridge:</strong>{' '}
                  {healthPermissions.platform === 'ios_healthkit'
                    ? 'Apple HealthKit (iOS)'
                    : 'Google Health Connect (Android)'}
                </div>
                <div style={{ marginTop: '4px', color: healthPermissions.connected ? '#10B981' : '#F59E0B' }}>
                  Status: {healthPermissions.connected ? '✓ Authorized' : 'Not yet authorized (asks only when needed)'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setShowHealthModal(true)}
                  style={{
                    background: '#10B981',
                    color: '#0B0F17',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    fontWeight: 800,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Configure Health Scopes
                </button>

                {healthPermissions.connected && (
                  <button
                    onClick={() => {
                      const reset = disconnectHealthIntegration(healthPermissions.platform);
                      setHealthPermissions(reset);
                      showToast(
                        'Health Integration Disconnected',
                        'Revoked HealthKit / Health Connect read & write permissions.',
                        'amber'
                      );
                    }}
                    style={{
                      background: '#1E293B',
                      color: '#FDA4AF',
                      border: '1px solid #F43F5E',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect Health
                  </button>
                )}
              </div>
            </div>

            {/* Privacy, Least-Privilege Permissions & Data Deletion Center */}
            <div
              style={{
                background: '#111827',
                border: '1px solid #1E293B',
                borderRadius: '20px',
                padding: '20px',
                gridColumn: 'span 2',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Shield size={18} color="#00E5FF" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
                  Privacy by Design, API Key Security & Data Deletion
                </h3>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '12px',
                  marginBottom: '16px',
                  fontSize: '12px',
                }}
              >
                <div style={{ background: '#0B0F17', padding: '12px', borderRadius: '12px', border: '1px solid #1E293B' }}>
                  <strong style={{ color: '#CCFF00' }}>📍 Location (Foreground & Background)</strong>
                  <p style={{ color: '#94A3B8', margin: '4px 0 0' }}>
                    Requested only when tracking a run or centering the route planner. Never tracked when idle.
                  </p>
                </div>
                <div style={{ background: '#0B0F17', padding: '12px', borderRadius: '12px', border: '1px solid #1E293B' }}>
                  <strong style={{ color: '#00E5FF' }}>📅 Google Calendar (Read-Only)</strong>
                  <p style={{ color: '#94A3B8', margin: '4px 0 0' }}>
                    Uses minimal <code>calendar.readonly</code> scope solely to check free/busy windows. Never modifies your calendar.
                  </p>
                </div>
                <div style={{ background: '#0B0F17', padding: '12px', borderRadius: '12px', border: '1px solid #1E293B' }}>
                  <strong style={{ color: '#FB7185' }}>❤️ Apple Health / Health Connect</strong>
                  <p style={{ color: '#94A3B8', margin: '4px 0 0' }}>
                    Just-in-time permission prompt when syncing a run. Disconnectable with one click.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Want a clean slate? You can permanently delete all saved routes, run logs, calendar tokens, and preferences.
                </div>
                <button
                  onClick={async () => {
                    await storageService.deleteAllUserData(user?.id);
                    setRunHistory([]);
                    setSavedRoutes([]);
                    setCalendarConnected(false);
                    setHealthPermissions(
                      disconnectHealthIntegration(healthPermissions.platform)
                    );
                    showToast(
                      'All User Data Deleted',
                      'Wiped all runs, saved routes, calendar tokens, and health permissions.',
                      'rose'
                    );
                  }}
                  style={{
                    background: 'rgba(244, 63, 94, 0.16)',
                    color: '#FDA4AF',
                    border: '1px solid #F43F5E',
                    borderRadius: '10px',
                    padding: '10px 16px',
                    fontWeight: 800,
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Trash2 size={15} /> Delete All My Data
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Post-Run Summary & Animated Replay Modal (Phase 2 & 3) */}
      {selectedReplayRun && (
        <RunReplayModal
          run={selectedReplayRun}
          healthPermissions={healthPermissions}
          onClose={() => setSelectedReplayRun(null)}
          onSyncHealthClick={(run) => handleInitiateHealthSync(run)}
        />
      )}

      {/* Just-in-Time Health Permission Modal (Phase 7) */}
      {showHealthModal && (
        <HealthPermissionModal
          initialState={healthPermissions}
          onCancel={() => {
            setShowHealthModal(false);
            setPendingHealthSyncRun(null);
          }}
          onSavePermissions={async (updated) => {
            setHealthPermissions(updated);
            saveHealthPermissions(updated);
            setShowHealthModal(false);
            if (pendingHealthSyncRun) {
              await executeHealthSync(pendingHealthSyncRun, updated);
              setPendingHealthSyncRun(null);
            } else {
              showToast(
                'Health Permissions Updated',
                `Connected to ${
                  updated.platform === 'ios_healthkit'
                    ? 'Apple HealthKit'
                    : 'Google Health Connect'
                }.`,
                'cyan'
              );
            }
          }}
        />
      )}

      {/* Bottom Navigation Bar */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1200,
          backgroundColor: 'rgba(11, 15, 23, 0.95)',
          backdropFilter: 'blur(14px)',
          borderTop: '1px solid #1E293B',
          padding: '8px 16px',
        }}
      >
        <div
          style={{
            maxWidth: '680px',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '6px',
          }}
        >
          {[
            { id: 'track', label: 'Run Tracker', icon: Navigation },
            { id: 'routes', label: 'Routes', icon: Route },
            { id: 'coach', label: 'Smart Coach', icon: Sparkles },
            { id: 'history', label: 'History', icon: History },
            { id: 'settings', label: 'Privacy & Auth', icon: Shield },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as AppTab)}
                style={{
                  background: isActive ? 'rgba(204, 255, 0, 0.12)' : 'transparent',
                  color: isActive ? '#CCFF00' : '#94A3B8',
                  border: isActive
                    ? '1px solid rgba(204, 255, 0, 0.35)'
                    : '1px solid transparent',
                  borderRadius: '12px',
                  padding: '8px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: isActive ? 800 : 600,
                }}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
