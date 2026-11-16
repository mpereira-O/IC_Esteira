import cv2
import socket
import ssl
import threading
import time
import subprocess
import requests  
from flask import Flask, Response, jsonify
from flask_cors import CORS
import paho.mqtt.client as mqtt
import random
import os

# ==============================
# CONFIGURAÇÕES MQTT & HARDWARE
# ==============================
import os
import random
from dotenv import load_dotenv

load_dotenv()

id_unico = f"rasp_camera_{random.randint(1000, 9999)}"

# Credenciais e Conexão MQTT (carregadas do .env)
CONEXAO_MQTT = os.getenv("MQTT_BROKER")
PORTA_MQTT = int(os.getenv("MQTT_PORT", 8884))
USUARIO_MQTT = os.getenv("MQTT_USER")
SENHA_MQTT = os.getenv("MQTT_PASS")

# Domínio Estático Ngrok (opcional para acesso externo)
DOMINIO_ESTATICO_NGROK = os.getenv("NGROK_STATIC_DOMAIN", "")

# Tópicos MQTT
TOPICO_DADOS_CAMERA = os.getenv("MQTT_TOPIC_CAMERA", "dados/camera")
TOPICO_SOLICITAR_IP = os.getenv("MQTT_TOPIC_IP", "dados/solicitar_ip")
TOPICO_CONTROLE_APP = os.getenv("MQTT_TOPIC_APP", "dados/app")

# Configurações de Hardware
PINO_MOTOR = int(os.getenv("GPIO_MOTOR_PIN", 17))
CAMERA_USB = int(os.getenv("USB_CAMERA_INDEX", 0))

# Monta a URL pública apenas se o domínio Ngrok estiver configurado
url_publica_estatica = (
    f"https://{DOMINIO_ESTATICO_NGROK}/stream_puro"
    if DOMINIO_ESTATICO_NGROK
    else ""
)

# ==============================
# CLASSES DE ESTADO E GPIO
# ==============================
class EstadoDoSistema:
    def __init__(self):
        self.esteira_ligada = False
        
    def atualizar_esteira(self, estado):
        self.esteira_ligada = bool(int(estado))
        print(f"[ESTADO] Esteira: {'LIGADA' if self.esteira_ligada else 'DESLIGADA'}")

class ControladorGPIO:
    def __init__(self):
        self.gpio_disponivel = False
        try:
            import RPi.GPIO as GPIO
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            self.gpio_disponivel = True
            print("[GPIO] Hardware Raspberry Pi identificado com sucesso.")
        except ImportError:
            self.gpio_disponivel = False
            print("[GPIO] RPi.GPIO não encontrado (Modo simulação).")
    
    def configurar_pino(self, pino):
        if self.gpio_disponivel:
            import RPi.GPIO as GPIO
            GPIO.setup(pino, GPIO.OUT)
    
    def escrever_pino(self, pino, valor):
        if self.gpio_disponivel:
            import RPi.GPIO as GPIO
            GPIO.output(pino, GPIO.HIGH if valor else GPIO.LOW)

estado_sistema = EstadoDoSistema()
controlador_gpio = ControladorGPIO()

