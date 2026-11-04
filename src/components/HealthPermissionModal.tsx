import React, { useState } from 'react';
import { Check, Heart, Lock, MapPin, ShieldCheck, Smartphone, X } from 'lucide-react';
import { HealthPermissionState } from '../types/models';

interface HealthPermissionModalProps {
  initialState: HealthPermissionState;
  onCancel: () => void;
  onSavePermissions: (updated: HealthPermissionState) => void;
}

export const HealthPermissionModal: React.FC<HealthPermissionModalProps> = ({
  initialState,
  onCancel,
  onSavePermissions,
}) => {
  const [platform, setPlatform] = useState<'ios_healthkit' | 'android_health_connect'>(
    initialState.platform
  );
  const [writeWorkouts, setWriteWorkouts] = useState<boolean>(
    initialState.writeWorkoutsGranted || true
  );
  const [writeRoute, setWriteRoute] = useState<boolean>(
    initialState.writeRouteGranted || true
  );
  const [readHr, setReadHr] = useState<boolean>(
    initialState.readHeartRateGranted || true
  );
  const [readRestingHr, setReadRestingHr] = useState<boolean>(
    initialState.readRestingHrGranted || true
  );

  const handleConfirm = () => {
    onSavePermissions({
      platform,
      connected: writeWorkouts,
      writeWorkoutsGranted: writeWorkouts,
      writeRouteGranted: writeRoute,
      readHeartRateGranted: readHr,
      readRestingHrGranted: readRestingHr,
      lastSyncedAt: new Date().toISOString(),
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2200,
        backgroundColor: 'rgba(6, 9, 15, 0.85)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: '#111827',
          border: '1px solid #1E293B',
          borderRadius: '20px',
          padding: '24px',
          color: '#F8FAFC',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={22} color="#10B981" />
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>
              Health Integration Permissions
            </h3>
          </div>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '13px', color: '#94A3B8', lineHeight: 1.5, marginTop: '8px' }}>
          Privacy by design: StrideSmart only asks for health permissions when you choose to sync a run.
          You can choose which scopes to grant below and disconnect at any time in Settings.
        </p>

        {/* Platform Selector */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', margin: '14px 0' }}>
          <button
            onClick={() => setPlatform('ios_healthkit')}
            style={{
              padding: '10px',
              borderRadius: '10px',
              border:
                platform === 'ios_healthkit'
                  ? '2px solid #CCFF00'
                  : '1px solid #334155',
              background: platform === 'ios_healthkit' ? 'rgba(204,255,0,0.1)' : '#0B0F17',
              color: '#F8FAFC',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Smartphone size={15} color="#CCFF00" />
            Apple HealthKit (iOS)
          </button>

          <button
            onClick={() => setPlatform('android_health_connect')}
            style={{
              padding: '10px',
              borderRadius: '10px',
              border:
                platform === 'android_health_connect'
                  ? '2px solid #00E5FF'
                  : '1px solid #334155',
              background:
                platform === 'android_health_connect' ? 'rgba(0,229,255,0.1)' : '#0B0F17',
              color: '#F8FAFC',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Heart size={15} color="#00E5FF" />
            Health Connect (Android)
          </button>
        </div>

        {/* Granular Scopes List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '16px 0' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: '#0B0F17',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid #1E293B',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={writeWorkouts}
              onChange={(e) => setWriteWorkouts(e.target.checked)}
              style={{ marginTop: '3px', accentColor: '#10B981' }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>
                Write Runs (Distance, Duration & Active Calories) — Required
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
                Saves completed running sessions to{' '}
                {platform === 'ios_healthkit'
                  ? 'HKWorkoutActivityTypeRunning'
                  : 'ExerciseSessionRecord'}{' '}
                so your daily activity goals stay accurate.
              </div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: '#0B0F17',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid #1E293B',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={writeRoute}
              onChange={(e) => setWriteRoute(e.target.checked)}
              style={{ marginTop: '3px', accentColor: '#10B981' }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>
                Write Workout GPS Route Map — Optional
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
                Attaches your GPS breadcrumb coordinates ({platform === 'ios_healthkit' ? 'HKWorkoutRoute' : 'ExerciseRoute'}) to the workout record.
              </div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: '#0B0F17',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid #1E293B',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={readHr}
              onChange={(e) => setReadHr(e.target.checked)}
              style={{ marginTop: '3px', accentColor: '#10B981' }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>
                Read Workout Heart Rate — Optional
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
                Reads heart rate samples recorded by your watch/strap during the run to show average & peak BPM on your Run Summary.
              </div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: '#0B0F17',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid #1E293B',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={readRestingHr}
              onChange={(e) => setReadRestingHr(e.target.checked)}
              style={{ marginTop: '3px', accentColor: '#10B981' }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>
                Read Resting Heart Rate — Optional
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
                Displays your daily resting heart rate alongside your run effort to help monitor recovery.
              </div>
            </div>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onCancel}
            style={{
              background: '#1E293B',
              color: '#F8FAFC',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '10px 16px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Not Now
          </button>

          <button
            onClick={handleConfirm}
            disabled={!writeWorkouts}
            style={{
              background: writeWorkouts ? '#CCFF00' : '#334155',
              color: '#0B0F17',
              border: 'none',
              borderRadius: '10px',
              padding: '10px 18px',
              fontWeight: 800,
              cursor: writeWorkouts ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Check size={16} />
            Authorize & Sync Run
          </button>
        </div>
      </div>
    </div>
  );
};
