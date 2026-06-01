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
let monitorActive   = false;    // true si la estación está activa
let monitorInterval = null;     // ID del setInterval
let monitorHistory  = [];       // Lecturas históricas [{timestamp, temp, wind, precip}]
let monitorChart    = null;     // Instancia Chart.js del histórico
let stationCentroid = null;     // {lat, lon} del polígono monitoreado

const STORAGE_KEY  = 'sate_monitor_history';  // localStorage key
const STORAGE_META = 'sate_monitor_meta';     // localStorage: metadatos de estación
const MAX_HISTORY  = 100;                     // Máximo de lecturas conservadas

/* ── WMO Weather Codes — descripciones en español ── */
const WMO_CODES = {
  0:  'Cielo despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado',
  3:  'Nublado', 45: 'Neblina', 48: 'Neblina con escarcha',
  51: 'Llovizna ligera', 53: 'Llovizna moderada', 55: 'Llovizna densa',
  61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia intensa',
  71: 'Nevada ligera', 73: 'Nevada moderada', 75: 'Nevada intensa',
  80: 'Chubascos ligeros', 81: 'Chubascos moderados', 82: 'Chubascos violentos',
  95: 'Tormenta eléctrica', 96: 'Tormenta con granizo', 99: 'Tormenta severa'
};

/* ── Activación ── */

/**
 * Activa la estación de monitoreo para el polígono activo.
 * Persiste la configuración en localStorage para sobrevivir recargas.
 */
async function activateMonitorStation() {
  const polygon = getActivePolygon();
  if (!polygon) {
    showToast('Define un polígono antes de activar la estación.', 'error');
    return;
  }

  // 1. Obtener centroide
  stationCentroid = getActiveCentroid();

  // 2. Guardar metadatos en localStorage
  const meta = {
    centroid:     stationCentroid,
    activatedAt:  new Date().toISOString(),
    label:        `Polígono — ${formatDate()}`
  };
  try {
    localStorage.setItem(STORAGE_META, JSON.stringify(meta));
  } catch (e) {
    console.warn('[SATE monitor] localStorage no disponible:', e.message);
  }

  // 3. Cargar histórico previo si existe
  monitorHistory = loadHistory();

  // 4. Primera lectura inmediata
  _setStationBtnState(true, 'Cargando datos…');
  await _doFetchAndUpdate();

  // 5. Intervalo cada 12 horas
  monitorInterval = setInterval(_doFetchAndUpdate, CONFIG.LIMITS.MONITOR_INTERVAL);
  monitorActive   = true;

  // 6. Mostrar dashboard
  const dashboard = document.getElementById('monitor-dashboard');
  if (dashboard) dashboard.style.display = '';

  // 7. Actualizar botón
  _setStationBtnState(true, '● Estación activa');
  showToast('Estación de monitoreo activada. Próxima lectura en 12h.', 'success');
}

/**
 * Restaura estación activa al recargar la página.
 * Llamar desde DOMContentLoaded si hay metadatos guardados.
 */
function restoreMonitorStation() {
  try {
    const rawMeta = localStorage.getItem(STORAGE_META);
    if (!rawMeta) return;

    const meta = JSON.parse(rawMeta);
    if (!meta?.centroid?.lat || !meta?.centroid?.lon) return;

    stationCentroid = meta.centroid;
    monitorHistory  = loadHistory();
    monitorActive   = true;

    // Mostrar dashboard con histórico
    const dashboard = document.getElementById('monitor-dashboard');
    if (dashboard) dashboard.style.display = '';

    // Renderizar chart con datos históricos sin fetch nuevo
    if (monitorHistory.length > 0) {
      updateMonitorDashboard(monitorHistory[monitorHistory.length - 1]);
      renderMonitorChart(monitorHistory);
    }

    // Retomar intervalo
    monitorInterval = setInterval(_doFetchAndUpdate, CONFIG.LIMITS.MONITOR_INTERVAL);
    _setStationBtnState(true, '● Estación activa');

    showToast('Estación de monitoreo restaurada.', 'info');
  } catch (e) {
    console.warn('[SATE monitor] No se pudo restaurar estación:', e.message);
  }
}

