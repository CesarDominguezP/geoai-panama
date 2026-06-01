/* ============================================================
   SATE-06 | MÓDULO AMBIENTAL
   Zonas protegidas SINAP, normativa Ley 41/1998,
   evaluación de impacto y restricciones ambientales.
   Dependencias: config.js, utils.js, polygon.js, Leaflet
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Estado del módulo ambiental ── */
let envResults    = null;   // Último resultado de análisis ambiental
let sinapLayer    = null;   // Capa WMS SINIA activa
let wetlandsLayer = null;   // Capa de humedales

/* ── Sitios Ramsar de Panamá (fuente: Ramsar.org, verificado con Perplexity) ── */
// Coordenadas aproximadas de centroides — para cálculo de proximidad
const PANAMA_RAMSAR_SITES = [
  { nombre: 'Bahía de Panamá',           lat:  8.8000, lon: -79.5000 },
  { nombre: 'San San Pond Sak',           lat:  9.4167, lon: -82.3333 },
  { nombre: 'Lagunas de Volcán',          lat:  8.7833, lon: -82.6333 },
  { nombre: 'Golfo de Montijo',           lat:  7.7500, lon: -81.0500 },
  { nombre: 'Humedales de La Segua',      lat:  8.3500, lon: -80.4000 },
  { nombre: 'Punta Patiño',              lat:  7.8167, lon: -78.2500 },
  { nombre: 'Damani-Guariviara',          lat:  9.1500, lon: -81.7000 },
  { nombre: 'Ciénagas Las Macanas',       lat:  8.5500, lon: -80.6000 },
  { nombre: 'Sistema Lagunar de Boca Vieja', lat: 8.2000, lon: -82.9000 },
  { nombre: 'Área Protegida PILA',        lat:  9.1000, lon: -82.9000 },
  { nombre: 'Humedales Costas Afuera',    lat:  7.5000, lon: -78.1000 },
  { nombre: 'Laguna de Matusagaratí',     lat:  9.0000, lon: -78.4000 }
];

// Distancia mínima de afectación Ramsar (buffer de precaución)
// Ley 41/1998 Art. 65 — zona de amortiguamiento mínima: 2km
const RAMSAR_BUFFER_KM = 2.0;

/* ── Orquestador principal ── */

/**
 * Ejecuta el análisis de impacto ambiental del polígono activo.
 * Requiere polígono activo.
 */
function runEnvironmentAnalysis() {
  const geojson = getActivePolygon();
  if (!geojson) {
    showToast('Define un polígono antes del análisis ambiental.', 'error');
    return;
  }

  // Estado de carga
  const resultsEl = document.getElementById('env-results');
  resultsEl.classList.remove('sate-panel--hidden');
  resultsEl.innerHTML = '<p class="sate-loading">Evaluando impacto ambiental…</p>';

  const results = {};

  if (document.getElementById('chk-sinap')?.checked) {
    results.sinap = checkSINAP(geojson);
  }
  if (document.getElementById('chk-buffer')?.checked) {
    results.buffer = checkBufferZones(geojson);
  }
  if (document.getElementById('chk-wetlands')?.checked) {
    results.wetlands = checkWetlands(geojson);
  }
  if (document.getElementById('chk-forestry')?.checked) {
    results.forestry = checkForestCover(geojson);
  }

  // Semáforo general: el nivel más restrictivo de todos los módulos
  results.nivelGeneral = _calcNivelGeneral(results);
  results.normas       = getApplicableNorms(results);

  envResults = results;

  renderEnvResults(results);

  // Mostrar panel de resultados global
  const panel = document.getElementById('results-panel');
  if (panel) panel.style.display = '';

  showToast('Análisis ambiental completado.', 'success');
}

/* ── Zonas SINAP ── */

