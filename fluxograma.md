```mermaid
flowchart TD
    %% Definição das 4 grandes áreas do seu projeto
    
    subgraph Processamento [1. server.py]
        S[Servidor Python] -->|Ativa Servidor| M
        V[Visão Computacional] -->|Alimenta| S
    end

    subgraph Mensageria [2. MQTT com Ngrok]
        M((Broker MQTT))
    end

    subgraph Interface [3. App]
        A[Aplicativo / Dashboard]
        Relatorio[Gerador de Relatórios]
    end

    subgraph Hardware [4. Raspberry Pi]
        R[Script do Rasp] -->|Controla| E[Esteira Física]
    end

    %% Conexões e Troca de Dados (As regras que você definiu)
    S <-->|Envia e Recebe Dados de Visão| M
    
    M <-->|Responde Requests e Envia Dados| A
    A -.->|Possibilita Download| Relatorio
    
    A ===>|Envia Comando de Controle| R
    
    %% Estilos para o relatório ficar bonito
    style M fill:#ffeb3b,stroke:#333,stroke-width:2px,color:#000
    style S fill:#bbdefb,stroke:#333,stroke-width:2px,color:#000
    style A fill:#c8e6c9,stroke:#333,stroke-width:2px,color:#000
    style R fill:#ffcc80,stroke:#333,stroke-width:2px,color:#000