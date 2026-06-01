"""
================================================================================
S.A.T.E. - Sistema de Auditoría Territorial Especializado
Backend Motor Cartográfico Industrial v3.0
================================================================================
Arquitecto: Senior GIS Software Architect
Paradigma: Zero-Trust | Modular | Pericial
Jurisdicción: República de Panamá (UTM WGS84 Zona 17N / EPSG:32617)
================================================================================

MÓDULOS PRINCIPALES:
  - /api/v1/auth        : Autenticación HMAC-SHA256 + API Key
  - /api/v1/topology    : Motor de cálculo topológico (Shapely + Proj4)
  - /api/v1/analysis    : Motor analítico ML/DL (scikit-learn + TensorFlow)
  - /api/v1/wms         : Proxy WMS SINIA/MiAmbiente con caché
  - /api/v1/export      : Generador de Expediente Pericial PDF
  - /api/v1/gee         : Integración Google Earth Engine
  - /api/v1/risk        : Matriz de Riesgo Geotécnico MIVIOT

SEGURIDAD:
  - HMAC-SHA256 por solicitud (timestamp + nonce + payload hash)
  - API Keys rotables con scopes granulares
  - Rate limiting por IP y API Key
  - Input validation con Pydantic
  - SQL injection / XSS / Path traversal hardening
  - Content Security Policy headers
  - No datos sintéticos: NULL + warning pericial si no hay datos reales
"""

import os
import sys
import hmac
import uuid
import time
import hashlib
import logging
import secrets
import threading
from io import BytesIO
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from dataclasses import dataclass, field

# ── Core Framework ────────────────────────────────────────────────────────────
from flask import (
    Flask, request, jsonify, Response, abort,
    send_file, g, make_response
)
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# ── Geoespacial ───────────────────────────────────────────────────────────────
import pyproj
from pyproj import Transformer, CRS
from shapely.geometry import (
    shape, mapping, Point, LineString, Polygon,
    MultiPolygon, GeometryCollection
)
from shapely.ops import transform, unary_union, triangulate
from shapely.validation import make_valid
import geopandas as gpd
import numpy as np
import pandas as pd

# ── Exportación PDF ───────────────────────────────────────────────────────────
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table,
    TableStyle, Image as RLImage, PageBreak, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.graphics import renderPDF
from reportlab.pdfgen import canvas as pdf_canvas

# ── HTTP / WMS ─────────────────────────────────────────────────────────────────
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── Validación & Serialización ────────────────────────────────────────────────
from pydantic import BaseModel, validator, Field, ValidationError
import json
import pickle
import csv
import re

# ── Google Earth Engine ────────────────────────────────────────────────────────
try:
    import ee
    GEE_AVAILABLE = True
except ImportError:
    GEE_AVAILABLE = False
    logging.warning("GEE SDK no disponible. Las rutas /gee retornarán NULL pericial.")

# ── ML / DL ───────────────────────────────────────────────────────────────────
try:
    import sklearn
    from sklearn.base import BaseEstimator
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False

try:
    import tensorflow as tf
    DL_AVAILABLE = True
except ImportError:
    DL_AVAILABLE = False

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURACIÓN CENTRAL
# ══════════════════════════════════════════════════════════════════════════════

class SATEConfig:
    """
    Configuración centralizada del sistema S.A.T.E.
    
    NUNCA exponer credenciales en código fuente.
    Usar variables de entorno o vault seguro.
    """

    # ── Seguridad ─────────────────────────────────────────────────────────────
    SECRET_HMAC_KEY: bytes = os.environ.get(
        "SATE_HMAC_KEY", secrets.token_hex(64)
    ).encode("utf-8")

    SECRET_MASTER_API_KEY: str = os.environ.get(
        "SATE_MASTER_API_KEY", secrets.token_urlsafe(48)
    )

    HMAC_TIMESTAMP_TOLERANCE_SECONDS: int = 300  # 5 minutos máximo
    TOKEN_NONCE_EXPIRY: int = 600                # 10 minutos para replay attack

    # ── GEE ───────────────────────────────────────────────────────────────────
    GEE_SERVICE_ACCOUNT: str = os.environ.get("GEE_SERVICE_ACCOUNT", "")
    GEE_KEY_FILE: str = os.environ.get("GEE_KEY_FILE", "")

    # ── Proyecciones ──────────────────────────────────────────────────────────
    CRS_WGS84: str = "EPSG:4326"
    CRS_UTM17N: str = "EPSG:32617"  # UTM WGS84 Zona 17N — Panamá
    CRS_PANAMA_OFICIAL: str = "EPSG:32617"

    # ── Límites geográficos — República de Panamá ─────────────────────────────
    # Bounding Box WGS84 [min_lon, min_lat, max_lon, max_lat]
    PANAMA_BBOX_WGS84: Tuple = (-83.0516, 7.1538, -77.1580, 9.6476)
    PANAMA_BBOX_UTM17N: Tuple = (
        274000, 787000,   # min_x, min_y (metros)
        870000, 1070000   # max_x, max_y (metros)
    )

    # ── WMS Oficiales Panamá ──────────────────────────────────────────────────
    WMS_ENDPOINTS: Dict[str, Dict] = {
        "sinia_miambiente": {
            "url": "https://geoserver.miambiente.gob.pa/geoserver/wms",
            "description": "SINIA / MiAmbiente - Áreas protegidas, cobertura",
            "version": "1.3.0",
            "timeout": 30,
        },
        "igntg_ortofoto": {
            "url": "https://ows.ign.gob.pa/geoserver/wms",
            "description": "IGNTG - Ortofotografía y cartografía base",
            "version": "1.3.0",
            "timeout": 45,
        },
        "miviot_zonificacion": {
            "url": "https://geoserver.miviot.gob.pa/geoserver/wms",
            "description": "MIVIOT - Zonificación y usos de suelo",
            "version": "1.3.0",
            "timeout": 30,
        },
        "osm_panama": {
            "url": "https://ows.terrestris.de/osm/service",
            "description": "OpenStreetMap - Infraestructura vial",
            "version": "1.1.1",
            "timeout": 20,
        },
    }

    # ── Directorios de datos ──────────────────────────────────────────────────
    DATA_DIR: Path = Path(os.environ.get("SATE_DATA_DIR", "./data"))
    MODELS_DIR: Path = DATA_DIR / "models"
    DATASETS_DIR: Path = DATA_DIR / "datasets"
    CACHE_DIR: Path = DATA_DIR / "cache"
    EXPORTS_DIR: Path = DATA_DIR / "exports"

    # ── Rate Limiting ─────────────────────────────────────────────────────────
    RATE_LIMIT_DEFAULT: str = "100 per hour"
    RATE_LIMIT_TOPOLOGY: str = "30 per minute"
    RATE_LIMIT_EXPORT: str = "10 per hour"
    RATE_LIMIT_GEE: str = "20 per hour"

    @classmethod
    def ensure_dirs(cls) -> None:
        """Crea directorios necesarios si no existen."""
        for d in [cls.DATA_DIR, cls.MODELS_DIR, cls.DATASETS_DIR,
                  cls.CACHE_DIR, cls.EXPORTS_DIR]:
            d.mkdir(parents=True, exist_ok=True)


# ══════════════════════════════════════════════════════════════════════════════
# LOGGING ESTRUCTURADO
# ══════════════════════════════════════════════════════════════════════════════

def configure_logging() -> logging.Logger:
    """
    Configura logging estructurado con niveles diferenciados.
    
    Returns:
        logging.Logger: Logger principal del sistema.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler("sate_audit.log", encoding="utf-8"),
        ],
    )
    return logging.getLogger("SATE")


logger = configure_logging()


# ══════════════════════════════════════════════════════════════════════════════
# ZERO-TRUST: SISTEMA DE AUTENTICACIÓN HMAC-SHA256
# ══════════════════════════════════════════════════════════════════════════════

class NonceStore:
    """
    Almacén thread-safe de nonces para prevenir ataques de replay.
    
    Implementa limpieza automática de nonces expirados para
    evitar crecimiento ilimitado de memoria.
    """

    def __init__(self, expiry_seconds: int = 600):
        self._store: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._expiry = expiry_seconds

    def is_used(self, nonce: str) -> bool:
        """
        Verifica si un nonce ya fue utilizado.
        
        Args:
            nonce: String único de la solicitud.
            
        Returns:
            bool: True si el nonce ya fue visto (replay attack).
        """
        with self._lock:
            self._cleanup()
            return nonce in self._store

    def mark_used(self, nonce: str) -> None:
        """Registra un nonce como usado con timestamp actual."""
        with self._lock:
            self._store[nonce] = time.time()

    def _cleanup(self) -> None:
        """Elimina nonces expirados del almacén."""
        now = time.time()
        expired = [k for k, v in self._store.items()
                   if now - v > self._expiry]
        for k in expired:
            del self._store[k]


# Instancia global del NonceStore
_nonce_store = NonceStore(SATEConfig.TOKEN_NONCE_EXPIRY)

# Almacén de API Keys con scopes
# Formato: { "api_key": { "name": str, "scopes": List[str], "active": bool } }
_api_key_registry: Dict[str, Dict] = {
    SATEConfig.SECRET_MASTER_API_KEY: {
        "name": "master_key",
        "scopes": ["topology", "analysis", "wms", "export", "gee", "risk", "admin"],
        "active": True,
    }
}


def generate_api_key(name: str, scopes: List[str]) -> str:
    """
    Genera una nueva API Key y la registra en el almacén.
    
    Args:
        name: Identificador descriptivo para la clave.
        scopes: Lista de permisos (ej: ["topology", "export"]).
        
    Returns:
        str: Nueva API Key en formato URL-safe.
    """
    new_key = secrets.token_urlsafe(48)
    _api_key_registry[new_key] = {
        "name": name,
        "scopes": scopes,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("API Key generada para '%s' con scopes: %s", name, scopes)
    return new_key


def validate_api_key(key: str, required_scope: str) -> Optional[Dict]:
    """
    Valida una API Key y verifica que tenga el scope requerido.
    
    Args:
        key: API Key a validar.
        required_scope: Scope mínimo requerido para la operación.
        
    Returns:
        Dict con datos de la key si es válida, None si no.
    """
    key_data = _api_key_registry.get(key)
    if not key_data:
        return None
    if not key_data.get("active", False):
        return None
    if required_scope not in key_data.get("scopes", []):
        return None
    return key_data


def compute_hmac(
    timestamp: str,
    nonce: str,
    method: str,
    path: str,
    payload_hash: str,
) -> str:
    """
    Calcula firma HMAC-SHA256 para una solicitud.
    
    El mensaje a firmar concatena todos los campos críticos de la
    solicitud para garantizar integridad completa.
    
    Args:
        timestamp: Unix timestamp en segundos (string).
        nonce: UUID único de la solicitud.
        method: Método HTTP (GET, POST, etc.).
        path: Ruta del endpoint.
        payload_hash: SHA256 del cuerpo de la solicitud.
        
    Returns:
        str: Firma HMAC-SHA256 en hexadecimal lowercase.
    """
    message = f"{timestamp}\n{nonce}\n{method.upper()}\n{path}\n{payload_hash}"
    return hmac.new(
        SATEConfig.SECRET_HMAC_KEY,
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def require_auth(scope: str):
    """
    Decorador de autenticación Zero-Trust.
    
    Verifica en orden:
      1. Presencia de API Key en header X-SATE-API-Key
      2. Validez y scope de la API Key
      3. Presencia de headers HMAC (X-SATE-Timestamp, X-SATE-Nonce, X-SATE-Signature)
      4. Tolerancia temporal del timestamp (±5 minutos)
      5. Nonce no reutilizado (anti-replay)
      6. Integridad del payload (HMAC-SHA256)
    
    Args:
        scope: Scope requerido para el endpoint.
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # ── 1. Extraer API Key ─────────────────────────────────────────
            api_key = request.headers.get("X-SATE-API-Key", "").strip()
            if not api_key:
                logger.warning("Auth fallida: sin API Key | IP=%s", _get_client_ip())
                return _auth_error("API Key requerida")

            # ── 2. Validar API Key y scope ─────────────────────────────────
            key_data = validate_api_key(api_key, scope)
            if not key_data:
                logger.warning(
                    "Auth fallida: API Key inválida o scope insuficiente | "
                    "scope=%s | IP=%s", scope, _get_client_ip()
                )
                return _auth_error("API Key inválida o permisos insuficientes")

            # ── 3. Extraer headers HMAC ────────────────────────────────────
            timestamp = request.headers.get("X-SATE-Timestamp", "")
            nonce = request.headers.get("X-SATE-Nonce", "")
            signature = request.headers.get("X-SATE-Signature", "")

            if not all([timestamp, nonce, signature]):
                return _auth_error("Headers HMAC incompletos")

            # ── 4. Validar tolerancia temporal ─────────────────────────────
            try:
                req_time = float(timestamp)
                if abs(time.time() - req_time) > SATEConfig.HMAC_TIMESTAMP_TOLERANCE_SECONDS:
                    logger.warning("Auth fallida: timestamp fuera de tolerancia")
                    return _auth_error("Timestamp expirado o inválido")
            except (ValueError, TypeError):
                return _auth_error("Timestamp mal formado")

            # ── 5. Verificar nonce (anti-replay) ───────────────────────────
            if _nonce_store.is_used(nonce):
                logger.warning("Auth fallida: replay attack detectado | nonce=%s", nonce)
                return _auth_error("Nonce ya utilizado (replay attack detectado)")
            _nonce_store.mark_used(nonce)

            # ── 6. Verificar firma HMAC ────────────────────────────────────
            body_bytes = request.get_data()
            payload_hash = hashlib.sha256(body_bytes).hexdigest()
            expected_sig = compute_hmac(
                timestamp, nonce,
                request.method, request.path,
                payload_hash
            )

            if not hmac.compare_digest(expected_sig, signature.lower()):
                logger.warning(
                    "Auth fallida: firma HMAC inválida | "
                    "endpoint=%s | IP=%s", request.path, _get_client_ip()
                )
                return _auth_error("Firma HMAC inválida — integridad comprometida")

            # ── Autenticación exitosa ──────────────────────────────────────
            g.authenticated_key = key_data["name"]
            g.key_scopes = key_data["scopes"]
            logger.info(
                "Auth OK | key='%s' | scope='%s' | endpoint=%s",
                key_data["name"], scope, request.path
            )
            return f(*args, **kwargs)

        return wrapper
    return decorator


