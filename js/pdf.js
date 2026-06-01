/* ============================================================
   SATE-08 | GENERACIÓN DE FICHA TÉCNICA PDF
   La ficha es el producto final del sistema — debe ser impecable.
   Incluye: imagen fiel del mapa, datos del polígono, análisis civil,
   análisis ambiental, derrotero UTM, normativa, hash de custodia.
   Dependencias: config.js, utils.js, map.js, polygon.js,
                 analysis.js, environment.js, monitor.js,
                 jsPDF, html2canvas
   SATE v2.0 | JIC 2026
   ============================================================ */

'use strict';

/* ── Configuración del documento PDF ── */
const PDF_CONFIG = {
  format:      'letter',
  orientation: 'portrait',
  unit:        'mm',
  margins: {
    top:    20,
    right:  15,
    bottom: 20,
    left:   15
  },
  colors: {
    primary:   [15,  82, 186],
    secondary: [34, 139,  34],
    accent:    [220,  50,  50],
    dark:      [30,   30,  30],
    gray:      [120, 120, 120],
    lightGray: [230, 230, 230]
  },
  fonts: {
    title:   18,
    section: 12,
    body:    9,
    small:   7
  }
};

/* ── Estado interno del PDF ── */
let _pdfDoc        = null;   // Instancia jsPDF activa
let _pdfY          = 0;      // Cursor Y actual en mm
let _pdfPageNum    = 1;      // Página actual
let _pdfTotalPages = 1;      // Total de páginas (estimado)
let _mapImageB64   = '';     // Captura del mapa guardada

const PAGE_W  = 216;  // Carta mm ancho
const PAGE_H  = 279;  // Carta mm alto
const MARGIN_L = PDF_CONFIG.margins.left;
const MARGIN_R = PDF_CONFIG.margins.right;
const MARGIN_T = PDF_CONFIG.margins.top;
const MARGIN_B = PDF_CONFIG.margins.bottom;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;  // 186 mm

/* ── Orquestador principal ── */

/**
 * Punto de entrada — genera previsualización y abre el modal.
 */
async function generatePDF() {
  const geojson = getActivePolygon();
  if (!geojson) {
    showToast('Define un polígono antes de generar la ficha.', 'error');
    return;
  }

  const civil = getCivilResults();
  const env   = getEnvResults();
  if (!civil && !env) {
    showToast('Ejecuta al menos un análisis antes de generar la ficha.', 'warning');
    return;
  }

  showToast('Preparando ficha técnica… esperando tiles del mapa.', 'info', 4000);

  // Capturar mapa (espera tiles internamente)
  _mapImageB64 = await captureMapImage();

  // Renderizar previsualización HTML en #pdf-preview
  _renderHTMLPreview(geojson, civil, env);

  // Abrir modal
  openModal('modal-pdf');
}

/**
 * Exporta y descarga el PDF final.
 * Llamado desde el botón "Descargar PDF" del modal.
 */
async function exportPDF() {
  const geojson = getActivePolygon();
  if (!geojson) return;

  showToast('Generando PDF…', 'info', 8000);

  const { jsPDF } = window.jspdf;
  _pdfDoc  = new jsPDF({
    orientation: PDF_CONFIG.orientation,
    unit:        PDF_CONFIG.unit,
    format:      PDF_CONFIG.format
  });

  _pdfY      = MARGIN_T;
  _pdfPageNum = 1;

  // Recopilar todos los datos
  const civil       = getCivilResults();
  const env         = getEnvResults();
  const monitor     = getMonitorData();
  const area        = calcArea(geojson);
  const perimeter   = calcPerimeter(geojson);
  const centroid    = getCentroid(geojson);
  const coords      = getActiveCoords();
  const adminLoc    = getAdminLocation(centroid);
  const vertices    = geojson.geometry.coordinates[0].length - 1;
  const timestamp   = new Date().toISOString();

  const polygonData = { area, perimeter, centroid, vertices, adminLoc, coords };

  // Hash de custodia — sobre los datos principales
  const hashContent = JSON.stringify({ timestamp, centroid, area, perimeter });
  const docHash     = await sha256(hashContent);

  const meta = {
    timestamp,
    docHash,
    expediente: docHash.substring(0, 12).toUpperCase()
  };

  // ── Construir secciones ──
  buildPDFHeader(_pdfDoc, meta);
  buildPDFMapSection(_pdfDoc, _mapImageB64);
  buildPDFPolygonSection(_pdfDoc, polygonData);

  if (civil)   buildPDFCivilSection(_pdfDoc, civil);
  if (env)     buildPDFEnvironmentSection(_pdfDoc, env);

  if (coords?.length >= 2) {
    const derrotero = buildDerrotero(coords);
    buildPDFDerroteroSection(_pdfDoc, derrotero, area, perimeter);
  }

  buildPDFNormativaSection(_pdfDoc);

  if (monitor) buildPDFMonitorSection(_pdfDoc, monitor);

  // Footer en todas las páginas
  await _applyFooterAllPages(_pdfDoc, meta);

  // Descargar
  const fname = `SATE_Ficha_${meta.expediente}_${timestamp.slice(0,10)}.pdf`;
  _pdfDoc.save(fname);

  closeModal('modal-pdf');
  showToast('Ficha técnica descargada.', 'success');
}

