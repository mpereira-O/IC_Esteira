import MqttPainel from "@/components/mqttPainel";
import { informacoesMqtt } from "@/hooks/useMqtt";
import useGeneratePdf from "@/hooks/usePdf";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Message } from "paho-mqtt";

type SavedImage = {
  id: string;
  uri: string;
  timestamp: number;
  type: "editor" | "camera";
  specs?: {
    serialNumber: string;
    category: string;
    specifications: string;
    problems: string;
    captureTime: string;
  };
};

export default function Index() {
  const PADRAO_IP = "http://186.217.113.168:5002";

  const [ip, setIp] = useState(PADRAO_IP);
  const [start, setStart] = useState(false);
  const [solicitandoIp, setSolicitandoIp] = useState(false);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [capturedImageUri, setCapturedImageUri] = useState<string>("");
  const [capturandoImagem, setCapturandoImagem] = useState(false);

  const [serialNumber, setSerialNumber] = useState("");
  const [category, setCategory] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [problems, setProblems] = useState("");

  const isWeb = Platform.OS === "web";

  // Hook MQTT ajustado sem o corndef
  const {
    loading,
    estado,
    ligarDesligarEstado,
    amarelo,
    roxo,
    verde,
    branco,
    logs,
    alterarEstadoEsteira,
    client,
  } = informacoesMqtt();

  // Hook do PDF ajustado sem o corndef
  const { gerarPdf, loading: pdfLoading } = useGeneratePdf(
    logs,
    amarelo,
    roxo,
    verde,
    branco,
  );

  const formatarIp = (ipInput: string) => {
    let formatted = ipInput.trim();
    if (!formatted.startsWith("http://") && !formatted.startsWith("https://")) {
      formatted = "http://" + formatted;
    }
    return formatted;
  };

  const solicitarIpViaMqtt = () => {
    console.log("[App MQTT] Botão clicado. Verificando estado do cliente...");

    if (!client || !client.isConnected()) {
      console.log("[App MQTT] Cliente não está conectado no momento.");
      Alert.alert(
        "Erro de Conexão",
        "MQTT não está conectado ao servidor HiveMQ. Aguarde alguns segundos e tente novamente.",
      );
      return;
    }

    setSolicitandoIp(true);
    const ENVIAR_IP_TOPIC = "dados/enviar_ip";
    const SOLICITAR_IP_TOPIC = "dados/solicitar_ip";

    let timeoutId: NodeJS.Timeout;

    const cleanup = () => {
      try {
        if (client && client.isConnected()) {
          client.unsubscribe(ENVIAR_IP_TOPIC);
        }
      } catch (e) {
        console.log("[App MQTT] Erro no cleanup:", e);
      }
    };

    // Salva o handler original de mensagens da esteira
    const handlerOriginal = client.onMessageArrived;

    client.onMessageArrived = (msg: Message) => {
      console.log(
        `[App MQTT] Mensagem recebida no tópico: ${msg.destinationName}`,
      );

      // Executa o handler padrão para não interromper a contagem das peças
      if (handlerOriginal) handlerOriginal(msg);

      if (msg.destinationName === ENVIAR_IP_TOPIC) {
        clearTimeout(timeoutId);
        const payloadRaw = msg.payloadString ?? "";
        console.log("[App MQTT] Resposta de IP recebida:", payloadRaw);

        const ipLimpo = payloadRaw.trim().replace(/^['"]|['"]$/g, "");

        if (!ipLimpo) {
          setSolicitandoIp(false);
          cleanup();
          client.onMessageArrived = handlerOriginal;
          Alert.alert("Erro", "O IP recebido via MQTT está vazio.");
          return;
        }

        const ipFinal = formatarIp(ipLimpo);
        setIp(ipFinal);
        setSolicitandoIp(false);
        cleanup();
        client.onMessageArrived = handlerOriginal;

        Alert.alert(
          "Sucesso!",
          `Endereço IP configurado automaticamente:\n\n${ipFinal}`,
          [{ text: "OK" }],
        );
      }
    };

    console.log(
      `[App MQTT] Inscrevendo no tópico de retorno: ${ENVIAR_IP_TOPIC}...`,
    );

    client.subscribe(ENVIAR_IP_TOPIC, {
      qos: 1,
      onSuccess: () => {
        console.log(
          `[App MQTT] Subscrito em ${ENVIAR_IP_TOPIC}. Publicando em ${SOLICITAR_IP_TOPIC}...`,
        );
        try {
          const mensagemReq = new Message("request_ip");
          mensagemReq.destinationName = SOLICITAR_IP_TOPIC;
          mensagemReq.qos = 1;
          client.send(mensagemReq);
          console.log("[App MQTT] Solicitação enviada com sucesso ao Broker!");
        } catch (err) {
          console.error("[App MQTT] Erro ao enviar solicitação:", err);
          setSolicitandoIp(false);
          cleanup();
          client.onMessageArrived = handlerOriginal;
          Alert.alert("Erro", "Falha ao publicar a solicitação no MQTT.");
        }
      },
      onFailure: (err) => {
        console.error(
          "[App MQTT] Falha ao inscrever no tópico de retorno:",
          err,
        );
        setSolicitandoIp(false);
        client.onMessageArrived = handlerOriginal;
        Alert.alert("Erro", "Não foi possível se inscrever no tópico MQTT.");
      },
    });

    timeoutId = setTimeout(() => {
      console.warn("[App MQTT] TIMEOUT de 12 segundos atingido!");
      setSolicitandoIp(false);
      cleanup();
      client.onMessageArrived = handlerOriginal;

      Alert.alert(
        "Timeout",
        "Não foi possível obter o IP automaticamente.\n\nVerifique se o terminal do Python recebeu a mensagem.",
      );
    }, 12000);
  };

  const conectarCamera = () => {
    if (!ip) {
      Alert.alert("Erro", "Digite um endereço IP válido");
      return;
    }
    const ipFormatado = formatarIp(ip);
    setIp(ipFormatado);
    setStart(true);
  };

  const captureImage = async () => {
    try {
      setCapturandoImagem(true);
      const timestamp = Date.now();
      const captureUrl = `${ip}/camera_ia/capture?t=${timestamp}`;

      const response = await fetch(captureUrl, {
        method: "GET",
        headers: {
          Accept: "image/jpeg, image/png, image/*",
        },
      });

      if (!response.ok) {
        throw new Error(`Erro HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error("Imagem vazia recebida do servidor");
      }

      const reader = new FileReader();

      reader.onload = () => {
        const base64String = reader.result as string;
        setCapturedImageUri(base64String);
        setShowSpecsModal(true);
        setCapturandoImagem(false);

        Alert.alert("Sucesso", "Imagem capturada!");
      };

      reader.onerror = () => {
        setCapturandoImagem(false);
        Alert.alert("Erro", "Falha ao processar imagem");
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("[CAMERA] Erro:", error);
      setCapturandoImagem(false);

      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert(
        "Erro ao Capturar",
        `${msg}\n\nVerifique:\n• URL: ${ip}/camera_ia/capture\n• Servidor rodando\n• Câmera conectada`,
      );
    }
  };

  const saveImageWithSpecs = async () => {
    if (!serialNumber.trim()) {
      Alert.alert("Atenção", "Por favor, preencha o número de série.");
      return;
    }

    try {
      const now = new Date();
      const captureTime = now.toLocaleString("pt-BR");

      const newImage: SavedImage = {
        id: Date.now().toString(),
        uri: capturedImageUri,
        timestamp: Date.now(),
        type: "camera",
        specs: {
          serialNumber: serialNumber.trim(),
          category: category.trim() || "Sem categoria",
          specifications: specifications.trim() || "Não especificado",
          problems: problems.trim() || "Nenhum",
          captureTime,
        },
      };

      if (Platform.OS === "web") {
        const DB_NAME = "StickerAppDB";
        const STORE_NAME = "images";

        const initDB = (): Promise<IDBDatabase> => {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
              const db = (event.target as IDBOpenDBRequest).result;
              if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
              }
            };
          });
        };

        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        await new Promise((resolve, reject) => {
          const request = store.put(newImage);
          request.onsuccess = () => resolve(undefined);
          request.onerror = () => reject(request.error);
        });
      } else {
        const stored = await AsyncStorage.getItem("saved_images");
        const images = stored ? JSON.parse(stored) : [];
        images.push(newImage);
        await AsyncStorage.setItem("saved_images", JSON.stringify(images));
      }

      setSerialNumber("");
      setCategory("");
      setSpecifications("");
      setProblems("");
      setShowSpecsModal(false);
      setCapturedImageUri("");

      Alert.alert("Sucesso", "Imagem salva na galeria!", [{ text: "OK" }]);
    } catch (error) {
      console.error("Erro ao salvar imagem:", error);
      Alert.alert("Erro", "Não foi possível salvar a imagem.");
    }
  };

  const cameraUrl = `${ip}/camera_ia`;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}
    >
      <View style={styles.container}>
        <View style={styles.mqttContainer}>
          <MqttPainel />
        </View>

        {/* CONTAINER REESTRUTURADO APENAS PARA PEÇAS 2X2 E 1X2 */}
        <View style={styles.statsContainer}>
          <Text style={styles.sectionHeaderTitle}>Peças 2x2</Text>
          <View style={styles.statsRow}>
            {/* AMARELO: Texto escuro (#212529) para dar contraste no fundo amarelo */}
            <View style={[styles.statBox, { backgroundColor: "#fbc02d" }]}>
              <Text style={[styles.statLabel, { color: "#212529" }]}>
                Amarelo
              </Text>
              <Text style={[styles.statValue, { color: "#212529" }]}>
                {amarelo ?? 0}
              </Text>
            </View>

            {/* ROXO: Texto branco (#ffffff) com valor garantido */}
            <View style={[styles.statBox, { backgroundColor: "#7b1fa2" }]}>
              <Text style={[styles.statLabel, { color: "#ffffff" }]}>Roxo</Text>
              <Text style={[styles.statValue, { color: "#ffffff" }]}>
                {roxo ?? 0}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionHeaderTitle}>Peças 1x2</Text>
          <View style={styles.statsRow}>
            {/* VERDE: Texto branco (#ffffff) */}
            <View style={[styles.statBox, { backgroundColor: "#388e3c" }]}>
              <Text style={[styles.statLabel, { color: "#ffffff" }]}>
                Verde
              </Text>
              <Text style={[styles.statValue, { color: "#ffffff" }]}>
                {verde ?? 0}
              </Text>
            </View>

            {/* BRANCO: Texto escuro (#212529) com borda para destacar */}
            <View
              style={[
                styles.statBox,
                {
                  backgroundColor: "#ffffff",
                  borderWidth: 1,
                  borderColor: "#cccccc",
                },
              ]}
            >
              <Text style={[styles.statLabel, { color: "#212529" }]}>
                Branco
              </Text>
              <Text style={[styles.statValue, { color: "#212529" }]}>
                {branco ?? 0}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.pdfButton, pdfLoading && styles.buttonDisabled]}
          onPress={gerarPdf}
          disabled={pdfLoading}
        >
          <Text style={styles.buttonText}>
            {pdfLoading ? "Gerando Relatório..." : "Gerar Relatório PDF"}
          </Text>
        </TouchableOpacity>

        {!start ? (
          <View style={styles.form}>
            <Text style={styles.title}>Configuração da Câmera</Text>

            <Text style={styles.label}>Endereço IP:</Text>
            <TextInput
              placeholder="http://192.168.2.109:5002"
              placeholderTextColor="#999"
              style={styles.input}
              value={ip}
              onChangeText={setIp}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={[
                styles.button,
                styles.connectButton,
                !ip && styles.buttonDisabled,
              ]}
              disabled={!ip}
              onPress={conectarCamera}
            >
              <Text style={styles.buttonText}>Conectar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.mqttButton,
                solicitandoIp && styles.buttonDisabled,
              ]}
              disabled={solicitandoIp}
              onPress={solicitarIpViaMqtt}
            >
              {solicitandoIp ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={[styles.buttonText, { marginLeft: 10 }]}>
                    Solicitando...
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Obter IP Automaticamente</Text>
              )}
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>Instruções:</Text>
              <Text style={styles.infoText}>
                • Digite o endereço IP do PC no formato IP:PORTA{"\n"}• Ou use a
                opção automática via MQTT{"\n"}• Certifique-se que o script YOLO
                está rodando no PC
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.streamContainer}>
            <View style={styles.streamHeader}>
              <Text style={styles.streamTitle}>
                Detecção de Peças em Tempo Real (YOLO)
              </Text>
              <Text style={styles.streamSubtitle}>{cameraUrl}</Text>
            </View>

            <View style={styles.webviewWrapper}>
              {isWeb ? (
                <iframe
                  src={cameraUrl}
                  style={styles.webviewIframe as any}
                  title="Camera Stream IA"
                />
              ) : (
                <WebView
                  source={{ uri: cameraUrl }}
                  style={styles.webview}
                  onError={() => {
                    Alert.alert(
                      "Erro de Conexão",
                      "Não foi possível conectar à câmera. Verifique a URL.",
                    );
                  }}
                />
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                styles.captureButton,
                capturandoImagem && styles.buttonDisabled,
              ]}
              onPress={captureImage}
              disabled={capturandoImagem}
            >
              <Text style={styles.buttonText}>
                {capturandoImagem ? "Capturando..." : "📸 Capturar Imagem"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.backButton]}
              onPress={() => setStart(false)}
            >
              <Text style={styles.buttonText}>Voltar</Text>
            </TouchableOpacity>
          </View>
        )}

        <Modal
          visible={showSpecsModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowSpecsModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Especificações da Imagem</Text>

              <ScrollView style={styles.modalScroll}>
                <Text style={styles.modalLabel}>Número de Série *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ex: SN-2026-001"
                  placeholderTextColor="#999"
                  value={serialNumber}
                  onChangeText={setSerialNumber}
                />

                <Text style={styles.modalLabel}>Categoria</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ex: Eletrônicos, Peças, etc."
                  placeholderTextColor="#999"
                  value={category}
                  onChangeText={setCategory}
                />

                <Text style={styles.modalLabel}>Especificações</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Descreva as especificações..."
                  placeholderTextColor="#999"
                  value={specifications}
                  onChangeText={setSpecifications}
                  multiline
                  numberOfLines={3}
                />

                <Text style={styles.modalLabel}>Problemas Identificados</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Descreva os problemas..."
                  placeholderTextColor="#999"
                  value={problems}
                  onChangeText={setProblems}
                  multiline
                  numberOfLines={3}
                />

                <Text style={styles.modalInfo}>
                  * Campos obrigatórios{"\n"}
                  Hora da captura será salva automaticamente
                </Text>
              </ScrollView>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => {
                    setShowSpecsModal(false);
                    setSerialNumber("");
                    setCategory("");
                    setSpecifications("");
                    setProblems("");
                    setCapturedImageUri("");
                  }}
                >
                  <Text style={styles.modalButtonText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={saveImageWithSpecs}
                >
                  <Text style={styles.modalButtonText}>Salvar na Galeria</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: 20,
  },
  mqttContainer: {
    width: "100%",
    maxWidth: 600,
    marginBottom: 15,
  },
  statsContainer: {
    width: "100%",
    maxWidth: 600,
    marginBottom: 15,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#37474f",
    marginBottom: 8,
    marginTop: 10,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  statBox: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 5,
  },
  statValue: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  pdfButton: {
    backgroundColor: "#2e7d32",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
    maxWidth: 600,
    marginBottom: 20,
  },
  form: {
    width: "100%",
    maxWidth: 500,
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 25,
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 20,
    color: "#212529",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 10,
    color: "#495057",
    width: "100%",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ced4da",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    width: "100%",
    marginBottom: 20,
    backgroundColor: "#ffffff",
    color: "#212529",
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    marginBottom: 12,
  },
  connectButton: {
    backgroundColor: "#1976d2",
  },
  mqttButton: {
    backgroundColor: "#0288d1",
  },
  captureButton: {
    backgroundColor: "#7b1fa2",
    marginTop: 15,
  },
  backButton: {
    backgroundColor: "#d32f2f",
    marginTop: 5,
  },
  buttonDisabled: {
    backgroundColor: "#bdbdbd",
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  infoBox: {
    backgroundColor: "#e3f2fd",
    borderRadius: 8,
    padding: 16,
    marginTop: 15,
    width: "100%",
    borderLeftWidth: 4,
    borderLeftColor: "#1976d2",
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 10,
    color: "#0d47a1",
  },
  infoText: {
    fontSize: 14,
    color: "#37474f",
    lineHeight: 22,
  },
  streamContainer: {
    width: "100%",
    maxWidth: 700,
    alignItems: "center",
  },
  streamHeader: {
    width: "100%",
    backgroundColor: "#f8f9fa",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    alignItems: "center",
  },
  streamTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#212529",
  },
  streamSubtitle: {
    fontSize: 13,
    color: "#6c757d",
  },
  webviewWrapper: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  webview: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  webviewIframe: {
    width: "100%",
    height: "100%",
    borderWidth: 0,
    borderStyle: "none",
    display: "block",
    backgroundColor: "#000",
    objectFit: "contain",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 25,
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#212529",
    marginBottom: 20,
    textAlign: "center",
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#495057",
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#ced4da",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#f8f9fa",
    color: "#212529",
  },
  modalTextArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalInfo: {
    fontSize: 12,
    color: "#6c757d",
    marginTop: 15,
    fontStyle: "italic",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  modalButtonCancel: {
    backgroundColor: "#6c757d",
  },
  modalButtonSave: {
    backgroundColor: "#2e7d32",
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
