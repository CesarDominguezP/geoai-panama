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
  if (!mapObj) {
    showToast('El mapa no está listo. Espera un momento.', 'error');
    return;
  }

  // Limpiar polígono anterior antes de dibujar uno nuevo
  clearPolygon();

  // Agregar el control de dibujo al mapa si no está aún
  if (!mapObj.hasLayer(drawControl)) {
    drawControl.addTo(mapObj);
  }

  // Activar la herramienta de dibujo de polígono directamente
  const polygonDrawer = new L.Draw.Polygon(mapObj, drawControl.options.draw.polygon);
  polygonDrawer.enable();
  drawMode = true;

  // Escuchar el evento de polígono creado (una sola vez)
  mapObj.once('draw:created', onPolygonCreated);

  // Escuchar cancelación (Escape)
  mapObj.once('draw:drawstop', () => {
    drawMode = false;
    _setDrawBtnState(false);
  });

  // Actualizar UI del botón
  _setDrawBtnState(true);
  showToast('Haz clic en el mapa para agregar vértices. Doble clic para cerrar.', 'info', 5000);
}

/**
 * Handler ejecutado cuando el usuario termina de dibujar
 * @param {L.Draw.Event} event
 */
function onPolygonCreated(event) {
  drawMode = false;
  _setDrawBtnState(false);

  const layer = event.layer;

  // 1. Agregar la capa al FeatureGroup de drawnItems
  window._drawnItems.addLayer(layer);
  activePolygon = layer;

  // 2. Convertir a GeoJSON Feature
  const geojson = layer.toGeoJSON();

  // 3. Convertir vértices a UTM → activeCoords
  const latlngs = layer.getLatLngs()[0]; // anillo exterior
  activeCoords = latlngs.map(ll => latLngToUTM(ll.lat, ll.lng));

  // 4. Notificar a todos los módulos
  onPolygonReady(geojson);
}

/* ── Entrada manual de coordenadas UTM ── */

/**
 * Agrega una fila de inputs Este/Norte al panel de coordenadas manuales
 */
function addCoordRow() {
  const list = document.getElementById('coords-list');
  if (!list) return;

  const rowIndex = list.querySelectorAll('.sate-coord-row').length + 1;

  const row = document.createElement('div');
  row.className = 'sate-coord-row';
  row.innerHTML = `
    <span class="sate-coord-row__label">P${rowIndex}</span>
    <input type="number" class="sate-input sate-coord-row__este"
           placeholder="Este (m)" step="0.001" />
    <input type="number" class="sate-input sate-coord-row__norte"
           placeholder="Norte (m)" step="0.001" />
    <button class="sate-btn sate-btn--icon sate-coord-row__del"
            title="Eliminar punto" onclick="_removeCoordRow(this)">✕</button>
  `;

  list.appendChild(row);
}

/**
 * Elimina una fila de coordenadas y renumera las restantes
 * @param {HTMLElement} btn — botón de eliminar dentro de la fila
 */
function _removeCoordRow(btn) {
  const row = btn.closest('.sate-coord-row');
  if (row) row.remove();
  _renumberCoordRows();
}

/**
 * Renumera las etiquetas P1, P2, P3... tras eliminar una fila
 */
function _renumberCoordRows() {
  const rows = document.querySelectorAll('#coords-list .sate-coord-row');
  rows.forEach((row, i) => {
    const label = row.querySelector('.sate-coord-row__label');
    if (label) label.textContent = `P${i + 1}`;
  });
}

/**
 * Construye el polígono a partir de las coordenadas UTM ingresadas manualmente
 */