/* ── Fetch meteorológico ── */

/**
 * Orquesta fetch + guardado + render.
 * Función interna llamada por activación e intervalo.
 */
async function _doFetchAndUpdate() {
  if (!stationCentroid) return;
  try {
    const data = await fetchWeatherData(stationCentroid);
    if (!data) return;

    // Guardar lectura
    const reading = {
      timestamp:   new Date().toISOString(),
      temp:        data.temp,
      wind:        data.wind,
      precip:      data.precip,
      humidity:    data.humidity,
      weatherCode: data.weatherCode,
      condition:   WMO_CODES[data.weatherCode] ?? 'Desconocido'
    };
    saveReading(reading);

    // Actualizar UI
    updateMonitorDashboard(reading);
    renderMonitorChart(monitorHistory);

  } catch (err) {
    console.error('[SATE monitor] Error en fetch:', err.message);
    showToast('Error al obtener datos meteorológicos.', 'warning');
  }
}

/**
 * Obtiene datos meteorológicos actuales del centroide del polígono.
 * Open-Meteo — sin API key, completamente gratuito.
 * @param {{lat: number, lon: number}} coords
 * @returns {Promise<Object>} datos meteorológicos normalizados
 */
async function fetchWeatherData(coords) {
  const params = new URLSearchParams({
    latitude:  coords.lat,
    longitude: coords.lon,
    current:   [
      'temperature_2m',
      'wind_speed_10m',
      'precipitation',
      'weather_code',
      'relative_humidity_2m'
    ].join(','),
    timezone:  'America/Panama'
  });

  const url      = `${CONFIG.ENDPOINTS.OPEN_METEO}?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);

  const json    = await response.json();
  const current = json.current;

  return {
    temp:        current.temperature_2m,
    wind:        current.wind_speed_10m,
    precip:      current.precipitation,
    humidity:    current.relative_humidity_2m,
    weatherCode: current.weather_code
  };
}

/**
 * Obtiene datos históricos de los últimos N días para el chart.
 * Usa Open-Meteo Archive API.
 * @param {{lat: number, lon: number}} coords
 * @param {number} days — días hacia atrás (default 7)
 * @returns {Promise<Array>} serie temporal [{date, tempMax, tempMin, precip, windMax}]
 */
async function fetchWeatherHistory(coords, days = 7) {
  const endDate   = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const fmt = d => d.toISOString().split('T')[0]; // YYYY-MM-DD

  const params = new URLSearchParams({
    latitude:   coords.lat,
    longitude:  coords.lon,
    start_date: fmt(startDate),
    end_date:   fmt(endDate),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'wind_speed_10m_max'
    ].join(','),
    timezone: 'America/Panama'
  });

  const url      = `${CONFIG.ENDPOINTS.OPEN_METEO_HIST}?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo Archive HTTP ${response.status}`);

  const json  = await response.json();
  const daily = json.daily;

  return daily.time.map((date, i) => ({
    date,
    tempMax:  daily.temperature_2m_max[i],
    tempMin:  daily.temperature_2m_min[i],
    precip:   daily.precipitation_sum[i],
    windMax:  daily.wind_speed_10m_max[i]
  }));
}

/* ── Persistencia ── */

/**
 * Guarda una lectura en el histórico local (FIFO, máx 100)
 * @param {Object} reading
 */
function saveReading(reading) {
  monitorHistory.push(reading);

  // FIFO: conservar solo las últimas MAX_HISTORY lecturas
  if (monitorHistory.length > MAX_HISTORY) {
    monitorHistory = monitorHistory.slice(-MAX_HISTORY);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(monitorHistory));
  } catch (e) {
    console.warn('[SATE monitor] No se pudo guardar historial:', e.message);
  }
}

/**
 * Carga el histórico desde localStorage
 * @returns {Array} lecturas guardadas
 */
function loadHistory() {
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
 * @param {Object} data — lectura guardada o datos de fetchWeatherData
 */
function updateMonitorDashboard(data) {
  if (!data) return;

  // Próxima lectura: ahora + 12h
  const nextRead = new Date(Date.now() + CONFIG.LIMITS.MONITOR_INTERVAL);

  _setDashEl('mon-temp',   `${data.temp ?? '—'} °C · ${data.condition ?? ''}`);
  _setDashEl('mon-wind',   `${data.wind ?? '—'} km/h`);
  _setDashEl('mon-precip', `${data.precip ?? '—'} mm`);
  _setDashEl('mon-last',   data.timestamp ? formatDate(new Date(data.timestamp)) : '—');
  _setDashEl('mon-next',   formatDate(nextRead));
}

/**
 * Renderiza o actualiza el gráfico de histórico
 * @param {Array} history — monitorHistory
 */
function renderMonitorChart(history) {
  const canvas = document.getElementById('monitor-chart');
  if (!canvas || history.length === 0) return;

  // Destruir instancia anterior
  if (monitorChart) { monitorChart.destroy(); monitorChart = null; }

  const labels   = history.map(r => {
    const d = new Date(r.timestamp);
    return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:00`;
  });
  const temps    = history.map(r => r.temp);
  const precips  = history.map(r => r.precip);

  monitorChart = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type:        'line',
          label:       'Temperatura (°C)',
          data:        temps,
          borderColor: '#3498db',
          backgroundColor: 'rgba(52,152,219,0.1)',
          yAxisID:     'yTemp',
          tension:     0.3,
          pointRadius: 3
        },
        {
          type:            'bar',
          label:           'Precipitación (mm)',
          data:            precips,
          backgroundColor: 'rgba(0,229,255,0.5)',
          borderColor:     '#00e5ff',
          borderWidth:     1,
          yAxisID:         'yPrecip'
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: 'var(--color-text)', font: { size: 11 } }
        }
      },
      scales: {
        x: {
          ticks: { color: 'var(--color-text-muted)', maxTicksLimit: 8 },
          grid:  { color: 'rgba(255,255,255,0.05)' }
        },
        yTemp: {
          type:     'linear',
          position: 'left',
          title:    { display: true, text: '°C', color: '#3498db' },
          ticks:    { color: '#3498db' },
          grid:     { color: 'rgba(255,255,255,0.05)' }
        },
        yPrecip: {
          type:     'linear',
          position: 'right',
          title:    { display: true, text: 'mm', color: '#00e5ff' },
          ticks:    { color: '#00e5ff' },
          grid:     { drawOnChartArea: false }
        }
      }
    }
  });
}