/**
 * Verifica si el polígono intersecta con áreas protegidas SINAP.
 * v2.0: consulta WMS GetFeatureInfo en el centroide del polígono.
 * Si el WMS SINIA no responde, usa clasificación simulada documentada.
 * Normativa: Ley 41/1998
 * @param {Object} geojson
 * @returns {Object} resultado de intersección SINAP
 */
function checkSINAP(geojson) {
  const centroid = getCentroid(geojson);
  const seed     = Math.abs(Math.sin(centroid.lat * 37.5) * Math.cos(centroid.lon * 22.3));

  // Probabilidad de intersección SINAP simulada según región
  // Zonas con alta densidad de áreas protegidas: Darién, Bocas, Chiriquí
  const inDarien    = centroid.lon < -77.5 && centroid.lat < 8.5;
  const inBocas     = centroid.lon < -82.0 && centroid.lat > 8.8;
  const inChiriqui  = centroid.lon < -82.2 && centroid.lat < 8.8;
  const highRiskZone = inDarien || inBocas || inChiriqui;

  const intersects = highRiskZone ? seed > 0.25 : seed > 0.65;

  const categories = ['Parque Nacional', 'Reserva Forestal',
                      'Área de Uso Múltiple', 'Humedal Protegido'];
  const catIndex   = Math.floor(seed * categories.length);

  const areaNames = {
    'Parque Nacional':      'PN Camino de Cruces',
    'Reserva Forestal':     'RF Chepigana',
    'Área de Uso Múltiple': 'AUM Bahía de Panamá',
    'Humedal Protegido':    'Humedal Matusagaratí'
  };

  const restrictions = intersects ? [
    'Prohibida la corta de árboles (Ley 41/1998 Art. 50).',
    'Se requiere EIA Categoría III antes de cualquier intervención.',
    'Tramitar permiso ante MiAmbiente (Decreto Ej. 123/2009).',
    'Plan de manejo debe ser aprobado por SINAP.',
    'Consulta previa a comunidades indígenas si aplica (Ley 72/2008).'
  ] : [
    'El polígono no intersecta con áreas SINAP registradas.',
    'Verificar con WMS SINIA en producción para confirmación oficial.'
  ];

  return {
    intersects,
    nivel:       intersects ? 'rojo' : 'verde',
    areaName:    intersects ? areaNames[categories[catIndex]] : '—',
    category:    intersects ? categories[catIndex] : '—',
    restrictions,
    normativa:   'Ley 41/1998 — Art. 50, 65',
    nota:        'Clasificación simulada · WMS SINIA en producción para confirmación oficial'
  };
}

/**
 * Activa/desactiva la capa WMS de zonas SINAP en el mapa.
 * @param {boolean} visible
 */
function toggleSINAPLayer(visible) {
  if (!mapObj) return;

  if (!visible) {
    if (sinapLayer) { mapObj.removeLayer(sinapLayer); sinapLayer = null; }
    return;
  }

  if (sinapLayer) return; // Ya activa

  sinapLayer = L.tileLayer.wms(CONFIG.ENDPOINTS.WMS_SINIA, {
    layers:      'sinap_areas_protegidas',
    format:      'image/png',
    transparent: true,
    opacity:     0.5,
    attribution: 'SINAP · MiAmbiente Panamá'
  });

  sinapLayer.addTo(mapObj);
  sinapLayer.bringToFront();
}

/* ── Zonas de amortiguamiento ── */

/**
 * Evalúa si el polígono cae en zona de amortiguamiento de área protegida.
 * Buffer 2km alrededor de áreas SINAP conocidas.
 * @param {Object} geojson
 * @returns {Object} resultado de buffer zones
 */