function buildPolygonFromCoords() {
  const rows = document.querySelectorAll('#coords-list .sate-coord-row');

  if (rows.length < 3) {
    showToast('Se necesitan al menos 3 puntos para formar un polígono.', 'error');
    return;
  }

  // 1. Leer y validar inputs
  const coords = [];
  let hasError  = false;

  rows.forEach((row, i) => {
    const easting  = parseFloat(row.querySelector('.sate-coord-row__este')?.value);
    const northing = parseFloat(row.querySelector('.sate-coord-row__norte')?.value);

    if (isNaN(easting) || isNaN(northing)) {
      showToast(`P${i + 1}: valores inválidos.`, 'error');
      hasError = true;
      return;
    }

    // Validar rango aproximado para Panamá en UTM 17N
    // Easting: ~200,000 – 900,000 m  |  Northing: ~790,000 – 1,070,000 m
    if (easting < 200000 || easting > 900000 || northing < 790000 || northing > 1070000) {
      showToast(`P${i + 1}: coordenadas fuera del territorio panameño.`, 'warning');
      hasError = true;
      return;
    }

    coords.push({ easting, northing });
  });

  if (hasError || coords.length < 3) return;

  // 2. Convertir UTM → WGS84
  const latlngs = coords.map(c => utmToLatLng(c.easting, c.northing));

  // 3. Construir layer Leaflet y agregar al mapa
  clearPolygon();

  const layer = L.polygon(latlngs, {
    color:       '#00e5ff',
    weight:      2,
    fillColor:   '#00e5ff',
    fillOpacity: 0.15
  });

  window._drawnItems.addLayer(layer);
  activePolygon = layer;
  activeCoords  = coords;

  // 4. Construir GeoJSON y notificar
  const geojson = layer.toGeoJSON();
  onPolygonReady(geojson);
}

/* ── Carga de archivo ── */

/**
 * Procesa el archivo seleccionado en el input de archivo.
 * Soporta: CSV (Este, Norte UTM), GeoJSON, KML
 * @param {Event} event — change event del input file
 */
function loadPolygonFile(event) {
  const file = event.target.files[0];

  // 1. Validar tamaño y extensión
  const validation = validateFile(file, ['csv', 'geojson', 'kml']);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    event.target.value = '';
    return;
  }

  const ext    = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();

  reader.onload = (e) => {
    const text = e.target.result;
    let geojson = null;

    try {
      if (ext === 'csv') {
        const coords = parseCSV(text);
        if (!coords || coords.length < 3) {
          showToast('CSV inválido o menos de 3 puntos válidos.', 'error');
          return;
        }
        geojson = _coordsToGeoJSON(coords);

      } else if (ext === 'geojson') {
        geojson = parseGeoJSON(text);

      } else if (ext === 'kml') {
        geojson = _parseKML(text);
      }

      if (!geojson) {
        showToast('No se pudo leer el archivo. Verifica el formato.', 'error');
        return;
      }

      // Construir capa Leaflet desde GeoJSON
      clearPolygon();
      const layer = L.geoJSON(geojson).getLayers()[0];
      if (!layer) {
        showToast('El archivo no contiene un polígono válido.', 'error');
        return;
      }

      window._drawnItems.addLayer(layer);
      activePolygon = layer;

      // Extraer coordenadas UTM del GeoJSON
      const ring = geojson.geometry.coordinates[0];
      activeCoords = ring.slice(0, -1).map(c => latLngToUTM(c[1], c[0]));

      onPolygonReady(geojson);

    } catch (err) {
      console.error('[SATE polygon] loadPolygonFile error:', err);
      showToast('Error al procesar el archivo: ' + err.message, 'error');
    }
  };

  reader.onerror = () => showToast('No se pudo leer el archivo.', 'error');
  reader.readAsText(file);

  // Reset input para permitir cargar el mismo archivo de nuevo
  event.target.value = '';
}

/**
 * Parsea CSV con columnas Este, Norte (UTM Zona 17N)
 * @param {string} csvText
 * @returns {Array} [{easting, northing}]
 */
