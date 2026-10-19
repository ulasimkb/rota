import { useState, useMemo, useEffect, useRef, useId } from 'react'
import { getLocations, findRoutes, findClosestLocation, getLocationCoords, findNearbyStops } from './utils/routeFinder'
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet';
import stopsData from './data/stops.json';
import closedStops from './data/closedStops';
import BottomSheet from './BottomSheet';
import { SNAP, PEEK_HEIGHT, HALF_RATIO, useViewportHeight } from './sheetConfig';

// Leaflet draws on canvas, which cannot resolve CSS variables, so the
// tokens from index.css are read once at runtime (hex values are fallbacks).
const readToken = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const getMapColors = () => ({
  primary: readToken('--accent-primary', '#6366f1'),
  success: readToken('--accent-success', '#10b981'),
  warning: readToken('--accent-warning', '#f59e0b'),
  stroke: readToken('--map-marker-stroke', '#ffffff')
});

const MOBILE_QUERY = '(max-width: 768px)';

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

const formatDistance = (km) => {
  if (!Number.isFinite(km) || km >= 99999) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${numberFormat.format(km)} km`;
};

const TILE_ICONS = {
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  voyager: (
    <>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </>
  ),
  satellite: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
    </>
  )
};

const MAP_TILES = {
  dark: {
    name: 'Gece',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labelsUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri'
  },
  voyager: {
    name: 'Sokak',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  satellite: {
    name: 'Uydu',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics'
  }
};

const normalize = (text) => text.toLocaleLowerCase('tr');

function ArrowIcon({ size = 14 }) {
  return (
    <svg className="inline-arrow" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function RouteLabel({ from, to }) {
  return (
    <>
      {from} <ArrowIcon /><span className="sr-only">→</span> {to}
    </>
  );
}

const createCustomMarker = (type) => {
  return L.divIcon({
    html: `
      <div class="marker-pin-outer ${type}">
        <div class="pulse-ring"></div>
        <div class="marker-pin-inner"></div>
      </div>
    `,
    className: 'custom-leaflet-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const startIcon = createCustomMarker('start');
const endIcon = createCustomMarker('end');
const transferIcon = createCustomMarker('transfer');

function MapUpdater({ sourceCoords, destCoords, transferCoords, bottomInset = 0 }) {
  const map = useMap();
  useEffect(() => {
    const points = [];
    if (sourceCoords) points.push(sourceCoords);
    if (transferCoords) points.push(transferCoords);
    if (destCoords) points.push(destCoords);

    if (points.length >= 2) {
      const bounds = L.latLngBounds(points);
      // Keep the route clear of the mobile bottom sheet
      map.fitBounds(bounds, { paddingTopLeft: [60, 60], paddingBottomRight: [60, 60 + bottomInset] });
    } else if (points.length === 1) {
      map.setView(points[0], 14);
    }
  }, [sourceCoords, destCoords, transferCoords, bottomInset, map]);
  return null;
}

// Accessible on/off switch for map layers
function LayerSwitch({ checked, onToggle, variant, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`layer-switch ${variant}`}
      onClick={onToggle}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{children}</span>
    </button>
  );
}

// Searchable Autocomplete Select Dropdown (ARIA combobox pattern)
function Autocomplete({ label, value, onChange, options, placeholder, icon, onLocationClick, locating, disabledOptions = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (idx) => `${baseId}-opt-${idx}`;

  const filteredOptions = useMemo(() => {
    if (!searchQuery || searchQuery === value) return options;
    const query = normalize(searchQuery);
    return options.filter(opt => normalize(opt).includes(query));
  }, [options, searchQuery, value]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const el = listRef.current?.querySelector(`[data-index="${highlightedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const selectOption = (val) => {
    if (disabledOptions.includes(val)) return;
    onChange(val);
    setSearchQuery(val);
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1) % Math.max(filteredOptions.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 + filteredOptions.length) % Math.max(filteredOptions.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        selectOption(filteredOptions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const activeDescendant = isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length
    ? optionId(highlightedIndex)
    : undefined;

  return (
    <div className="input-container" ref={containerRef}>
      <div className="input-label-row">
        <label className="input-label" htmlFor={inputId}>{label}</label>
      </div>
      <div className="autocomplete-wrapper">
        <div className="input-field-wrapper">
          <span className="input-icon-left" aria-hidden="true">{icon}</span>
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            autoComplete="off"
            className="autocomplete-input"
            placeholder={placeholder}
            value={isOpen ? searchQuery : (value || '')}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setHighlightedIndex(0);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => {
              setIsOpen(true);
              setSearchQuery('');
            }}
            onBlur={() => {
              setIsOpen(false);
              setSearchQuery(value || '');
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="input-actions-right">
            {value && (
              <button
                type="button"
                className="input-action-btn"
                onClick={() => {
                  onChange('');
                  setSearchQuery('');
                }}
                aria-label={`${label} alanını temizle`}
                title="Temizle"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
            {onLocationClick && (
              <button
                type="button"
                className={`input-action-btn ${locating ? 'is-locating' : ''}`}
                onClick={onLocationClick}
                disabled={locating}
                aria-label={locating ? 'Konumunuz alınıyor' : 'Konumumu kullan'}
                title="Konumumu Kullan"
              >
                {locating ? (
                  <svg className="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10" strokeDasharray="30 10"></circle></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                )}
              </button>
            )}
          </div>
        </div>

        {isOpen && filteredOptions.length === 0 && (
          <div className="autocomplete-dropdown autocomplete-no-results" role="status">Mahalle bulunamadı</div>
        )}

        {isOpen && filteredOptions.length > 0 && (
          <ul className="autocomplete-dropdown" id={listId} role="listbox" aria-label={label} ref={listRef}>
            {filteredOptions.map((opt, idx) => {
                const isDisabled = disabledOptions.includes(opt);
                const isSelected = opt === value;
                return (
                  <li
                    key={opt}
                    id={optionId(idx)}
                    data-index={idx}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={isDisabled || undefined}
                    className={`autocomplete-item ${idx === highlightedIndex ? 'highlighted' : ''} ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectOption(opt);
                    }}
                  >
                    <svg className="autocomplete-item-dot" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg>
                    <span>{opt}</span>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}

function App() {
  const [source, setSource] = useState('')
  const [destination, setDestination] = useState('')
  const [routeResult, setRouteResult] = useState(null)
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0)
  const [locating, setLocating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showStops, setShowStops] = useState(false)
  const [showClosedStops, setShowClosedStops] = useState(false)
  const [sheetSnap, setSheetSnap] = useState(SNAP.PEEK)
  const [activeTileKey, setActiveTileKey] = useState('voyager')

  const locations = useMemo(() => getLocations(), [])
  const mapColors = useMemo(() => getMapColors(), [])
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const viewportHeight = useViewportHeight()
  const sheetRef = useRef(null)
  const resultsRef = useRef(null)
  // Collapsed bottom sheet: keep hidden content out of tab order and screen readers
  const isSheetContentHidden = isMobile && sheetSnap === SNAP.PEEK
  const isSheetOpen = sheetSnap !== SNAP.PEEK
  // Map area covered by the sheet, so fitted routes stay visible above it
  const mapBottomInset = !isMobile ? 0
    : sheetSnap === SNAP.HALF ? Math.round(viewportHeight * HALF_RATIO)
    : PEEK_HEIGHT

  // On mobile, show map and route together once results arrive
  const showResults = (result) => {
    if (!isMobile || !result) return
    setSheetSnap(SNAP.HALF)
    requestAnimationFrame(() => {
      const sheet = sheetRef.current
      const results = resultsRef.current
      if (sheet && results) sheet.scrollTo({ top: results.offsetTop - PEEK_HEIGHT })
    })
  }

  // Auto-search when endpoints are fully selected
  const handleSearch = () => {
    if (!source || !destination) return
    const result = findRoutes(source, destination)
    setRouteResult(result)
    setSelectedRouteIndex(0) // Default to first route option
    showResults(result)
  }

  // Swap source and destination values
  const handleSwap = () => {
    const newSource = destination;
    const newDest = source;
    setSource(newSource);
    setDestination(newDest);
    if (newSource && newDest && newSource !== newDest) {
      const result = findRoutes(newSource, newDest);
      setRouteResult(result);
      setSelectedRouteIndex(0);
      showResults(result);
    }
  };

  const findMyLocation = () => {
    setLocating(true)
    setErrorMsg('')
    if (!navigator.geolocation) {
      setErrorMsg('Tarayıcınız konum özelliğini desteklemiyor.');
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const closest = findClosestLocation(pos.coords.latitude, pos.coords.longitude);
        if (closest) {
          setSource(closest);
        } else {
          setErrorMsg('Yakınınızda durak bulunamadı.');
        }
        setLocating(false);
      },
      () => {
        setErrorMsg('Konum alınamadı: Lütfen tarayıcı izinlerini kontrol edin.');
        setLocating(false);
      }
    );
  }

  const sourceCoords = useMemo(() => source ? getLocationCoords(source) : null, [source])
  const destCoords = useMemo(() => destination ? getLocationCoords(destination) : null, [destination])

  // Get active route coordinates for map styling
  const activeRoute = useMemo(() => {
    if (routeResult && routeResult.routes && routeResult.routes.length > 0) {
      return routeResult.routes[selectedRouteIndex] || null;
    }
    return null;
  }, [routeResult, selectedRouteIndex]);

  const transferCoords = useMemo(() => {
    if (routeResult?.type === 'transfer' && activeRoute?.transferPoint) {
      return getLocationCoords(activeRoute.transferPoint);
    }
    return null;
  }, [routeResult, activeRoute]);

  // Keyboard/screen-reader alternative to the canvas stop markers
  const nearbyStops = useMemo(() => {
    if (!routeResult || !sourceCoords || !destCoords) return null;
    return {
      source: findNearbyStops(sourceCoords[0], sourceCoords[1], stopsData),
      destination: findNearbyStops(destCoords[0], destCoords[1], stopsData)
    };
  }, [routeResult, sourceCoords, destCoords]);

  // Text announced to screen readers when a search finishes
  const resultAnnouncement = !routeResult
    ? ''
    : routeResult.type === 'none'
      ? `${source} ile ${destination} arasında rota bulunamadı.`
      : `${routeResult.routes.length} rota seçeneği bulundu: ${routeResult.type === 'direct' ? 'direkt hat' : 'aktarmalı'}.`;

  const defaultCenter = [39.4242, 29.9833]; // Kütahya default center

  return (
    <div className="dashboard-container">
      {/* Sidebar / Bottom Sheet Panel */}
      <BottomSheet
        id="route-panel"
        label="Rota planlayıcı"
        isMobile={isMobile}
        snap={sheetSnap}
        onSnapChange={setSheetSnap}
        sheetRef={sheetRef}
        handle={
          <button
            type="button"
            className="bottom-sheet-handle-bar"
            onClick={() => setSheetSnap(isSheetOpen ? SNAP.PEEK : routeResult ? SNAP.HALF : SNAP.FULL)}
            aria-expanded={isSheetOpen}
            aria-controls="route-panel-content"
          >
            <span className="handle-pill" aria-hidden="true"></span>
            <span className="mobile-handle-info">
              <span className="mobile-handle-title">
                {routeResult && source && destination ? <RouteLabel from={source} to={destination} /> : 'Rota Planlayıcı'}
              </span>
              <span className="mobile-handle-action">
                {isSheetOpen ? 'Haritayı Gör' : 'Rotaları Gör'}
                <svg className={`handle-chevron ${isSheetOpen ? 'is-down' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
              </span>
            </span>
          </button>
        }
      >
        <div id="route-panel-content" className="sidebar-content" inert={isSheetContentHidden}>
        <header className="sidebar-header">
          <div className="brand-section">
            <div className="brand-icon-wrapper" aria-hidden="true">
              <svg className="brand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="15" rx="2" ry="2"></rect><line x1="6" y1="21" x2="6" y2="18"></line><line x1="18" y1="21" x2="18" y2="18"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>
            </div>
            <h1 className="brand-title">Rota Kütahya</h1>
          </div>
          <p className="brand-subtitle">Mahalleler arası akıllı toplu taşıma ve aktarma kılavuzu</p>
        </header>

        <div role="alert">
          {errorMsg && (
            <div className="error-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="search-panel">
          <Autocomplete
            label="Kalkış Noktası"
            value={source}
            onChange={setSource}
            options={locations}
            placeholder="Kalkış mahallesi arayın..."
            disabledOptions={[destination]}
            onLocationClick={findMyLocation}
            locating={locating}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>}
          />

          {/* Swap Origin / Destination Button */}
          <div className="swap-button-container">
            <button
              type="button"
              className="swap-button"
              onClick={handleSwap}
              disabled={!source && !destination}
              aria-label="Kalkış ve varış noktalarını yer değiştir"
              title="Kalkış ve Varış Noktalarını Değiştir"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 16V4M7 4L3 8M7 4L11 8" />
                <path d="M17 8V20M17 20L21 16M17 20L13 16" />
              </svg>
            </button>
          </div>

          <Autocomplete
            label="Varış Noktası"
            value={destination}
            onChange={setDestination}
            options={locations}
            placeholder="Varış mahallesi arayın..."
            disabledOptions={[source]}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>}
          />

          <button
            type="button"
            className="search-button"
            onClick={handleSearch}
            disabled={!source || !destination || source === destination}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>Rota Planla</span>
          </button>

          <div className="layer-switches">
            <LayerSwitch
              checked={showStops}
              variant="stops"
              onToggle={() => {
                setShowStops((current) => !current)
                setShowClosedStops(false)
              }}
            >
              Tüm Durakları Haritada Göster ({stopsData.length})
            </LayerSwitch>

            <LayerSwitch
              checked={showClosedStops}
              variant="closed"
              onToggle={() => {
                setShowClosedStops((current) => !current)
                setShowStops(false)
              }}
            >
              Kapalı Durakları Haritada Göster ({closedStops.length})
            </LayerSwitch>

            <p className="layer-hint">
              Durak üstüne tıklayarak ilgili durak hakkında bilgi alabilirsiniz.
            </p>
          </div>
        </div>

        {/* Results Area inside Sidebar */}
        <section className="results-container" aria-label="Rota sonuçları" ref={resultsRef}>
          <p className="sr-only" aria-live="polite">{resultAnnouncement}</p>
          {!routeResult ? (
            <div className="results-placeholder">
              <svg className="results-placeholder-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
              <div>
                <h2 className="results-title">Güzergah Hazır Değil</h2>
                <p className="results-placeholder-text">Başlangıç ve varış mahallelerini seçip "Rota Planla" butonuna tıklayarak aramayı başlatın.</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="results-info-row">
                <h2 className="results-route-summary"><RouteLabel from={source} to={destination} /></h2>
                <span className={`results-type-pill ${routeResult.type}`}>
                  {routeResult.type === 'direct' ? 'Direkt Hat' : routeResult.type === 'transfer' ? 'Aktarmalı' : 'Rota Yok'}
                </span>
              </div>

              {routeResult.type === 'direct' && (
                <div className="route-list">
                  {routeResult.routes.map((r, idx) => (
                    <button
                      type="button"
                      key={idx}
                      className={`route-card direct ${selectedRouteIndex === idx ? 'selected-card' : ''}`}
                      aria-pressed={selectedRouteIndex === idx}
                      onClick={() => setSelectedRouteIndex(idx)}
                    >
                      <span className="route-card-header">
                        <span className="results-type-pill direct">Seçenek {idx + 1}</span>
                        <span className="route-card-meta">~{r.score} sefer/gün</span>
                      </span>
                      <span className="transit-timeline">
                        <span className="timeline-step">
                          <span className="timeline-dot start"></span>
                          <span className="timeline-title">{source}</span>
                          <span className="timeline-desc">Başlangıç Noktası</span>
                        </span>
                        <span className="timeline-line-row">
                          <span className="line-badge success-badge">{r.line}</span>
                          <span className="timeline-line-text">Hattı ile doğrudan ulaşım</span>
                        </span>
                        <span className="timeline-step">
                          <span className="timeline-dot end"></span>
                          <span className="timeline-title">{destination}</span>
                          <span className="timeline-desc">Varış Noktası</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {routeResult.type === 'transfer' && (
                <div className="route-list">
                  {routeResult.routes.map((r, idx) => (
                    <button
                      type="button"
                      key={idx}
                      className={`route-card transfer ${selectedRouteIndex === idx ? 'selected-card' : ''}`}
                      aria-pressed={selectedRouteIndex === idx}
                      onClick={() => setSelectedRouteIndex(idx)}
                    >
                      <span className="route-card-header">
                        <span className="results-type-pill transfer">Seçenek {idx + 1}</span>
                        <span className="route-card-meta">
                          ~{r.freqLimit} sefer/gün
                          {formatDistance(r.rawDist) && <> · kuş uçuşu {formatDistance(r.rawDist)}</>}
                        </span>
                      </span>
                      <span className="transit-timeline">
                        <span className="timeline-step">
                          <span className="timeline-dot start"></span>
                          <span className="timeline-title">{source}</span>
                          <span className="timeline-desc">
                            <span>Binilecek Hat:</span>
                            <span className="line-badge">{r.line1}</span>
                          </span>
                        </span>
                        <span className="timeline-step">
                          <span className="timeline-dot transfer"></span>
                          <span className="timeline-title">{r.transferPoint}</span>
                          <span className="timeline-desc">
                            <span>Burada Aktarma Yapın</span>
                            <ArrowIcon size={12} />
                            <span className="line-badge success-badge">{r.line2}</span>
                          </span>
                        </span>
                        <span className="timeline-step">
                          <span className="timeline-dot end"></span>
                          <span className="timeline-title">{destination}</span>
                          <span className="timeline-desc">Varış Noktası</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {routeResult.type === 'none' && (
                <div className="no-route-card">
                  <svg className="no-route-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <p className="no-route-title">Rota Bulunamadı</p>
                  <p>Bu iki mahalle arasında doğrudan veya tek aktarmalı bir rota bulunmamaktadır. Lütfen merkez durakları kullanarak ulaşmayı deneyin.</p>
                </div>
              )}
            </div>
          )}

          {nearbyStops && (
            <details className="nearby-stops">
              <summary>Kalkış ve varış çevresindeki duraklar</summary>
              {[
                { title: `${source} yakınında`, stops: nearbyStops.source },
                { title: `${destination} yakınında`, stops: nearbyStops.destination }
              ].map(group => (
                <div className="nearby-group" key={group.title}>
                  <h3 className="nearby-title">{group.title}</h3>
                  <ul className="nearby-list">
                    {group.stops.map(stop => (
                      <li key={stop.name}>
                        <span>{stop.name}</span>
                        <span className="nearby-dist">{formatDistance(stop.dist)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}
        </section>
        </div>
      </BottomSheet>

      {/* Map Display Panel */}
      <main className="map-panel" aria-label="Harita">
        <div className="map-wrapper-inner">
          {/* Floating Map Tile Switcher */}
          <div className="map-tile-switcher" role="group" aria-label="Harita görünümü">
            {Object.entries(MAP_TILES).map(([key, tile]) => (
              <button
                key={key}
                type="button"
                className={`tile-switcher-btn ${activeTileKey === key ? 'active' : ''}`}
                aria-pressed={activeTileKey === key}
                onClick={() => setActiveTileKey(key)}
              >
                <svg className="tile-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {TILE_ICONS[key]}
                </svg>
                <span className="tile-name">{tile.name}</span>
              </button>
            ))}
          </div>

          <MapContainer center={defaultCenter} zoom={13} zoomControl={true} preferCanvas={true}>
            <TileLayer
              key={activeTileKey}
              url={MAP_TILES[activeTileKey].url}
              attribution={MAP_TILES[activeTileKey].attribution}
            />
            {MAP_TILES[activeTileKey].labelsUrl && (
              <TileLayer
                key={`${activeTileKey}-labels`}
                url={MAP_TILES[activeTileKey].labelsUrl}
              />
            )}
            <MapUpdater sourceCoords={sourceCoords} destCoords={destCoords} transferCoords={transferCoords} bottomInset={mapBottomInset} />

            {sourceCoords && (
              <Marker position={sourceCoords} icon={startIcon} alt={`Kalkış: ${source}`}>
                <Popup>Kalkış: {source}</Popup>
              </Marker>
            )}

            {transferCoords && (
              <Marker position={transferCoords} icon={transferIcon} alt={`Aktarma: ${activeRoute?.transferPoint}`}>
                <Popup>Aktarma Noktası: {activeRoute?.transferPoint}</Popup>
              </Marker>
            )}

            {destCoords && (
              <Marker position={destCoords} icon={endIcon} alt={`Varış: ${destination}`}>
                <Popup>Varış: {destination}</Popup>
              </Marker>
            )}

            {/* Direct Line Polyline */}
            {sourceCoords && destCoords && routeResult?.type === 'direct' && (
              <Polyline
                positions={[sourceCoords, destCoords]}
                pathOptions={{ color: mapColors.success, weight: 4, dashArray: '8, 8', opacity: 0.8 }}
              />
            )}

            {/* Transfer Path Polyline */}
            {sourceCoords && transferCoords && destCoords && routeResult?.type === 'transfer' && (
              <>
                <Polyline
                  positions={[sourceCoords, transferCoords]}
                  pathOptions={{ color: mapColors.primary, weight: 4, opacity: 0.9 }}
                />
                <Polyline
                  positions={[transferCoords, destCoords]}
                  pathOptions={{ color: mapColors.success, weight: 4, opacity: 0.9, dashArray: '4, 6' }}
                />
              </>
            )}

            {showStops && stopsData.map((stop, idx) => (
              <CircleMarker
                key={idx}
                center={[stop.lat, stop.lng]}
                radius={4.5}
                pathOptions={{
                  fillColor: mapColors.primary,
                  fillOpacity: 0.85,
                  color: mapColors.stroke,
                  weight: 1.5
                }}
              >
                <Popup>
                  <div className="map-popup-title">{stop.name}</div>
                </Popup>
              </CircleMarker>
            ))}

            {showClosedStops && closedStops.map(([type, lat, lng], idx) => (
              <CircleMarker
                key={idx}
                center={[lat, lng]}
                radius={5.5}
                pathOptions={{
                  fillColor: mapColors.warning,
                  fillOpacity: 0.9,
                  color: mapColors.stroke,
                  weight: 1.5
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={0.95} sticky>
                  <strong>{type}</strong>
                </Tooltip>
                <Popup>
                  <div className="map-popup-title">{type}</div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </main>
    </div>
  )
}

export default App
