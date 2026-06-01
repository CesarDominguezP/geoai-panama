/* ============================================================
   SATE-04 | GESTIÓN DE POLÍGONO
   Corazón del sistema. Todo análisis depende de que este
   módulo tenga un polígono activo válido.
   Maneja: dibujo en mapa, entrada UTM manual, carga de archivo.
   Dependencias: config.js, utils.js, map.js, Leaflet.draw, Turf, Proj4
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Estado del polígono activo ── */
let activePolygon   = null;  // Layer Leaflet del polígono dibujado
let activeGeoJSON   = null;  // GeoJSON Feature del polígono activo
let activeCoords    = [];    // Array de {easting, northing} UTM 17N
let drawMode        = false; // true mientras Leaflet.draw está activo

/* ── Dibujo en mapa ── */

/**
 * Activa el modo de dibujo de polígono en el mapa.
 * El usuario hace clic para agregar vértices, doble clic para cerrar.
 */
function startDrawPolygon() {
  // TODO — implementar en Fase 2
  // 1. Verificar que mapObj esté inicializado
  // 2. Limpiar polígono anterior si existe
  // 3. Activar drawControl (Leaflet.draw DrawPolygon)
  // 4. Escuchar evento 'draw:created' → onPolygonCreated()
  // 5. Actualizar UI: btn-draw-polygon → estado activo
}

/**
 * Handler ejecutado cuando el usuario termina de dibujar
 * @param {L.Draw.Event} event
 */
function onPolygonCreated(event) {
  // TODO — implementar en Fase 2
  // 1. Guardar layer en activePolygon
  // 2. Convertir a GeoJSON → activeGeoJSON
  // 3. Convertir vértices a UTM → activeCoords
  // 4. Llamar onPolygonReady()
}

/* ── Entrada manual de coordenadas UTM ── */

/**
 * Agrega una fila de inputs Este/Norte al panel de coordenadas manuales
 */
function addCoordRow() {
  // TODO — implementar en Fase 2
  // Agregar fila al #coords-list con inputs Este (m) y Norte (m)
  // Botón eliminar fila
  // Mínimo 3 puntos para formar polígono válido
}

/**
 * Construye el polígono a partir de las coordenadas UTM ingresadas manualmente
 */
function buildPolygonFromCoords() {
  // TODO — implementar en Fase 2
  // 1. Leer todos los inputs del #coords-list
  // 2. Validar: mínimo 3 puntos, valores numéricos en rango Panamá
  // 3. Convertir UTM → WGS84 con utmToLatLng()
  // 4. Construir L.polygon y agregar al mapa
  // 5. Llamar onPolygonReady()
}

/* ── Carga de archivo ── */

/**
 * Procesa el archivo seleccionado en el input de archivo
 * Soporta: CSV (Este, Norte UTM), GeoJSON, KML
 * @param {Event} event — change event del input file
 */
function loadPolygonFile(event) {
  // TODO — implementar en Fase 2
  // 1. validateFile() — tamaño y extensión
  // 2. Según extensión: parseCSV / parseGeoJSON / parseKML
  // 3. Construir polígono y llamar onPolygonReady()
}

/**
 * Parsea CSV con columnas Este, Norte (UTM Zona 17N)
 * @param {string} csvText
 * @returns {Array} [{easting, northing}]
 */
function parseCSV(csvText) {
  // TODO — implementar en Fase 2
  // Usar PapaParse: Papa.parse(csvText, { header: true, skipEmptyLines: true })
  // Detectar automáticamente nombres de columnas (Este/Easting/E, Norte/Northing/N)
  // Validar que valores estén dentro del bbox de Panamá
}

/**
 * Parsea GeoJSON y extrae el primer Polygon encontrado
 * @param {string} geojsonText
 * @returns {Object} GeoJSON Feature
 */
function parseGeoJSON(geojsonText) {
  // TODO — implementar en Fase 2
}

/* ── Polígono listo ── */

/**
 * Ejecutado cuando un polígono válido está activo.
 * Actualiza la UI y notifica a los módulos dependientes.
 * @param {Object} geojson — GeoJSON Feature Polygon
 */
function onPolygonReady(geojson) {
  // TODO — implementar en Fase 2
  // 1. Guardar en activeGeoJSON
  // 2. Calcular área, perímetro, centroide con utils.js
  // 3. Mostrar #polygon-summary con los valores
  // 4. Hacer zoom al polígono
  // 5. Habilitar botones de análisis civil y ambiental
  // 6. showToast('Polígono listo. Ejecuta el análisis.', 'success')
}

/* ── Limpiar ── */

/**
 * Elimina el polígono activo del mapa y resetea el estado
 */
function clearPolygon() {
  // TODO — implementar en Fase 2
  // 1. Remover activePolygon del mapa
  // 2. Resetear activePolygon, activeGeoJSON, activeCoords
  // 3. Ocultar #polygon-summary
  // 4. Deshabilitar botones de análisis
  // 5. Limpiar resultados previos
}

/* ── Acceso público al estado del polígono ── */

/**
 * Retorna el GeoJSON del polígono activo o null
 * Usado por analysis.js, environment.js, monitor.js, pdf.js
 * @returns {Object|null}
 */
function getActivePolygon() {
  return activeGeoJSON;
}

/**
 * Retorna el centroide del polígono activo en WGS84
 * Usado principalmente por monitor.js para fetch Open-Meteo
 * @returns {{lat: number, lon: number}|null}
 */
function getActiveCentroid() {
  // TODO — implementar en Fase 2
  if (!activeGeoJSON) return null;
  return getCentroid(activeGeoJSON);
}
