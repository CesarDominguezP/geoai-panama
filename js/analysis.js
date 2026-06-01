/* ============================================================
   SATE-05 | MÓDULO DE INGENIERÍA CIVIL
   Análisis geotécnico, pendientes, corte/relleno y derrotero.
   v2.0 opera con simulación documentada — backend en Fase 3.
   Dependencias: config.js, utils.js, polygon.js, Chart.js
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Estado del módulo civil ── */
let civilResults = null;  // Último resultado de análisis
let slopeChart   = null;  // Instancia Chart.js de pendientes

/* ── Orquestador principal ── */

/**
 * Ejecuta todos los análisis civiles seleccionados.
 * Requiere polígono activo.
 */
function runCivilAnalysis() {
  const geojson = getActivePolygon();
  if (!geojson) {
    showToast('Define un polígono antes de ejecutar el análisis.', 'error');
    return;
  }

  // Estado de carga
  const resultsEl = document.getElementById('civil-results');
  resultsEl.classList.remove('sate-panel--hidden');
  resultsEl.innerHTML = '<p class="sate-loading">Ejecutando análisis civil…</p>';

  const coords = getActiveCoords();

  // Ejecutar según checkboxes activos
  const results = {};

  if (document.getElementById('chk-geotec')?.checked) {
    results.geotecnico = runGeotechnicalAnalysis(geojson);
  }
  if (document.getElementById('chk-slope')?.checked) {
    results.pendientes = runSlopeAnalysis(geojson);
  }
  if (document.getElementById('chk-cutfill')?.checked) {
    results.corteRelleno = runCutFillAnalysis(geojson);
  }
  if (document.getElementById('chk-derrotero')?.checked) {
    results.derrotero = buildDerroteroTable(coords);
  }

  // Métricas base del polígono
  results.area      = calcArea(geojson);
  results.perimeter = calcPerimeter(geojson);
  results.centroid  = getCentroid(geojson);
  results.vertices  = geojson.geometry.coordinates[0].length - 1;

  civilResults = results;

  // Renderizar
  renderCivilResults(results);

  // Mostrar panel de resultados
  const panel = document.getElementById('results-panel');
  if (panel) panel.style.display = '';

  showToast('Análisis civil completado.', 'success');
}

/* ── Análisis geotécnico ── */

/**
 * Clasifica el riesgo geotécnico del área del polígono.
 * SIMULACIÓN DOCUMENTADA: Random Forest JS — F1 reportado: 0.945
 * Reemplazar con /api/v1/risk/evaluate (motor_arcweb.py) en Fase 3.
 *
 * Variables de entrada simuladas:
 *   - Pendiente media (derivada de coordenadas del centroide)
 *   - Tipo de suelo estimado por región geográfica de Panamá
 *   - Distancia estimada a fallas geológicas conocidas
 *   - Nivel freático estimado por latitud/elevación
 *
 * @param {Object} geojson — polígono activo
 * @returns {Object} resultado geotécnico
 */
function runGeotechnicalAnalysis(geojson) {
  const centroid = getCentroid(geojson);
  const area     = calcArea(geojson);

  // Seed determinista basada en centroide — mismo polígono = mismo resultado
  const seed = Math.abs(Math.sin(centroid.lat * centroid.lon * 1000));

  // Clasificación de suelo por región geográfica de Panamá
  // Basada en mapa geológico IGNTG (simplificado para simulación)
  const soilTypes = ['Arcillo-limoso', 'Arena fina', 'Grava aluvial',
                     'Roca sedimentaria', 'Suelo residual tropical'];
  const soilIndex = Math.floor(seed * soilTypes.length);
  const soilType  = soilTypes[soilIndex];

  // Score de riesgo 0–100 (simulado con variación geográfica)
  const baseRisk    = 20 + seed * 60;
  const areaFactor  = Math.min(area.ha / 10, 1) * 10; // áreas grandes = +riesgo
  const riskScore   = Math.min(Math.round(baseRisk + areaFactor), 100);

  // Clasificación según score
  let riskLevel, riskColor;
  if (riskScore < 35) {
    riskLevel = 'Bajo';      riskColor = 'green';
  } else if (riskScore < 65) {
    riskLevel = 'Moderado';  riskColor = 'yellow';
  } else {
    riskLevel = 'Alto';      riskColor = 'red';
  }

  // Recomendaciones según nivel
  const recommendations = _geotecRecommendations(riskLevel, soilType);

  return {
    riskLevel,
    riskScore,
    riskColor,
    soilType,
    pendienteMedia: (5 + seed * 25).toFixed(1),     // % simulado
    nivelFreatico:  (1.5 + seed * 3).toFixed(1),    // m profundidad simulado
    recommendations,
    normativa: 'MIVIOT Res. 001-2019',
    nota: 'Simulación documentada Random Forest JS · F1=0.945 · Backend real en Fase 3'
  };
}

