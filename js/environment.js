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

/* ── Orquestador principal ── */

/**
 * Ejecuta el análisis de impacto ambiental del polígono activo.
 * Requiere polígono activo.
 */
function runEnvironmentAnalysis() {
  // TODO — implementar en Fase 2
  // 1. Verificar getActivePolygon() !== null
  // 2. Mostrar estado de carga en #env-results
  // 3. Según checkboxes:
  //    - chk-sinap    → checkSINAP()
  //    - chk-buffer   → checkBufferZones()
  //    - chk-wetlands → checkWetlands()
  //    - chk-forestry → checkForestCover()
  // 4. Consolidar en envResults
  // 5. Renderizar en #env-results
}

/* ── Zonas SINAP ── */

/**
 * Verifica si el polígono intersecta con áreas protegidas SINAP.
 * Fuente: WMS SINIA (CONFIG.ENDPOINTS.WMS_SINIA)
 * Normativa: Ley 41/1998
 * @param {Object} geojson
 * @returns {Object} resultado de intersección SINAP
 */
function checkSINAP(geojson) {
  // TODO — implementar en Fase 2
  // Query WMS GetFeatureInfo en el centroide del polígono
  // Output: {intersects: bool, areaName, category, restrictions[]}
}

/**
 * Activa/desactiva la capa WMS de zonas SINAP en el mapa
 * @param {boolean} visible
 */
function toggleSINAPLayer(visible) {
  // TODO — implementar en Fase 2
  // Instanciar L.tileLayer.wms con CONFIG.ENDPOINTS.WMS_SINIA
  // Layers: 'sinap' (verificar nombre real en GetCapabilities)
}

/* ── Zonas de amortiguamiento ── */

/**
 * Evalúa si el polígono cae en zona de amortiguamiento de área protegida.
 * Las zonas de amortiguamiento tienen restricciones parciales (no prohibición total).
 * @param {Object} geojson
 * @returns {Object} resultado de buffer zones
 */
function checkBufferZones(geojson) {
  // TODO — implementar en Fase 2
}

/* ── Humedales Ramsar ── */

/**
 * Verifica proximidad a humedales Ramsar registrados en Panamá.
 * Panamá tiene 12 sitios Ramsar (verificar con Perplexity antes de hardcodear)
 * @param {Object} geojson
 * @returns {Object} resultado Ramsar
 */
function checkWetlands(geojson) {
  // TODO — implementar en Fase 2
  // Panamá sitios Ramsar conocidos: Bahía de Panamá, San San Pond Sak, etc.
  // Distancia mínima de afectación: 500m (verificar normativa con Perplexity)
}

/* ── Cobertura forestal ── */

/**
 * Estima cobertura forestal del área del polígono.
 * En v2.0 usa estimación por coordenada — GEE en Fase 3.
 * @param {Object} geojson
 * @returns {Object} cobertura forestal estimada
 */
function checkForestCover(geojson) {
  // TODO — implementar en Fase 2
}

/* ── Normativa ── */

/**
 * Retorna las normas ambientales aplicables según los resultados
 * @param {Object} results — envResults
 * @returns {Array} normativa aplicable de CONFIG.NORMATIVA
 */
function getApplicableNorms(results) {
  // TODO — implementar en Fase 2
  // Filtrar CONFIG.NORMATIVA por ambito 'Ambiental'
  // Agregar restricciones específicas según resultados
}

/* ── Renderizado ── */

/**
 * Inyecta los resultados del análisis ambiental en el DOM
 * @param {Object} results
 */
function renderEnvResults(results) {
  // TODO — implementar en Fase 2
  // Semáforo de restricción: Verde (sin restricción) / Amarillo (buffer) / Rojo (SINAP)
  // Tabla de normativa aplicable
  // Recomendaciones y próximos pasos (EIA requerido o no)
}

/**
 * Retorna los últimos resultados ambientales calculados
 * Usado por pdf.js para componer la ficha técnica
 * @returns {Object|null}
 */
function getEnvResults() {
  return envResults;
}