/* ════════════════════════════════════════════════════════
   SECCIONES DEL PDF
   ════════════════════════════════════════════════════════ */

/**
 * Encabezado institucional
 */
function buildPDFHeader(doc, meta) {
  _pdfY = MARGIN_T;

  // Banda superior azul
  doc.setFillColor(...PDF_CONFIG.colors.primary);
  doc.rect(0, 0, PAGE_W, 14, 'F');

  // Título en banda
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('S.A.T.E. v2.0  —  Sistema de Auditoría Territorial Especializada', MARGIN_L, 9);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('JIC 2026 · República de Panamá', PAGE_W - MARGIN_R, 9, { align: 'right' });

  _pdfY = 20;

  // Título de la ficha
  doc.setTextColor(...PDF_CONFIG.colors.dark);
  doc.setFontSize(PDF_CONFIG.fonts.title);
  doc.setFont('helvetica', 'bold');
  doc.text('FICHA TÉCNICA DE AUDITORÍA TERRITORIAL', PAGE_W / 2, _pdfY, { align: 'center' });
  _pdfY += 7;

  // Subtítulo
  doc.setFontSize(PDF_CONFIG.fonts.body);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_CONFIG.colors.gray);
  doc.text(`Expediente N.° ${meta.expediente}  ·  ${formatDate(new Date(meta.timestamp))}`,
           PAGE_W / 2, _pdfY, { align: 'center' });
  _pdfY += 3;

  _drawHRule(doc);
}

/**
 * Sección del mapa
 */
function buildPDFMapSection(doc, mapImageBase64) {
  _checkPageBreak(doc, 85);
  _sectionTitle(doc, 'Vista Satelital del Área de Estudio');

  if (mapImageBase64) {
    const imgH = 75;  // mm
    try {
      doc.addImage(mapImageBase64, 'PNG', MARGIN_L, _pdfY, CONTENT_W, imgH);
      _pdfY += imgH + 2;
    } catch {
      _bodyText(doc, '[Imagen del mapa no disponible — verificar permisos CORS de tiles]');
    }
  } else {
    _bodyText(doc, '[Captura de mapa no disponible]');
  }

  // Nota al pie de la imagen
  doc.setFontSize(PDF_CONFIG.fonts.small);
  doc.setTextColor(...PDF_CONFIG.colors.gray);
  doc.text('Fuente: ESRI World Imagery · Sistema de coordenadas: UTM Zona 17N (EPSG:32617) · Datum: WGS84',
           MARGIN_L, _pdfY);
  _pdfY += 5;
  _drawHRule(doc);
}

/**
 * Datos del polígono
 */
function buildPDFPolygonSection(doc, data) {
  _checkPageBreak(doc, 55);
  _sectionTitle(doc, 'Datos del Polígono');

  const utmCentroid = latLngToUTM(data.centroid.lat, data.centroid.lon);

  const rows = [
    ['Área',               `${formatNumber(data.area.ha, 4)} ha`],
    ['Área (m²)',          `${formatNumber(data.area.m2, 2)} m²`],
    ['Perímetro',          `${formatNumber(data.perimeter, 2)} m`],
    ['Vértices',           `${data.vertices}`],
    ['Centroide Lat/Lon',  `${data.centroid.lat.toFixed(6)}°, ${data.centroid.lon.toFixed(6)}°`],
    ['Centroide UTM Este', `${formatNumber(utmCentroid.easting, 3)} m`],
    ['Centroide UTM Norte',`${formatNumber(utmCentroid.northing, 3)} m`],
    ['Provincia',          data.adminLoc?.provincia || '—'],
    ['Distrito',           data.adminLoc?.distrito  || '—'],
    ['Proyección',         'UTM Zona 17N · EPSG:32617 · WGS84']
  ];

  _twoColTable(doc, rows);
  _drawHRule(doc);
}