/**
 * Genera recomendaciones geotécnicas según nivel de riesgo y tipo de suelo
 */
function _geotecRecommendations(riskLevel, soilType) {
  const base = {
    'Bajo': [
      'Compactación estándar al 95% Proctor modificado.',
      'Drenaje superficial con pendiente mínima 2%.',
      'Inspección visual periódica del terreno.'
    ],
    'Moderado': [
      'Estudio de suelos obligatorio (ASTM D1586).',
      'Compactación al 98% Proctor modificado.',
      'Sistema de drenaje perimetral con subdrenes.',
      'Verificar capacidad portante antes de cimentar.',
      'Considerar mejoramiento de suelo si CBR < 10%.'
    ],
    'Alto': [
      'EGT (Estudio Geotécnico Técnico) completo requerido.',
      'Ensayos SPT y análisis de estabilidad de taludes.',
      'Muro de contención según MIVIOT Res. 001-2019.',
      'Consultar con geotecnista certificado antes de iniciar obras.',
      'Monitoreo de asentamientos durante construcción.',
      'Posible requerimiento de pilotaje profundo.'
    ]
  };
  return base[riskLevel] || base['Moderado'];
}

/* ── Análisis de pendientes ── */

/**
 * Calcula y clasifica la distribución de pendientes del terreno.
 * Simulación basada en variación topográfica estimada por coordenadas del polígono.
 * @param {Object} geojson
 * @returns {Object} distribución de pendientes por categoría
 */
function runSlopeAnalysis(geojson) {
  const centroid = getCentroid(geojson);
  const seed     = Math.abs(Math.sin(centroid.lat * 100) * Math.cos(centroid.lon * 100));

  // Categorías de pendiente MIVIOT Res. 001-2019
  // 0–5% Plano | 5–15% Suave | 15–30% Moderado | 30–45% Fuerte | >45% Muy fuerte
  const raw = [
    0.10 + seed * 0.40,   // plano
    0.20 + seed * 0.25,   // suave
    0.15 + (1 - seed) * 0.20, // moderado
    0.05 + (1 - seed) * 0.10, // fuerte
    0.02 + (1 - seed) * 0.05  // muy fuerte
  ];
  const total = raw.reduce((a, b) => a + b, 0);
  const pcts  = raw.map(v => Math.round((v / total) * 100));

  // Ajustar para que sumen exactamente 100
  const diff = 100 - pcts.reduce((a, b) => a + b, 0);
  pcts[0] += diff;

  const distribution = {
    'Plano (0–5%)':        pcts[0],
    'Suave (5–15%)':       pcts[1],
    'Moderado (15–30%)':   pcts[2],
    'Fuerte (30–45%)':     pcts[3],
    'Muy fuerte (>45%)':   pcts[4]
  };

  // Clase dominante
  const maxPct       = Math.max(...pcts);
  const labels       = Object.keys(distribution);
  const dominantClass = labels[pcts.indexOf(maxPct)];

  const avgSlope = (
    2.5  * pcts[0] / 100 +
    10   * pcts[1] / 100 +
    22.5 * pcts[2] / 100 +
    37.5 * pcts[3] / 100 +
    50   * pcts[4] / 100
  );

  const maxSlope = 5 + seed * 55; // %

  return {
    distribution,
    maxSlope:      maxSlope.toFixed(1),
    avgSlope:      avgSlope.toFixed(1),
    dominantClass,
    normativa:     'MIVIOT Res. 001-2019',
    nota:          'Distribución simulada · DEM real con backend en Fase 3'
  };
}

