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
  // proj4 retorna [lon, lat] — invertimos para Leaflet que espera [lat, lon]
  const [lon, lat] = proj4('EPSG:32617', 'EPSG:4326', [easting, northing]);
  return [lat, lon];
}

/**
 * Convierte WGS84 [lat, lon] a UTM Zona 17N {easting, northing}
 * @param {number} lat
 * @param {number} lon
 * @returns {{easting: number, northing: number}}
 */
function latLngToUTM(lat, lon) {
  // proj4 espera [lon, lat] en orden geográfico estándar
  const [easting, northing] = proj4('EPSG:4326', 'EPSG:32617', [lon, lat]);
  return { easting, northing };
}

/* ── Geometría ── */

/**
 * Calcula área en m² y ha de un polígono GeoJSON
 * @param {Object} geojson — Feature de tipo Polygon
 * @returns {{m2: number, ha: number}}
 */
function calcArea(geojson) {
  const m2 = turf.area(geojson);
  return { m2, ha: m2 / 10000 };
}

/**
 * Calcula perímetro en metros de un polígono GeoJSON
 * @param {Object} geojson
 * @returns {number} metros
 */
function calcPerimeter(geojson) {
  // polygonToLine convierte el polígono a línea para medir su longitud
  const line = turf.polygonToLine(geojson);
  return turf.length(line, { units: 'kilometers' }) * 1000;
}

/**
 * Detecta si un punto [lat, lon] está dentro de un polígono GeoJSON
 * @param {[number, number]} point — [lat, lon]
 * @param {Object} polygon — Feature GeoJSON
 * @returns {boolean}
 */
function pointInPolygon(point, polygon) {
  // Turf usa [lon, lat] — invertimos el array recibido
  const turfPoint = turf.point([point[1], point[0]]);
  return turf.booleanPointInPolygon(turfPoint, polygon);
}

/**
 * Obtiene el centroide de un polígono GeoJSON
 * @param {Object} geojson
 * @returns {{lat: number, lon: number}}
 */
function getCentroid(geojson) {
  const c = turf.centroid(geojson);
  return {
    lat: c.geometry.coordinates[1],
    lon: c.geometry.coordinates[0]
  };
}

/* ── Derrotero geodésico ── */

/**
 * Construye la tabla de derrotero UTM de un polígono.
 * Calcula rumbo, azimut y distancia entre vértices consecutivos.
 * @param {Array} coords — Array de {easting, northing}
 * @returns {Array} filas del derrotero
 */
function buildDerrotero(coords) {
  if (!coords || coords.length < 2) return [];

  const filas = [];

  for (let i = 0; i < coords.length; i++) {
    const A = coords[i];
    // El último punto conecta de vuelta al primero (cierre del polígono)
    const B = coords[(i + 1) % coords.length];

    const dE = B.easting  - A.easting;
    const dN = B.northing - A.northing;

    // Distancia euclidiana en metros (coordenadas proyectadas UTM)
    const distancia = Math.sqrt(dE * dE + dN * dN);

    // Azimut: ángulo desde el norte geográfico, sentido horario (0°–360°)
    let azimutRad = Math.atan2(dE, dN);
    let azimutDeg = (azimutRad * 180) / Math.PI;
    if (azimutDeg < 0) azimutDeg += 360;

    // Rumbo: cuadrante + ángulo (N45°E, S30°W, etc.)
    const rumbo = azimutToRumbo(azimutDeg);

    filas.push({
      punto:    `P${i + 1}`,
      easting:  A.easting,
      northing: A.northing,
      rumbo,
      azimut:   azimutDeg,
      distancia
    });
  }

  return filas;
}

/**
 * Convierte azimut decimal a notación de rumbo (cuadrante)
 * @param {number} azimut — grados decimales 0–360
 * @returns {string} — ej: "N 45°30' E"
 */
function azimutToRumbo(azimut) {
  let angulo, cuadrante;

  if (azimut >= 0 && azimut < 90) {
    angulo = azimut;
    cuadrante = ['N', 'E'];
  } else if (azimut >= 90 && azimut < 180) {
    angulo = 180 - azimut;
    cuadrante = ['S', 'E'];
  } else if (azimut >= 180 && azimut < 270) {
    angulo = azimut - 180;
    cuadrante = ['S', 'W'];
  } else {
    angulo = 360 - azimut;
    cuadrante = ['N', 'W'];
  }

  // Convertir grados decimales a grados y minutos
  const grados  = Math.floor(angulo);
  const minutos = Math.round((angulo - grados) * 60);

  return `${cuadrante[0]} ${grados}°${minutos.toString().padStart(2, '0')}' ${cuadrante[1]}`;
}

/* ── Criptografía ── */

/**
 * Hash SHA-256 de un string — para custodia documental del PDF
 * @param {string} message
 * @returns {Promise<string>} hash hex
 */
async function sha256(message) {
  const msgBuffer  = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Formateo ── */

/**
 * Formatea número con separadores de miles y decimales
 * @param {number} n
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(n, decimals = 2) {
  return n?.toLocaleString('es-PA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }) ?? '—';
}

/**
 * Formatea fecha para mostrar en ficha técnica
 * @param {Date} date
 * @returns {string} — ej: "31 de mayo de 2026, 14:32"
 */
function formatDate(date = new Date()) {
  return date.toLocaleString('es-PA', {
    day:    'numeric',
    month:  'long',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit'
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
  // Buscar o crear el contenedor de toasts
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    // Estilos inline mínimos — el CSS real está en components.css
    container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Forzar reflow para que la transición CSS de entrada funcione
  void toast.offsetWidth;
  toast.classList.add('toast--visible');

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    // Remover del DOM después de la transición (300ms estimado)
    setTimeout(() => toast.remove(), 350);
  }, duration);
}