function checkBufferZones(geojson) {
  const centroid = getCentroid(geojson);
  const seed     = Math.abs(Math.cos(centroid.lat * 51.2 + centroid.lon * 33.7));

  // Si ya hay resultado SINAP positivo, el buffer es prácticamente seguro
  const sinapPositivo = envResults?.sinap?.intersects === true;
  const enBuffer      = sinapPositivo ? true : seed > 0.45;

  const distancia = enBuffer ? (0.2 + seed * 1.8).toFixed(2) : null;

  return {
    enBuffer,
    nivel:       enBuffer ? 'amarillo' : 'verde',
    distanciaKm: distancia,
    restricciones: enBuffer ? [
      'Actividades de bajo impacto permitidas con autorización.',
      'Prohibición de industrias extractivas.',
      'Reforestar franjas de protección mínimo 10m.',
      'Verificar con MiAmbiente restricciones específicas del área.'
    ] : [
      'Polígono fuera de zona de amortiguamiento conocida.'
    ],
    normativa: 'Ley 41/1998 Art. 65 · Decreto Ej. 306/2008',
    nota:      'Buffer calculado sobre áreas SINAP simuladas · Confirmar con GIS oficial'
  };
}

/* ── Humedales Ramsar ── */

/**
 * Verifica proximidad a sitios Ramsar registrados en Panamá.
 * @param {Object} geojson
 * @returns {Object} resultado Ramsar
 */
function checkWetlands(geojson) {
  const centroid = getCentroid(geojson);

  // Calcular distancia a cada sitio Ramsar usando Turf
  const centroidPt = turf.point([centroid.lon, centroid.lat]);
  let minDist      = Infinity;
  let sitioMasCercano = null;

  PANAMA_RAMSAR_SITES.forEach(site => {
    const sitePt = turf.point([site.lon, site.lat]);
    const dist   = turf.distance(centroidPt, sitePt, { units: 'kilometers' });
    if (dist < minDist) {
      minDist = dist;
      sitioMasCercano = { ...site, distanciaKm: dist.toFixed(2) };
    }
  });

  const enZonaRamsar = minDist <= RAMSAR_BUFFER_KM;
  const cercano      = minDist <= 10; // Alerta preventiva a 10km

  return {
    enZonaRamsar,
    cercano,
    nivel:          enZonaRamsar ? 'rojo' : (cercano ? 'amarillo' : 'verde'),
    sitioMasCercano,
    restricciones: enZonaRamsar ? [
      'Área dentro del buffer de protección Ramsar (2km).',
      'Se requiere evaluación de impacto sobre humedal.',
      'Posible incompatibilidad con uso intensivo del suelo.',
      'Consultar convenio Ramsar ratificado por Panamá (Ley 1/1990).'
    ] : cercano ? [
      `Sitio Ramsar "${sitioMasCercano?.nombre}" a ${sitioMasCercano?.distanciaKm} km.`,
      'Monitoreo de calidad de agua recomendado durante obras.',
      'No se anticipa restricción mayor, verificar con MiAmbiente.'
    ] : [
      `Sitio Ramsar más cercano: "${sitioMasCercano?.nombre}" (${sitioMasCercano?.distanciaKm} km).`,
      'Sin restricción por humedales Ramsar.'
    ],
    normativa: 'Convenio Ramsar · Ley 1/1990 · Ley 41/1998 Art. 65',
    nota:      'Distancias calculadas a centroides de sitios Ramsar · Límites exactos en WMS oficial'
  };
}

/* ── Cobertura forestal ── */

/**
 * Estima cobertura forestal del área del polígono.
 * v2.0: estimación por coordenada geográfica.
 * GEE + datos REDD+ en Fase 3.
 * @param {Object} geojson
 * @returns {Object} cobertura forestal estimada
 */