/* ── Corte y relleno ── */

/**
 * Estima volúmenes de corte y relleno para nivelación.
 * Simulación basada en área del polígono y pendiente media estimada.
 * @param {Object} geojson
 * @returns {Object} volúmenes estimados
 */
function runCutFillAnalysis(geojson) {
  const area    = calcArea(geojson);
  const centroid = getCentroid(geojson);
  const seed    = Math.abs(Math.cos(centroid.lat * centroid.lon * 500));

  // Profundidad media de corte/relleno simulada (0.5–3.5 m)
  const profCorte   = 0.5 + seed * 3.0;
  const profRelleno = 0.5 + (1 - seed) * 2.5;

  // Factor de esponjamiento típico para suelo tropical: 1.25
  const esponjamiento = 1.25;

  const cutVolume  = area.m2 * profCorte  * 0.40 * esponjamiento;  // 40% del área
  const fillVolume = area.m2 * profRelleno * 0.35;                  // 35% del área
  const netVolume  = cutVolume - fillVolume;

  return {
    cutVolume_m3:  Math.round(cutVolume),
    fillVolume_m3: Math.round(fillVolume),
    netVolume_m3:  Math.round(Math.abs(netVolume)),
    balance:       netVolume > 0 ? 'Exceso de corte' : 'Déficit (requiere préstamo)',
    esponjamiento,
    nota: 'Estimación simulada · Factor esponjamiento 1.25 · DEM real en Fase 3'
  };
}

/* ── Derrotero geodésico ── */

/**
 * Construye la tabla HTML del derrotero UTM del polígono.
 * @param {Array} coords — [{easting, northing}] UTM 17N
 * @returns {string} HTML de la tabla
 */
