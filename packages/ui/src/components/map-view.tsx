'use client';

import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  /** Shown as the pin's tooltip and used by assistive technology through the list view. */
  label: string;
  /** Bookable pins are filled; listed pins are a ring (shape, not colour alone: A-02 pin legend). */
  kind: 'bookable' | 'listed';
}

export interface MapViewProps {
  points: readonly MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /**
   * Raster tile URL template (`{z}/{x}/{y}`), from configuration (MAPS_AND_GEOCODING: tiles behind
   * a configurable URL; production tiles are open, OQ-17).
   */
  tileUrl: string;
  /** Tile attribution, always shown, for example "© OpenStreetMap contributors". */
  attribution: string;
  /** Accessible name of the map region. */
  label: string;
  /** Shown instead of the map when the browser has no WebGL. */
  unavailableText: string;
  className?: string;
}

const SOURCE = 'labs';

function hasWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
  } catch {
    return false;
  }
}

function toGeoJson(points: readonly MapPoint[], selectedId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      id: point.id,
      properties: {
        id: point.id,
        label: point.label,
        bookable: point.kind === 'bookable',
        selected: point.id === selectedId,
      },
      geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
    })),
  };
}

/** Reads a token from the page so the map uses the design colours, not literals (DR-13). */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/**
 * The search map (COMPONENT_SPECIFICATION "MapView"; boards B1 and H2): MapLibre GL with clustered
 * pins and the selected pin in sync with the list. The map is not keyboard-operable on its own;
 * the list view next to it is the accessible way to reach every lab (H2 list/map toggle).
 */
export function MapView({
  points,
  selectedId = null,
  onSelect,
  tileUrl,
  attribution,
  label,
  unavailableText,
  className,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [supported, setSupported] = useState(true);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!hasWebGl()) {
      setSupported(false);
      return;
    }
    let cancelled = false;
    void import('maplibre-gl').then(({ Map: MapClass, LngLatBounds }) => {
      if (cancelled || container.current === null) return;
      const instance = new MapClass({
        container: container.current,
        style: {
          version: 8,
          sources: {
            tiles: { type: 'raster', tiles: [tileUrl], tileSize: 256, attribution },
          },
          layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }],
        },
        center: [78.9, 22.6],
        zoom: 4,
        attributionControl: { compact: false },
      });
      map.current = instance;
      instance.on('load', () => {
        const primary = token('--color-brand-primary', '#1f6fa8');
        const surface = token('--color-surface-raised', '#ffffff');
        const strong = token('--color-brand-on-tint', '#13476d');
        instance.addSource(SOURCE, {
          type: 'geojson',
          data: toGeoJson(points, selectedId),
          cluster: true,
          clusterRadius: 40,
        });
        instance.addLayer({
          id: 'clusters',
          type: 'circle',
          source: SOURCE,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': primary,
            'circle-opacity': 0.18,
            'circle-stroke-color': primary,
            'circle-stroke-width': 2,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
          },
        });
        instance.addLayer({
          id: 'pins',
          type: 'circle',
          source: SOURCE,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': ['case', ['get', 'selected'], 10, 7],
            'circle-color': ['case', ['get', 'bookable'], primary, surface],
            'circle-stroke-color': ['case', ['get', 'selected'], strong, primary],
            'circle-stroke-width': ['case', ['get', 'selected'], 4, 3],
          },
        });
        instance.on(
          'click',
          'pins',
          (event: MapMouseEvent & { features?: { properties: { id?: string } }[] }) => {
            const id = event.features?.[0]?.properties.id;
            if (id !== undefined) onSelectRef.current?.(id);
          },
        );
        instance.on('click', 'clusters', (event: MapMouseEvent) => {
          instance.easeTo({ center: event.lngLat, zoom: instance.getZoom() + 2 });
        });
        if (points.length > 0) {
          const bounds = new LngLatBounds();
          for (const point of points) bounds.extend([point.lng, point.lat]);
          instance.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
        }
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // Created once per tile source: points and the selection are pushed by the effect below.
  }, [tileUrl, attribution]);

  useEffect(() => {
    const source = map.current?.getSource<GeoJSONSource>(SOURCE);
    void source?.setData(toGeoJson(points, selectedId));
  }, [points, selectedId]);

  if (!supported) {
    return (
      <div
        role="note"
        className={cn(
          'flex min-h-64 items-center justify-center rounded-md border border-dashed border-border p-6 text-center text-text-muted',
          className,
        )}
      >
        {unavailableText}
      </div>
    );
  }
  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className={cn('min-h-64 overflow-hidden rounded-md border border-border', className)}
    />
  );
}