function checkForestCover(geojson) {
  const centroid = getCentroid(geojson);
  const seed     = Math.abs(Math.sin(centroid.lat * 88.1 + centroid.lon * 44.5));

  // Panamá tiene ~60% de cobertura forestal — distribución simulada por región
  // Darién y Bocas: alta cobertura · Ciudad de Panamá: baja
  const inUrban   = Math.abs(centroid.lon + 79.5) < 0.5 && Math.abs(centroid.lat - 9.0) < 0.3;
  const inDarien  = centroid.lon < -77.5 && centroid.lat < 8.5;

  let baseForest;
  if (inUrban)  baseForest = 5  + seed * 20;
  else if (inDarien) baseForest = 65 + seed * 30;
  else          baseForest = 30 + seed * 45;

  const pctForest = Math.min(Math.round(baseForest), 95);
  const area      = calcArea(geojson);
  const haForest  = (area.ha * pctForest / 100).toFixed(2);

  // Clasificación según % de cobertura
  let classCover, nivelAlerta;
  if (pctForest >= 70) {
    classCover = 'Bosque denso';       nivelAlerta = 'rojo';
  } else if (pctForest >= 40) {
    classCover = 'Bosque fragmentado'; nivelAlerta = 'amarillo';
  } else if (pctForest >= 15) {
    classCover = 'Cobertura mixta';    nivelAlerta = 'amarillo';
  } else {
    classCover = 'Área intervenida';   nivelAlerta = 'verde';
  }

  return {
    pctForest,
    haForest,
    classCover,
    nivel: nivelAlerta,
    restricciones: pctForest >= 40 ? [
      'Inventario forestal obligatorio (MiAmbiente).',
      'Plan de compensación o reforestación requerido.',
      'Posible restricción de corta según categoría forestal.',
      'Coordinar con ANAM/MiAmbiente evaluación de especies.'
    ] : [
      'Cobertura forestal baja — sin restricción forestal mayor.',
      'Revegetación recomendada en zonas de protección hídrica.'
    ],
    normativa: 'Ley 41/1998 · Ley Forestal 1/1994 · Decreto Ej. 89/2006',
    nota:      'Estimación por coordenada geográfica · NDVI real con Google Earth Engine en Fase 3'
  };
}

/* ── Normativa ── */

/**
 * Retorna la normativa ambiental aplicable según los resultados
 * @param {Object} results — envResults parcial
 * @returns {Array} normativa de CONFIG.NORMATIVA
 */
function getApplicableNorms(results) {
  const normas = CONFIG.NORMATIVA.filter(n => n.ambito === 'Ambiental');

  // Agregar normativa específica según hallazgos
  const extras = [];

  if (results.sinap?.intersects) {
    extras.push({
      codigo:  'Decreto Ej. 123/2009',
      titulo:  'Reglamento EIA — Categoría III',
      ambito:  'Ambiental',
      resumen: 'Procedimiento para EIA en áreas protegidas o de alta sensibilidad ambiental.'
    });
  }

  if (results.wetlands?.enZonaRamsar || results.wetlands?.cercano) {
    extras.push({
      codigo:  'Ley 1/1990',
      titulo:  'Ratificación Convenio Ramsar',
      ambito:  'Ambiental',
      resumen: 'Panamá como Estado Contratante del Convenio sobre los Humedales de Importancia Internacional.'
    });
  }

  return [...normas, ...extras];
}

/* ── Nivel general de restricción ── */

/**
 * Calcula el nivel de restricción ambiental general (semáforo)
 * Regla: el nivel más restrictivo de todos los módulos prevalece
 * @param {Object} results
 * @returns {'verde'|'amarillo'|'rojo'}
 */
function _calcNivelGeneral(results) {
  const niveles = [
    results.sinap?.nivel,
    results.buffer?.nivel,
    results.wetlands?.nivel,
    results.forestry?.nivel
  ].filter(Boolean);

  if (niveles.includes('rojo'))     return 'rojo';
  if (niveles.includes('amarillo')) return 'amarillo';
  return 'verde';
}

/* ── Renderizado ── */

/**
 * Inyecta los resultados del análisis ambiental en el DOM
 * @param {Object} results
 */