/**
 * Análisis de ingeniería civil
 */
function buildPDFCivilSection(doc, civil) {
  _checkPageBreak(doc, 40);
  _sectionTitle(doc, 'Análisis de Ingeniería Civil');

  // Geotécnico
  if (civil.geotecnico) {
    const g = civil.geotecnico;
    _subTitle(doc, 'Riesgo Geotécnico');

    // Semáforo
    const colorMap = { Bajo: PDF_CONFIG.colors.secondary,
                       Moderado: [200, 150, 0], Alto: PDF_CONFIG.colors.accent };
    doc.setFillColor(...(colorMap[g.riskLevel] || PDF_CONFIG.colors.gray));
    doc.roundedRect(MARGIN_L, _pdfY, 40, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(PDF_CONFIG.fonts.body);
    doc.setFont('helvetica', 'bold');
    doc.text(`${g.riskLevel}  (${g.riskScore}/100)`, MARGIN_L + 2, _pdfY + 5.5);
    doc.setTextColor(...PDF_CONFIG.colors.dark);
    doc.setFont('helvetica', 'normal');
    _pdfY += 11;

    const rows = [
      ['Tipo de suelo',       g.soilType],
      ['Pendiente media est.',`${g.pendienteMedia}%`],
      ['Nivel freático est.', `${g.nivelFreatico} m`],
      ['Normativa',           g.normativa]
    ];
    _twoColTable(doc, rows);

    _subTitle(doc, 'Recomendaciones Geotécnicas');
    g.recommendations.forEach(r => _bulletText(doc, r));
    _pdfY += 2;
    _noteText(doc, g.nota);
  }

  // Pendientes
  if (civil.pendientes) {
    const p = civil.pendientes;
    _checkPageBreak(doc, 35);
    _subTitle(doc, 'Distribución de Pendientes');

    const rows = [
      ['Pendiente máxima', `${p.maxSlope}%`],
      ['Pendiente media',  `${p.avgSlope}%`],
      ['Clase dominante',  p.dominantClass],
      ['Normativa',        p.normativa]
    ];
    _twoColTable(doc, rows);

    // Tabla de distribución
    const distRows = Object.entries(p.distribution).map(([k, v]) => [k, `${v}%`]);
    _smallTable(doc, ['Categoría', '%'], distRows);
    _noteText(doc, p.nota);
  }

  // Corte y relleno
  if (civil.corteRelleno) {
    const c = civil.corteRelleno;
    _checkPageBreak(doc, 30);
    _subTitle(doc, 'Estimación de Corte y Relleno');

    const rows = [
      ['Volumen de corte',   `${formatNumber(c.cutVolume_m3, 0)} m³`],
      ['Volumen de relleno', `${formatNumber(c.fillVolume_m3, 0)} m³`],
      ['Volumen neto',       `${formatNumber(c.netVolume_m3, 0)} m³`],
      ['Balance',            c.balance],
      ['Factor esponjamiento', `${c.esponjamiento}`]
    ];
    _twoColTable(doc, rows);
    _noteText(doc, c.nota);
  }

  _drawHRule(doc);
}

/**
 * Análisis ambiental
 */
function buildPDFEnvironmentSection(doc, env) {
  _checkPageBreak(doc, 40);
  _sectionTitle(doc, 'Análisis Ambiental');

  // Nivel general
  const nivelColors = {
    verde:    PDF_CONFIG.colors.secondary,
    amarillo: [200, 150, 0],
    rojo:     PDF_CONFIG.colors.accent
  };
  const nivelTexts = {
    verde:    'Sin restricción mayor',
    amarillo: 'Restricciones parciales',
    rojo:     'Restricción severa'
  };
  const nGen = env.nivelGeneral || 'verde';

  doc.setFillColor(...(nivelColors[nGen] || PDF_CONFIG.colors.gray));
  doc.roundedRect(MARGIN_L, _pdfY, 80, 8, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(PDF_CONFIG.fonts.body);
  doc.setFont('helvetica', 'bold');
  doc.text(`Nivel General: ${nivelTexts[nGen]}`, MARGIN_L + 2, _pdfY + 5.5);
  doc.setTextColor(...PDF_CONFIG.colors.dark);
  doc.setFont('helvetica', 'normal');
  _pdfY += 12;

  // SINAP
  if (env.sinap) {
    const s = env.sinap;
    _subTitle(doc, 'Zonas SINAP');
    const rows = [
      ['Intersecta SINAP', s.intersects ? `Sí — ${s.areaName}` : 'No'],
      ['Categoría',        s.category],
      ['Normativa',        s.normativa]
    ];
    _twoColTable(doc, rows);
    s.restricciones.forEach(r => _bulletText(doc, r));
    _noteText(doc, s.nota);
  }

  // Buffer
  if (env.buffer) {
    const b = env.buffer;
    _checkPageBreak(doc, 25);
    _subTitle(doc, 'Zona de Amortiguamiento');
    const rows = [
      ['En buffer', b.enBuffer ? `Sí — ${b.distanciaKm} km del límite` : 'No'],
      ['Normativa', b.normativa]
    ];
    _twoColTable(doc, rows);
    b.restricciones.forEach(r => _bulletText(doc, r));
    _noteText(doc, b.nota);
  }

  // Humedales
  if (env.wetlands) {
    const w = env.wetlands;
    _checkPageBreak(doc, 25);
    _subTitle(doc, 'Humedales Ramsar');
    const rows = [
      ['En zona Ramsar',    w.enZonaRamsar ? 'Sí' : 'No'],
      ['Sitio más cercano', w.sitioMasCercano?.nombre || '—'],
      ['Distancia',         w.sitioMasCercano ? `${w.sitioMasCercano.distanciaKm} km` : '—'],
      ['Normativa',         w.normativa]
    ];
    _twoColTable(doc, rows);
    w.restricciones.forEach(r => _bulletText(doc, r));
    _noteText(doc, w.nota);
  }

  // Forestal
  if (env.forestry) {
    const f = env.forestry;
    _checkPageBreak(doc, 25);
    _subTitle(doc, 'Cobertura Forestal');
    const rows = [
      ['Cobertura estimada', `${f.pctForest}% (${f.haForest} ha)`],
      ['Clase',              f.classCover],
      ['Normativa',          f.normativa]
    ];
    _twoColTable(doc, rows);
    f.restricciones.forEach(r => _bulletText(doc, r));
    _noteText(doc, f.nota);
  }

  _drawHRule(doc);
}

/**
 * Tabla de derrotero geodésico UTM
 */
function buildPDFDerroteroSection(doc, derrotero, area, perimeter) {
  if (!derrotero?.length) return;
  _checkPageBreak(doc, 50);
  _sectionTitle(doc, 'Derrotero Geodésico — UTM Zona 17N (EPSG:32617)');

  doc.setFontSize(PDF_CONFIG.fonts.small);
  doc.setTextColor(...PDF_CONFIG.colors.gray);
  doc.text('Datum: WGS84 · Decreto IGNTG 23/2009 · Unidades: metros',
           MARGIN_L, _pdfY);
  _pdfY += 4;

  const headers = ['Punto', 'Este (m)', 'Norte (m)', 'Hacia', 'Rumbo', 'Azimut', 'Dist. (m)'];
  const colW    = [14, 32, 32, 14, 28, 22, 22]; // mm, suma = 164 < 186
  const rows    = derrotero.map((f, i) => [
    f.punto,
    formatNumber(f.easting, 3),
    formatNumber(f.northing, 3),
    i < derrotero.length - 1 ? `P${i + 2}` : 'P1',
    f.rumbo,
    `${formatNumber(f.azimut, 2)}°`,
    formatNumber(f.distancia, 2)
  ]);

  // Fila de totales
  rows.push(['', '', '', '', 'PERÍMETRO', '', formatNumber(perimeter, 2)]);
  rows.push(['', '', '', '', 'ÁREA', '', `${formatNumber(area.ha, 4)} ha`]);

  _fullTable(doc, headers, colW, rows);
  _drawHRule(doc);
}

/**
 * Normativa panameña aplicada
 */
function buildPDFNormativaSection(doc) {
  _checkPageBreak(doc, 35);
  _sectionTitle(doc, 'Marco Normativo Aplicado');

  CONFIG.NORMATIVA.forEach(n => {
    _checkPageBreak(doc, 12);
    doc.setFontSize(PDF_CONFIG.fonts.body);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_CONFIG.colors.primary);
    doc.text(`${n.codigo}  —  ${n.titulo}`, MARGIN_L, _pdfY);
    _pdfY += 4;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_CONFIG.colors.dark);
    const lines = doc.splitTextToSize(n.resumen, CONTENT_W - 4);
    lines.forEach(line => {
      doc.text(line, MARGIN_L + 3, _pdfY);
      _pdfY += 3.5;
    });
    _pdfY += 1;
  });

  _drawHRule(doc);
}