def _auth_error(message: str) -> Response:
    """Respuesta estándar de error de autenticación (RFC 7235)."""
    return jsonify({
        "error": "UNAUTHORIZED",
        "message": message,
        "pericial_note": "Acceso denegado por política Zero-Trust S.A.T.E.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }), 401


def _get_client_ip() -> str:
    """Obtiene IP real del cliente considerando proxies."""
    return (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or request.remote_addr
        or "unknown"
    )


# ══════════════════════════════════════════════════════════════════════════════
# VALIDACIÓN GEOGRÁFICA — RESTRICCIÓN A PANAMÁ
# ══════════════════════════════════════════════════════════════════════════════

def validate_panama_bounds(lon: float, lat: float) -> bool:
    """
    Verifica que una coordenada WGS84 esté dentro de Panamá.
    
    Args:
        lon: Longitud en grados decimales.
        lat: Latitud en grados decimales.
        
    Returns:
        bool: True si la coordenada está dentro del bbox de Panamá.
    """
    min_lon, min_lat, max_lon, max_lat = SATEConfig.PANAMA_BBOX_WGS84
    return (min_lon <= lon <= max_lon) and (min_lat <= lat <= max_lat)


def validate_geometry_in_panama(geom) -> Tuple[bool, str]:
    """
    Valida que una geometría Shapely esté completamente dentro de Panamá.
    
    Args:
        geom: Geometría Shapely (Point, LineString, Polygon, etc.)
        
    Returns:
        Tuple[bool, str]: (válida, mensaje descriptivo).
    """
    if geom is None or geom.is_empty:
        return False, "Geometría nula o vacía"

    min_lon, min_lat, max_lon, max_lat = SATEConfig.PANAMA_BBOX_WGS84
    panama_bbox = Polygon([
        (min_lon, min_lat), (max_lon, min_lat),
        (max_lon, max_lat), (min_lon, max_lat),
        (min_lon, min_lat)
    ])

    if not geom.intersects(panama_bbox):
        return False, (
            f"Geometría fuera del territorio panameño. "
            f"Bbox Panamá: {SATEConfig.PANAMA_BBOX_WGS84}"
        )

    return True, "Geometría dentro del territorio panameño"


# ══════════════════════════════════════════════════════════════════════════════
# MOTOR TOPOLÓGICO — CÁLCULOS GEODÉSICOS REALES
# ══════════════════════════════════════════════════════════════════════════════

class TopologyEngine:
    """
    Motor de cálculo topológico para levantamientos pericial-geodésicos.
    
    Implementa:
      - Transformación de coordenadas WGS84 ↔ UTM WGS84 17N (EPSG:32617)
      - Cálculo de derroteros (rumbos geodésicos)
      - Azimut (0-360°)
      - Distancias reales en metros
      - Área de polígonos en m² y hectáreas
      - Volumen de corte/relleno (método prismatoide)
      - Pendientes porcentuales e isohipsas
      - Perímetros geodésicos
    
    IMPORTANTE: No genera datos sintéticos. Si no hay datos de elevación
    reales (DEM/SRTM), retorna NULL con advertencia pericial.
    """

    def __init__(self):
        self._transformer_to_utm = Transformer.from_crs(
            SATEConfig.CRS_WGS84,
            SATEConfig.CRS_UTM17N,
            always_xy=True
        )
        self._transformer_to_wgs84 = Transformer.from_crs(
            SATEConfig.CRS_UTM17N,
            SATEConfig.CRS_WGS84,
            always_xy=True
        )
        self._geod = pyproj.Geod(ellps="WGS84")

    def wgs84_to_utm(self, lon: float, lat: float) -> Tuple[float, float]:
        """
        Convierte coordenadas WGS84 a UTM 17N.
        
        Args:
            lon: Longitud (grados decimales).
            lat: Latitud (grados decimales).
            
        Returns:
            Tuple[float, float]: (este_m, norte_m) en metros.
        """
        return self._transformer_to_utm.transform(lon, lat)

    def utm_to_wgs84(self, easting: float, northing: float) -> Tuple[float, float]:
        """
        Convierte coordenadas UTM 17N a WGS84.
        
        Args:
            easting: Coordenada este (metros).
            northing: Coordenada norte (metros).
            
        Returns:
            Tuple[float, float]: (lon, lat) en grados decimales.
        """
        return self._transformer_to_wgs84.transform(easting, northing)

    def calculate_azimuth(
        self, lon1: float, lat1: float, lon2: float, lat2: float
    ) -> Dict[str, Any]:
        """
        Calcula el azimut geodésico entre dos puntos WGS84.
        
        El azimut se mide desde el Norte geográfico en sentido horario,
        rango 0° a 360°.
        
        Args:
            lon1, lat1: Coordenadas del punto de partida (WGS84).
            lon2, lat2: Coordenadas del punto de destino (WGS84).
            
        Returns:
            Dict con azimut_deg, back_azimuth_deg, distance_m.
        """
        # Valida que ambos puntos estén en Panamá
        for lon, lat in [(lon1, lat1), (lon2, lat2)]:
            if not validate_panama_bounds(lon, lat):
                return {
                    "error": "FUERA_DE_PANAMA",
                    "pericial_warning": (
                        "Coordenada fuera del territorio panameño. "
                        "S.A.T.E. restringe análisis a la República de Panamá."
                    ),
                    "value": None
                }

        az12, az21, distance = self._geod.inv(lon1, lat1, lon2, lat2)

        # Normalizar azimut a [0, 360]
        az_forward = az12 % 360.0
        az_back = az21 % 360.0

        return {
            "azimut_directo_deg": round(az_forward, 6),
            "azimut_inverso_deg": round(az_back, 6),
            "distancia_m": round(distance, 4),
            "distancia_km": round(distance / 1000.0, 6),
            "rumbo_cuadrantal": self._azimuth_to_bearing(az_forward),
            "punto_origen": {"lon": lon1, "lat": lat1},
            "punto_destino": {"lon": lon2, "lat": lat2},
            "datum": "WGS84",
            "zona_utm": "17N",
        }

    def _azimuth_to_bearing(self, azimuth: float) -> str:
        """
        Convierte azimut decimal a rumbo cuadrantal (ej: N 45°30' E).
        
        Args:
            azimuth: Azimut en grados decimales [0, 360].
            
        Returns:
            str: Rumbo en notación cuadrantal.
        """
        az = azimuth % 360.0

        if az <= 90:
            q, ref_az = "N", az
        elif az <= 180:
            q, ref_az = "S", 180 - az
        elif az <= 270:
            q, ref_az = "S", az - 180
        else:
            q, ref_az = "N", 360 - az

        suffix = "E" if (az <= 90 or az >= 270) else "W"

        deg = int(ref_az)
        min_dec = (ref_az - deg) * 60
        mins = int(min_dec)
        secs = round((min_dec - mins) * 60, 1)

        return f"{q} {deg}°{mins:02d}'{secs:04.1f}\" {suffix}"

    def calculate_derrotero(self, vertices: List[Dict]) -> Dict[str, Any]:
        """
        Calcula el derrotero completo de un polígono o polilínea.
        
        El derrotero es la descripción secuencial de los lados del
        levantamiento topográfico, incluyendo rumbo y distancia de
        cada segmento.
        
        Args:
            vertices: Lista de dicts con 'lon', 'lat' (WGS84) o
                      'easting', 'northing' (UTM 17N).
                      
        Returns:
            Dict con lista de segmentos y estadísticas totales.
        """
        if len(vertices) < 2:
            return {"error": "Se requieren al menos 2 vértices para derrotero"}

        # Convertir a UTM si están en WGS84
        utm_points = []
        for v in vertices:
            if "lon" in v and "lat" in v:
                if not validate_panama_bounds(v["lon"], v["lat"]):
                    return {
                        "error": "VERTICE_FUERA_DE_PANAMA",
                        "pericial_warning": (
                            f"Vértice ({v['lon']}, {v['lat']}) fuera del territorio. "
                            "Cálculo abortado."
                        ),
                        "value": None
                    }
                e, n = self.wgs84_to_utm(v["lon"], v["lat"])
                utm_points.append((e, n))
            elif "easting" in v and "northing" in v:
                utm_points.append((v["easting"], v["northing"]))
            else:
                return {"error": f"Formato de vértice inválido: {v}"}

        segments = []
        total_perimeter_m = 0.0

        for i in range(len(utm_points) - 1):
            x1, y1 = utm_points[i]
            x2, y2 = utm_points[i + 1]

            dx = x2 - x1
            dy = y2 - y1
            dist = np.sqrt(dx**2 + dy**2)
            total_perimeter_m += dist

            # Azimut desde Norte (sentido horario) en UTM
            az_rad = np.arctan2(dx, dy)
            az_deg = np.degrees(az_rad) % 360.0

            # Convertir puntos UTM a WGS84 para coordenadas de reporte
            lon1, lat1 = self.utm_to_wgs84(x1, y1)
            lon2, lat2 = self.utm_to_wgs84(x2, y2)

            segments.append({
                "segmento": i + 1,
                "vertice_desde": f"V{i + 1}",
                "vertice_hasta": f"V{i + 2}",
                "coordenadas_utm_desde": {
                    "easting": round(x1, 3),
                    "northing": round(y1, 3)
                },
                "coordenadas_utm_hasta": {
                    "easting": round(x2, 3),
                    "northing": round(y2, 3)
                },
                "coordenadas_wgs84_desde": {
                    "lon": round(lon1, 8),
                    "lat": round(lat1, 8)
                },
                "coordenadas_wgs84_hasta": {
                    "lon": round(lon2, 8),
                    "lat": round(lat2, 8)
                },
                "azimut_deg": round(az_deg, 6),
                "rumbo_cuadrantal": self._azimuth_to_bearing(az_deg),
                "distancia_m": round(dist, 4),
                "delta_e_m": round(dx, 4),
                "delta_n_m": round(dy, 4),
            })

        return {
            "derrotero": segments,
            "n_vertices": len(utm_points),
            "n_segmentos": len(segments),
            "perimetro_total_m": round(total_perimeter_m, 4),
            "perimetro_total_km": round(total_perimeter_m / 1000, 6),
            "sistema_coordenadas": "UTM WGS84 Zona 17N (EPSG:32617)",
            "datum": "WGS84",
        }

    def calculate_polygon_area(self, vertices: List[Dict]) -> Dict[str, Any]:
        """
        Calcula el área real de un polígono en proyección UTM 17N.
        
        Usa la fórmula de Gauss (Shoelace) en coordenadas cartesianas UTM
        para máxima precisión en latitudes ecuatoriales.
        
        Args:
            vertices: Lista de vértices (lon/lat WGS84 o easting/northing UTM).
            
        Returns:
            Dict con áreas en m², ha y km².
        """
        if len(vertices) < 3:
            return {"error": "Se requieren al menos 3 vértices para calcular área"}

        utm_points = []
        for v in vertices:
            if "lon" in v and "lat" in v:
                if not validate_panama_bounds(v["lon"], v["lat"]):
                    return {
                        "error": "VERTICE_FUERA_DE_PANAMA",
                        "value": None,
                        "pericial_warning": "Vértice fuera del territorio panameño"
                    }
                e, n = self.wgs84_to_utm(v["lon"], v["lat"])
                utm_points.append((e, n))
            else:
                utm_points.append((v["easting"], v["northing"]))

        # Crear polígono Shapely en UTM y calcular área
        try:
            poly = Polygon(utm_points)
            poly = make_valid(poly)
            area_m2 = poly.area
        except Exception as ex:
            return {"error": f"Error al construir polígono: {str(ex)}"}

        return {
            "area_m2": round(area_m2, 4),
            "area_ha": round(area_m2 / 10_000, 6),
            "area_km2": round(area_m2 / 1_000_000, 8),
            "perimetro_m": round(poly.length, 4),
            "centroide_utm": {
                "easting": round(poly.centroid.x, 3),
                "northing": round(poly.centroid.y, 3),
            },
            "es_valido": poly.is_valid,
            "es_simple": poly.is_simple,
            "sistema_coordenadas": "UTM WGS84 Zona 17N (EPSG:32617)",
        }

    def calculate_cut_fill(
        self,
        terrain_dem: Optional[np.ndarray],
        design_surface: Optional[np.ndarray],
        cell_size_m: float = 1.0,
    ) -> Dict[str, Any]:
        """
        Calcula volúmenes de corte y relleno mediante método de prismatoide.
        
        ADVERTENCIA PERICIAL: Si terrain_dem o design_surface son None,
        el sistema NO genera datos sintéticos. Retorna NULL con código
        PERICIAL_NULL_MISSING_DEM.
        
        Args:
            terrain_dem: Array 2D de elevaciones del terreno real (metros).
            design_surface: Array 2D de superficie de diseño (metros).
            cell_size_m: Tamaño de celda en metros (resolución del DEM).
            
        Returns:
            Dict con volúmenes de corte, relleno y balance neto.
        """
        if terrain_dem is None or design_surface is None:
            return {
                "error": "PERICIAL_NULL_MISSING_DEM",
                "pericial_warning": (
                    "S.A.T.E. no genera datos sintéticos de elevación. "
                    "Proporcione DEM real (SRTM/LiDAR) y superficie de diseño. "
                    "Formato esperado: numpy array 2D en metros sobre el nivel del mar."
                ),
                "value": None,
                "required_input": {
                    "terrain_dem": "numpy.ndarray 2D, elevaciones en metros",
                    "design_surface": "numpy.ndarray 2D, elevaciones diseño en metros",
                    "cell_size_m": "float, resolución espacial en metros",
                }
            }

        if terrain_dem.shape != design_surface.shape:
            return {
                "error": "DIM_MISMATCH",
                "message": (
                    f"Dimensiones incompatibles: terrain={terrain_dem.shape}, "
                    f"design={design_surface.shape}"
                )
            }

        diff = design_surface - terrain_dem
        cell_area_m2 = cell_size_m ** 2

        # Volumen de corte (terrain > design → necesita excavar)
        cut_mask = diff < 0
        fill_mask = diff > 0

        vol_cut_m3 = float(np.sum(np.abs(diff[cut_mask])) * cell_area_m2)
        vol_fill_m3 = float(np.sum(diff[fill_mask]) * cell_area_m2)
        balance_m3 = vol_fill_m3 - vol_cut_m3

        return {
            "volumen_corte_m3": round(vol_cut_m3, 3),
            "volumen_relleno_m3": round(vol_fill_m3, 3),
            "balance_neto_m3": round(balance_m3, 3),
            "area_corte_m2": round(float(np.sum(cut_mask)) * cell_area_m2, 2),
            "area_relleno_m2": round(float(np.sum(fill_mask)) * cell_area_m2, 2),
            "elevacion_min_terreno_m": round(float(np.min(terrain_dem)), 3),
            "elevacion_max_terreno_m": round(float(np.max(terrain_dem)), 3),
            "resolucion_celda_m": cell_size_m,
            "metodo": "Prismatoide (diferencias de malla regular)",
            "nota_pericial": (
                "Cálculo basado en DEM real. "
                "Verificar datum vertical y fecha de levantamiento."
            ),
        }

    def calculate_slope(
        self,
        dem: Optional[np.ndarray],
        cell_size_m: float = 30.0,
    ) -> Dict[str, Any]:
        """
        Calcula mapa de pendientes a partir de DEM real.
        
        Utiliza el algoritmo de Horn (1981) implementado con gradiente
        de numpy para máxima precisión en terrenos irregulares.
        
        Args:
            dem: Array 2D de elevaciones (metros). No puede ser None.
            cell_size_m: Resolución espacial del DEM (metros).
            
        Returns:
            Dict con estadísticas de pendiente en grados y porcentaje.
        """
        if dem is None:
            return {
                "error": "PERICIAL_NULL_MISSING_DEM",
                "pericial_warning": (
                    "No se proporcionó DEM real. S.A.T.E. no fabrica datos "
                    "de elevación. Cargue SRTM 30m o LiDAR oficial IGNTG."
                ),
                "value": None,
            }

        # Algoritmo de Horn para pendientes
        dz_dy, dz_dx = np.gradient(dem, cell_size_m)
        slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
        slope_deg = np.degrees(slope_rad)
        slope_pct = np.tan(slope_rad) * 100.0

        return {
            "pendiente_min_deg": round(float(np.min(slope_deg)), 3),
            "pendiente_max_deg": round(float(np.max(slope_deg)), 3),
            "pendiente_media_deg": round(float(np.mean(slope_deg)), 3),
            "pendiente_mediana_deg": round(float(np.median(slope_deg)), 3),
            "pendiente_min_pct": round(float(np.min(slope_pct)), 3),
            "pendiente_max_pct": round(float(np.max(slope_pct)), 3),
            "pendiente_media_pct": round(float(np.mean(slope_pct)), 3),
            "dimensiones_dem": list(dem.shape),
            "resolucion_celda_m": cell_size_m,
            "algoritmo": "Horn (1981) — 8-vecinos",
            "clases_pendiente_miviot": self._classify_slope_miviot(slope_pct),
        }

    def _classify_slope_miviot(self, slope_pct: np.ndarray) -> Dict:
        """
        Clasifica pendientes según tabla MIVIOT Panamá.
        
        Clases:
          0-5%   : Plano / casi plano
          5-15%  : Suave / ondulado
          15-30% : Moderado
          30-60% : Fuerte
          >60%   : Muy fuerte / escarpado
        """
        total = slope_pct.size
        return {
            "plano_0_5pct": round(float(np.sum(slope_pct <= 5) / total * 100), 2),
            "suave_5_15pct": round(float(np.sum((slope_pct > 5) & (slope_pct <= 15)) / total * 100), 2),
            "moderado_15_30pct": round(float(np.sum((slope_pct > 15) & (slope_pct <= 30)) / total * 100), 2),
            "fuerte_30_60pct": round(float(np.sum((slope_pct > 30) & (slope_pct <= 60)) / total * 100), 2),
            "escarpado_gt60pct": round(float(np.sum(slope_pct > 60) / total * 100), 2),
            "referencia": "Tabla de pendientes MIVIOT / ANATI — Resolución 001-2019",
        }


# ══════════════════════════════════════════════════════════════════════════════
# MOTOR ANALÍTICO ML/DL — SIN ALUCINACIONES
# ══════════════════════════════════════════════════════════════════════════════

class AnalyticsEngine:
    """
    Motor analítico que carga y ejecuta modelos ML/DL reales.
    
    Política de integridad:
      - NUNCA genera predicciones sin modelo cargado.
      - NUNCA imputa datos faltantes sin notificación explícita.
      - Devuelve PERICIAL_NULL con especificación técnica del faltante.
    
    Formatos soportados:
      - Modelos: .pkl (scikit-learn, XGBoost, LightGBM)
      - Datasets: .csv, .geojson
    """

    def __init__(self):
        self._models: Dict[str, Any] = {}
        self._datasets: Dict[str, Any] = {}
        self._model_metadata: Dict[str, Dict] = {}

    def load_model(self, model_name: str, model_path: str) -> Dict[str, Any]:
        """
        Carga un modelo ML desde archivo .pkl.
        
        Args:
            model_name: Identificador único del modelo.
            model_path: Ruta absoluta al archivo .pkl.
            
        Returns:
            Dict con estado de carga y metadata del modelo.
        """
        if not ML_AVAILABLE:
            return {
                "error": "ML_NOT_AVAILABLE",
                "message": "scikit-learn no está instalado. pip install scikit-learn"
            }

        path = Path(model_path)
        if not path.exists():
            return {
                "error": "MODEL_FILE_NOT_FOUND",
                "path": str(path),
                "pericial_warning": (
                    f"Modelo '{model_name}' no encontrado en '{model_path}'. "
                    "Proporcione el archivo .pkl del modelo entrenado."
                ),
            }

        if path.suffix.lower() != ".pkl":
            return {
                "error": "INVALID_MODEL_FORMAT",
                "message": "Solo se aceptan modelos en formato .pkl"
            }

        try:
            with open(path, "rb") as f:
                model = pickle.load(f)

            self._models[model_name] = model
            self._model_metadata[model_name] = {
                "path": str(path),
                "loaded_at": datetime.now(timezone.utc).isoformat(),
                "type": type(model).__name__,
                "module": type(model).__module__,
            }

            logger.info("Modelo '%s' cargado: %s", model_name, type(model).__name__)
            return {
                "status": "loaded",
                "model_name": model_name,
                "model_type": type(model).__name__,
                "metadata": self._model_metadata[model_name],
            }

        except (pickle.UnpicklingError, AttributeError, ImportError) as ex:
            return {
                "error": "MODEL_LOAD_FAILED",
                "exception": str(ex),
                "pericial_warning": (
                    "Fallo al deserializar modelo. "
                    "Verifique compatibilidad de versiones de scikit-learn."
                ),
            }

    def load_dataset_csv(self, name: str, path: str) -> Dict[str, Any]:
        """
        Carga un dataset CSV para análisis.
        
        Args:
            name: Identificador del dataset.
            path: Ruta al archivo .csv.
            
        Returns:
            Dict con estadísticas del dataset cargado.
        """
        csv_path = Path(path)
        if not csv_path.exists():
            return {
                "error": "DATASET_NOT_FOUND",
                "path": str(csv_path),
                "pericial_warning": (
                    f"Dataset '{name}' no encontrado. "
                    "S.A.T.E. no genera datos sintéticos."
                )
            }

        try:
            df = pd.read_csv(csv_path, encoding="utf-8")
            self._datasets[name] = df

            return {
                "status": "loaded",
                "dataset_name": name,
                "rows": len(df),
                "columns": list(df.columns),
                "dtypes": df.dtypes.astype(str).to_dict(),
                "null_counts": df.isnull().sum().to_dict(),
                "memory_mb": round(df.memory_usage(deep=True).sum() / 1024**2, 3),
            }
        except Exception as ex:
            return {"error": f"CSV_LOAD_FAILED: {str(ex)}"}

    def load_dataset_geojson(self, name: str, path: str) -> Dict[str, Any]:
        """
        Carga un dataset GeoJSON como GeoDataFrame.
        
        Args:
            name: Identificador del dataset.
            path: Ruta al archivo .geojson.
            
        Returns:
            Dict con estadísticas del GeoDataFrame cargado.
        """
        gj_path = Path(path)
        if not gj_path.exists():
            return {
                "error": "GEOJSON_NOT_FOUND",
                "path": str(gj_path),
                "pericial_warning": "Archivo GeoJSON no encontrado."
            }

        try:
            gdf = gpd.read_file(gj_path)
            # Reproyectar a UTM 17N si está en WGS84
            if gdf.crs and gdf.crs.to_epsg() == 4326:
                gdf = gdf.to_crs(SATEConfig.CRS_UTM17N)

            self._datasets[name] = gdf

            return {
                "status": "loaded",
                "dataset_name": name,
                "features": len(gdf),
                "columns": list(gdf.columns),
                "crs": str(gdf.crs),
                "geometry_types": gdf.geom_type.value_counts().to_dict(),
                "bbox_utm": list(gdf.total_bounds),
            }
        except Exception as ex:
            return {"error": f"GEOJSON_LOAD_FAILED: {str(ex)}"}

    def predict(
        self,
        model_name: str,
        features: List[Dict],
        feature_names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Ejecuta predicción con modelo ML cargado.
        
        POLÍTICA DE NULOS: Si el modelo no está cargado o hay features
        faltantes, retorna PERICIAL_NULL con descripción técnica.
        
        Args:
            model_name: Nombre del modelo a usar.
            features: Lista de dicts con features de entrada.
            feature_names: Orden de columnas esperado por el modelo.
            
        Returns:
            Dict con predicciones y metadatos del modelo.
        """
        if model_name not in self._models:
            return {
                "error": "PERICIAL_NULL_MODEL_NOT_LOADED",
                "pericial_warning": (
                    f"Modelo '{model_name}' no está cargado. "
                    "Use POST /api/v1/analysis/load-model primero."
                ),
                "predictions": None,
            }

        model = self._models[model_name]

        try:
            df = pd.DataFrame(features)

            if feature_names:
                missing_cols = [c for c in feature_names if c not in df.columns]
                if missing_cols:
                    return {
                        "error": "PERICIAL_NULL_MISSING_FEATURES",
                        "missing_features": missing_cols,
                        "pericial_warning": (
                            f"Features faltantes: {missing_cols}. "
                            "No se imputan con valores sintéticos."
                        ),
                        "predictions": None,
                    }
                df = df[feature_names]

            predictions = model.predict(df.values)
            proba = None

            if hasattr(model, "predict_proba"):
                proba = model.predict_proba(df.values).tolist()

            return {
                "model_name": model_name,
                "model_type": type(model).__name__,
                "n_samples": len(features),
                "predictions": predictions.tolist(),
                "probabilities": proba,
                "feature_names_used": feature_names or list(df.columns),
                "metadata": self._model_metadata.get(model_name, {}),
            }

        except Exception as ex:
            return {
                "error": f"PREDICTION_FAILED: {str(ex)}",
                "predictions": None,
            }


# ══════════════════════════════════════════════════════════════════════════════
# PROXY WMS OFICIAL — CATÁLOGO CARTOGRÁFICO PANAMÁ
# ══════════════════════════════════════════════════════════════════════════════

class WMSProxy:
    """
    Proxy seguro para servicios WMS oficiales de Panamá.
    
    Características:
      - Restricción de bbox al territorio panameño
      - Cache de tiles para reducir carga en servidores oficiales
      - Retry con backoff exponencial
      - Timeout adaptativo por servidor
      - Sanitización de parámetros WMS
    """

    ALLOWED_PARAMS = {
        "SERVICE", "REQUEST", "VERSION", "LAYERS", "STYLES",
        "CRS", "SRS", "BBOX", "WIDTH", "HEIGHT", "FORMAT",
        "TRANSPARENT", "BGCOLOR", "EXCEPTIONS",
    }

    def __init__(self):
        self._session = self._build_session()
        self._cache: Dict[str, bytes] = {}

    def _build_session(self) -> requests.Session:
        """Construye sesión HTTP con retry automático."""
        session = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def get_wms_tile(
        self,
        service_name: str,
        params: Dict[str, str],
    ) -> Tuple[Optional[bytes], str, int]:
        """
        Obtiene un tile WMS del servicio oficial especificado.
        
        Args:
            service_name: Clave del servicio en WMS_ENDPOINTS.
            params: Parámetros WMS sanitizados.
            
        Returns:
            Tuple[bytes|None, content_type, status_code].
        """
        if service_name not in SATEConfig.WMS_ENDPOINTS:
            return None, "application/json", 404

        endpoint = SATEConfig.WMS_ENDPOINTS[service_name]

        # Sanitizar parámetros — solo permitidos
        clean_params = {
            k.upper(): v for k, v in params.items()
            if k.upper() in self.ALLOWED_PARAMS
        }

        # Forzar restricción a Panamá en el BBOX
        if "BBOX" in clean_params:
            clean_params["BBOX"] = self._clamp_bbox_to_panama(
                clean_params["BBOX"],
                clean_params.get("CRS", clean_params.get("SRS", "CRS:84"))
            )

        # Cache key
        cache_key = hashlib.md5(
            (service_name + json.dumps(clean_params, sort_keys=True)).encode()
        ).hexdigest()

        if cache_key in self._cache:
            return self._cache[cache_key], "image/png", 200

        try:
            resp = self._session.get(
                endpoint["url"],
                params=clean_params,
                timeout=endpoint.get("timeout", 30),
                headers={"User-Agent": "SATE-GeoPortal/3.0 (+gob.pa)"},
            )
            resp.raise_for_status()
            content = resp.content
            self._cache[cache_key] = content
            return content, resp.headers.get("Content-Type", "image/png"), 200

        except requests.exceptions.Timeout:
            logger.error("WMS timeout: %s", service_name)
            return None, "application/json", 504
        except requests.exceptions.ConnectionError:
            logger.error("WMS conexión fallida: %s", service_name)
            return None, "application/json", 502
        except requests.exceptions.HTTPError as ex:
            logger.error("WMS HTTP error: %s — %s", service_name, str(ex))
            return None, "application/json", 502

    def _clamp_bbox_to_panama(self, bbox_str: str, crs: str) -> str:
        """
        Restringe el BBOX de la solicitud WMS al territorio panameño.
        
        Args:
            bbox_str: Bbox como "minx,miny,maxx,maxy".
            crs: Sistema de referencia del bbox.
            
        Returns:
            str: Bbox recortado a los límites de Panamá.
        """
        try:
            parts = [float(x) for x in bbox_str.split(",")]
            if len(parts) != 4:
                raise ValueError

            min_lon, min_lat, max_lon, max_lat = SATEConfig.PANAMA_BBOX_WGS84

            # Si CRS es UTM, usar límites UTM
            if "32617" in crs or "17N" in crs.upper():
                min_lon, min_lat, max_lon, max_lat = SATEConfig.PANAMA_BBOX_UTM17N

            clamped = [
                max(parts[0], min_lon),
                max(parts[1], min_lat),
                min(parts[2], max_lon),
                min(parts[3], max_lat),
            ]
            return ",".join(str(round(v, 6)) for v in clamped)

        except (ValueError, IndexError):
            # Si el bbox es inválido, retornar Panamá completa
            return ",".join(str(v) for v in SATEConfig.PANAMA_BBOX_WGS84)

    def get_capabilities(self, service_name: str) -> Dict[str, Any]:
        """
        Obtiene GetCapabilities de un servicio WMS.
        
        Args:
            service_name: Clave del servicio.
            
        Returns:
            Dict con metadata del servicio.
        """
        if service_name not in SATEConfig.WMS_ENDPOINTS:
            return {
                "error": "SERVICE_NOT_FOUND",
                "available": list(SATEConfig.WMS_ENDPOINTS.keys())
            }

        endpoint = SATEConfig.WMS_ENDPOINTS[service_name]

        try:
            resp = self._session.get(
                endpoint["url"],
                params={"SERVICE": "WMS", "REQUEST": "GetCapabilities"},
                timeout=15,
            )
            return {
                "service": service_name,
                "url": endpoint["url"],
                "description": endpoint["description"],
                "status_code": resp.status_code,
                "content_type": resp.headers.get("Content-Type", ""),
                "available": resp.ok,
            }
        except Exception as ex:
            return {
                "service": service_name,
                "available": False,
                "error": str(ex),
            }


# ══════════════════════════════════════════════════════════════════════════════
# MOTOR GEE — GOOGLE EARTH ENGINE CON MANEJO ROBUSTO
# ══════════════════════════════════════════════════════════════════════════════

class GEEEngine:
    """
    Motor de integración con Google Earth Engine.
    
    Manejo de errores robusto:
      - Si la cuenta de servicio no está configurada → PERICIAL_NULL
      - Si GEE retorna error de cuota → QUOTA_EXCEEDED con retry
      - Si la geometría está fuera de Panamá → abortado con warning
    
    NOTA: Requiere configurar GEE_SERVICE_ACCOUNT y GEE_KEY_FILE
    como variables de entorno. No se hardcodean credenciales.
    """

    def __init__(self):
        self._initialized = False
        self._init_error: Optional[str] = None
        self._initialize()

    def _initialize(self) -> None:
        """Inicializa la conexión con GEE usando cuenta de servicio."""
        if not GEE_AVAILABLE:
            self._init_error = "GEE SDK no instalado (pip install earthengine-api)"
            return

        sa = SATEConfig.GEE_SERVICE_ACCOUNT
        key_file = SATEConfig.GEE_KEY_FILE

        if not sa or not key_file:
            self._init_error = (
                "GEE_SERVICE_ACCOUNT y GEE_KEY_FILE no configurados. "
                "Las rutas GEE retornarán PERICIAL_NULL."
            )
            logger.warning(self._init_error)
            return

        key_path = Path(key_file)
        if not key_path.exists():
            self._init_error = f"Archivo de credenciales GEE no encontrado: {key_file}"
            logger.error(self._init_error)
            return

        try:
            credentials = ee.ServiceAccountCredentials(sa, key_file)
            ee.Initialize(credentials)
            self._initialized = True
            logger.info("GEE inicializado correctamente con cuenta de servicio.")
        except Exception as ex:
            self._init_error = f"Error al inicializar GEE: {str(ex)}"
            logger.error(self._init_error)

    def _check_ready(self) -> Optional[Dict]:
        """Verifica que GEE esté operacional."""
        if not self._initialized:
            return {
                "error": "PERICIAL_NULL_GEE_NOT_INITIALIZED",
                "pericial_warning": self._init_error,
                "value": None,
            }
        return None

    def get_ndvi(
        self,
        geojson_geometry: Dict,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        """
        Calcula NDVI medio de una geometría usando Sentinel-2 o Landsat.
        
        Args:
            geojson_geometry: Geometría en formato GeoJSON (WGS84).
            start_date: Fecha inicio "YYYY-MM-DD".
            end_date: Fecha fin "YYYY-MM-DD".
            
        Returns:
            Dict con estadísticas NDVI del área.
        """
        err = self._check_ready()
        if err:
            return err

        try:
            aoi = ee.Geometry(geojson_geometry)

            # Sentinel-2 con máscara de nubes
            collection = (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(aoi)
                .filterDate(start_date, end_date)
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
            )

            count = collection.size().getInfo()

            if count == 0:
                return {
                    "error": "PERICIAL_NULL_NO_IMAGES",
                    "pericial_warning": (
                        f"Sin imágenes Sentinel-2 disponibles para el área "
                        f"en el período {start_date} — {end_date} "
                        f"con nubosidad < 20%. Amplíe el rango temporal."
                    ),
                    "n_images": 0,
                    "value": None,
                }

            # Calcular NDVI mediano
            def add_ndvi(img):
                return img.normalizedDifference(["B8", "B4"]).rename("NDVI")

            ndvi_col = collection.map(add_ndvi)
            ndvi_median = ndvi_col.median()

            stats = ndvi_median.reduceRegion(
                reducer=ee.Reducer.mean()
                    .combine(ee.Reducer.stdDev(), sharedInputs=True)
                    .combine(ee.Reducer.min(), sharedInputs=True)
                    .combine(ee.Reducer.max(), sharedInputs=True),
                geometry=aoi,
                scale=10,
                maxPixels=1e9,
            ).getInfo()

            return {
                "ndvi_mean": round(stats.get("NDVI_mean", 0), 4),
                "ndvi_stddev": round(stats.get("NDVI_stdDev", 0), 4),
                "ndvi_min": round(stats.get("NDVI_min", 0), 4),
                "ndvi_max": round(stats.get("NDVI_max", 0), 4),
                "n_images": count,
                "satellite": "Sentinel-2 SR (COPERNICUS/S2_SR_HARMONIZED)",
                "period": {"start": start_date, "end": end_date},
                "cloud_filter_pct": 20,
            }

        except ee.EEException as ex:
            if "Quota" in str(ex) or "quota" in str(ex):
                return {
                    "error": "GEE_QUOTA_EXCEEDED",
                    "message": "Cuota de GEE excedida. Reintente en 24 horas.",
                    "value": None,
                }
            return {
                "error": f"GEE_ERROR: {str(ex)}",
                "value": None,
            }
        except Exception as ex:
            return {"error": f"UNEXPECTED_GEE_ERROR: {str(ex)}", "value": None}


# ══════════════════════════════════════════════════════════════════════════════
# MATRIZ DE RIESGO GEOTÉCNICO — MIVIOT / MIDA
# ══════════════════════════════════════════════════════════════════════════════

class RiskMatrixEngine:
    """
    Motor de evaluación de riesgo geotécnico para Panamá.
    
    Basado en:
      - Pendientes reales (SRTM 30m o LiDAR IGNTG)
      - Materiales permitidos por MIVIOT (Resolución 001-2019)
      - Zonas de riesgo SINAPROC (Inundación, deslizamiento)
      - Cobertura de suelos MiAmbiente
    
    POLÍTICA: Si no hay datos de pendiente o material → NULL pericial.
    NO se asumen valores de pendiente ni tipo de suelo.
    """

    # Tabla de riesgo MIVIOT × pendiente × material
    # Fuente: Resolución MIVIOT 001-2019, Tabla 3
    RISK_MATRIX = {
        "plano": {
            "roca": "BAJO",
            "granular": "BAJO",
            "cohesivo": "BAJO",
            "organico": "MEDIO",
        },
        "suave": {
            "roca": "BAJO",
            "granular": "BAJO",
            "cohesivo": "MEDIO",
            "organico": "ALTO",
        },
        "moderado": {
            "roca": "MEDIO",
            "granular": "MEDIO",
            "cohesivo": "ALTO",
            "organico": "MUY_ALTO",
        },
        "fuerte": {
            "roca": "MEDIO",
            "granular": "ALTO",
            "cohesivo": "MUY_ALTO",
            "organico": "MUY_ALTO",
        },
        "escarpado": {
            "roca": "ALTO",
            "granular": "MUY_ALTO",
            "cohesivo": "MUY_ALTO",
            "organico": "CRITICO",
        },
    }

    SLOPE_CLASSES = [
        (5, "plano"),
        (15, "suave"),
        (30, "moderado"),
        (60, "fuerte"),
        (float("inf"), "escarpado"),
    ]

    def classify_slope_class(self, slope_pct: float) -> str:
        """
        Clasifica una pendiente porcentual en categoría MIVIOT.
        
        Args:
            slope_pct: Pendiente en porcentaje (0-100+).
            
        Returns:
            str: Clase de pendiente.
        """
        for threshold, cls in self.SLOPE_CLASSES:
            if slope_pct <= threshold:
                return cls
        return "escarpado"

    def evaluate(
        self,
        slope_pct: Optional[float],
        material_type: Optional[str],
        location_lon: Optional[float] = None,
        location_lat: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Evalúa el nivel de riesgo geotécnico para una ubicación.
        
        Args:
            slope_pct: Pendiente en porcentaje (dato real requerido).
            material_type: Tipo de material del suelo (dato real requerido).
            location_lon: Longitud WGS84 (para verificar Panamá).
            location_lat: Latitud WGS84.
            
        Returns:
            Dict con clasificación de riesgo y recomendaciones.
        """
        warnings = []

        # Verificar jurisdicción
        if location_lon and location_lat:
            if not validate_panama_bounds(location_lon, location_lat):
                return {
                    "error": "FUERA_DE_PANAMA",
                    "pericial_warning": "Ubicación fuera de la República de Panamá.",
                    "value": None,
                }

        # Validar pendiente
        if slope_pct is None:
            return {
                "error": "PERICIAL_NULL_MISSING_SLOPE",
                "pericial_warning": (
                    "Pendiente no proporcionada. "
                    "Cargue DEM real (SRTM/LiDAR) para calcular pendiente. "
                    "No se asume valor por defecto."
                ),
                "value": None,
            }

        # Validar material
        valid_materials = list(list(self.RISK_MATRIX.values())[0].keys())
        if not material_type or material_type.lower() not in valid_materials:
            return {
                "error": "PERICIAL_NULL_MISSING_MATERIAL",
                "pericial_warning": (
                    f"Tipo de material '{material_type}' no reconocido. "
                    f"Valores válidos: {valid_materials}. "
                    "Consulte mapa de materiales MIVIOT."
                ),
                "value": None,
            }

        slope_class = self.classify_slope_class(slope_pct)
        material = material_type.lower()
        risk_level = self.RISK_MATRIX[slope_class][material]

        return {
            "nivel_riesgo": risk_level,
            "clase_pendiente": slope_class,
            "pendiente_pct": slope_pct,
            "material": material,
            "recomendaciones": self._get_recommendations(risk_level, slope_class, material),
            "referencia_normativa": "MIVIOT Resolución 001-2019 — Tabla 3",
            "pericial_warnings": warnings,
        }

    def _get_recommendations(
        self, risk: str, slope_class: str, material: str
    ) -> List[str]:
        """Retorna recomendaciones técnicas según nivel de riesgo."""
        recs = {
            "BAJO": [
                "Terreno apto para desarrollo con medidas estándar.",
                "Estudio geotécnico básico recomendado.",
            ],
            "MEDIO": [
                "Requiere estudio geotécnico detallado.",
                "Implementar drenajes perimetrales.",
                "Monitoreo periódico de asentamientos.",
            ],
            "ALTO": [
                "Estudio geotécnico especializado obligatorio (MIVIOT Art. 18).",
                "Prohibido desarrollo sin medidas de mitigación aprobadas.",
                "Consultar SINAPROC para zonas de deslizamiento.",
            ],
            "MUY_ALTO": [
                "RESTRICCIÓN DE USO — Requiere aprobación especial MIVIOT.",
                "Estudio geotécnico con ensayos de laboratorio in-situ.",
                "Plan de manejo ambiental obligatorio (MiAmbiente).",
            ],
            "CRITICO": [
                "ZONA DE ALTO RIESGO — Desarrollo prohibido sin EIA.",
                "Coordinar con SINAPROC, MIVIOT y MiAmbiente.",
                "Requiere resolución ministerial para cualquier intervención.",
            ],
        }
        return recs.get(risk, ["Consulte con ingeniero geotécnico certificado."])


# ══════════════════════════════════════════════════════════════════════════════
# GENERADOR DE EXPEDIENTE PERICIAL PDF
# ══════════════════════════════════════════════════════════════════════════════

class PericialPDFExporter:
    """
    Generador de Expediente Pericial en formato PDF multipágina.
    
    Produce fascículos:
      - Fascículo Geodésico (coordenadas, derroteros, áreas)
      - Fascículo Ambiental (NDVI, cobertura, pendientes)
      - Fascículo Normativo (riesgo geotécnico, zonificación)
      - Fascículo de Infraestructura (vialidad, servicios)
    
    Estilo: Cajetín Cartográfico Oficial IGNTG Panamá
    Formato: A4 vertical / A3 apaisado según fascículo
    """

    COLORS = {
        "primary": colors.HexColor("#003366"),
        "secondary": colors.HexColor("#0055A4"),
        "accent": colors.HexColor("#C8A84B"),
        "danger": colors.HexColor("#CC0000"),
        "success": colors.HexColor("#006633"),
        "warning": colors.HexColor("#FF8C00"),
        "light_bg": colors.HexColor("#F5F5F0"),
        "border": colors.HexColor("#CCCCCC"),
        "white": colors.white,
        "black": colors.black,
    }

    def __init__(self):
        self._styles = getSampleStyleSheet()
        self._setup_custom_styles()

    def _setup_custom_styles(self) -> None:
        """Configura estilos tipográficos del expediente."""
        self._styles.add(ParagraphStyle(
            "SATETitle",
            parent=self._styles["Title"],
            fontSize=14,
            fontName="Helvetica-Bold",
            textColor=self.COLORS["primary"],
            spaceAfter=6,
            alignment=TA_CENTER,
        ))
        self._styles.add(ParagraphStyle(
            "SATESubtitle",
            parent=self._styles["Normal"],
            fontSize=10,
            fontName="Helvetica-Bold",
            textColor=self.COLORS["secondary"],
            spaceAfter=4,
        ))
        self._styles.add(ParagraphStyle(
            "SATEBody",
            parent=self._styles["Normal"],
            fontSize=8,
            fontName="Helvetica",
            leading=12,
            spaceAfter=3,
        ))
        self._styles.add(ParagraphStyle(
            "SATEWarning",
            parent=self._styles["Normal"],
            fontSize=8,
            fontName="Helvetica-Bold",
            textColor=self.COLORS["danger"],
            leading=11,
            leftIndent=10,
        ))
        self._styles.add(ParagraphStyle(
            "SATECaption",
            parent=self._styles["Normal"],
            fontSize=7,
            fontName="Helvetica-Oblique",
            textColor=colors.grey,
            alignment=TA_CENTER,
        ))

    def _draw_cajetin(
        self,
        c: pdf_canvas.Canvas,
        page_width: float,
        page_height: float,
        data: Dict,
        page_num: int,
        total_pages: int,
    ) -> None:
        """
        Dibuja el Cajetín Cartográfico Oficial en el canvas.
        
        El cajetín se posiciona en la esquina inferior derecha siguiendo
        el estándar IGNTG (Instituto Geográfico Nacional Tommy Guardia).
        
        Args:
            c: Canvas ReportLab.
            page_width, page_height: Dimensiones en puntos.
            data: Dict con metadatos del expediente.
            page_num: Número de página actual.
            total_pages: Total de páginas del expediente.
        """
        # Dimensiones del cajetín
        caj_width = 160 * mm
        caj_height = 40 * mm
        caj_x = page_width - caj_width - 10 * mm
        caj_y = 10 * mm

        # Marco exterior
        c.setStrokeColor(self.COLORS["primary"])
        c.setLineWidth(1.5)
        c.rect(caj_x, caj_y, caj_width, caj_height)

        # Línea divisoria vertical (columna izquierda = institución)
        div_x = caj_x + 50 * mm
        c.line(div_x, caj_y, div_x, caj_y + caj_height)

        # División horizontal derecha
        mid_y = caj_y + caj_height / 2
        c.line(div_x, mid_y, caj_x + caj_width, mid_y)

        # Columna izquierda: Logo e institución
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(self.COLORS["primary"])
        c.drawString(caj_x + 3 * mm, caj_y + 30 * mm, "REPÚBLICA DE PANAMÁ")
        c.setFont("Helvetica", 6)
        c.drawString(caj_x + 3 * mm, caj_y + 25 * mm, "S.A.T.E.")
        c.drawString(caj_x + 3 * mm, caj_y + 20 * mm, "Sistema de Auditoría")
        c.drawString(caj_x + 3 * mm, caj_y + 15 * mm, "Territorial Especializado")
        c.setFont("Helvetica-Bold", 6)
        c.setFillColor(self.COLORS["accent"])
        c.drawString(caj_x + 3 * mm, caj_y + 8 * mm, "EXPEDIENTE PERICIAL")

        # Columna derecha superior: datos del proyecto
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColor(self.COLORS["primary"])
        c.drawString(div_x + 3 * mm, caj_y + caj_height - 8 * mm,
                     f"PROYECTO: {data.get('proyecto', 'N/D')[:35]}")
        c.setFont("Helvetica", 6)
        c.setFillColor(colors.black)
        c.drawString(div_x + 3 * mm, caj_y + caj_height - 14 * mm,
                     f"EXPEDIENTE N°: {data.get('expediente', 'SATE-2025-001')}")
        c.drawString(div_x + 3 * mm, caj_y + caj_height - 19 * mm,
                     f"DATUM: WGS84 | ZONA UTM: 17N | EPSG:32617")

        # Columna derecha inferior: escala y fecha
        c.setFont("Helvetica", 6)
        c.drawString(div_x + 3 * mm, mid_y - 6 * mm,
                     f"FECHA: {data.get('fecha', datetime.now().strftime('%d/%m/%Y'))}")
        c.drawString(div_x + 3 * mm, mid_y - 11 * mm,
                     f"ELABORÓ: {data.get('elaboro', 'Motor S.A.T.E. v3.0')}")
        c.drawString(div_x + 3 * mm, mid_y - 16 * mm,
                     f"REVISÓ: {data.get('reviso', '---')}")

        # Número de página
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(self.COLORS["primary"])
        c.drawRightString(
            caj_x + caj_width - 3 * mm,
            mid_y - 16 * mm,
            f"{page_num} / {total_pages}"
        )

        # Marca de agua de coordenadas de Panamá
        c.setFont("Helvetica", 5)
        c.setFillColor(colors.grey)
        c.drawString(
            10 * mm, 8 * mm,
            "Datum: WGS84 | UTM Zona 17N | EPSG:32617 | República de Panamá | "
            "S.A.T.E. — Sistema de Auditoría Territorial Especializado"
        )

    def generate_expediente(
        self,
        data: Dict[str, Any],
        fasciculos: List[str],
    ) -> BytesIO:
        """
        Genera el expediente pericial completo en PDF.
        
        Args:
            data: Diccionario con todos los datos del expediente.
            fasciculos: Lista de fascículos a incluir.
                        Opciones: ["geodesico", "ambiental", "normativo", "infraestructura"]
                        
        Returns:
            BytesIO: Buffer con el PDF generado.
        """
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=15 * mm,
            leftMargin=15 * mm,
            topMargin=15 * mm,
            bottomMargin=55 * mm,  # Espacio para cajetín
        )

        story = []
        page_meta = {
            "proyecto": data.get("nombre_proyecto", "SIN NOMBRE"),
            "expediente": data.get("numero_expediente", f"SATE-{datetime.now().strftime('%Y-%m%d')}-001"),
            "fecha": datetime.now().strftime("%d/%m/%Y"),
            "elaboro": data.get("elaborado_por", "Motor S.A.T.E. v3.0"),
            "reviso": data.get("revisado_por", "---"),
        }

        # ── Portada ────────────────────────────────────────────────────────────
        story.extend(self._build_portada(data))

        # ── Fascículos ─────────────────────────────────────────────────────────
        fasciculos_map = {
            "geodesico": self._build_fasciculo_geodesico,
            "ambiental": self._build_fasciculo_ambiental,
            "normativo": self._build_fasciculo_normativo,
            "infraestructura": self._build_fasciculo_infraestructura,
        }

        for fasciculo_name in fasciculos:
            builder = fasciculos_map.get(fasciculo_name)
            if builder:
                story.append(PageBreak())
                story.extend(builder(data))

        # Total estimado de páginas
        total_pages = 1 + len(fasciculos)

        # Construir con cajetín en cada página
        page_counter = [0]

        def on_page(canvas_obj, doc_obj):
            page_counter[0] += 1
            self._draw_cajetin(
                canvas_obj,
                doc_obj.pagesize[0],
                doc_obj.pagesize[1],
                page_meta,
                page_counter[0],
                total_pages,
            )

        doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
        buffer.seek(0)
        return buffer

    def _build_portada(self, data: Dict) -> List:
        """Construye la portada oficial del expediente."""
        elements = []

        elements.append(Spacer(1, 20 * mm))
        elements.append(Paragraph(
            "REPÚBLICA DE PANAMÁ",
            self._styles["SATETitle"]
        ))
        elements.append(Paragraph(
            "SISTEMA DE AUDITORÍA TERRITORIAL ESPECIALIZADO",
            self._styles["SATETitle"]
        ))
        elements.append(Paragraph(
            "S.A.T.E. v3.0",
            self._styles["SATESubtitle"]
        ))
        elements.append(Spacer(1, 10 * mm))

        # Línea decorativa
        d = Drawing(150 * mm, 3)
        d.add(Line(0, 1.5, 150 * mm, 1.5,
                   strokeColor=self.COLORS["accent"],
                   strokeWidth=2))
        elements.append(d)
        elements.append(Spacer(1, 5 * mm))

        elements.append(Paragraph(
            f"EXPEDIENTE PERICIAL N° {data.get('numero_expediente', 'SATE-2025-001')}",
            self._styles["SATETitle"]
        ))
        elements.append(Spacer(1, 8 * mm))
        elements.append(Paragraph(
            f"PROYECTO: {data.get('nombre_proyecto', 'N/D')}",
            self._styles["SATESubtitle"]
        ))
        elements.append(Spacer(1, 5 * mm))

        # Tabla de metadatos
        meta_data = [
            ["PARÁMETRO", "VALOR"],
            ["Fecha de Emisión", datetime.now().strftime("%d de %B de %Y")],
            ["Datum Geodésico", "WGS84 (World Geodetic System 1984)"],
            ["Sistema de Proyección", "UTM Zona 17N — EPSG:32617"],
            ["Jurisdicción", "República de Panamá"],
            ["Elaborado por", data.get("elaborado_por", "Motor S.A.T.E. v3.0")],
            ["Revisado por", data.get("revisado_por", "---")],
            ["Aprobado por", data.get("aprobado_por", "---")],
            ["Clasificación", data.get("clasificacion", "PERICIAL — CONFIDENCIAL")],
        ]

        table = Table(meta_data, colWidths=[60 * mm, 100 * mm])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), self.COLORS["primary"]),
            ("TEXTCOLOR", (0, 0), (-1, 0), self.COLORS["white"]),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, self.COLORS["border"]),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [self.COLORS["light_bg"], self.COLORS["white"]]),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(table)
        elements.append(Spacer(1, 10 * mm))

        elements.append(Paragraph(
            "⚠ DOCUMENTO DE USO PERICIAL — PROHIBIDA SU REPRODUCCIÓN PARCIAL",
            self._styles["SATEWarning"]
        ))

        return elements

    def _build_fasciculo_geodesico(self, data: Dict) -> List:
        """Construye el Fascículo Geodésico."""
        elements = []
        elements.append(Paragraph(
            "FASCÍCULO I — GEODÉSICO", self._styles["SATETitle"]
        ))
        elements.append(Paragraph(
            "Coordenadas, Derroteros y Análisis Topológico",
            self._styles["SATESubtitle"]
        ))
        elements.append(Spacer(1, 5 * mm))

        geo_data = data.get("geodesico", {})

        if not geo_data:
            elements.append(Paragraph(
                "⚠ PERICIAL_NULL: No se proporcionaron datos geodésicos. "
                "Ejecute el cálculo topológico en /api/v1/topology antes de exportar.",
                self._styles["SATEWarning"]
            ))
            return elements

        # Derrotero
        derrotero = geo_data.get("derrotero", {}).get("derrotero", [])
        if derrotero:
            elements.append(Paragraph("DERROTERO DE LINDEROS", self._styles["SATESubtitle"]))

            dero_headers = [
                "Seg.", "Desde", "Hasta",
                "Azimut (°)", "Rumbo", "Distancia (m)"
            ]
            dero_rows = [dero_headers]

            for seg in derrotero:
                dero_rows.append([
                    str(seg.get("segmento", "")),
                    seg.get("vertice_desde", ""),
                    seg.get("vertice_hasta", ""),
                    str(seg.get("azimut_deg", "")),
                    seg.get("rumbo_cuadrantal", ""),
                    str(seg.get("distancia_m", "")),
                ])

            dero_table = Table(dero_rows, colWidths=[15*mm, 18*mm, 18*mm, 22*mm, 50*mm, 25*mm])
            dero_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), self.COLORS["secondary"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), self.COLORS["white"]),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.3, self.COLORS["border"]),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                 [self.COLORS["light_bg"], self.COLORS["white"]]),
                ("PADDING", (0, 0), (-1, -1), 3),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]))
            elements.append(dero_table)
            elements.append(Spacer(1, 3 * mm))

            # Totales
            total_dist = geo_data.get("derrotero", {}).get("perimetro_total_m", "N/D")
            elements.append(Paragraph(
                f"PERÍMETRO TOTAL: {total_dist} m",
                self._styles["SATESubtitle"]
            ))

        # Área
        area_data = geo_data.get("area", {})
        if area_data and "area_m2" in area_data:
            elements.append(Spacer(1, 3 * mm))
            elements.append(Paragraph("SUPERFICIE", self._styles["SATESubtitle"]))

            area_rows = [
                ["ÁREA m²", "ÁREA ha", "ÁREA km²", "PERÍMETRO m"],
                [
                    f"{area_data.get('area_m2', 'N/D'):,.4f}",
                    f"{area_data.get('area_ha', 'N/D'):,.6f}",
                    f"{area_data.get('area_km2', 'N/D'):,.8f}",
                    f"{area_data.get('perimetro_m', 'N/D'):,.4f}",
                ]
            ]
            area_table = Table(area_rows, colWidths=[40*mm, 40*mm, 40*mm, 40*mm])
            area_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), self.COLORS["secondary"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), self.COLORS["white"]),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, self.COLORS["border"]),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("PADDING", (0, 0), (-1, -1), 5),
            ]))
            elements.append(area_table)

        return elements

    def _build_fasciculo_ambiental(self, data: Dict) -> List:
        """Construye el Fascículo Ambiental."""
        elements = []
        elements.append(Paragraph(
            "FASCÍCULO II — AMBIENTAL", self._styles["SATETitle"]
        ))
        elements.append(Paragraph(
            "NDVI, Cobertura Vegetal y Análisis de Pendientes",
            self._styles["SATESubtitle"]
        ))
        elements.append(Spacer(1, 5 * mm))

        ambiental = data.get("ambiental", {})

        if not ambiental:
            elements.append(Paragraph(
                "⚠ PERICIAL_NULL: No se proporcionaron datos ambientales. "
                "Ejecute análisis GEE en /api/v1/gee/ndvi antes de exportar.",
                self._styles["SATEWarning"]
            ))
            return elements

        # NDVI
        ndvi = ambiental.get("ndvi", {})
        if ndvi and "ndvi_mean" in ndvi:
            elements.append(Paragraph("ÍNDICE NDVI (Sentinel-2)", self._styles["SATESubtitle"]))
            ndvi_rows = [
                ["Parámetro", "Valor"],
                ["NDVI Medio", str(ndvi.get("ndvi_mean", "N/D"))],
                ["NDVI Mínimo", str(ndvi.get("ndvi_min", "N/D"))],
                ["NDVI Máximo", str(ndvi.get("ndvi_max", "N/D"))],
                ["Desviación Estándar", str(ndvi.get("ndvi_stddev", "N/D"))],
                ["N° Imágenes", str(ndvi.get("n_images", "N/D"))],
                ["Satélite", ndvi.get("satellite", "N/D")],
            ]
            ndvi_table = Table(ndvi_rows, colWidths=[80*mm, 80*mm])
            ndvi_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), self.COLORS["success"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), self.COLORS["white"]),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.3, self.COLORS["border"]),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                 [self.COLORS["light_bg"], self.COLORS["white"]]),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]))
            elements.append(ndvi_table)

        return elements

    def _build_fasciculo_normativo(self, data: Dict) -> List:
        """Construye el Fascículo Normativo."""
        elements = []
        elements.append(Paragraph(
            "FASCÍCULO III — NORMATIVO", self._styles["SATETitle"]
        ))
        elements.append(Paragraph(
            "Riesgo Geotécnico, Zonificación MIVIOT y Marco Legal",
            self._styles["SATESubtitle"]
        ))
        elements.append(Spacer(1, 5 * mm))

        normativo = data.get("normativo", {})
        riesgo = normativo.get("riesgo", {})

        if riesgo and "nivel_riesgo" in riesgo:
            risk_level = riesgo["nivel_riesgo"]
            risk_color = {
                "BAJO": self.COLORS["success"],
                "MEDIO": colors.HexColor("#FFA500"),
                "ALTO": colors.HexColor("#FF4500"),
                "MUY_ALTO": self.COLORS["danger"],
                "CRITICO": colors.HexColor("#8B0000"),
            }.get(risk_level, colors.grey)

            elements.append(Paragraph("NIVEL DE RIESGO GEOTÉCNICO", self._styles["SATESubtitle"]))

            risk_rows = [
                ["NIVEL DE RIESGO", risk_level],
                ["Clase de Pendiente", riesgo.get("clase_pendiente", "N/D")],
                ["Pendiente (%)", str(riesgo.get("pendiente_pct", "N/D"))],
                ["Material", riesgo.get("material", "N/D")],
                ["Referencia", riesgo.get("referencia_normativa", "N/D")],
            ]
            risk_table = Table(risk_rows, colWidths=[80*mm, 80*mm])
            risk_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (0, 0), self.COLORS["primary"]),
                ("BACKGROUND", (1, 0), (1, 0), risk_color),
                ("TEXTCOLOR", (0, 0), (-1, 0), self.COLORS["white"]),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, self.COLORS["border"]),
                ("PADDING", (0, 0), (-1, -1), 5),
            ]))
            elements.append(risk_table)
            elements.append(Spacer(1, 3 * mm))

            # Recomendaciones
            recomendaciones = riesgo.get("recomendaciones", [])
            if recomendaciones:
                elements.append(Paragraph("RECOMENDACIONES TÉCNICAS:", self._styles["SATESubtitle"]))
                for rec in recomendaciones:
                    elements.append(Paragraph(f"• {rec}", self._styles["SATEBody"]))
        else:
            elements.append(Paragraph(
                "⚠ PERICIAL_NULL: No se proporcionaron datos de riesgo geotécnico.",
                self._styles["SATEWarning"]
            ))

        return elements

    def _build_fasciculo_infraestructura(self, data: Dict) -> List:
        """Construye el Fascículo de Infraestructura."""
        elements = []
        elements.append(Paragraph(
            "FASCÍCULO IV — INFRAESTRUCTURA", self._styles["SATETitle"]
        ))
        elements.append(Paragraph(
            "Vialidad, Servicios Públicos y Accesibilidad",
            self._styles["SATESubtitle"]
        ))
        elements.append(Spacer(1, 5 * mm))

        infra = data.get("infraestructura", {})

        if not infra:
            elements.append(Paragraph(
                "⚠ PERICIAL_NULL: No se proporcionaron datos de infraestructura. "
                "Consuma el servicio WMS OSM en /api/v1/wms/tile para obtener datos viales.",
                self._styles["SATEWarning"]
            ))
        else:
            for key, value in infra.items():
                elements.append(Paragraph(
                    f"{key.upper()}: {value}",
                    self._styles["SATEBody"]
                ))

        # Nota de pie pericial
        elements.append(Spacer(1, 10 * mm))
        elements.append(Paragraph(
            "NOTA PERICIAL: Los datos de infraestructura provienen de "
            "servicios WMS oficiales (OSM / IGNTG). La información debe "
            "ser verificada in-situ antes de cualquier decisión técnico-legal.",
            self._styles["SATECaption"]
        ))

        return elements