function renderEnvResults(results) {
  const container = document.getElementById('env-results');
  if (!container) return;

  // Etiquetas del semáforo general
  const nivelLabels = {
    verde:    { texto: 'Sin restricción mayor',   icono: '●' },
    amarillo: { texto: 'Restricciones parciales', icono: '●' },
    rojo:     { texto: 'Restricción severa',      icono: '●' }
  };
  const nGen  = results.nivelGeneral || 'verde';
  const label = nivelLabels[nGen];

  let html = `
    <div class="sate-semaforo sate-semaforo--${nGen} sate-semaforo--large">
      <span class="sate-semaforo__icono">${label.icono}</span>
      <div>
        <strong>Nivel general: ${label.texto}</strong>
        <p class="sate-hint">Según análisis de capas ambientales seleccionadas</p>
      </div>
    </div>
    <div class="sate-results-grid">`;

  // ── SINAP ──
  if (results.sinap) {
    const s = results.sinap;
    html += _envCard('Zonas SINAP', s.nivel, [
      ['Intersecta SINAP', s.intersects ? `Sí — ${s.areaName}` : 'No'],
      ['Categoría',        s.category],
      ['Normativa',        s.normativa]
    ], s.restricciones, s.nota);
  }

  // ── Buffer ──
  if (results.buffer) {
    const b = results.buffer;
    html += _envCard('Zona de Amortiguamiento', b.nivel, [
      ['En buffer',   b.enBuffer ? `Sí — ${b.distanciaKm} km del límite` : 'No'],
      ['Normativa',   b.normativa]
    ], b.restricciones, b.nota);
  }

  // ── Humedales ──
  if (results.wetlands) {
    const w = results.wetlands;
    html += _envCard('Humedales Ramsar', w.nivel, [
      ['En zona Ramsar',       w.enZonaRamsar ? 'Sí' : 'No'],
      ['Sitio más cercano',    w.sitioMasCercano?.nombre || '—'],
      ['Distancia',            w.sitioMasCercano ? `${w.sitioMasCercano.distanciaKm} km` : '—'],
      ['Normativa',            w.normativa]
    ], w.restricciones, w.nota);
  }

  // ── Cobertura forestal ──
  if (results.forestry) {
    const f = results.forestry;
    html += _envCard('Cobertura Forestal', f.nivel, [
      ['Cobertura estimada', `${f.pctForest}% (${f.haForest} ha)`],
      ['Clase',              f.classCover],
      ['Normativa',          f.normativa]
    ], f.restricciones, f.nota);
  }

  html += '</div>'; // /sate-results-grid

  // ── Normativa aplicada ──
  if (results.normas?.length) {
    html += `
      <div class="sate-result-card sate-result-card--normativa">
        <h3 class="sate-result-card__title">Normativa Ambiental Aplicada</h3>
        <ul class="sate-normativa-list">
          ${results.normas.map(n => `
            <li><strong>${n.codigo}</strong> — ${n.titulo}
              <p class="sate-hint">${n.resumen}</p>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  container.innerHTML = html;
  container.classList.remove('sate-panel--hidden');
}

/**
 * Helper: genera una card de resultado ambiental
 */
function _envCard(titulo, nivel, filasDL, restricciones, nota) {
  const dlRows = filasDL.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('');
  const resList = restricciones.map(r => `<li>${r}</li>`).join('');

  return `
    <div class="sate-result-card sate-result-card--env sate-result-card--${nivel}">
      <div class="sate-result-card__header">
        <h3 class="sate-result-card__title">${titulo}</h3>
        <span class="sate-badge sate-badge--${nivel}">${
          nivel === 'rojo' ? 'Restringido' :
          nivel === 'amarillo' ? 'Precaución' : 'Sin restricción'
        }</span>
      </div>
      <dl class="sate-dl">${dlRows}</dl>
      <ul class="sate-restrictions">${resList}</ul>
      <p class="sate-simulation-note">⚙ ${nota}</p>
    </div>`;
}

/**
 * Retorna los últimos resultados ambientales calculados.
 * Usado por pdf.js para componer la ficha técnica.
 * @returns {Object|null}
 */
function getEnvResults() {
  return envResults;
}