/**
 * Datos de la estación de monitoreo
 */
function buildPDFMonitorSection(doc, monitor) {
  if (!monitor?.lastReading) return;
  _checkPageBreak(doc, 35);
  _sectionTitle(doc, 'Estación de Monitoreo Meteorológico');

  const r = monitor.lastReading;
  const rows = [
    ['Temperatura',     `${r.temp} °C`],
    ['Viento',          `${r.wind} km/h`],
    ['Precipitación',   `${r.precip} mm`],
    ['Condición',       r.condition || '—'],
    ['Última lectura',  formatDate(new Date(r.timestamp))],
    ['Lecturas totales',`${monitor.history.length}`],
    ['Fuente',          'Open-Meteo API (open-meteo.com)']
  ];
  _twoColTable(doc, rows);
  _drawHRule(doc);
}

/**
 * Footer con hash SHA-256 y numeración de páginas — en todas las páginas
 */
async function _applyFooterAllPages(doc, meta) {
  const total = doc.getNumberOfPages();

  for (let p = 1; p <= total; p++) {
    doc.setPage(p);

    // Línea de pie
    doc.setDrawColor(...PDF_CONFIG.colors.lightGray);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_L, PAGE_H - MARGIN_B + 2, PAGE_W - MARGIN_R, PAGE_H - MARGIN_B + 2);

    doc.setFontSize(PDF_CONFIG.fonts.small);
    doc.setTextColor(...PDF_CONFIG.colors.gray);

    // Izquierda: hash
    doc.text(`SHA-256: ${meta.docHash.substring(0, 32)}…`, MARGIN_L, PAGE_H - MARGIN_B + 6);

    // Centro: SATE
    doc.text('S.A.T.E. v2.0 · JIC 2026 · Ley 51/2008', PAGE_W / 2, PAGE_H - MARGIN_B + 6,
             { align: 'center' });

    // Derecha: paginación
    doc.text(`Pág. ${p} / ${total}`, PAGE_W - MARGIN_R, PAGE_H - MARGIN_B + 6,
             { align: 'right' });
  }
}