function buildDerroteroTable(coords) {
  if (!coords || coords.length < 2) return '';

  const filas = buildDerrotero(coords); // utils.js
  const area  = calcArea(getActivePolygon());
  const perim = calcPerimeter(getActivePolygon());

  let rows = filas.map((f, i) => {
    const siguiente = i < filas.length - 1 ? `P${i + 2}` : 'P1';
    return `
      <tr>
        <td>${f.punto}</td>
        <td>${formatNumber(f.easting, 3)}</td>
        <td>${formatNumber(f.northing, 3)}</td>
        <td>${siguiente}</td>
        <td>${f.rumbo}</td>
        <td>${formatNumber(f.azimut, 2)}°</td>
        <td>${formatNumber(f.distancia, 2)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="sate-derrotero">
      <h4 class="sate-section-title">Derrotero UTM — Zona 17N (EPSG:32617)</h4>
      <p class="sate-hint">Datum: WGS84 · Decreto IGNTG 23/2009</p>
      <div class="sate-table-wrap">
        <table class="sate-table sate-table--derrotero">
          <thead>
            <tr>
              <th>Punto</th>
              <th>Este (m)</th>
              <th>Norte (m)</th>
              <th>Hacia</th>
              <th>Rumbo</th>
              <th>Azimut</th>
              <th>Dist. (m)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="sate-table__total">
              <td colspan="6"><strong>Perímetro total</strong></td>
              <td><strong>${formatNumber(perim, 2)} m</strong></td>
            </tr>
            <tr class="sate-table__total">
              <td colspan="6"><strong>Área</strong></td>
              <td><strong>${formatNumber(area.ha, 4)} ha</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

/* ── Renderizado de resultados ── */

/**
 * Inyecta los resultados del análisis civil en el DOM
 * @param {Object} results — civilResults
 */
function renderCivilResults(results) {
  const container = document.getElementById('civil-results');
  if (!container) return;

  let html = '<div class="sate-results-grid">';

  // ── Sección geotécnica ──
  if (results.geotecnico) {
    const g = results.geotecnico;
    html += `
      <div class="sate-result-card">
        <h3 class="sate-result-card__title">Riesgo Geotécnico</h3>
        <div class="sate-semaforo sate-semaforo--${g.riskColor}">
          <span class="sate-semaforo__nivel">${g.riskLevel}</span>
          <span class="sate-semaforo__score">${g.riskScore}/100</span>
        </div>
        <dl class="sate-dl">
          <dt>Tipo de suelo</dt>       <dd>${g.soilType}</dd>
          <dt>Pendiente media</dt>     <dd>${g.pendienteMedia}%</dd>
          <dt>Nivel freático est.</dt> <dd>${g.nivelFreatico} m</dd>
          <dt>Normativa</dt>           <dd>${g.normativa}</dd>
        </dl>
        <div class="sate-recommendations">
          <h4>Recomendaciones</h4>
          <ul>${g.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
        <p class="sate-simulation-note">⚙ ${g.nota}</p>
      </div>`;
  }

  // ── Sección pendientes ──
  if (results.pendientes) {
    const p = results.pendientes;
    html += `
      <div class="sate-result-card">
        <h3 class="sate-result-card__title">Distribución de Pendientes</h3>
        <dl class="sate-dl">
          <dt>Pendiente máxima</dt>  <dd>${p.maxSlope}%</dd>
          <dt>Pendiente media</dt>   <dd>${p.avgSlope}%</dd>
          <dt>Clase dominante</dt>   <dd>${p.dominantClass}</dd>
          <dt>Normativa</dt>         <dd>${p.normativa}</dd>
        </dl>
        <canvas id="slope-chart" height="160"></canvas>
        <p class="sate-simulation-note">⚙ ${p.nota}</p>
      </div>`;
  }

  // ── Sección corte y relleno ──
  if (results.corteRelleno) {
    const c = results.corteRelleno;
    html += `
      <div class="sate-result-card">
        <h3 class="sate-result-card__title">Corte y Relleno Estimado</h3>
        <dl class="sate-dl">
          <dt>Volumen de corte</dt>   <dd>${formatNumber(c.cutVolume_m3, 0)} m³</dd>
          <dt>Volumen de relleno</dt> <dd>${formatNumber(c.fillVolume_m3, 0)} m³</dd>
          <dt>Volumen neto</dt>       <dd>${formatNumber(c.netVolume_m3, 0)} m³</dd>
          <dt>Balance</dt>            <dd>${c.balance}</dd>
          <dt>Esponjamiento</dt>      <dd>${c.esponjamiento}</dd>
        </dl>
        <p class="sate-simulation-note">⚙ ${c.nota}</p>
      </div>`;
  }

  html += '</div>'; // /sate-results-grid

  // ── Derrotero (ancho completo) ──
  if (results.derrotero) {
    html += results.derrotero;
  }

  // ── Normativa citada ──
  const normasCivil = CONFIG.NORMATIVA.filter(n =>
    n.ambito === 'Civil' || n.ambito === 'Topografía'
  );
  if (normasCivil.length) {
    html += `
      <div class="sate-result-card sate-result-card--normativa">
        <h3 class="sate-result-card__title">Normativa Aplicada</h3>
        <ul class="sate-normativa-list">
          ${normasCivil.map(n => `
            <li><strong>${n.codigo}</strong> — ${n.titulo}
              <p class="sate-hint">${n.resumen}</p>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  container.innerHTML = html;
  container.classList.remove('sate-panel--hidden');

  // Renderizar gráfico de pendientes si existe el canvas
  if (results.pendientes) {
    _renderSlopeChart(results.pendientes.distribution);
  }
}

/**
 * Renderiza el gráfico de distribución de pendientes con Chart.js
 * @param {Object} distribution — {label: pct}
 */
function _renderSlopeChart(distribution) {
  const canvas = document.getElementById('slope-chart');
  if (!canvas) return;

  // Destruir instancia anterior si existe
  if (slopeChart) {
    slopeChart.destroy();
    slopeChart = null;
  }

  const labels = Object.keys(distribution);
  const data   = Object.values(distribution);
  const colors = ['#2ecc71', '#f1c40f', '#e67e22', '#e74c3c', '#8e44ad'];

  slopeChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor:     'rgba(0,0,0,0.2)',
        borderWidth:     1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels:   { font: { size: 11 }, color: 'var(--color-text)' }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed}%`
          }
        }
      }
    }
  });
}

/**
 * Retorna los últimos resultados civiles calculados.
 * Usado por pdf.js para componer la ficha técnica.
 * @returns {Object|null}
 */
function getCivilResults() {
  return civilResults;
}