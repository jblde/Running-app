import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  Flame,
  Heart,
  Mountain,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Timer,
  X,
} from 'lucide-react';
import { HealthPermissionState, RunRecord } from '../types/models';
import {
  formatDuration,
  formatPace,
  interpolateReplayPoint,
} from '../utils/geoMath';
import { InteractiveMap } from './InteractiveMap';

interface RunReplayModalProps {
  run: RunRecord;
  healthPermissions: HealthPermissionState;
  onClose: () => void;
  onSyncHealthClick: (run: RunRecord) => void;
}

export const RunReplayModal: React.FC<RunReplayModalProps> = ({
  run,
  healthPermissions,
  onClose,
  onSyncHealthClick,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(15); // 15x default so a 25-min run replays in ~100s
  const [elapsedCursorSec, setElapsedCursorSec] = useState<number>(0);

  const maxElapsedSec = useMemo(() => {
    if (run.routePoints.length === 0) return run.durationSec || 1;
    return Math.max(
      1,
      run.routePoints[run.routePoints.length - 1].elapsedSec || run.durationSec
    );
  }, [run]);

  // 60fps requestAnimationFrame loop for smooth marker motion along the GPS path
  useEffect(() => {
    if (!isPlaying) return;
    let frameId: number;
    let lastTick = performance.now();

    const step = (now: number) => {
      const dtSec = (now - lastTick) / 1000;
      lastTick = now;

      setElapsedCursorSec((prev) => {
        const next = prev + dtSec * playbackSpeed;
        if (next >= maxElapsedSec) {
          setIsPlaying(false);
          return maxElapsedSec;
        }
        return next;
      });
      frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, playbackSpeed, maxElapsedSec]);

  const currentTelemetry = useMemo(
    () => interpolateReplayPoint(run.routePoints, elapsedCursorSec),
    [run.routePoints, elapsedCursorSec]
  );

  const progressRatio = Math.min(1, Math.max(0, elapsedCursorSec / maxElapsedSec));

  // Elevation profile SVG polyline coordinates
  const elevationSvgPath = useMemo(() => {
    const pts = run.routePoints;
    if (pts.length < 2) return '';
    const eles = pts.map((p) => p.ele ?? 20);
    const minE = Math.min(...eles) - 2;
    const maxE = Math.max(...eles) + 2;
    const spanE = Math.max(1, maxE - minE);

    return pts
      .map((p, idx) => {
        const x = (idx / (pts.length - 1)) * 600;
        const y = 78 - (((p.ele ?? 20) - minE) / spanE) * 66;
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [run.routePoints]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: 'rgba(6, 9, 15, 0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '92vh',
          overflowY: 'auto',
          backgroundColor: '#111827',
          border: '1px solid #1E293B',
          borderRadius: '20px',
          padding: '24px',
          color: '#F8FAFC',
          boxShadow: '0 24px 48px rgba(0,0,0,0.65)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '16px',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  background: 'rgba(204, 255, 0, 0.14)',
                  color: '#CCFF00',
                  border: '1px solid rgba(204, 255, 0, 0.35)',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: '999px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Post-Run Summary & Animated Replay
              </span>
              {run.healthSync?.synced && (
                <span
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10B981',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <CheckCircle2 size={12} />
                  Synced to{' '}
                  {run.healthSync.provider === 'apple_healthkit'
                    ? 'Apple HealthKit'
                    : 'Google Health Connect'}
                </span>
              )}
            </div>
            <h2 style={{ margin: '8px 0 4px', fontSize: '22px', fontWeight: 800 }}>
              {run.title}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>
              {new Date(run.startedAt).toLocaleString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {run.weatherSummary &&
                ` • ${run.weatherSummary.tempC}°C (${run.weatherSummary.condition}) • AQI ${run.weatherSummary.aqi}`}
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close run summary"
            style={{
              background: '#1E293B',
              border: '1px solid #334155',
              color: '#F8FAFC',
              borderRadius: '10px',
              padding: '8px',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Top Hero Stats Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          <div style={{ background: '#0B0F17', padding: '12px 14px', borderRadius: '12px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Distance</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: 800, color: '#CCFF00' }}>
              {run.distanceKm.toFixed(2)} <span style={{ fontSize: '13px', fontWeight: 600 }}>km</span>
            </div>
          </div>

          <div style={{ background: '#0B0F17', padding: '12px 14px', borderRadius: '12px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Avg Pace</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: 800 }}>
              {formatPace(run.avgPaceSecPerKm)} <span style={{ fontSize: '13px', color: '#94A3B8' }}>/km</span>
            </div>
          </div>

          <div style={{ background: '#0B0F17', padding: '12px 14px', borderRadius: '12px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Duration</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: 800 }}>
              {formatDuration(run.durationSec)}
            </div>
          </div>

          <div style={{ background: '#0B0F17', padding: '12px 14px', borderRadius: '12px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Elevation Gain</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: 800, color: '#00E5FF' }}>
              +{run.elevationGainM} <span style={{ fontSize: '13px' }}>m</span>
            </div>
          </div>

          <div style={{ background: '#0B0F17', padding: '12px 14px', borderRadius: '12px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Active Calories</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: 800, color: '#F97316' }}>
              {run.calories} <span style={{ fontSize: '13px' }}>kcal</span>
            </div>
          </div>

          <div style={{ background: '#0B0F17', padding: '12px 14px', borderRadius: '12px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Heart Rate (Avg / Rest)</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '20px', fontWeight: 800, color: '#FB7185' }}>
              {run.avgHeartRate ? `${run.avgHeartRate} bpm` : '--'}{' '}
              <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                {run.restingHeartRate ? `(Rest ${run.restingHeartRate})` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Map + Animated Replay Marker */}
        <InteractiveMap
          center={run.routePoints[0] ?? { lat: 54.9069, lng: -1.3838 }}
          routeCoords={run.routePoints}
          replayMarkerPosition={currentTelemetry}
          height="320px"
          fitBoundsKey={`replay-${run.id}`}
        />

        {/* Replay Scrubber & Live Interpolated Telemetry Bar */}
        <div
          style={{
            marginTop: '14px',
            background: '#0B0F17',
            border: '1px solid #1E293B',
            borderRadius: '14px',
            padding: '14px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => {
                  if (elapsedCursorSec >= maxElapsedSec) {
                    setElapsedCursorSec(0);
                  }
                  setIsPlaying((p) => !p);
                }}
                style={{
                  background: '#CCFF00',
                  color: '#0B0F17',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '8px 14px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                {isPlaying ? 'Pause Replay' : 'Play Replay'}
              </button>

              <button
                onClick={() => {
                  setElapsedCursorSec(0);
                  setIsPlaying(true);
                }}
                title="Restart Replay"
                style={{
                  background: '#1E293B',
                  color: '#F8FAFC',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <RotateCcw size={15} />
              </button>

              {/* Speed multiplier buttons */}
              <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
                {[1, 5, 15, 30].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    style={{
                      background: playbackSpeed === spd ? '#00E5FF' : '#1E293B',
                      color: playbackSpeed === spd ? '#0B0F17' : '#94A3B8',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '5px 9px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            {/* Instantaneous Telemetry at Replay Marker */}
            {currentTelemetry && (
              <div
                style={{
                  display: 'flex',
                  gap: '16px',
                  fontSize: '13px',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                <span>
                  <strong style={{ color: '#CCFF00' }}>
                    {currentTelemetry.distanceFromStartKm.toFixed(2)} km
                  </strong>
                </span>
                <span>
                  Pace: <strong>{formatPace(currentTelemetry.paceSecPerKm)}/km</strong>
                </span>
                <span>
                  Ele: <strong style={{ color: '#00E5FF' }}>{currentTelemetry.ele ?? 20}m</strong>
                </span>
                {currentTelemetry.heartRate && (
                  <span>
                    HR: <strong style={{ color: '#FB7185' }}>{currentTelemetry.heartRate} bpm</strong>
                  </span>
                )}
                <span style={{ color: '#94A3B8' }}>
                  {formatDuration(elapsedCursorSec)} / {formatDuration(maxElapsedSec)}
                </span>
              </div>
            )}
          </div>

          {/* Interactive Scrubber Slider */}
          <input
            type="range"
            min={0}
            max={maxElapsedSec}
            step={1}
            value={Math.round(elapsedCursorSec)}
            onChange={(e) => {
              setIsPlaying(false);
              setElapsedCursorSec(Number(e.target.value));
            }}
            style={{ width: '100%', accentColor: '#CCFF00', cursor: 'pointer' }}
          />

          {/* Synchronized Elevation Profile SVG */}
          {elevationSvgPath && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Elevation Profile & Replay Position
              </div>
              <svg
                viewBox="0 0 600 84"
                style={{
                  width: '100%',
                  height: '68px',
                  background: '#111827',
                  borderRadius: '8px',
                  border: '1px solid #1E293B',
                }}
              >
                <path
                  d={elevationSvgPath}
                  fill="none"
                  stroke="#00E5FF"
                  strokeWidth="2.5"
                />
                <line
                  x1={progressRatio * 600}
                  y1={0}
                  x2={progressRatio * 600}
                  y2={84}
                  stroke="#F97316"
                  strokeWidth="2"
                  strokeDasharray="3,3"
                />
                <circle
                  cx={progressRatio * 600}
                  cy={42}
                  r={5}
                  fill="#F97316"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Splits + Health Sync Footer */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            marginTop: '16px',
          }}
        >
          {/* Kilometer Splits Table */}
          <div
            style={{
              background: '#0B0F17',
              border: '1px solid #1E293B',
              borderRadius: '14px',
              padding: '14px',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Timer size={16} color="#CCFF00" /> Kilometer Splits
            </div>
            {run.splits.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                Run under 1.0 km — full route telemetry recorded ({run.routePoints.length} GPS samples).
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {run.splits.map((sp) => (
                  <div
                    key={sp.kilometer}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      padding: '6px 10px',
                      background: '#111827',
                      borderRadius: '8px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    <span>KM {sp.kilometer}</span>
                    <span style={{ color: '#CCFF00', fontWeight: 700 }}>
                      {formatPace(sp.paceSecPerKm)} /km
                    </span>
                    <span style={{ color: '#94A3B8' }}>
                      {sp.elevationDiffM >= 0 ? `+${sp.elevationDiffM}m` : `${sp.elevationDiffM}m`}
                    </span>
                    {sp.avgHeartRate && (
                      <span style={{ color: '#FB7185' }}>{sp.avgHeartRate} bpm</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Apple HealthKit / Google Health Connect Sync Card */}
          <div
            style={{
              background: '#0B0F17',
              border: '1px solid #1E293B',
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Heart size={16} color="#FB7185" /> Apple Health & Google Health Connect
              </div>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '0 0 12px', lineHeight: 1.5 }}>
                Exports workout distance ({run.distanceKm.toFixed(2)} km), duration ({formatDuration(run.durationSec)}),
                active energy ({run.calories} kcal), and {run.routePoints.length} GPS route points, and optionally imports
                Heart Rate & Resting HR.
              </p>
            </div>

            <button
              onClick={() => onSyncHealthClick(run)}
              style={{
                background: run.healthSync?.synced ? '#1E293B' : '#10B981',
                color: run.healthSync?.synced ? '#10B981' : '#0B0F17',
                border: run.healthSync?.synced ? '1px solid #10B981' : 'none',
                borderRadius: '10px',
                padding: '10px 14px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Activity size={16} />
              {run.healthSync?.synced
                ? `Re-Sync with ${
                    healthPermissions.platform === 'ios_healthkit'
                      ? 'Apple HealthKit'
                      : 'Google Health Connect'
                  }`
                : `Sync Run to ${
                    healthPermissions.platform === 'ios_healthkit'
                      ? 'Apple Health (iOS)'
                      : 'Health Connect (Android)'
                  }`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
