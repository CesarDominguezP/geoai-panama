/* ============================================================
   SATE-03 | MOTOR CARTOGRÁFICO
   Inicialización de Leaflet, capas ESRI, límites político-
   administrativos y controles del mapa.
   Dependencias: config.js, utils.js, Leaflet 1.9.4
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Estado del mapa ── */
let mapObj        = null;   // Instancia principal de Leaflet
let activeLayer   = null;   // Capa base activa
let baseLayers    = {};     // Todas las capas base instanciadas
let overlayLayer  = null;   // Capa de etiquetas (modo híbrido)
let boundaryLayer = null;   // Límites de provincias/distritos (GeoJSON)
let drawControl   = null;   // Control Leaflet.draw
let _boundaryData = null;   // Cache del GeoJSON de límites (evita re-fetch)

/* ── Inicialización principal ── */

/**
 * Inicializa el mapa Leaflet y todas las capas base.
 * Llamado una sola vez al cargar la página.
 */
function initMap() {
  // 1. Crear instancia Leaflet sin zoom control nativo
  //    (lo reemplazamos con nuestros botones flotantes en .sate-map-controls)
  mapObj = L.map('map', {
    center:      CONFIG.GEO.PA_CENTER,
    zoom:        CONFIG.GEO.PA_ZOOM,
    zoomControl: false,
    attributionControl: true
  });

  // 2. Instanciar todas las capas base desde CONFIG.LAYERS
  Object.keys(CONFIG.LAYERS).forEach(key => {
    const cfg = CONFIG.LAYERS[key];
    baseLayers[key] = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom:     19
    });
  });

  // La capa híbrida comparte tiles con satellite — overlay se gestiona en setBaseLayer
  // Instanciar overlay de etiquetas para hybrid por separado
  overlayLayer = L.tileLayer(CONFIG.LAYERS.hybrid.overlay, {
    attribution: '',
    maxZoom:     19,
    opacity:     0.9
  });

  // 3. Activar capa 'satellite' por defecto
  setBaseLayer('satellite');

  // 4. Escala métrica (inferior izquierdo)
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapObj);

  // 5. Inicializar Leaflet.draw — el control se agrega al mapa
  //    pero NO se activa hasta que el usuario pulse "Dibujar polígono"
  const drawnItems = new L.FeatureGroup();
  mapObj.addLayer(drawnItems);

  drawControl = new L.Control.Draw({
    edit: { featureGroup: drawnItems, edit: false, remove: false },
    draw: {
      polygon:   { allowIntersection: false, showArea: true },
      polyline:  false,
      rectangle: false,
      circle:    false,
      marker:    false,
      circlemarker: false
    }
  });
  // No se agrega al mapa aquí — polygon.js lo hace al activar el modo dibujo

  // Exponer drawnItems globalmente para que polygon.js pueda agregar capas
  window._drawnItems = drawnItems;

  // 6. Eventos del mapa
  mapObj.on('mousemove', onMapMouseMove);
  mapObj.on('zoom',      _onZoomChange);
  mapObj.on('contextmenu', onMapContextMenu);

  // Estado inicial del zoom en barra de estado
  _updateZoomDisplay();

  // 7. Cargar límites político-administrativos de Panamá
  loadPanamaLimits();

  // 8. Bind botones #layer-switcher
  document.querySelectorAll('[data-layer]').forEach(btn => {
    btn.addEventListener('click', () => setBaseLayer(btn.dataset.layer));
  });
}

/* ── Gestión de capas base ── */

/**
 * Cambia la capa base activa del mapa
 * @param {'satellite'|'topo'|'streets'|'hybrid'} layerKey
 */
function setBaseLayer(layerKey) {
  if (!mapObj || !baseLayers[layerKey]) return;

  // 1. Remover capa activa
  if (activeLayer) mapObj.removeLayer(activeLayer);

  // 2. Remover overlay de etiquetas si estaba activo
  if (mapObj.hasLayer(overlayLayer)) mapObj.removeLayer(overlayLayer);

  // 3. Agregar nueva capa base
  activeLayer = baseLayers[layerKey];
  activeLayer.addTo(mapObj);

  // 4. Si es hybrid: agregar overlay de etiquetas encima
  if (layerKey === 'hybrid') {
    overlayLayer.addTo(mapObj);
    // Asegurar que las capas de datos (límites, polígono) queden por encima
    if (boundaryLayer) boundaryLayer.bringToFront();
  }

  // 5. Actualizar estado visual de los botones
  document.querySelectorAll('[data-layer]').forEach(btn => {
    btn.classList.toggle('sate-layer-btn--active', btn.dataset.layer === layerKey);
  });
}

/* ── Límites político-administrativos ── */

/**
 * Carga y muestra los límites de provincias y distritos de Panamá.
 * Fuente: data/panama_limits.geojson (incluido en repo)
 */
