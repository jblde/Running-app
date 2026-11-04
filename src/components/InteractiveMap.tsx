import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ENV, ENV_STATUS } from '../config/env';
import { GeoPoint } from '../types/models';

export interface InteractiveMapProps {
  center: GeoPoint;
  routeCoords: GeoPoint[];
  guideRouteCoords?: GeoPoint[];
  waypoints?: GeoPoint[];
  currentPosition?: GeoPoint | null;
  replayMarkerPosition?: GeoPoint | null;
  interactiveDrawMode?: boolean;
  onMapClickAddPoint?: (point: GeoPoint) => void;
  height?: string;
  fitBoundsKey?: string;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  center,
  routeCoords,
  guideRouteCoords,
  waypoints = [],
  currentPosition,
  replayMarkerPosition,
  interactiveDrawMode = false,
  onMapClickAddPoint,
  height = '380px',
  fitBoundsKey,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const guidePolylineRef = useRef<L.Polyline | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const replayMarkerRef = useRef<L.CircleMarker | null>(null);
  const clickCallbackRef = useRef(onMapClickAddPoint);
  const drawModeRef = useRef(interactiveDrawMode);

  useEffect(() => {
    clickCallbackRef.current = onMapClickAddPoint;
    drawModeRef.current = interactiveDrawMode;
  }, [onMapClickAddPoint, interactiveDrawMode]);

  // Initialize Leaflet Map instance once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 14,
      zoomControl: true,
      attributionControl: false,
    });

    // Use Mapbox Dark tiles if EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is present, otherwise CartoDB Dark Matter
    const tileUrl = ENV_STATUS.hasMapbox
      ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${ENV.MAPBOX_ACCESS_TOKEN}`
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    L.tileLayer(tileUrl, {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    const markerGroup = L.layerGroup().addTo(map);
    markerLayerRef.current = markerGroup;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (drawModeRef.current && clickCallbackRef.current) {
        clickCallbackRef.current({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6)),
          ele: 22,
        });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update polylines & markers whenever coordinates change
  useEffect(() => {
    const map = mapRef.current;
    const markerGroup = markerLayerRef.current;
    if (!map || !markerGroup) return;

    markerGroup.clearLayers();

    if (guidePolylineRef.current) {
      guidePolylineRef.current.remove();
      guidePolylineRef.current = null;
    }

    if (routePolylineRef.current) {
      routePolylineRef.current.remove();
      routePolylineRef.current = null;
    }

    // 1. Optional background guide route (dashed cyan)
    if (guideRouteCoords && guideRouteCoords.length > 1) {
      const latlngs = guideRouteCoords.map((p) => [p.lat, p.lng] as [number, number]);
      guidePolylineRef.current = L.polyline(latlngs, {
        color: '#00E5FF',
        weight: 4,
        opacity: 0.4,
        dashArray: '8, 8',
      }).addTo(map);
    }

    // 2. Primary route polyline (glowing Strava-inspired electric lime)
    if (routeCoords.length > 1) {
      const latlngs = routeCoords.map((p) => [p.lat, p.lng] as [number, number]);
      routePolylineRef.current = L.polyline(latlngs, {
        color: '#CCFF00',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Start marker (green circle)
      const startPt = routeCoords[0];
      L.circleMarker([startPt.lat, startPt.lng], {
        radius: 7,
        fillColor: '#10B981',
        color: '#0B0F17',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip('Start', { direction: 'top' })
        .addTo(markerGroup);

      // End marker (checkered/orange circle)
      const endPt = routeCoords[routeCoords.length - 1];
      L.circleMarker([endPt.lat, endPt.lng], {
        radius: 7,
        fillColor: '#F97316',
        color: '#0B0F17',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip('Finish', { direction: 'top' })
        .addTo(markerGroup);
    }

    // 3. Waypoint pins in Route Planner mode
    waypoints.forEach((wp, idx) => {
      L.circleMarker([wp.lat, wp.lng], {
        radius: 6,
        fillColor: idx === 0 ? '#10B981' : '#00E5FF',
        color: '#0B0F17',
        weight: 2,
        fillOpacity: 0.95,
      })
        .bindTooltip(`Waypoint #${idx + 1}`, { direction: 'top' })
        .addTo(markerGroup);
    });

    // 4. Current Live GPS Position dot
    if (currentPosition) {
      // Outer pulse halo
      L.circleMarker([currentPosition.lat, currentPosition.lng], {
        radius: 14,
        fillColor: '#00E5FF',
        color: '#00E5FF',
        weight: 1,
        fillOpacity: 0.22,
      }).addTo(markerGroup);

      L.circleMarker([currentPosition.lat, currentPosition.lng], {
        radius: 7,
        fillColor: '#00E5FF',
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip('Your Live GPS Location', { direction: 'top' })
        .addTo(markerGroup);
    }
  }, [routeCoords, guideRouteCoords, waypoints, currentPosition]);

  // Fit bounds when requested (e.g. when a new route is generated or selected)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const targetPts =
      routeCoords.length > 1
        ? routeCoords
        : guideRouteCoords && guideRouteCoords.length > 1
          ? guideRouteCoords
          : [];

    if (targetPts.length > 1) {
      const bounds = L.latLngBounds(targetPts.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    } else {
      map.setView([center.lat, center.lng], 14);
    }
  }, [fitBoundsKey]);

  // Smoothly update Animated Replay Marker at 60fps without rebuilding the whole map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!replayMarkerPosition) {
      if (replayMarkerRef.current) {
        replayMarkerRef.current.remove();
        replayMarkerRef.current = null;
      }
      return;
    }

    if (!replayMarkerRef.current) {
      replayMarkerRef.current = L.circleMarker(
        [replayMarkerPosition.lat, replayMarkerPosition.lng],
        {
          radius: 9,
          fillColor: '#F97316',
          color: '#FFFFFF',
          weight: 3,
          fillOpacity: 1,
        }
      ).addTo(map);
    } else {
      replayMarkerRef.current.setLatLng([
        replayMarkerPosition.lat,
        replayMarkerPosition.lng,
      ]);
    }
  }, [replayMarkerPosition]);

  return (
    <div style={{ position: 'relative', width: '100%', height, borderRadius: '16px', overflow: 'hidden', border: '1px solid #1E293B' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#090D14' }} />
      {interactiveDrawMode && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 52,
            zIndex: 500,
            background: 'rgba(11, 15, 23, 0.88)',
            border: '1px solid #00E5FF',
            color: '#00E5FF',
            padding: '6px 12px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 600,
            pointerEvents: 'none',
          }}
        >
          ✏️ Tap anywhere on map to place custom route waypoints
        </div>
      )}
    </div>
  );
};
