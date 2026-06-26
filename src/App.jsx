import { useState, useMemo, useEffect, useRef } from 'react'
import { getLocations, findRoutes, findClosestLocation, getLocationCoords } from './utils/routeFinder'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet';

// Custom Leaflet Pin Markers using CSS / SVG
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

function MapUpdater({ sourceCoords, destCoords, transferCoords }) {
  const map = useMap();
  useEffect(() => {
    const points = [];
    if (sourceCoords) points.push(sourceCoords);
    if (transferCoords) points.push(transferCoords);
    if (destCoords) points.push(destCoords);

    if (points.length >= 2) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [60, 60] });
    } else if (points.length === 1) {
      map.setView(points[0], 14);
    }
  }, [sourceCoords, destCoords, transferCoords, map]);
  return null;
}

// Searchable Autocomplete Select Dropdown
function Autocomplete({ label, value, onChange, options, placeholder, icon, onLocationClick, locating, disabledOptions = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);

  const filteredOptions = useMemo(() => {
    if (!searchQuery || searchQuery === value) return options;
    return options.filter(opt =>
      opt.toLowerCase().includes(searchQuery.toLowerCase())
    );
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
        const val = filteredOptions[highlightedIndex];
        if (!disabledOptions.includes(val)) {
          onChange(val);
          setSearchQuery(val);
          setIsOpen(false);
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="input-container" ref={containerRef}>
      <div className="input-label-row">
        <span className="input-label">{label}</span>
      </div>
      <div className="autocomplete-wrapper">
        <div className="input-field-wrapper">
          <span className="input-icon-left">{icon}</span>
          <input
            type="text"
            className="autocomplete-input"
            placeholder={placeholder}
            value={isOpen ? searchQuery : (value || '')}
            onChange={(e) => {
              setSearchQuery(e.target.value);
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
                title="Temizle"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
            {onLocationClick && (
              <button
                type="button"
                className="input-action-btn"
                onClick={onLocationClick}
                disabled={locating}
                title="Konumumu Kullan"
                style={{ color: locating ? 'var(--accent-success)' : 'inherit' }}
              >
                {locating ? (
                  <svg style={{ animation: 'spin 1s linear infinite' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 10"></circle></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                )}
              </button>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="autocomplete-dropdown">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, idx) => {
                const isDisabled = disabledOptions.includes(opt);
                const isSelected = opt === value;
                return (
                  <div
                    key={opt}
                    className={`autocomplete-item ${idx === highlightedIndex ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ opacity: isDisabled ? 0.4 : 1, pointerEvents: isDisabled ? 'none' : 'auto' }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!isDisabled) {
                        onChange(opt);
                        setSearchQuery(opt);
                        setIsOpen(false);
                      }
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)' }}><circle cx="12" cy="12" r="10"></circle></svg>
                    <span>{opt}</span>
                  </div>
                );
              })
            ) : (
              <div className="autocomplete-no-results">Mahalle bulunamadı</div>
            )}
          </div>
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

  const locations = useMemo(() => getLocations(), [])

  // Auto-search when endpoints are fully selected
  const handleSearch = () => {
    if (!source || !destination) return
    const result = findRoutes(source, destination)
    setRouteResult(result)
    setSelectedRouteIndex(0) // Default to first route option
  }

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

  const defaultCenter = [39.4242, 29.9833]; // Kütahya default center

  return (
    <div className="dashboard-container">
      {/* Sidebar Panel */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="brand-section">
            <div className="brand-icon-wrapper">
              <svg className="brand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="15" rx="2" ry="2"></rect><line x1="6" y1="21" x2="6" y2="18"></line><line x1="18" y1="21" x2="18" y2="18"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>
            </div>
            <h1 className="brand-title">Rota Kütahya</h1>
          </div>
          <p className="brand-subtitle">Mahalleler arası akıllı toplu taşıma ve aktarma kılavuzu</p>
        </div>

        {errorMsg && (
          <div className="error-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>{errorMsg}</span>
          </div>
        )}

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
            className="search-button"
            onClick={handleSearch}
            disabled={!source || !destination || source === destination}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>Rota Planla</span>
          </button>
        </div>

        {/* Results Area inside Sidebar */}
        <div className="results-container">
          {!routeResult ? (
            <div className="results-placeholder">
              <svg className="results-placeholder-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
              <div>
                <p className="results-title">Güzergah Hazır Değil</p>
                <p style={{ fontSize: '0.85rem' }}>Başlangıç ve varış mahallelerini seçip "Rota Planla" butonuna tıklayarak aramayı başlatın.</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="results-info-row">
                <span className="results-route-summary">{source} ➔ {destination}</span>
                <span className={`results-type-pill ${routeResult.type}`}>
                  {routeResult.type === 'direct' ? 'Direkt Hat' : routeResult.type === 'transfer' ? 'Aktarmalı' : 'Rota Yok'}
                </span>
              </div>

              {routeResult.type === 'direct' && (
                <div>
                  {routeResult.routes.map((r, idx) => (
                    <div
                      key={idx}
                      className={`route-card ${selectedRouteIndex === idx ? 'selected-card' : ''}`}
                      style={{ borderColor: selectedRouteIndex === idx ? 'var(--accent-success)' : '' }}
                      onClick={() => setSelectedRouteIndex(idx)}
                    >
                      <div className="route-card-header">
                        <span className="results-type-pill direct">Seçenek {idx + 1}</span>
                        <span className="route-card-meta">~{r.score} Sefer/Gün</span>
                      </div>
                      <div className="transit-timeline">
                        <div className="timeline-step">
                          <div className="timeline-dot start"></div>
                          <div className="timeline-title">{source}</div>
                          <div className="timeline-desc">Başlangıç Noktası</div>
                        </div>
                        <div style={{ margin: '-0.3rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="line-badge success-badge">{r.line}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Hattı ile doğrudan ulaşım</span>
                        </div>
                        <div className="timeline-step">
                          <div className="timeline-dot end"></div>
                          <div className="timeline-title">{destination}</div>
                          <div className="timeline-desc">Varış Noktası</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {routeResult.type === 'transfer' && (
                <div>
                  {routeResult.routes.map((r, idx) => (
                    <div
                      key={idx}
                      className="route-card"
                      style={{ borderColor: selectedRouteIndex === idx ? 'var(--accent-primary)' : '' }}
                      onClick={() => setSelectedRouteIndex(idx)}
                    >
                      <div className="route-card-header">
                        <span className="results-type-pill transfer">Seçenek {idx + 1}</span>
                        <span className="route-card-meta">~{r.freqLimit} Sefer | {r.dist} km</span>
                      </div>
                      <div className="transit-timeline">
                        <div className="timeline-step">
                          <div className="timeline-dot start"></div>
                          <div className="timeline-title">{source}</div>
                          <div className="timeline-desc">
                            <span>Binilecek Hat:</span>
                            <span className="line-badge">{r.line1}</span>
                          </div>
                        </div>
                        <div className="timeline-step">
                          <div className="timeline-dot transfer"></div>
                          <div className="timeline-title">{r.transferPoint}</div>
                          <div className="timeline-desc">
                            <span>Burada Aktarma Yapın ➔</span>
                            <span className="line-badge success-badge">{r.line2}</span>
                          </div>
                        </div>
                        <div className="timeline-step">
                          <div className="timeline-dot end"></div>
                          <div className="timeline-title">{destination}</div>
                          <div className="timeline-desc">Varış Noktası</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {routeResult.type === 'none' && (
                <div className="no-route-card">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-danger)' }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <p style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Rota Bulunamadı</p>
                  <p>Bu iki mahalle arasında doğrudan veya tek aktarmalı bir rota bulunmamaktadır. Lütfen merkez durakları kullanarak ulaşmayı deneyin.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Map Display Panel */}
      <div className="map-panel">
        <div className="map-wrapper-inner">
          <MapContainer center={defaultCenter} zoom={13} zoomControl={true}>
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            />
            <MapUpdater sourceCoords={sourceCoords} destCoords={destCoords} transferCoords={transferCoords} />

            {sourceCoords && (
              <Marker position={sourceCoords} icon={startIcon}>
                <Popup>Kalkış: {source}</Popup>
              </Marker>
            )}
            
            {transferCoords && (
              <Marker position={transferCoords} icon={transferIcon}>
                <Popup>Aktarma Noktası: {activeRoute?.transferPoint}</Popup>
              </Marker>
            )}

            {destCoords && (
              <Marker position={destCoords} icon={endIcon}>
                <Popup>Varış: {destination}</Popup>
              </Marker>
            )}

            {/* Direct Line Polyline */}
            {sourceCoords && destCoords && routeResult?.type === 'direct' && (
              <Polyline
                positions={[sourceCoords, destCoords]}
                color="var(--accent-success)"
                weight={4}
                dashArray="8, 8"
                opacity={0.8}
              />
            )}

            {/* Transfer Path Polyline */}
            {sourceCoords && transferCoords && destCoords && routeResult?.type === 'transfer' && (
              <>
                <Polyline
                  positions={[sourceCoords, transferCoords]}
                  color="var(--accent-primary)"
                  weight={4}
                  opacity={0.9}
                />
                <Polyline
                  positions={[transferCoords, destCoords]}
                  color="var(--accent-success)"
                  weight={4}
                  opacity={0.9}
                  dashArray="4, 6"
                />
              </>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

export default App