/* ── Detener estación ── */

/**
 * Detiene el monitoreo activo.
 * Los datos históricos se conservan en localStorage.
 */
function deactivateMonitorStation() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  monitorActive = false;
  _setStationBtnState(false, 'Activar estación');
  showToast('Estación detenida. Historial conservado.', 'info');
}

/**
 * Retorna los datos de la estación para incluir en el PDF
 * @returns {Object|null}
 */
function getMonitorData() {
  if (!monitorActive && monitorHistory.length === 0) return null;
  return {
    centroid:    stationCentroid,
    history:     monitorHistory,
    lastReading: monitorHistory[monitorHistory.length - 1] ?? null
  };
}

/* ── Helpers internos ── */

/**
 * Setea textContent de un elemento del dashboard de forma segura
 */
function _setDashEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Actualiza el estado visual del botón de activación
 */
function _setStationBtnState(active, label) {
  const btn = document.getElementById('btn-activate-station');
  if (!btn) return;
  btn.textContent = label;
  btn.classList.toggle('sate-btn--active', active);
  // Si está activo, un segundo clic desactiva
  btn.onclick = active ? deactivateMonitorStation : activateMonitorStation;
}

/* ── Restaurar al cargar página ── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreMonitorStation);
} else {
  restoreMonitorStation();
}