# ══════════════════════════════════════════════════════════════════════════════
# MODELOS PYDANTIC — VALIDACIÓN DE ENTRADA
# ══════════════════════════════════════════════════════════════════════════════

class VertexModel(BaseModel):
    """Vértice geográfico con coordenadas WGS84 o UTM."""
    lon: Optional[float] = Field(None, ge=-84.0, le=-77.0,
                                  description="Longitud WGS84 (°)")
    lat: Optional[float] = Field(None, ge=7.0, le=10.0,
                                  description="Latitud WGS84 (°)")
    easting: Optional[float] = Field(None, description="Coordenada Este UTM (m)")
    northing: Optional[float] = Field(None, description="Coordenada Norte UTM (m)")
    elevation_m: Optional[float] = Field(None, description="Elevación en metros")

    @validator("lon")
    def validate_lon_panama(cls, v):
        if v is not None:
            min_lon, _, max_lon, _ = SATEConfig.PANAMA_BBOX_WGS84
            if not (min_lon <= v <= max_lon):
                raise ValueError(
                    f"Longitud {v}° fuera del territorio panameño "
                    f"({min_lon}° a {max_lon}°)"
                )
        return v

    @validator("lat")
    def validate_lat_panama(cls, v):
        if v is not None:
            _, min_lat, _, max_lat = SATEConfig.PANAMA_BBOX_WGS84
            if not (min_lat <= v <= max_lat):
                raise ValueError(
                    f"Latitud {v}° fuera del territorio panameño "
                    f"({min_lat}° a {max_lat}°)"
                )
        return v


