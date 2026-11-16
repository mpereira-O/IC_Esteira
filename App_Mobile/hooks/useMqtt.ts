import { Client, Message } from "paho-mqtt";
import { useEffect, useState } from "react";

type LogEntry = { time: string; value: string };

const MQTT_BROKER = process.env.EXPO_PUBLIC_MQTT_BROKER ?? "";
const MQTT_PORT = Number(process.env.EXPO_PUBLIC_MQTT_PORT ?? 8884);
const MQTT_USER = process.env.EXPO_PUBLIC_MQTT_USER ?? "";
const MQTT_PASS = process.env.EXPO_PUBLIC_MQTT_PASS ?? "";

export function informacoesMqtt(
  topicoPadraoReceber: string = "dados/camera",
  topicoPadraoEnviar: string = "dados/app"
) {
  const [client, setClient] = useState<Client | null>(null);
  const [message, setMessage] = useState("");
  const [estado, setEstado] = useState(0);
  const [ligarDesligarEstado, setLigarDesligarEstado] = useState("Ligar");

  // 1. Contadores para as peças por cor/formato
  const [amarelo, setAmarelo] = useState(0); // 2x2
  const [roxo, setRoxo] = useState(0); // 2x2
  const [verde, setVerde] = useState(0); // 1x2
  const [branco, setBranco] = useState(0); // 1x2

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ultimaMsg, setUltimaMsg] = useState("");
  const [topicoMsgReceber, setTopicoMsgReceber] = useState(topicoPadraoReceber);
  const [topicoMsgEnviar, setTopicoMsgEnviar] = useState(topicoPadraoEnviar);

  useEffect(() => {
    let active = true;
    let mqttClient: Client | null = null;

    const connectMqtt = () => {
      if (!MQTT_BROKER || !MQTT_USER || !MQTT_PASS) {
        console.error(
          "❌ Credenciais MQTT não encontradas. Verifique o arquivo .env (EXPO_PUBLIC_MQTT_*)."
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      const clientId = "expo_" + Math.random().toString(16).substring(2, 10);

      mqttClient = new Client(MQTT_BROKER, MQTT_PORT, clientId);

      mqttClient.connect({
        useSSL: true,
        userName: MQTT_USER,
        password: MQTT_PASS,
        onSuccess: () => {
          if (!active || !mqttClient) return;

          console.log(`✅ Conectado ao MQTT! Escutando: ${topicoMsgReceber}`);
          mqttClient.subscribe(topicoMsgReceber);
          setClient(mqttClient);
          setLoading(false);
        },
        onFailure: (err) => {
          console.error("❌ Erro de Conexão MQTT:", err);
          if (active) setLoading(false);
        }
      });

      mqttClient.onConnectionLost = (responseObject) => {
        if (responseObject.errorCode !== 0) {
          console.warn(
            "⚠️ Conexão perdida com o broker:",
            responseObject.errorMessage
          );
        }
        if (active) setClient(null);
      };

      // 2. Processamento das mensagens de detecção do YOLO
      mqttClient.onMessageArrived = (msg: Message) => {
        if (!active) return;
        const p = msg.payloadString ?? "";
        const time = new Date().toLocaleString();

        // Trata e normaliza o payload vindo da IA/Python
        const payloadFormatado = p.trim().toLowerCase();

        const UlrOuIp =
          payloadFormatado.startsWith("http://") ||
          payloadFormatado.startsWith("https://") ||
          payloadFormatado.includes("stream");
        if (UlrOuIp || !payloadFormatado) {
          return; // Ignora mensagens que são URLs, IPs ou vazias
        }

        // Registra a mensagem no estado e nos logs
        setMessage(p);
        setLogs((prev) => [...prev, { time, value: p }]);
        setUltimaMsg(p);

        // Contador de peça por cor
        // Peças 2x2
        if (payloadFormatado === "2x2_amarelo") {
          setAmarelo((v) => v + 1);
        } else if (payloadFormatado === "2x2_roxo") {
          setRoxo((v) => v + 1);
        }
        // Peças 1x2
        else if (payloadFormatado === "1x2_verde") {
          setVerde((v) => v + 1);
        } else if (payloadFormatado === "1x2_branco") {
          setBranco((v) => v + 1);
        }
      };
    };

    connectMqtt();

    return () => {
      active = false;
      if (mqttClient && mqttClient.isConnected()) {
        console.log("🔌 Desconectando cliente antigo...");
        mqttClient.disconnect();
      }
      setClient(null);
    };
  }, [topicoMsgReceber]);

  const alterarEstadoEsteira = () => {
    if (!client || !client.isConnected()) {
      console.warn(
        "⚠️ Comando não enviado: O cliente MQTT não está conectado ainda."
      );
      return;
    }

    setLigarDesligarEstado("Aguarde...");

    const novaMensagem = estado === 1 ? "0" : "1";
    const novoEstado = estado === 1 ? 0 : 1;
    const novoTextoBotao = estado === 1 ? "Ligar" : "Desligar";

    try {
      const msg = new Message(novaMensagem);
      msg.destinationName = topicoMsgEnviar;
      client.send(msg);

      setTimeout(() => {
        setEstado(novoEstado);
        setLigarDesligarEstado(novoTextoBotao);
      }, 500);
    } catch (error) {
      console.error("Erro ao enviar mensagem do motor:", error);
      setLigarDesligarEstado(estado === 1 ? "Desligar" : "Ligar");
    }
  };

  // Reset de contadores para as cores atuais
  const refreshCor = () => {
    if (!client || !client.isConnected()) {
      console.warn("⚠️ Refresh de cor cancelado: Cliente MQTT desconectado.");
      return;
    }

    setAmarelo(0);
    setRoxo(0);
    setVerde(0);
    setBranco(0);

    try {
      const msg = new Message("Cor:Refresh");
      msg.destinationName = topicoMsgEnviar;
      client.send(msg);
    } catch (error) {
      console.error("Erro ao enviar refresh de cor:", error);
    }
  };

  const ngrokRefresh = () => {
    // Lógica futura se necessária
  };

  // 3. Retorno atualizado para o Index.tsx
  return {
    loading,
    estado,
    ligarDesligarEstado,
    amarelo,
    roxo,
    verde,
    branco,
    logs,
    ultimaMsg,
    client,
    alterarEstadoEsteira,
    refreshCor,
    setTopicoMsgEnviar,
    setTopicoMsgReceber,
    ngrokRefresh
  };
}
