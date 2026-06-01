/* ============================================================
   SATE-07 | ESTACIÓN DE MONITOREO AMBIENTAL
   Monitoreo meteorológico persistente por polígono.
   Fuente: Open-Meteo API (gratuita, sin key)
   Ciclo: fetch cada 12 horas, histórico en localStorage
   Dependencias: config.js, utils.js, polygon.js, Chart.js
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Estado de la estación ── */
let monitorActive    = false;      // true si la estación está activa
let monitorInterval  = null;       // ID del setInterval
let monitorHistory   = [];         // Lecturas históricas [{timestamp, temp, wind, precip}]
let monitorChart     = null;       // Instancia Chart.js del histórico
let stationCentroid  = null;       // {lat, lon} del polígono monitoreado

const STORAGE_KEY    = 'sate_monitor_history';   // localStorage key
const STORAGE_META   = 'sate_monitor_meta';      // localStorage: metadatos de estación

/* ── Activación ── */

/**
 * Activa la estación de monitoreo para el polígono activo.
 * Persiste la configuración en localStorage para sobrevivir recargas.
 */
function activateMonitorStation() {
  // TODO — implementar en Fase 3
  // 1. Verificar getActivePolygon() !== null
  // 2. Obtener centroide con getActiveCentroid()
  // 3. Guardar metadatos en localStorage (centroide, fecha activación, nombre)
  // 4. Primera lectura inmediata: fetchWeatherData()
  // 5. Configurar intervalo cada CONFIG.LIMITS.MONITOR_INTERVAL
  // 6. Mostrar #monitor-dashboard
  // 7. Actualizar botón a "Estación activa ●"
}

/**
 * Restaura estación activa al recargar la página
 * (si había una estación guardada en localStorage)
 */
function restoreMonitorStation() {
  // TODO — implementar en Fase 3
  // Leer STORAGE_META
  // Si existe y tiene centroide válido → reactivar fetchWeatherData()
  // Cargar histórico desde STORAGE_KEY → monitorHistory
  // Renderizar chart con datos históricos
}

/* ── Fetch meteorológico ── */

/**
 * Obtiene datos meteorológicos actuales del centroide del polígono.
 * Open-Meteo — sin API key, completamente gratuito.
 * @param {{lat: number, lon: number}} coords
 * @returns {Promise<Object>} datos meteorológicos
 */
async function fetchWeatherData(coords) {
  // TODO — implementar en Fase 3
  // URL: CONFIG.ENDPOINTS.OPEN_METEO
  // Params: latitude, longitude, current=temperature_2m,wind_speed_10m,precipitation,
  //         weather_code, relative_humidity_2m
  // Retorna objeto con valores actuales
}

/**
 * Obtiene datos históricos de los últimos N días para el chart
 * @param {{lat: number, lon: number}} coords
 * @param {number} days — días hacia atrás (default 7)
 * @returns {Promise<Array>} serie temporal
 */
async function fetchWeatherHistory(coords, days = 7) {
  // TODO — implementar en Fase 3
  // URL: CONFIG.ENDPOINTS.OPEN_METEO_HIST
  // Params: latitude, longitude, start_date, end_date,
  //         daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max
}

/* ── Persistencia ── */

/**
 * Guarda una lectura en el histórico local
 * @param {Object} reading — {timestamp, temp, wind, precip, humidity, weatherCode}
 */
function saveReading(reading) {
  // TODO — implementar en Fase 3
  // Agregar a monitorHistory
  // Mantener máximo 100 lecturas (FIFO)
  // Guardar en localStorage[STORAGE_KEY]
}

/**
 * Carga el histórico desde localStorage
 * @returns {Array} lecturas guardadas
 */
function loadHistory() {
  // TODO — implementar en Fase 3
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/* ── Renderizado ── */

/**
 * Actualiza el dashboard con los datos de la última lectura
 * @param {Object} data — datos meteorológicos de fetchWeatherData
 */
function updateMonitorDashboard(data) {
  // TODO — implementar en Fase 3
  // Actualizar: #mon-temp, #mon-wind, #mon-precip, #mon-last, #mon-next
}

/**
 * Renderiza o actualiza el gráfico de histórico de temperatura y precipitación
 * @param {Array} history — monitorHistory
 */
function renderMonitorChart(history) {
  // TODO — implementar en Fase 3
  // Chart.js: eje X = timestamps, eje Y1 = temperatura, eje Y2 = precipitación
  // Dataset temperatura: línea azul
  // Dataset precipitación: barras celestes
}

/* ── Detener estación ── */

/**
 * Detiene el monitoreo activo
 * Los datos históricos se conservan en localStorage
 */
function deactivateMonitorStation() {
  // TODO — implementar en Fase 3
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  monitorActive = false;
}

/**
 * Retorna los datos de la estación para incluir en el PDF
 * @returns {Object|null}
 */
function getMonitorData() {
  if (!monitorActive) return null;
  return {
    centroid:    stationCentroid,
    history:     monitorHistory,
    lastReading: monitorHistory[monitorHistory.length - 1] ?? null
  };
}