/* ════════════════════════════════════════════════════════
   PREVISUALIZACIÓN HTML
   ════════════════════════════════════════════════════════ */

/**
 * Renderiza una previsualización HTML en #pdf-preview
 */
function _renderHTMLPreview(geojson, civil, env) {
  const area      = calcArea(geojson);
  const perimeter = calcPerimeter(geojson);
  const centroid  = getCentroid(geojson);
  const adminLoc  = getAdminLocation(centroid);
  const vertices  = geojson.geometry.coordinates[0].length - 1;

  const mapImg = _mapImageB64
    ? `<img src="${_mapImageB64}" style="width:100%;border-radius:4px;margin-bottom:8px;" />`
    : '<div style="background:#1a1a2e;height:120px;display:flex;align-items:center;justify-content:center;color:#666;border-radius:4px;">Mapa no disponible</div>';

  const civilHtml = civil ? `
    <div class="preview-section">
      <h4>Análisis Civil</h4>
      ${civil.geotecnico ? `<p>Riesgo geotécnico: <strong>${civil.geotecnico.riskLevel}</strong> (${civil.geotecnico.riskScore}/100) · Suelo: ${civil.geotecnico.soilType}</p>` : ''}
      ${civil.pendientes ? `<p>Pendiente media: <strong>${civil.pendientes.avgSlope}%</strong> · Clase dominante: ${civil.pendientes.dominantClass}</p>` : ''}
      ${civil.corteRelleno ? `<p>Corte: ${formatNumber(civil.corteRelleno.cutVolume_m3, 0)} m³ · Relleno: ${formatNumber(civil.corteRelleno.fillVolume_m3, 0)} m³</p>` : ''}
    </div>` : '';

  const envHtml = env ? `
    <div class="preview-section">
      <h4>Análisis Ambiental</h4>
      <p>Nivel general: <strong>${env.nivelGeneral?.toUpperCase()}</strong></p>
      ${env.sinap ? `<p>SINAP: ${env.sinap.intersects ? '⚠ Intersecta ' + env.sinap.areaName : '✓ Sin intersección'}</p>` : ''}
      ${env.wetlands ? `<p>Ramsar: sitio más cercano a ${env.wetlands.sitioMasCercano?.distanciaKm} km</p>` : ''}
    </div>` : '';

  document.getElementById('pdf-preview').innerHTML = `
    <div style="font-family:sans-serif;font-size:12px;padding:8px;">
      ${mapImg}
      <div class="preview-section">
        <h4>Datos del Polígono</h4>
        <p>Área: <strong>${formatNumber(area.ha, 4)} ha</strong> · Perímetro: <strong>${formatNumber(perimeter, 2)} m</strong> · Vértices: ${vertices}</p>
        <p>Provincia: ${adminLoc?.provincia || '—'} · Distrito: ${adminLoc?.distrito || '—'}</p>
        <p>Centroide: ${centroid.lat.toFixed(5)}°, ${centroid.lon.toFixed(5)}°</p>
      </div>
      ${civilHtml}
      ${envHtml}
      <p style="color:#666;font-size:10px;margin-top:8px;">
        Vista previa simplificada. El PDF incluye derrotero completo, normativa y hash de custodia.
      </p>
    </div>`;
}

