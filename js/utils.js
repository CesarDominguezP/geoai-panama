/* ============================================================
   SATE-02 | UTILIDADES Y HELPERS PUROS
   Funciones sin efectos secundarios sobre el DOM ni el mapa.
   Dependencias: config.js, proj4
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Conversión de coordenadas ── */

/**
 * Convierte un punto UTM Zona 17N a WGS84 [lat, lon]
 * @param {number} easting  — Este en metros
 * @param {number} northing — Norte en metros
 * @returns {[number, number]} [lat, lon]
 */
function utmToLatLng(easting, northing) {
  // TODO — implementar en Fase 2
  // Usar: proj4('EPSG:32617', 'EPSG:4326', [easting, northing])
  // Retorna [lon, lat] — invertir para Leaflet
}

/**
 * Convierte WGS84 [lat, lon] a UTM Zona 17N {easting, northing}
 * @param {number} lat
 * @param {number} lon
 * @returns {{easting: number, northing: number}}
 */
function latLngToUTM(lat, lon) {
  // TODO — implementar en Fase 2
  // Usar: proj4('EPSG:4326', 'EPSG:32617', [lon, lat])
}

/* ── Geometría ── */

/**
 * Calcula área en m² y ha de un polígono GeoJSON
 * @param {Object} geojson — Feature de tipo Polygon
 * @returns {{m2: number, ha: number}}
 */
function calcArea(geojson) {
  // TODO — implementar en Fase 2
  // Usar: turf.area(geojson)
}

/**
 * Calcula perímetro en metros de un polígono GeoJSON
 * @param {Object} geojson
 * @returns {number} metros
 */
function calcPerimeter(geojson) {
  // TODO — implementar en Fase 2
  // Usar: turf.length(turf.polygonToLine(geojson), {units: 'kilometers'}) * 1000
}

/**
 * Detecta si un punto [lat, lon] está dentro de un polígono GeoJSON
 * @param {[number, number]} point — [lat, lon]
 * @param {Object} polygon — Feature GeoJSON
 * @returns {boolean}
 */
function pointInPolygon(point, polygon) {
  // TODO — implementar en Fase 2
  // Usar: turf.booleanPointInPolygon(turf.point([lon, lat]), polygon)
}

/**
 * Obtiene el centroide de un polígono GeoJSON
 * @param {Object} geojson
 * @returns {{lat: number, lon: number}}
 */
function getCentroid(geojson) {
  // TODO — implementar en Fase 2
  // Usar: turf.centroid(geojson)
}

/* ── Derrotero geodésico ── */

/**
 * Construye la tabla de derrotero UTM de un polígono
 * Calcula rumbo, azimut y distancia entre vértices consecutivos
 * @param {Array} coords — Array de {easting, northing}
 * @returns {Array} filas del derrotero
 */
function buildDerrotero(coords) {
  // TODO — implementar en Fase 2
  // Retorna: [{punto, easting, northing, rumbo, azimut, distancia}]
}

/* ── Criptografía ── */

/**
 * Hash SHA-256 de un string — para custodia documental del PDF
 * @param {string} message
 * @returns {Promise<string>} hash hex
 */
async function sha256(message) {
  // TODO — implementar en Fase 2
  // Usar: crypto.subtle.digest('SHA-256', ...)
}

/* ── Formateo ── */

/**
 * Formatea número con separadores de miles y decimales
 * @param {number} n
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(n, decimals = 2) {
  // TODO — implementar en Fase 2
  return n?.toLocaleString('es-PA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) ?? '—';
}

/**
 * Formatea fecha para mostrar en ficha técnica
 * @param {Date} date
 * @returns {string} — ej: "31 de mayo de 2026, 14:32"
 */
function formatDate(date = new Date()) {
  // TODO — implementar en Fase 2
  return date.toLocaleString('es-PA', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ── Validación de archivos ── */

/**
 * Valida tamaño y tipo de archivo antes de leer
 * @param {File} file
 * @param {string[]} allowedTypes — extensiones sin punto: ['csv','geojson','kml']
 * @returns {{valid: boolean, error: string|null}}
 */
function validateFile(file, allowedTypes = ['csv', 'geojson', 'kml']) {
  // TODO — implementar en Fase 2
  if (!file) return { valid: false, error: 'No se seleccionó archivo.' };
  if (file.size > CONFIG.LIMITS.MAX_FILE_SIZE) {
    return { valid: false, error: `Archivo demasiado grande. Máximo ${CONFIG.LIMITS.MAX_FILE_SIZE_MB} MB.` };
  }
  const ext = file.name.split('.').pop().toLowerCase();
  if (!allowedTypes.includes(ext)) {
    return { valid: false, error: `Formato no soportado. Permitidos: ${allowedTypes.join(', ')}.` };
  }
  return { valid: true, error: null };
}

/* ── UI helpers ── */

/**
 * Muestra u oculta un elemento por ID
 * @param {string} id
 * @param {boolean} visible
 */
function toggleEl(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

/**
 * Abre un modal por ID
 * @param {string} modalId
 */
function openModal(modalId) {
  // TODO — implementar en Fase 2
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'flex';
}

/**
 * Cierra un modal por ID
 * @param {string} modalId
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

/**
 * Muestra notificación temporal en pantalla
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {number} duration — ms
 */
function showToast(message, type = 'info', duration = 3000) {
  // TODO — implementar en Fase 2
  console.log(`[SATE ${type.toUpperCase()}] ${message}`);
}