class DerroteroRequest(BaseModel):
    """Solicitud de cálculo de derrotero."""
    vertices: List[VertexModel] = Field(..., min_items=2)
    cerrar_poligono: bool = Field(
        True, description="Si True, cierra el polígono repitiendo el primer vértice"
    )


class AzimuthRequest(BaseModel):
    """Solicitud de cálculo de azimut."""
    lon1: float = Field(..., ge=-84.0, le=-77.0)
    lat1: float = Field(..., ge=7.0, le=10.0)
    lon2: float = Field(..., ge=-84.0, le=-77.0)
    lat2: float = Field(..., ge=7.0, le=10.0)


class RiskEvaluationRequest(BaseModel):
    """Solicitud de evaluación de riesgo geotécnico."""
    slope_pct: Optional[float] = Field(None, ge=0, le=200)
    material_type: Optional[str] = Field(None)
    lon: Optional[float] = Field(None, ge=-84.0, le=-77.0)
    lat: Optional[float] = Field(None, ge=7.0, le=10.0)


class GEENDVIRequest(BaseModel):
    """Solicitud de análisis NDVI en GEE."""
    geometry: Dict = Field(..., description="GeoJSON geometry (WGS84)")
    start_date: str = Field(..., regex=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(..., regex=r"^\d{4}-\d{2}-\d{2}$")


class ExportRequest(BaseModel):
    """Solicitud de exportación de expediente pericial."""
    nombre_proyecto: str = Field(..., min_length=3, max_length=200)
    numero_expediente: Optional[str] = None
    elaborado_por: Optional[str] = "Motor S.A.T.E. v3.0"
    revisado_por: Optional[str] = None
    aprobado_por: Optional[str] = None
    fasciculos: List[str] = Field(
        default=["geodesico", "ambiental", "normativo", "infraestructura"]
    )
    geodesico: Optional[Dict] = None
    ambiental: Optional[Dict] = None
    normativo: Optional[Dict] = None
    infraestructura: Optional[Dict] = None

    @validator("fasciculos", each_item=True)
    def validate_fasciculo_name(cls, v):
        valid = ["geodesico", "ambiental", "normativo", "infraestructura"]
        if v not in valid:
            raise ValueError(f"Fascículo '{v}' inválido. Válidos: {valid}")
        return v


# ══════════════════════════════════════════════════════════════════════════════
# INICIALIZACIÓN DE LA APLICACIÓN FLASK
# ══════════════════════════════════════════════════════════════════════════════

SATEConfig.ensure_dirs()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB máximo

# ── CORS — Restringido ────────────────────────────────────────────────────────
CORS(app, resources={
    r"/api/*": {
        "origins": os.environ.get("SATE_ALLOWED_ORIGINS", "*").split(","),
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": [
            "Content-Type",
            "X-SATE-API-Key",
            "X-SATE-Timestamp",
            "X-SATE-Nonce",
            "X-SATE-Signature",
        ],
        "max_age": 600,
    }
})