/* ════════════════════════════════════════════════════════
   HELPERS DE DIBUJO PDF
   ════════════════════════════════════════════════════════ */

/** Verifica si queda espacio, si no agrega nueva página */
function _checkPageBreak(doc, neededMm) {
  if (_pdfY + neededMm > PAGE_H - MARGIN_B) {
    doc.addPage();
    _pdfPageNum++;
    _pdfY = MARGIN_T;
  }
}

/** Título de sección */
function _sectionTitle(doc, text) {
  _checkPageBreak(doc, 10);
  doc.setFontSize(PDF_CONFIG.fonts.section);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_CONFIG.colors.primary);
  doc.text(text, MARGIN_L, _pdfY);
  _pdfY += 5;
  doc.setTextColor(...PDF_CONFIG.colors.dark);
}

/** Subtítulo */
function _subTitle(doc, text) {
  _checkPageBreak(doc, 8);
  doc.setFontSize(PDF_CONFIG.fonts.body + 1);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_CONFIG.colors.dark);
  doc.text(text, MARGIN_L, _pdfY);
  _pdfY += 4;
  doc.setFont('helvetica', 'normal');
}

/** Texto de cuerpo */
function _bodyText(doc, text) {
  doc.setFontSize(PDF_CONFIG.fonts.body);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_CONFIG.colors.dark);
  const lines = doc.splitTextToSize(text, CONTENT_W);
  lines.forEach(l => { doc.text(l, MARGIN_L, _pdfY); _pdfY += 4; });
}

/** Bullet item */
function _bulletText(doc, text) {
  _checkPageBreak(doc, 5);
  doc.setFontSize(PDF_CONFIG.fonts.body);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_CONFIG.colors.dark);
  const lines = doc.splitTextToSize(`• ${text}`, CONTENT_W - 5);
  lines.forEach((l, i) => {
    doc.text(l, MARGIN_L + (i > 0 ? 4 : 2), _pdfY);
    _pdfY += 3.8;
  });
}

/** Nota de simulación en gris pequeño */
function _noteText(doc, text) {
  _checkPageBreak(doc, 5);
  doc.setFontSize(PDF_CONFIG.fonts.small);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...PDF_CONFIG.colors.gray);
  doc.text(`⚙ ${text}`, MARGIN_L, _pdfY);
  _pdfY += 4;
  doc.setFont('helvetica', 'normal');
}

