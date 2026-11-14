import { useEffect, useId, useRef, useState } from 'react';
import type { Polygon } from 'geojson';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './orbitFarm-scenes.css';

interface BoundaryMapProps {
  boundary: Polygon | null;
  onChange: (boundary: Polygon | null) => void;
  error?: string | null;
}

type MapPoint = [number, number];

const DEMO_BOUNDARY: Polygon = {
  type: 'Polygon',
  coordinates: [[[34.79, 30.85], [34.79235, 30.85], [34.79235, 30.852], [34.79, 30.852], [34.79, 30.85]]],
};

function pointsFromBoundary(boundary: Polygon | null): MapPoint[] {
  return boundary ? boundary.coordinates[0].slice(0, -1).map((position) => [position[1], position[0]]) : [];
}

export function BoundaryMap({ boundary, onChange, error }: BoundaryMapProps) {
  const fieldId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawingRef = useRef<L.LayerGroup | null>(null);
  const [points, setPoints] = useState<MapPoint[]>(() => pointsFromBoundary(boundary));
  const [closed, setClosed] = useState(Boolean(boundary));
  const [latitude, setLatitude] = useState('30.851');
  const [longitude, setLongitude] = useState('34.791');
  const [pointError, setPointError] = useState<string | null>(null);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const emittedBoundaryRef = useRef<string | null>(null);
  const closedRef = useRef(closed);
  const pointsRef = useRef(points);
  const finishRef = useRef<() => void>(() => {});
  closedRef.current = closed;

  const replacePoints = (next: MapPoint[]) => {
    pointsRef.current = next;
    setPoints(next);
  };

  useEffect(() => {
    if (emittedBoundaryRef.current === JSON.stringify(boundary)) {
      emittedBoundaryRef.current = null;
      return;
    }
    replacePoints(pointsFromBoundary(boundary));
    closedRef.current = Boolean(boundary);
    setClosed(Boolean(boundary));
  }, [boundary]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [30.851, 34.791],
      zoom: 17,
      zoomControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
    });
    mapRef.current = map;
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    tiles.on('tileerror', () => setTilesUnavailable(true));
    drawingRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (closedRef.current || event.originalEvent.detail > 1) return;
      const previous = pointsRef.current;
      // A closing click belongs to the first corner, not to a new vertex.
      const cornerIndex = previous.findIndex((corner) => map.latLngToContainerPoint(corner).distanceTo(event.containerPoint) <= 12);
      if (cornerIndex !== -1) {
        if (cornerIndex === 0 && previous.length >= 3) finishRef.current();
        return;
      }
      const point = event.latlng.wrap();
      setPointError(null);
      replacePoints([...previous, [Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))]]);
    });
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      drawingRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = drawingRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (points.length > 1) {
      if (closed) {
        L.polygon(points, { color: error ? '#9B422E' : '#203D32', weight: 4, dashArray: '8 5', fillColor: error ? '#9B422E' : '#286B45', fillOpacity: 0.16, lineCap: 'square' }).addTo(layer);
      } else {
        L.polyline(points, { color: '#286B45', weight: 3, dashArray: '7 5' }).addTo(layer);
      }
    }
    points.forEach((point, index) => {
      L.circleMarker(point, { radius: 6, color: '#203D32', weight: 2, fillColor: '#FFF8E8', fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(index === 0 && !closed && points.length >= 3 ? 'Click to close boundary' : `Corner ${index + 1}`, { direction: 'top' })
        .on('click', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          if (!closedRef.current && index === 0 && pointsRef.current.length >= 3) finishRef.current();
        })
        .addTo(layer);
    });
  }, [points, closed, error]);

  useEffect(() => {
    if (boundary && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(pointsFromBoundary(boundary)), { padding: [40, 40], maxZoom: 18, animate: false });
    }
  }, [boundary]);

  const addPoint = () => {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (closed) { setPointError('Clear the boundary before drawing a new one.'); return; }
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setPointError('Enter a latitude from -90 to 90 and a longitude from -180 to 180.');
      return;
    }
    if (pointsRef.current.some((point) => point[0] === lat && point[1] === lon)) { setPointError('This corner was already added. Choose another position.'); return; }
    replacePoints([...pointsRef.current, [lat, lon]]);
    mapRef.current?.panTo([lat, lon], { animate: false });
    setPointError(null);
  };

  const emitBoundary = (value: Polygon | null) => {
    emittedBoundaryRef.current = JSON.stringify(value);
    onChange(value);
  };

  const finish = () => {
    if (closedRef.current) return;
    if (pointsRef.current.length < 3) { setPointError('Add at least three corners to close your boundary.'); return; }
    const ring = pointsRef.current.map(([lat, lon]) => [lon, lat]);
    closedRef.current = true;
    setClosed(true);
    setPointError(null);
    emitBoundary({ type: 'Polygon', coordinates: [[...ring, [...ring[0]]]] });
  };
  finishRef.current = finish;

  const undo = () => {
    replacePoints(pointsRef.current.slice(0, -1));
    closedRef.current = false;
    setClosed(false);
    setPointError(null);
    if (boundary) emitBoundary(null);
  };

  const clear = () => {
    replacePoints([]);
    closedRef.current = false;
    setClosed(false);
    setPointError(null);
    emitBoundary(null);
  };

  return (
    <div className="of-boundary-editor">
      <div className="of-map-instruction"><span className="of-map-instruction-dot" /><span>{closed ? 'Boundary closed' : 'Place corners, then close the boundary.'}</span></div>
      <div ref={containerRef} className="of-boundary-map" aria-label="Field boundary map" data-testid="boundary-map" />
      {tilesUnavailable && <p className="of-map-tile-note" role="status">Map tiles unavailable. Boundary tools still work.</p>}
      <div className="of-map-toolbar">
        <p className="of-map-corner-count" aria-live="polite">{points.length} {points.length === 1 ? 'corner' : 'corners'} placed <span>· {closed ? 'Closed boundary' : 'Drawing'}</span></p>
        <div className="of-map-actions">
          <button type="button" className="of-map-button" onClick={undo} disabled={points.length === 0}>Undo point</button>
          <button type="button" className="of-map-button" onClick={clear} disabled={points.length === 0}>Clear boundary</button>
          <button type="button" className="of-map-button of-map-button-primary" onClick={finish} disabled={points.length < 3 || closed}>Finish boundary</button>
        </div>
      </div>
      <div className="of-map-shortcut"><button type="button" onClick={() => { const demo = structuredClone(DEMO_BOUNDARY); replacePoints(pointsFromBoundary(demo)); closedRef.current = true; setClosed(true); setPointError(null); emitBoundary(demo); }} className="of-map-text-button">Use demo boundary</button></div>
      <details className="of-coordinate-entry">
        <summary>Enter coordinates instead</summary>
        <div className="of-coordinate-fields">
          <label htmlFor={`${fieldId}-lat`}>Latitude<input id={`${fieldId}-lat`} type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPoint(); } }} /></label>
          <label htmlFor={`${fieldId}-lon`}>Longitude<input id={`${fieldId}-lon`} type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPoint(); } }} /></label>
          <button type="button" className="of-map-button" onClick={addPoint} disabled={closed}>Add point</button>
        </div>
      </details>
      {(pointError || error) && <p className="of-boundary-error" role="alert">{pointError || error}</p>}
    </div>
  );
}