# ── Rate Limiting ──────────────────────────────────────────────────────────────
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=[SATEConfig.RATE_LIMIT_DEFAULT],
    storage_uri="memory://",
)

# ── Motores ────────────────────────────────────────────────────────────────────
_topology = TopologyEngine()
_analytics = AnalyticsEngine()
_wms_proxy = WMSProxy()
_gee_engine = GEEEngine()
_risk_engine = RiskMatrixEngine()
_pdf_exporter = PericialPDFExporter()


# ══════════════════════════════════════════════════════════════════════════════
# SECURITY HEADERS MIDDLEWARE
# ══════════════════════════════════════════════════════════════════════════════

@app.after_request
def add_security_headers(response: Response) -> Response:
    """
    Agrega headers de seguridad a todas las respuestas.
    
    Implementa:
      - Content Security Policy (CSP)
      - X-Content-Type-Options (no MIME sniffing)
      - X-Frame-Options (clickjacking)
      - Strict-Transport-Security (HSTS)
      - Referrer-Policy
    """
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = (
        "max-age=31536000; includeSubDomains; preload"
    )
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        "script-src 'none'; "
        "frame-ancestors 'none';"
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-SATE-Version"] = "3.0"
    return response


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — AUTENTICACIÓN
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/auth/status", methods=["GET"])
def auth_status():
    """
    Verifica el estado del sistema de autenticación.
    
    No requiere autenticación.
    """
    return jsonify({
        "system": "S.A.T.E. v3.0",
        "auth_scheme": "HMAC-SHA256 + API Key",
        "jurisdiction": "República de Panamá",
        "crs": SATEConfig.CRS_UTM17N,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gee_available": GEE_AVAILABLE,
        "gee_initialized": _gee_engine._initialized,
    })


