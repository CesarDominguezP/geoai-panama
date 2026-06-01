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

/* ── Inicialización principal ── */

/**
 * Inicializa el mapa Leaflet y todas las capas base.
 * Llamado una sola vez al cargar la página.
 */
function initMap() {
  // TODO — implementar en Fase 2
  // 1. L.map('map', { center, zoom, zoomControl: false })
  // 2. Instanciar baseLayers desde CONFIG.LAYERS
  // 3. Activar capa 'satellite' por defecto
  // 4. Agregar escala métrica
  // 5. Bind eventos: mousemove → actualizar #map-cursor y #hdr-coordinates
  // 6. Bind evento zoom → actualizar #map-zoom
  // 7. Inicializar Leaflet.draw (sin activar aún)
  // 8. Cargar límites de provincias GeoJSON
}

/* ── Gestión de capas base ── */

/**
 * Cambia la capa base activa del mapa
 * @param {'satellite'|'topo'|'streets'|'hybrid'} layerKey
 */
function setBaseLayer(layerKey) {
  // TODO — implementar en Fase 2
  // 1. Remover capa activa actual
  // 2. Remover overlayLayer si existe
  // 3. Agregar nueva capa base
  // 4. Si hybrid: agregar overlayLayer de etiquetas
  // 5. Actualizar estado visual de botones #layer-switcher
}

/* ── Límites político-administrativos ── */

/**
 * Carga y muestra los límites de provincias y distritos de Panamá
 * sobre el mapa. Requerido para la ficha técnica PDF.
 * Fuente: GeoJSON de IGNTG (incluido en repo como data/panama_limits.geojson)
 */
function loadPanamaLimits() {
  // TODO — implementar en Fase 2
  // Estrategia: fetch('data/panama_limits.geojson')
  // Estilo: líneas delgadas, sin relleno, para no tapar el satélite
  // Al hover: tooltip con nombre de provincia/distrito
}

/**
 * Identifica en qué provincia y distrito cae el centroide del polígono activo
 * @param {{lat: number, lon: number}} centroid
 * @returns {{provincia: string, distrito: string}}
 */
function getAdminLocation(centroid) {
  // TODO — implementar en Fase 2
  // Iterar features del GeoJSON de límites con pointInPolygon()
}

/* ── Controles del mapa ── */

/**
 * Centra el mapa en Panamá con zoom por defecto
 */
function centerPanama() {
  // TODO — implementar en Fase 2
  if (mapObj) mapObj.setView(CONFIG.GEO.PA_CENTER, CONFIG.GEO.PA_ZOOM);
}

/**
 * Ajusta el zoom para que el polígono activo sea visible completo
 */
function zoomToPolygon() {
  // TODO — implementar en Fase 2
  // Usar: mapObj.fitBounds(drawnLayer.getBounds(), { padding: [20, 20] })
}

/* ── Captura del mapa para PDF ── */

/**
 * Captura el canvas actual del mapa como imagen base64.
 * Espera que todos los tiles estén cargados antes de capturar.
 * Este es el método correcto para obtener imagen fiel del mapa.
 * @returns {Promise<string>} dataURL base64 PNG
 */
function captureMapImage() {
  // TODO — implementar en Fase 2
  // Estrategia:
  // 1. map.invalidateSize()
  // 2. Esperar CONFIG.LIMITS.PDF_MAP_WAIT ms (tiles)
  // 3. html2canvas(document.getElementById('map'), { useCORS: true, allowTaint: false })
  // 4. Retornar canvas.toDataURL('image/png')
  //
  // NOTA: Los tiles ESRI permiten CORS — esta captura debe funcionar correctamente.
  // Si hay problemas de CORS en tiles específicos, usar leaflet-image como alternativa.
}

/* ── Event handlers del mapa ── */

/**
 * Handler: clic derecho en el mapa → mostrar coordenadas UTM
 */
function onMapContextMenu(e) {
  // TODO — implementar en Fase 2
}

/**
 * Handler: mousemove → actualizar barra de estado inferior
 */
function onMapMouseMove(e) {
  // TODO — implementar en Fase 2
  // Mostrar lat/lon en #map-cursor
  // Mostrar UTM en #hdr-coordinates (convertir con latLngToUTM)
}