/** Línea horizontal separadora */
function _drawHRule(doc) {
  _pdfY += 2;
  doc.setDrawColor(...PDF_CONFIG.colors.lightGray);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_L, _pdfY, PAGE_W - MARGIN_R, _pdfY);
  _pdfY += 4;
}

/**
 * Tabla de dos columnas (parámetro | valor)
 */
function _twoColTable(doc, rows) {
  const col1W = 55;
  const col2W = CONTENT_W - col1W;
  const rowH  = 5.5;

  rows.forEach((row, i) => {
    _checkPageBreak(doc, rowH + 1);

    // Fila alternada
    if (i % 2 === 0) {
      doc.setFillColor(...PDF_CONFIG.colors.lightGray);
      doc.rect(MARGIN_L, _pdfY - 3.5, CONTENT_W, rowH, 'F');
    }

    doc.setFontSize(PDF_CONFIG.fonts.body);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_CONFIG.colors.dark);
    doc.text(row[0], MARGIN_L + 1, _pdfY);

    doc.setFont('helvetica', 'normal');
    const valLines = doc.splitTextToSize(String(row[1]), col2W - 2);
    valLines.forEach((l, li) => {
      doc.text(l, MARGIN_L + col1W, _pdfY + li * 3.5);
    });

    _pdfY += rowH;
  });
  _pdfY += 2;
}

/**
 * Tabla pequeña (headers + rows de 2 cols)
 */
function _smallTable(doc, headers, rows) {
  const col1W = 80;
  const col2W = 30;
  const rowH  = 4.5;

  // Header
  doc.setFillColor(...PDF_CONFIG.colors.primary);
  doc.rect(MARGIN_L, _pdfY - 3, col1W + col2W, rowH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(PDF_CONFIG.fonts.small + 0.5);
  doc.setFont('helvetica', 'bold');
  doc.text(headers[0], MARGIN_L + 1, _pdfY);
  doc.text(headers[1], MARGIN_L + col1W + 1, _pdfY);
  _pdfY += rowH;

  rows.forEach((row, i) => {
    _checkPageBreak(doc, rowH);
    if (i % 2 === 0) {
      doc.setFillColor(...PDF_CONFIG.colors.lightGray);
      doc.rect(MARGIN_L, _pdfY - 3, col1W + col2W, rowH, 'F');
    }
    doc.setTextColor(...PDF_CONFIG.colors.dark);
    doc.setFont('helvetica', 'normal');
    doc.text(String(row[0]), MARGIN_L + 1, _pdfY);
    doc.text(String(row[1]), MARGIN_L + col1W + 1, _pdfY);
    _pdfY += rowH;
  });
  _pdfY += 3;
}

/**
 * Tabla completa del derrotero con N columnas
 */
function _fullTable(doc, headers, colWidths, rows) {
  const rowH   = 5;
  const startX = MARGIN_L;

  // Header azul
  doc.setFillColor(...PDF_CONFIG.colors.primary);
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  doc.rect(startX, _pdfY - 3.5, totalW, rowH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(PDF_CONFIG.fonts.small);
  doc.setFont('helvetica', 'bold');

  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x + 1, _pdfY);
    x += colWidths[i];
  });
  _pdfY += rowH;

  // Filas
  rows.forEach((row, ri) => {
    _checkPageBreak(doc, rowH + 1);

    if (ri % 2 === 0) {
      doc.setFillColor(...PDF_CONFIG.colors.lightGray);
      doc.rect(startX, _pdfY - 3.5, totalW, rowH, 'F');
    }

    // Totales en negrita
    const isTotal = row[4] === 'PERÍMETRO' || row[4] === 'ÁREA';
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setTextColor(...(isTotal ? PDF_CONFIG.colors.primary : PDF_CONFIG.colors.dark));
    doc.setFontSize(PDF_CONFIG.fonts.small);

    x = startX;
    row.forEach((cell, ci) => {
      doc.text(String(cell ?? ''), x + 1, _pdfY);
      x += colWidths[ci];
    });
    _pdfY += rowH;
  });
  _pdfY += 3;
}