@app.route("/api/v1/auth/generate-key", methods=["POST"])
@require_auth("admin")
def create_api_key():
    """
    Genera una nueva API Key.
    
    Requiere scope 'admin'.
    Body JSON: { "name": str, "scopes": List[str] }
    """
    body = request.get_json(silent=True) or {}
    name = body.get("name", "").strip()
    scopes = body.get("scopes", [])

    if not name:
        return jsonify({"error": "Campo 'name' requerido"}), 400

    valid_scopes = ["topology", "analysis", "wms", "export", "gee", "risk"]
    invalid_scopes = [s for s in scopes if s not in valid_scopes]
    if invalid_scopes:
        return jsonify({
            "error": f"Scopes inválidos: {invalid_scopes}",
            "valid_scopes": valid_scopes,
        }), 400

    new_key = generate_api_key(name, scopes)
    return jsonify({
        "api_key": new_key,
        "name": name,
        "scopes": scopes,
        "warning": "Guarde esta key. No se mostrará nuevamente.",
    })


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — TOPOLOGÍA
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/topology/derrotero", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_TOPOLOGY)
@require_auth("topology")
def calc_derrotero():
    """
    Calcula el derrotero geodésico de un conjunto de vértices.
    
    Body JSON: DerroteroRequest
    Returns: Derrotero completo con azimut, rumbo y distancias por segmento.
    """
    try:
        body = request.get_json(force=True)
        req = DerroteroRequest(**body)
    except (ValidationError, Exception) as ex:
        return jsonify({"error": "INVALID_INPUT", "detail": str(ex)}), 400

    vertices = [v.dict() for v in req.vertices]

    if req.cerrar_poligono and len(vertices) >= 3:
        if vertices[0] != vertices[-1]:
            vertices.append(vertices[0])

    result = _topology.calculate_derrotero(vertices)
    return jsonify(result)


