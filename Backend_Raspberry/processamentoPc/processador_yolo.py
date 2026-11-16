import os 

# ============================== 
# CABEÇALHO PARA NGROK / OPENCV 
# ============================== 
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "headers;ngrok-skip-browser-warning: true\r\n" 

import cv2 
import ssl 
import time 
import threading 
import paho.mqtt.client as mqtt 
from ultralytics import YOLO 
from flask import Flask, Response, jsonify 
from flask_cors import CORS 
import numpy as np
import requests

# ==============================
# CONFIGURAÇÕES DE REDE & STREAM
# ==============================
URL_STREAM_RASPBERRY = os.getenv(
    "RASPBERRY_STREAM_URL", "http://10.42.0.10:5001/stream_puro"
)

# ==============================
# CONFIGURAÇÕES MQTT
# ==============================
CONEXAO_MQTT = os.getenv("MQTT_BROKER")
PORTA_MQTT = int(os.getenv("MQTT_PORT", 8884))
USUARIO_MQTT = os.getenv("MQTT_USER")
SENHA_MQTT = os.getenv("MQTT_PASS")

TOPICO_DADOS_CAMERA = os.getenv("MQTT_TOPIC_CAMERA", "dados/camera")
TOPICO_SOLICITAR_IP = os.getenv("MQTT_TOPIC_IP", "dados/solicitar_ip")
TOPICO_CONTROLE_APP = os.getenv("MQTT_TOPIC_APP", "dados/app")

# ==============================
# PARÂMETROS DE INFERÊNCIA (YOLO)
# ==============================
CAMINHO_MODELO = os.getenv("YOLO_MODEL_PATH", "def.pt")
CONFIANCA_YOLO = float(os.getenv("YOLO_CONFIDENCE", 0.50))
IOU_YOLO = float(os.getenv("YOLO_IOU", 0.45))

# Linha Virtual de Contagem (Eixo Y em pixels no frame 480x360)
POSICAO_LINHA_Y = 180  
MARGEM_TOLERANCIA_PX = 15  

frame_processado_ia = None 
trava_frame = threading.Lock() 

# Conjunto de IDs já contabilizados para evitar duplicidade
ids_contados = set()

# ==========================================================
# CLAHE ORIGINAL DO TREINAMENTO (LAB + ClipLimit 2.0 + Grid 8x8)
# ==========================================================
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)) 

app = Flask(__name__) 
CORS(app) 

def aplicar_clahe_original(frame): 
    try: 
        # Pré-processamento exatamente igual ao usado durante o treino do dataset
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB) 
        l, a, b = cv2.split(lab) 
        l_clahe = clahe.apply(l) 
        lab_merge = cv2.merge((l_clahe, a, b)) 
        return cv2.cvtColor(lab_merge, cv2.COLOR_LAB2BGR) 
    except Exception: 
        return frame 

# ============================== 
# MQTT CALLBACKS NO NOTEBOOK 
# ============================== 
def ao_receber_mensagem(cliente, userdata, msg): 
    topico = msg.topic 
    payload = msg.payload.decode('utf-8', errors='ignore')

    print(f"[MQTT Notebook] Mensagem recebida no tópico '{topico}': {payload}")
    
    if topico == TOPICO_SOLICITAR_IP: 
        ip_video = "http://186.217.113.168:5002"
        print(f"[MQTT Notebook] Solicitação de IP recebida! Respondendo com: {ip_video}") 
        cliente.publish(TOPICO_ENVIAR_IP_APP, ip_video, qos=1) 

def ao_conectar(cliente, userdata, flags, rc, reason_code=None): 
    sucesso = (rc == 0) if isinstance(rc, int) else (rc.is_failure == False if hasattr(rc, 'is_failure') else True)
    if sucesso: 
        print("[MQTT Notebook] ✓ Conectado ao Broker Cloud!") 
        cliente.subscribe(TOPICO_SOLICITAR_IP, qos=1) 
    else:
        print(f"[MQTT Notebook] ❌ Falha na conexão ao Broker Cloud! Código: {rc}, Motivo: {reason_code}")

cliente_mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="yolo_processor_notebook") 
cliente_mqtt.username_pw_set(USUARIO_MQTT, SENHA_MQTT) 
cliente_mqtt.tls_set(cert_reqs=ssl.CERT_NONE, tls_version=ssl.PROTOCOL_TLS) 
cliente_mqtt.tls_insecure_set(True) 

cliente_mqtt.on_connect = ao_conectar 
cliente_mqtt.on_message = ao_receber_mensagem 

cliente_mqtt.connect(CONEXAO_MQTT, PORTA_MQTT, keepalive=60) 
cliente_mqtt.loop_start() 

