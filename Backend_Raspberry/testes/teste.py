import cv2
from ultralytics import YOLO

# 1. Carrega o seu modelo de Lego (garanta que o arquivo 'best.pt' correto está nesta pasta)
model = YOLO('best.pt') 

# 2. Configura a captura da câmera (0 = webcam padrão / Raspberry Pi)
cap = cv2.VideoCapture(0)

# Garante estabilidade definindo a resolução nativa da câmera
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

print("Rodando detecção contínua. Pressione 'q' na janela do vídeo para sair.")

# 3. O loop principal força a leitura da câmera frame por frame
while cap.isOpened():
    success, frame = cap.read()
    
    # Se a câmera falhar em pegar um frame específico, o código pula para o próximo
    if not success:
        continue 
        
    # Executa a previsão no frame atual
    # AJUSTADO: conf mudado para 0.15 para o YOLO não ser tímido na câmera em tempo real!
    results = model.predict(source=frame, stream=True, conf=0.20, imgsz=800)

    # Extrai o resultado do gerador
    for r in results:
        # Desenha as caixas se houver detecção
        annotated_frame = r.plot()
        
    # Exibe a imagem na tela com os quadrados das detecções
    cv2.imshow("Deteccao de Lego - OpenCV", annotated_frame)
    
    # Mantém a janela aberta e verifica se o usuário apertou 'q' para fechar
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Libera os recursos do sistema ao sair
cap.release()
cv2.destroyAllWindows()