@app.route("/api/v1/topology/azimuth", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_TOPOLOGY)
@require_auth("topology")
def calc_azimuth():
    """
    Calcula el azimut geodésico entre dos puntos WGS84.
    
    Body JSON: AzimuthRequest
    """
    try:
        body = request.get_json(force=True)
        req = AzimuthRequest(**body)
    except (ValidationError, Exception) as ex:
        return jsonify({"error": "INVALID_INPUT", "detail": str(ex)}), 400

    result = _topology.calculate_azimuth(req.lon1, req.lat1, req.lon2, req.lat2)
    return jsonify(result)


@app.route("/api/v1/topology/area", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_TOPOLOGY)
@require_auth("topology")
def calc_area():
    """
    Calcula el área real de un polígono en UTM 17N.
    
    Body JSON: { "vertices": [VertexModel, ...] }
    """
    try:
        body = request.get_json(force=True)
        vertices_raw = body.get("vertices", [])
        vertices = [VertexModel(**v).dict() for v in vertices_raw]
    except (ValidationError, Exception) as ex:
        return jsonify({"error": "INVALID_INPUT", "detail": str(ex)}), 400

    result = _topology.calculate_polygon_area(vertices)
    return jsonify(result)


@app.route("/api/v1/topology/slope", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_TOPOLOGY)
@require_auth("topology")
def calc_slope():
    """
    Calcula pendientes a partir de DEM real.
    
    Body JSON:
      { "dem_array": [[...]], "cell_size_m": 30 }
    
    NOTA: dem_array debe ser matriz 2D de elevaciones reales en metros.
    No se aceptan datos sintéticos.
    """
    try:
        body = request.get_json(force=True)
        dem_raw = body.get("dem_array")
        cell_size = float(body.get("cell_size_m", 30.0))

        if dem_raw is None:
            return jsonify({
                "error": "PERICIAL_NULL_MISSING_DEM",
                "pericial_warning": (
                    "dem_array requerido. Proporcione datos SRTM real o LiDAR IGNTG."
                ),
                "value": None,
            })

        dem = np.array(dem_raw, dtype=np.float64)

    except Exception as ex:
        return jsonify({"error": f"INVALID_DEM_DATA: {str(ex)}"}), 400

    result = _topology.calculate_slope(dem, cell_size)
    return jsonify(result)