function parseCSV(csvText) {
  const result = Papa.parse(csvText, {
    header:         true,
    skipEmptyLines: true,
    dynamicTyping:  true
  });

  if (!result.data || result.data.length === 0) return null;

  // Detectar automáticamente nombres de columnas Este/Norte
  const headers  = Object.keys(result.data[0]).map(h => h.trim());
  const esteKey  = headers.find(h => /^(este|easting|e|x)$/i.test(h));
  const norteKey = headers.find(h => /^(norte|northing|n|y)$/i.test(h));

  if (!esteKey || !norteKey) {
    showToast(
      `CSV: no se encontraron columnas Este/Norte. Columnas detectadas: ${headers.join(', ')}`,
      'error', 6000
    );
    return null;
  }

  const coords = result.data
    .map(row => ({
      easting:  parseFloat(row[esteKey]),
      northing: parseFloat(row[norteKey])
    }))
    .filter(c =>
      !isNaN(c.easting)  && !isNaN(c.northing) &&
      c.easting  >= 200000 && c.easting  <= 900000 &&
      c.northing >= 790000 && c.northing <= 1070000
    );

  return coords.length >= 3 ? coords : null;
}

/**
 * Parsea GeoJSON y extrae el primer Polygon encontrado
 * @param {string} geojsonText
 * @returns {Object} GeoJSON Feature Polygon
 */
function parseGeoJSON(geojsonText) {
  const data = JSON.parse(geojsonText);

  // Puede llegar como Feature, FeatureCollection o Geometry directa
  if (data.type === 'FeatureCollection') {
    const feat = data.features.find(f =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
    );
    if (!feat) return null;
    // Si es MultiPolygon, tomar el primer anillo
    if (feat.geometry.type === 'MultiPolygon') {
      return {
        type: 'Feature',
        properties: feat.properties,
        geometry: { type: 'Polygon', coordinates: feat.geometry.coordinates[0] }
      };
    }
    return feat;
  }

  if (data.type === 'Feature' && data.geometry?.type === 'Polygon') {
    return data;
  }

  if (data.type === 'Polygon') {
    return { type: 'Feature', properties: {}, geometry: data };
  }

  return null;
}

/**
 * Parsea KML básico y extrae el primer Polygon
 * @param {string} kmlText
 * @returns {Object|null} GeoJSON Feature
 */
function _parseKML(kmlText) {
  try {
    const parser  = new DOMParser();
    const kmlDoc  = parser.parseFromString(kmlText, 'text/xml');
    const coords  = kmlDoc.querySelector('Polygon coordinates, coordinates');
    if (!coords) return null;

    const raw = coords.textContent.trim().split(/\s+/);
    const ring = raw.map(pair => {
      const parts = pair.split(',');
      return [parseFloat(parts[0]), parseFloat(parts[1])]; // [lon, lat]
    }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));

    if (ring.length < 3) return null;

    // Cerrar el anillo si no está cerrado
    const first = ring[0];
    const last  = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] }
    };
  } catch {
    return null;
  }
}

/**
 * Convierte array de {easting, northing} UTM a GeoJSON Feature Polygon
 * @param {Array} coords
 * @returns {Object} GeoJSON Feature
 */
function _coordsToGeoJSON(coords) {
  const ring = coords.map(c => {
    const [lat, lon] = utmToLatLng(c.easting, c.northing);
    return [lon, lat]; // GeoJSON usa [lon, lat]
  });

  // Cerrar el anillo
  ring.push(ring[0]);

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}

/* ── Polígono listo ── */

/**
 * Ejecutado cuando un polígono válido está activo.
 * Actualiza la UI y notifica a los módulos dependientes.
 * @param {Object} geojson — GeoJSON Feature Polygon
 */
