/* ============================================================
   SATE-01 | CONFIG Y CONSTANTES GLOBALES
   Punto de entrada de toda la configuración del sistema.
   Todo el resto de módulos lee de aquí — nunca al revés.
   SATE v2.0 | JIC 2026 | República de Panamá
   ============================================================ */

'use strict';

/* ── Endpoints externos ── */
const CONFIG = {
  ENDPOINTS: {
    OPEN_METEO:      'https://api.open-meteo.com/v1/forecast',
    OPEN_METEO_HIST: 'https://archive-api.open-meteo.com/v1/archive',
    OVERPASS:        'https://overpass-api.de/api/interpreter',
    NOMINATIM:       'https://nominatim.openstreetmap.org/search',
    ANTHROPIC:       'https://api.anthropic.com/v1/messages',
    WMS_SINIA:       'https://geoserver.sinia.miambiente.gob.pa/geoserver/wms',
    ARCGIS_REST:     'https://server.arcgisonline.com/ArcGIS/rest/services',
    ARCGIS_TILES:    'https://services.arcgisonline.com/ArcGIS/rest/services'
  },

  /* ── Parámetros geográficos fijos — NO MODIFICAR ── */
  GEO: {
    PA_CENTER:   [8.9936, -79.5197],  // Centro de Panamá [lat, lon]
    PA_ZOOM:     8,
    BBOX_LON:    [-83.05, -77.16],
    BBOX_LAT:    [7.15,   9.65],
    CRS:         'EPSG:32617',        // UTM Zona 17N (oficial IGNTG)
    DATUM:       'EPSG:4326',         // WGS84
    UTM_PROJ:    '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs'
  },

  /* ── Límites operativos ── */
  LIMITS: {
    MAX_FILE_SIZE_MB: 5,
    MAX_FILE_SIZE:    5 * 1024 * 1024,   // bytes
    MONITOR_INTERVAL: 12 * 60 * 60 * 1000, // 12 horas en ms
    SEARCH_DEBOUNCE:  400,               // ms
    PDF_MAP_WAIT:     1500               // ms espera tiles antes de captura
  },

  /* ── Capas base ESRI ── */
  LAYERS: {
    satellite: {
      label: 'Satélite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics'
    },
    topo: {
      label: 'Topográfico',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri — Source: Esri, USGS, NGA, NASA, CGIAR'
    },
    streets: {
      label: 'Calles',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri — Source: Esri, HERE, Garmin, USGS'
    },
    hybrid: {
      label: 'Híbrido',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri — Hybrid: Imagery + Labels',
      overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
    }
  },

  /* ── Normativa panameña citada ── */
  NORMATIVA: [
    {
      codigo: 'Ley 41/1998',
      titulo: 'Ley General de Ambiente',
      ambito: 'Ambiental',
      resumen: 'Marco legal de áreas protegidas y SINAP. Prohibición de intervención en zonas de amortiguamiento sin EIA.'
    },
    {
      codigo: 'Ley 51/2008',
      titulo: 'Firma Electrónica',
      ambito: 'Legal',
      resumen: 'Validez jurídica de documentos digitales firmados electrónicamente en Panamá.'
    },
    {
      codigo: 'Ley 81/2019',
      titulo: 'Protección de Datos Personales',
      ambito: 'Legal',
      resumen: 'Tratamiento y protección de datos personales recopilados por sistemas digitales.'
    },
    {
      codigo: 'Decreto 23/2009',
      titulo: 'Especificaciones Técnicas IGNTG',
      ambito: 'Topografía',
      resumen: 'Estándares cartográficos oficiales. Proyección UTM Zona 17N obligatoria para Panamá.'
    },
    {
      codigo: 'MIVIOT Res. 001-2019',
      titulo: 'Pendientes y Muros de Contención',
      ambito: 'Civil',
      resumen: 'Criterios de pendiente máxima para urbanizaciones y requisitos de muros de contención.'
    }
  ],

  /* ── Roadmap de futuras mejoras ── */
  ROADMAP: [
    {
      fase: 'Fase 2 — Backend',
      items: [
        'Deploy de motor_arcweb.py en Render',
        'ML real con scikit-learn (modelo .pkl)',
        'Análisis topográfico con datos DEM reales',
        'Corte y relleno con TensorFlow'
      ]
    },
    {
      fase: 'Fase 3 — Integración GEE',
      items: [
        'NDVI en tiempo real via Google Earth Engine',
        'Análisis de cobertura forestal histórica',
        'Detección de cambios de uso de suelo',
        'Índices espectrales (EVI, SAVI, MNDWI)'
      ]
    },
    {
      fase: 'Fase 4 — IA Avanzada',
      items: [
        'Consulta a LLM con contexto geoespacial completo',
        'Clasificación automática de uso de suelo',
        'Predicción de riesgo por eventos climáticos extremos',
        'Generación de informes narrativos automáticos'
      ]
    },
    {
      fase: 'Fase 5 — Plataforma',
      items: [
        'Autenticación de usuarios y gestión de proyectos',
        'Almacenamiento de polígonos y análisis en base de datos',
        'API pública con documentación OpenAPI',
        'App móvil con captura GPS en campo'
      ]
    }
  ]
};

/* ── Proyección UTM 17N — registrar en Proj4 ── */
// Se ejecuta una vez al cargar, disponible globalmente para polygon.js y utils.js
if (typeof proj4 !== 'undefined') {
  proj4.defs('EPSG:32617', CONFIG.GEO.UTM_PROJ);
}