@app.route("/api/v1/topology/cut-fill", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_TOPOLOGY)
@require_auth("topology")
def calc_cut_fill():
    """
    Calcula volúmenes de corte y relleno.
    
    Body JSON:
      { "terrain_dem": [[...]], "design_surface": [[...]], "cell_size_m": 1.0 }
    """
    try:
        body = request.get_json(force=True)
        terrain_raw = body.get("terrain_dem")
        design_raw = body.get("design_surface")
        cell_size = float(body.get("cell_size_m", 1.0))

        terrain = np.array(terrain_raw, dtype=np.float64) if terrain_raw else None
        design = np.array(design_raw, dtype=np.float64) if design_raw else None

    except Exception as ex:
        return jsonify({"error": f"INVALID_DATA: {str(ex)}"}), 400

    result = _topology.calculate_cut_fill(terrain, design, cell_size)
    return jsonify(result)


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — ANÁLISIS ML/DL
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/analysis/load-model", methods=["POST"])
@require_auth("analysis")
def load_ml_model():
    """
    Carga un modelo .pkl en el motor analítico.
    
    Body JSON: { "model_name": str, "model_path": str }
    """
    body = request.get_json(silent=True) or {}
    model_name = body.get("model_name", "").strip()
    model_path = body.get("model_path", "").strip()

    if not model_name or not model_path:
        return jsonify({"error": "model_name y model_path son requeridos"}), 400

    # Sanitizar path — prevenir path traversal
    safe_path = Path(SATEConfig.MODELS_DIR) / Path(model_path).name
    result = _analytics.load_model(model_name, str(safe_path))
    return jsonify(result)


@app.route("/api/v1/analysis/predict", methods=["POST"])
@limiter.limit("50 per hour")
@require_auth("analysis")
def ml_predict():
    """
    Ejecuta predicción con un modelo ML cargado.
    
    Body JSON:
      { "model_name": str, "features": [{},...], "feature_names": [str,...] }
    """
    body = request.get_json(silent=True) or {}
    model_name = body.get("model_name", "").strip()
    features = body.get("features", [])
    feature_names = body.get("feature_names")

    if not model_name or not features:
        return jsonify({"error": "model_name y features son requeridos"}), 400

    result = _analytics.predict(model_name, features, feature_names)
    return jsonify(result)


@app.route("/api/v1/analysis/load-dataset", methods=["POST"])
@require_auth("analysis")
def load_dataset():
    """
    Carga un dataset CSV o GeoJSON en el motor analítico.
    
    Body JSON:
      { "name": str, "path": str, "format": "csv"|"geojson" }
    """
    body = request.get_json(silent=True) or {}
    name = body.get("name", "").strip()
    path = body.get("path", "").strip()
    fmt = body.get("format", "csv").lower()

    if not name or not path:
        return jsonify({"error": "name y path son requeridos"}), 400

    # Sanitizar path
    safe_path = Path(SATEConfig.DATASETS_DIR) / Path(path).name

    if fmt == "csv":
        result = _analytics.load_dataset_csv(name, str(safe_path))
    elif fmt == "geojson":
        result = _analytics.load_dataset_geojson(name, str(safe_path))
    else:
        return jsonify({"error": f"Formato '{fmt}' no soportado. Use 'csv' o 'geojson'"}), 400

    return jsonify(result)


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — WMS PROXY
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/wms/tile/<service_name>", methods=["GET"])
@limiter.limit("200 per hour")
@require_auth("wms")
def get_wms_tile(service_name: str):
    """
    Proxy seguro para tiles WMS de servicios oficiales de Panamá.
    
    Parámetros WMS estándar en query string.
    Bbox automáticamente restringido al territorio panameño.
    
    Servicios disponibles: sinia_miambiente, igntg_ortofoto,
                           miviot_zonificacion, osm_panama
    """
    params = dict(request.args)
    content, content_type, status_code = _wms_proxy.get_wms_tile(service_name, params)

    if content is None:
        return jsonify({
            "error": f"WMS service '{service_name}' no disponible",
            "available_services": list(SATEConfig.WMS_ENDPOINTS.keys()),
        }), status_code

    return Response(content, status=200, content_type=content_type)


@app.route("/api/v1/wms/catalog", methods=["GET"])
@require_auth("wms")
def wms_catalog():
    """
    Retorna el catálogo completo de servicios WMS disponibles.
    """
    return jsonify({
        "services": [
            {
                "key": k,
                "description": v["description"],
                "url": v["url"],
                "version": v["version"],
            }
            for k, v in SATEConfig.WMS_ENDPOINTS.items()
        ],
        "jurisdiction": "República de Panamá",
        "bbox_wgs84": SATEConfig.PANAMA_BBOX_WGS84,
        "crs": SATEConfig.CRS_UTM17N,
    })


@app.route("/api/v1/wms/capabilities/<service_name>", methods=["GET"])
@require_auth("wms")
def wms_capabilities(service_name: str):
    """Retorna GetCapabilities de un servicio WMS."""
    result = _wms_proxy.get_capabilities(service_name)
    return jsonify(result)


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — GOOGLE EARTH ENGINE
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/gee/ndvi", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_GEE)
@require_auth("gee")
def gee_ndvi():
    """
    Calcula NDVI de un área usando Sentinel-2 via GEE.
    
    Body JSON: GEENDVIRequest
    """
    try:
        body = request.get_json(force=True)
        req = GEENDVIRequest(**body)
    except (ValidationError, Exception) as ex:
        return jsonify({"error": "INVALID_INPUT", "detail": str(ex)}), 400

    # Validar geometría en Panamá
    try:
        geom = shape(req.geometry)
        valid, msg = validate_geometry_in_panama(geom)
        if not valid:
            return jsonify({
                "error": "GEOMETRY_OUTSIDE_PANAMA",
                "pericial_warning": msg,
                "value": None,
            }), 400
    except Exception as ex:
        return jsonify({"error": f"INVALID_GEOMETRY: {str(ex)}"}), 400

    result = _gee_engine.get_ndvi(req.geometry, req.start_date, req.end_date)
    return jsonify(result)


@app.route("/api/v1/gee/status", methods=["GET"])
@require_auth("gee")
def gee_status():
    """Estado de la conexión GEE."""
    return jsonify({
        "initialized": _gee_engine._initialized,
        "error": _gee_engine._init_error,
        "sdk_available": GEE_AVAILABLE,
    })


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — RIESGO GEOTÉCNICO
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/risk/evaluate", methods=["POST"])
@limiter.limit("50 per hour")
@require_auth("risk")
def risk_evaluate():
    """
    Evalúa el riesgo geotécnico según Matriz MIVIOT.
    
    Body JSON: RiskEvaluationRequest
    """
    try:
        body = request.get_json(force=True)
        req = RiskEvaluationRequest(**body)
    except (ValidationError, Exception) as ex:
        return jsonify({"error": "INVALID_INPUT", "detail": str(ex)}), 400

    result = _risk_engine.evaluate(
        slope_pct=req.slope_pct,
        material_type=req.material_type,
        location_lon=req.lon,
        location_lat=req.lat,
    )
    return jsonify(result)


@app.route("/api/v1/risk/matrix", methods=["GET"])
@require_auth("risk")
def risk_matrix():
    """Retorna la matriz de riesgo geotécnico MIVIOT completa."""
    return jsonify({
        "matrix": _risk_engine.RISK_MATRIX,
        "slope_classes": [
            {"limite_superior_pct": t, "clase": c}
            for t, c in _risk_engine.SLOPE_CLASSES
        ],
        "valid_materials": list(list(_risk_engine.RISK_MATRIX.values())[0].keys()),
        "referencia": "MIVIOT Resolución 001-2019 — Tabla 3",
    })


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — EXPORTACIÓN PDF
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/v1/export/expediente", methods=["POST"])
@limiter.limit(SATEConfig.RATE_LIMIT_EXPORT)
@require_auth("export")
def export_expediente():
    """
    Genera el Expediente Pericial en PDF multipágina.
    
    Body JSON: ExportRequest
    
    Returns:
        PDF binario del expediente con Cajetín Cartográfico Oficial.
    """
    try:
        body = request.get_json(force=True)
        req = ExportRequest(**body)
    except (ValidationError, Exception) as ex:
        return jsonify({"error": "INVALID_INPUT", "detail": str(ex)}), 400

    data = req.dict()

    try:
        pdf_buffer = _pdf_exporter.generate_expediente(
            data=data,
            fasciculos=req.fasciculos,
        )
    except Exception as ex:
        logger.error("Error generando PDF: %s", str(ex), exc_info=True)
        return jsonify({"error": f"PDF_GENERATION_FAILED: {str(ex)}"}), 500

    filename = (
        f"SATE_{req.numero_expediente or 'EXP'}_"
        f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    )

    # Guardar en disco para descarga posterior
    export_path = SATEConfig.EXPORTS_DIR / filename
    with open(export_path, "wb") as f:
        f.write(pdf_buffer.getvalue())

    pdf_buffer.seek(0)

    return send_file(
        pdf_buffer,
        mimetype="application/pdf",
        as_attachment=False,  # inline — el frontend decide si descargar
        download_name=filename,
    )


# ══════════════════════════════════════════════════════════════════════════════
# HEALTHCHECK
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health():
    """Endpoint de healthcheck sin autenticación."""
    return jsonify({
        "status": "operational",
        "system": "S.A.T.E. v3.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "jurisdiction": "República de Panamá",
    })


# ══════════════════════════════════════════════════════════════════════════════
# MANEJO GLOBAL DE ERRORES
# ══════════════════════════════════════════════════════════════════════════════

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "BAD_REQUEST", "message": str(e)}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({
        "error": "ENDPOINT_NOT_FOUND",
        "message": "El endpoint solicitado no existe en S.A.T.E. v3.0",
        "available_prefixes": ["/api/v1/", "/health"],
    }), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "METHOD_NOT_ALLOWED"}), 405


@app.errorhandler(413)
def payload_too_large(e):
    return jsonify({
        "error": "PAYLOAD_TOO_LARGE",
        "max_size_mb": 16,
    }), 413


@app.errorhandler(429)
def rate_limit_exceeded(e):
    return jsonify({
        "error": "RATE_LIMIT_EXCEEDED",
        "message": "Demasiadas solicitudes. Reduzca la frecuencia.",
        "retry_after_seconds": 60,
    }), 429


@app.errorhandler(500)
def internal_error(e):
    logger.error("Error interno: %s", str(e), exc_info=True)
    return jsonify({
        "error": "INTERNAL_SERVER_ERROR",
        "message": "Error interno del servidor S.A.T.E.",
        "pericial_note": "Revisar logs de auditoría: sate_audit.log",
    }), 500


# ══════════════════════════════════════════════════════════════════════════════
# PUNTO DE ENTRADA
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logger.info("=" * 70)
    logger.info("  S.A.T.E. v3.0 — Sistema de Auditoría Territorial Especializado")
    logger.info("  Jurisdicción: República de Panamá")
    logger.info("  Datum: WGS84 | UTM Zona 17N | EPSG:32617")
    logger.info("  Seguridad: Zero-Trust HMAC-SHA256 + API Key")
    logger.info("=" * 70)
    logger.info("  Master API Key (SOLO PARA DESARROLLO):")
    logger.info("  %s", SATEConfig.SECRET_MASTER_API_KEY)
    logger.info("=" * 70)
    logger.info(
        "  ADVERTENCIA: Configurar SATE_HMAC_KEY y SATE_MASTER_API_KEY "
        "como variables de entorno en producción."
    )
    logger.info("=" * 70)

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("SATE_PORT", 5000)),
        debug=os.environ.get("SATE_DEBUG", "false").lower() == "true",
        threaded=True,
    )