function onPolygonReady(geojson) {
  // 1. Guardar estado global
  activeGeoJSON = geojson;

  // 2. Calcular métricas con utils.js
  const area      = calcArea(geojson);
  const perimeter = calcPerimeter(geojson);
  const centroid  = getCentroid(geojson);
  const vertices  = geojson.geometry.coordinates[0].length - 1; // -1 por cierre

  // 3. Mostrar #polygon-summary
  document.getElementById('polygon-summary').style.display = '';
  document.getElementById('poly-area').textContent =
    `${formatNumber(area.ha, 4)} ha  (${formatNumber(area.m2, 2)} m²)`;
  document.getElementById('poly-perimeter').textContent =
    `${formatNumber(perimeter, 2)} m`;
  document.getElementById('poly-vertices').textContent = vertices;
  document.getElementById('poly-centroid').textContent =
    `${centroid.lat.toFixed(5)}°, ${centroid.lon.toFixed(5)}°`;

  // 4. Zoom al polígono
  zoomToPolygon();

  // 5. Habilitar botones de análisis civil y ambiental
  const btnCivil = document.getElementById('btn-run-civil');
  const btnEnv   = document.getElementById('btn-run-env');
  const btnMon   = document.getElementById('btn-activate-station');
  if (btnCivil) btnCivil.disabled = false;
  if (btnEnv)   btnEnv.disabled   = false;
  if (btnMon)   btnMon.disabled   = false;

  // 6. Notificar
  showToast('Polígono listo. Ejecuta el análisis.', 'success');
}

/* ── Limpiar ── */

/**
 * Elimina el polígono activo del mapa y resetea el estado
 */
function clearPolygon() {
  // 1. Remover capa del mapa
  if (activePolygon && window._drawnItems) {
    window._drawnItems.removeLayer(activePolygon);
  }

  // 2. Resetear estado
  activePolygon = null;
  activeGeoJSON = null;
  activeCoords  = [];
  drawMode      = false;

  // 3. Ocultar resumen
  const summary = document.getElementById('polygon-summary');
  if (summary) summary.style.display = 'none';

  // 4. Deshabilitar botones de análisis
  const btnCivil = document.getElementById('btn-run-civil');
  const btnEnv   = document.getElementById('btn-run-env');
  const btnMon   = document.getElementById('btn-activate-station');
  if (btnCivil) btnCivil.disabled = true;
  if (btnEnv)   btnEnv.disabled   = true;
  if (btnMon)   btnMon.disabled   = true;

  // 5. Limpiar resultados previos
  const resultsPanel  = document.getElementById('results-panel');
  const resultsContent = document.getElementById('results-content');
  if (resultsContent) resultsContent.innerHTML = '';
  if (resultsPanel)   resultsPanel.style.display = 'none';

  // 6. Limpiar inputs de coordenadas manuales
  document.querySelectorAll('#coords-list .sate-coord-row').forEach(r => r.remove());

  _setDrawBtnState(false);
}

/* ── Acceso público al estado del polígono ── */

/**
 * Retorna el GeoJSON del polígono activo o null.
 * Usado por analysis.js, environment.js, monitor.js, pdf.js
 * @returns {Object|null}
 */
function getActivePolygon() {
  return activeGeoJSON;
}

/**
 * Retorna las coordenadas UTM del polígono activo.
 * Usado por analysis.js para el derrotero.
 * @returns {Array} [{easting, northing}]
 */
function getActiveCoords() {
  return activeCoords;
}

/**
 * Retorna el centroide del polígono activo en WGS84.
 * Usado principalmente por monitor.js para fetch Open-Meteo.
 * @returns {{lat: number, lon: number}|null}
 */
function getActiveCentroid() {
  if (!activeGeoJSON) return null;
  return getCentroid(activeGeoJSON);
}

/* ── Helpers internos de UI ── */

/**
 * Actualiza el estado visual del botón de dibujo
 * @param {boolean} active
 */
function _setDrawBtnState(active) {
  const btn = document.getElementById('btn-draw-polygon');
  if (!btn) return;
  btn.classList.toggle('sate-btn--active', active);
  btn.textContent = active ? 'Cancelar dibujo' : 'Dibujar polígono';
}