import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Platform } from "react-native";

export type LogEntry = { time: string; value: string };

const useGeneratePdf = (
  logs: LogEntry[],
  amarelo: number,
  roxo: number,
  verde: number,
  branco: number,
) => {
  const [loading, setLoading] = useState(false);

  const gerarPdf = async () => {
    try {
      setLoading(true);
      console.log("[PDF] Iniciando geração...");

      // 1. Filtra para remover qualquer IP, URL ou mensagem do sistema
      const logsValidos = logs.filter((log) => {
        const val = log.value.toLowerCase().trim();
        const ehUrl =
          val.startsWith("http://") ||
          val.startsWith("https://") ||
          val.includes("stream_puro");
        return !ehUrl;
      });

      // 2. Gera HTML para o PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              color: #333;
            }
            h1 {
              color: #1976d2;
              border-bottom: 3px solid #1976d2;
              padding-bottom: 10px;
              margin-bottom: 30px;
            }
            .stats {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 15px;
              margin-bottom: 40px;
            }
            .stat-box {
              padding: 15px;
              border-radius: 8px;
              color: white;
              font-weight: bold;
            }
            .stat-box.amarelo { 
              background-color: #fbc02d; 
              color: #212121;
            }
            .stat-box.roxo { background-color: #8e24aa; }
            .stat-box.verde { background-color: #43a047; }
            .stat-box.branco { 
              background-color: #ffffff; 
              color: #212121;
              border: 2px solid #e0e0e0;
            }
            .stat-label {
              font-size: 14px;
              opacity: 0.9;
            }
            .stat-value {
              font-size: 32px;
              margin-top: 5px;
            }
            h2 {
              color: #333;
              margin-top: 40px;
              margin-bottom: 20px;
              border-bottom: 2px solid #ddd;
              padding-bottom: 8px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }
            th {
              background-color: #1976d2;
              color: white;
              padding: 12px;
              text-align: left;
              font-weight: bold;
            }
            td {
              padding: 10px 12px;
              border-bottom: 1px solid #ddd;
            }
            tr:nth-child(even) {
              background-color: #f8f9fa;
            }
            .color-badge {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: bold;
              color: white;
            }
            .color-amarelo { 
              background-color: #fbc02d; 
              color: #212121;
            }
            .color-roxo { background-color: #8e24aa; }
            .color-verde { background-color: #43a047; }
            .color-branco { 
              background-color: #ffffff; 
              color: #212121;
              border: 1px solid #ccc;
            }
            .color-outras { background-color: #757575; }
            .footer {
              margin-top: 50px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              text-align: center;
              color: #666;
              font-size: 12px;
            }
            .total {
              font-weight: bold;
              font-size: 18px;
              margin-top: 20px;
              padding: 15px;
              background-color: #e3f2fd;
              border-radius: 8px;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <h1>Relatório de Cores</h1>
          
          <div class="stats">
            <div class="stat-box amarelo">
              <div class="stat-label">Amarelo</div>
              <div class="stat-value">${amarelo}</div>
            </div>
            <div class="stat-box roxo">
              <div class="stat-label">Roxo</div>
              <div class="stat-value">${roxo}</div>
            </div>
            <div class="stat-box verde">
              <div class="stat-label">Verde</div>
              <div class="stat-value">${verde}</div>
            </div>
            <div class="stat-box branco">
              <div class="stat-label">Branco</div>
              <div class="stat-value">${branco}</div>
            </div>
          </div>

          <div class="total">
            Total de Detecções: ${amarelo + roxo + verde + branco}
          </div>

          <h2>📋 Histórico de Detecções</h2>
          <table>
            <thead>
              <tr>
                <th>Horário</th>
                <th>Peça Detectada</th>
              </tr>
            </thead>
            <tbody>
              ${logsValidos
                .map((log) => {
                  let colorClass = "outras";
                  const valRaw = log.value.toLowerCase();

                  // Define a cor da badge mantendo o texto original (ex: 2x2_amarelo)
                  if (valRaw.includes("amarelo")) colorClass = "amarelo";
                  else if (valRaw.includes("roxo")) colorClass = "roxo";
                  else if (valRaw.includes("verde")) colorClass = "verde";
                  else if (valRaw.includes("branco")) colorClass = "branco";

                  return `
                  <tr>
                    <td>${log.time}</td>
                    <td>
                      <span class="color-badge color-${colorClass}">${log.value}</span>
                    </td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>

          <div class="footer">
            Relatório gerado em: ${new Date().toLocaleString("pt-BR")}
          </div>
        </body>
        </html>
      `;

      console.log("[PDF] HTML gerado, criando PDF...");

      if (Platform.OS === "web") {
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(htmlContent);
          printWindow.document.close();
          setTimeout(() => {
            printWindow.print();
          }, 250);
        } else {
          Alert.alert(
            "Erro",
            "Bloqueador de pop-up ativado. Permita pop-ups para gerar o PDF.",
          );
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html: htmlContent });
        console.log("[PDF] PDF criado em:", uri);

        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/pdf",
            dialogTitle: "Salvar Relatório PDF",
            UTI: "com.adobe.pdf",
          });
          console.log("[PDF] PDF compartilhado com sucesso");
        } else {
          Alert.alert("Sucesso", `PDF salvo em: ${uri}`);
        }
      }

      Alert.alert("Sucesso", "Relatório PDF gerado com sucesso!");
    } catch (err) {
      console.error("[PDF] Erro ao gerar PDF:", err);
      Alert.alert(
        "Erro ao Gerar PDF",
        `Detalhes: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
      console.log("[PDF] Processo finalizado");
    }
  };

  return { gerarPdf, loading };
};

export default useGeneratePdf;
