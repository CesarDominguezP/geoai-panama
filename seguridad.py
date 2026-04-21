import hashlib
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Esto permite que tu mapa hable con Python

def generar_sello_digital(lat, lng, res):
    datos = f"{lat}|{lng}|{res}"
    return hashlib.sha256(datos.encode()).hexdigest()

@app.route('/analizar', methods=['POST'])
def analizar_terreno():
    # Recibimos los datos del mapa
    data = request.json
    lat = data.get('lat')
    lng = data.get('lng')
    
    # Aquí simulamos el resultado de la IA por ahora
    resultado_simulado = "Zona de Reserva - Sin Alertas"
    
    # Generamos el blindaje
    sello = generar_sello_digital(lat, lng, resultado_simulado)
    
    # Devolvemos la respuesta al mapa
    return jsonify({
        "lat": lat,
        "lng": lng,
        "resultado": resultado_simulado,
        "hash": sello
    })

if __name__ == '__main__':
    print("--- Servidor GeoAI Iniciado ---")
    app.run(port=5000, debug=True)