#=============================
# THREAD LEITORA DE STREAM
#================================
class LeitorStream:
    def __init__(self, url):
        self.url = url
        self.frame_atual = None
        self.rodando = False
        self.lock = threading.Lock()

    def iniciar(self):
        self.rodando = True
        threading.Thread(target=self._atualizar_frames, daemon=True).start()

    def _atualizar_frames(self):
        headers = {"ngrok-skip-browser-warning": "true"}
        while self.rodando:
            try:
                stream = requests.get(self.url, stream=True, headers=headers, timeout=None)
                bytes_data = b""

                for chunk in stream.iter_content(chunk_size=4096):
                    if not self.rodando:
                        break
                    bytes_data += chunk
                    
                    a = bytes_data.find(b"\xff\xd8")
                    b = bytes_data.find(b"\xff\xd9")

                    if a != -1 and b != -1:
                        jpg = bytes_data[a:b+2]
                        bytes_data = bytes_data[b+2:]

                        frame = cv2.imdecode(np.frombuffer(jpg, dtype=np.uint8), cv2.IMREAD_COLOR)
                        if frame is not None:
                            with self.lock:
                                self.frame_atual = frame
            except Exception as e:
                print(f"[IA Stream] Conexão pendente/Erro ({e}). Tentando novamente...")
                time.sleep(1)

    def ler_frame(self):
        with self.lock:
            return None if self.frame_atual is None else self.frame_atual.copy()


# ============================== 
# LOOP DA IA 
# ============================== 
def loop_processamento_ia(): 
    global frame_processado_ia, ids_contados 
      
    print(f"[IA] Carregando modelo YOLOv8 ({CAMINHO_MODELO})...") 
    modelo = YOLO(CAMINHO_MODELO) 
    
    # Inicia a Thread que puxa os frames continuamente
    leitor = LeitorStream(URL_STREAM_RASPBERRY)
    leitor.iniciar()

    print(f"[IA] Conectado e aguardando frames de: {URL_STREAM_RASPBERRY}")

    while True: 
        frame = leitor.ler_frame()

        if frame is None:
            time.sleep(0.01)
            continue

        # Interpolação e CLAHE
        frame_pequeno = cv2.resize(frame, (480, 360), interpolation=cv2.INTER_LINEAR) 
        frame_clahe = aplicar_clahe_original(frame_pequeno) 

        # YOLO Tracking
        resultados = modelo.track( 
            source=frame_clahe,  
            conf=CONFIANCA_YOLO,  
            iou=IOU_YOLO,  
            imgsz=320,  
            persist=True,
            tracker="bytetrack.yaml",
            verbose=False, 
            device='0' if cv2.cuda.getCudaEnabledDeviceCount() > 0 else 'cpu'
        ) 
          
        frame_anotado = resultados[0].plot() 
        cv2.line(frame_anotado, (0, POSICAO_LINHA_Y), (480, POSICAO_LINHA_Y), (0, 165, 255), 2)

        # Lógica de contagem na linha
        if resultados[0].boxes is not None and resultados[0].boxes.id is not None:
            boxes = resultados[0].boxes.xyxy.cpu().numpy()
            ids = resultados[0].boxes.id.cpu().numpy().astype(int)
            clss = resultados[0].boxes.cls.cpu().numpy().astype(int)

            for box, obj_id, cls in zip(boxes, ids, clss):
                x1, y1, x2, y2 = box
                centro_y = int((y1 + y2) / 2)
                nome_classe = modelo.names[cls]

                if abs(centro_y - POSICAO_LINHA_Y) < MARGEM_TOLERANCIA_PX:
                    if obj_id not in ids_contados:
                        print(f"[MQTT] 🎯 Peça ID #{obj_id} cruzou a linha -> Enviando: {nome_classe}")
                        cliente_mqtt.publish(TOPICO_DADOS_CAMERA, nome_classe, qos=1) 
                        ids_contados.add(obj_id)

            if len(ids_contados) > 200:
                ids_contados.clear()

        with trava_frame: 
            frame_processado_ia = frame_anotado
# ============================== 
# ROTAS FLASK 
# ============================== 
@app.route("/") 
def index(): 
    status = "🟢 OK (Recebendo frames da IA)" if frame_processado_ia is not None else "🔴 Aguardando transmissão..." 
    return f"<h2>Status da IA: {status}</h2><p><a href='/camera_ia'>Ver Vídeo</a></p>" 

@app.route("/camera_ia") 
def camera_ia(): 
    def gerar(): 
        while True: 
            frame_local = None 
            with trava_frame: 
                if frame_processado_ia is not None: 
                    frame_local = frame_processado_ia.copy() 

            if frame_local is None: 
                time.sleep(0.01) 
                continue 

            sucesso, buffer = cv2.imencode('.jpg', frame_local, [cv2.IMWRITE_JPEG_QUALITY, 50]) 
              
            if sucesso: 
                yield (b'--frame\r\n' 
                       b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n') 
              
            time.sleep(0.015) 

    resp = Response(gerar(), mimetype='multipart/x-mixed-replace; boundary=frame') 
    resp.headers['ngrok-skip-browser-warning'] = 'true' 
    return resp 

@app.route("/camera_ia/capture") 
def capture(): 
    with trava_frame: 
        if frame_processado_ia is None: 
            return jsonify({"erro": "Nenhum frame disponível"}), 500 
          
        _, buffer = cv2.imencode('.jpg', frame_processado_ia, [cv2.IMWRITE_JPEG_QUALITY, 80]) 
          
        resp = Response(buffer.tobytes(), mimetype='image/jpeg') 
        resp.headers['ngrok-skip-browser-warning'] = 'true' 
        return resp 

# ============================== 
# START DO SISTEMA 
# ============================== 
if __name__ == "__main__": 
    threading.Thread(target=loop_processamento_ia, daemon=True).start() 
      
    print("🚀 Servidor Web da IA ativo na porta 5002...") 
    app.run(host="0.0.0.0", port=5002, debug=False, use_reloader=False, threaded=True)