function loadPanamaLimits() {
  fetch('data/panama_limits.geojson')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      _boundaryData = data; // Cache para getAdminLocation()

      boundaryLayer = L.geoJSON(data, {
        style: {
          color:       '#00e5ff',
          weight:      1,
          opacity:     0.6,
          fillOpacity: 0         // Sin relleno — no tapa el satélite
        },
        onEachFeature: (feature, layer) => {
          // Tooltip con nombre de provincia/distrito al pasar el cursor
          const props = feature.properties || {};
          const nombre = props.NAME_1 || props.nombre || props.name || 'Límite';
          layer.bindTooltip(nombre, {
            sticky:    true,
            className: 'sate-map-tooltip'
          });
        }
      }).addTo(mapObj);

      // Límites siempre por encima de la capa base
      boundaryLayer.bringToFront();
    })
    .catch(err => {
      // No fatal — la plataforma funciona sin el GeoJSON de límites
      console.warn('[SATE map] Límites no cargados:', err.message);
    });
}

/**
 * Identifica en qué provincia y distrito cae el centroide del polígono activo.
 * Requiere que _boundaryData esté cargado.
 * @param {{lat: number, lon: number}} centroid
 * @returns {{provincia: string, distrito: string}}
 */
function getAdminLocation(centroid) {
  const result = { provincia: 'No determinado', distrito: 'No determinado' };
  if (!_boundaryData || !centroid) return result;

  const point = [centroid.lat, centroid.lon];

  for (const feature of _boundaryData.features) {
    if (pointInPolygon(point, feature)) {
      const p = feature.properties || {};
      result.provincia = p.NAME_1 || p.provincia || p.name || 'No determinado';
      result.distrito  = p.NAME_2 || p.distrito  || '—';
      break;
    }
  }

  return result;
}

/* ── Controles del mapa ── */

/**
 * Centra el mapa en Panamá con zoom por defecto
 */
function centerPanama() {
  if (mapObj) mapObj.setView(CONFIG.GEO.PA_CENTER, CONFIG.GEO.PA_ZOOM);
}

/**
 * Ajusta el zoom para que el polígono activo sea visible completo.
 * Llamado desde polygon.js tras onPolygonReady.
 */
function zoomToPolygon() {
  if (!mapObj || !window._drawnItems) return;
  const bounds = window._drawnItems.getBounds();
  if (bounds.isValid()) {
    mapObj.fitBounds(bounds, { padding: [20, 20] });
  }
}

/* ── Captura del mapa para PDF ── */

/**
 * Captura el canvas actual del mapa como imagen base64.
 * Espera que todos los tiles estén cargados antes de capturar.
 * @returns {Promise<string>} dataURL base64 PNG
 */
function captureMapImage() {
  return new Promise((resolve, reject) => {
    if (!mapObj) return reject(new Error('Mapa no inicializado'));

    // Forzar recalculo de tamaño por si el panel cambió el layout
    mapObj.invalidateSize();

    // Esperar CONFIG.LIMITS.PDF_MAP_WAIT ms para que los tiles terminen
    setTimeout(() => {
      const mapEl = document.getElementById('map');
      html2canvas(mapEl, {
        useCORS:    true,   // Tiles ESRI permiten CORS
        allowTaint: false,
        logging:    false
      })
        .then(canvas => resolve(canvas.toDataURL('image/png')))
        .catch(err => {
          console.warn('[SATE map] captureMapImage falló:', err.message);
          // Retornar string vacío — pdf.js lo gestiona con fallback
          resolve('');
        });
    }, CONFIG.LIMITS.PDF_MAP_WAIT);
  });
}

/* ── Event handlers del mapa ── */

/**
 * Handler: clic derecho en el mapa → mostrar coordenadas UTM en toast
 */
function onMapContextMenu(e) {
  const { lat, lng } = e.latlng;
  const utm = latLngToUTM(lat, lng);
  showToast(
    `Este: ${formatNumber(utm.easting, 0)} m  |  Norte: ${formatNumber(utm.northing, 0)} m`,
    'info',
    4000
  );
}

/**
 * Handler: mousemove → actualizar barra de estado inferior
 */
function onMapMouseMove(e) {
  const { lat, lng } = e.latlng;

  // Mostrar lat/lon en #map-cursor
  const cursorEl = document.getElementById('map-cursor');
  if (cursorEl) {
    cursorEl.textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
  }

  // Mostrar UTM en #hdr-coordinates (cabecera superior)
  const utm = latLngToUTM(lat, lng);
  const hdrEl = document.getElementById('hdr-coordinates');
  if (hdrEl) {
    hdrEl.textContent =
      `E ${formatNumber(utm.easting, 0)} m  |  N ${formatNumber(utm.northing, 0)} m`;
  }
}

/* ── Helpers internos ── */

/**
 * Actualiza el indicador de zoom en la barra de estado
 */
function _updateZoomDisplay() {
  const el = document.getElementById('map-zoom');
  if (el && mapObj) el.textContent = `Zoom: ${mapObj.getZoom()}`;
}

/**
 * Handler: cambio de zoom → actualizar display
 */
function _onZoomChange() {
  _updateZoomDisplay();
}

/* ── Arranque automático ── */
// Inicializar el mapa en cuanto el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMap);
} else {
  initMap();
}