# ==============================
# DISPARADOR NGROK ESTÁTICO
# ==============================
def disparar_ngrok(cliente_mqtt):
    try:
        print(f"[NGROK] Subindo túnel no domínio fixo: {DOMINIO_ESTATICO_NGROK}...")
        
        # O comando correto utiliza --domain
        subprocess.Popen([
            "ngrok", "http", 
            f"--domain={DOMINIO_ESTATICO_NGROK}", 
            "5001"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        time.sleep(3)
        
        url_fixa = f"https://{DOMINIO_ESTATICO_NGROK}/stream_puro"
        print(f"[NGROK] 🎉 Stream fixa ativa: {url_fixa}")
        
        # Publica no MQTT apenas para garantir que os clientes leiam a URL
        cliente_mqtt.publish(TOPICO_DADOS_CAMERA, url_fixa, qos=1, retain=True)

    except Exception as e:
        print(f"[NGROK] Erro ao iniciar Ngrok: {e}")

# ==============================
# MQTT CALLBACKS
# ==============================
def ao_conectar(cliente, userdata, flags, rc, properties=None):
    if rc == 0:
        print("[MQTT Rasp] ✓ Conectado ao Broker Cloud!")
        cliente.subscribe(TOPICO_SOLICITAR_IP, qos=1)
        cliente.subscribe(TOPICO_CONTROLE_APP, qos=1)
        # Sempre que reconecta ao broker, reafirma qual é a sua URL do Stream
        cliente.publish(TOPICO_DADOS_CAMERA, url_publica_estatica, qos=1, retain=True)

def ao_receber_mensagem(cliente, userdata, msg):
    topico = msg.topic
    conteudo = msg.payload.decode('utf-8').strip()
    
    print(f"[MQTT Rasp] 📩 Chegou no tópico [{topico}]: '{conteudo}'")
    
    if topico == TOPICO_SOLICITAR_IP:
        print(f"[MQTT Rasp] IP Solicitado -> Respondendo com: {url_publica_estatica}")
        cliente.publish(TOPICO_DADOS_CAMERA, url_publica_estatica, qos=1, retain=True)

    elif topico == TOPICO_CONTROLE_APP:
        if conteudo in ['0', '1']:
            estado_sistema.atualizar_esteira(conteudo)
            controlador_gpio.escrever_pino(PINO_MOTOR, estado_sistema.esteira_ligada) 
def ao_receber_mensagem(cliente, userdata, msg):
    topico = msg.topic
    conteudo = msg.payload.decode('utf-8').strip()
    
    # 🔍 PRINT DE DEBUG (Mostra QUALQUER mensagem que chegar)
    print(f"[MQTT Rasp] 📩 Mensagem recebida em [{topico}]: '{conteudo}'")
    
    if topico == TOPICO_SOLICITAR_IP:
        print(f"[MQTT Rasp] IP Solicitado -> Respondendo com: {url_publica_estatica}")
        cliente.publish(TOPICO_DADOS_CAMERA, url_publica_estatica, qos=1, retain=True)

    elif topico == TOPICO_CONTROLE_APP:
        # Aceita '1', 'ligado', 'true', 'on' (case insensitive)
        if conteudo.lower() in ['1', 'ligado', 'true', 'on']:
            print("[GPIO] 🟢 LIGANDO ESTEIRA")
            estado_sistema.atualizar_esteira('1')
            controlador_gpio.escrever_pino(PINO_MOTOR, True)

        # Aceita '0', 'desligado', 'false', 'off'
        elif conteudo.lower() in ['0', 'desligado', 'false', 'off']:
            print("[GPIO] 🔴 DESLIGANDO ESTEIRA")
            estado_sistema.atualizar_esteira('0')
            controlador_gpio.escrever_pino(PINO_MOTOR, False)
            
        else:
            print(f"[MQTT Rasp] ⚠️ Payload não reconhecido: '{conteudo}'")

 # Configuração do Cliente MQTT (API Version 2)

cliente_mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=id_unico, transport="websockets")

cliente_mqtt.username_pw_set(USUARIO_MQTT, SENHA_MQTT)

cliente_mqtt.tls_set(cert_reqs=ssl.CERT_NONE, tls_version=ssl.PROTOCOL_TLS) 
cliente_mqtt.tls_insecure_set(True)
cliente_mqtt.on_connect = ao_conectar
cliente_mqtt.on_message = ao_receber_mensagem

# Use obrigatoriamente a porta 8884 com websockets
cliente_mqtt.connect(CONEXAO_MQTT, 8884, keepalive=60)
cliente_mqtt.loop_start()

# ==============================
# SERVIDOR FLASK & CAPTURA
# ==============================
app = Flask(__name__)
CORS(app)

# Lock para evitar que múltiplas requisições acessem a câmera ao mesmo tempo
trava_camera = threading.Lock()

def inicializar_camera():
    """Cria e configura a captura usando V4L2 e MJPG nativo"""
    captura = cv2.VideoCapture(CAMERA_USB, cv2.CAP_V4L2)
    captura.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    captura.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    captura.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    return captura

# Instancia a câmera
cap = inicializar_camera()

def gerar_stream_puro():
    global cap
    while True:
        with trava_camera:
            if not cap.isOpened():
                cap.release()
                time.sleep(0.5)
                cap = inicializar_camera()
                continue

            sucesso, frame = cap.read()

        if not sucesso or frame is None:
            time.sleep(0.01)
            continue

        sucesso_encode, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
        if sucesso_encode:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        
        time.sleep(0.03) # Limita transmissão a ~30 FPS

@app.route("/stream_puro")
def stream_puro():
    resp = Response(
        gerar_stream_puro(), 
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )
    resp.headers['Cache-Control'] = 'no-cache, private'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['ngrok-skip-browser-warning'] = 'true'
    return resp
# ==============================
# INICIALIZAÇÃO
# ==============================
if __name__ == "__main__":
    # Configura pinagem
    controlador_gpio.configurar_pino(PINO_MOTOR)
    
    # Conecta no MQTT
    print("[SYSTEM] Conectando ao MQTT...")
    cliente_mqtt.connect(CONEXAO_MQTT, PORTA_MQTT, keepalive=60)
    cliente_mqtt.loop_start()

    # Dispara o serviço do Ngrok em Thread daemon
    threading.Thread(target=disparar_ngrok, args=(cliente_mqtt,), daemon=True).start()

    # Sobe o servidor web Flask na porta 5001
    print("[SYSTEM] 🚀 Servidor Flask ativo na porta 5001...")
    app.run(host="0.0.0.0", port=5001, debug=False, use_reloader=False, threaded=True)
