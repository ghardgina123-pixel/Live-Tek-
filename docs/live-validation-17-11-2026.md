# Lives — conclusão e evidências de 17/11/2026

## Implementação concluída

- Quatro nomes emitidos diretamente nos handlers existentes: `project.live_created`, `project.live_started`, `project.live_failed`, `project.live_ended`.
- Catálogo validado: quatro eventos; propriedades fechadas, categóricas e sem títulos, identificadores pessoais, referências bancárias ou texto de erros.
- Início medido apenas após publicação de vídeo confirmada e retorno de uma linha na gravação do estado; zero linhas não contam como sucesso.
- Encerramento distingue `server` de `status_only_fallback`; o segundo não prova encerramento da sala de vídeo.
- Indicadores de ligação derivados do estado e qualidade LiveKit; o espectador também observa `waiting`, `stalled` e `playing`, enquanto o publicador observa perda de pacotes e latência reais.
- Aviso do publicador separado verticalmente do erro/estado de publicação para impedir sobreposição.

## Verificação real

- 34 testes aprovados: acesso por categoria (5), estado da ligação (10), integração híbrida existente (19).
- Compilação automática: `build OK`; verificação de diferenças sem erros.
- Sessão autenticada da conta solicitada: acesso à página de Lives; criação e criação com título disponíveis, sem aviso de subscrição para Loja.
- Uma Live intitulada explicitamente como validação técnica com vídeo sintético foi criada pela interface. Os dispositivos sintéticos devolveram vídeo e áudio locais; não são vídeo pessoal nem prova de transmissão recebida.
- Publicação pelo serviço real tentou ligação normal e relay, mas terminou por timeout. O callback observado em localhost foi `project.live_failed` com `{role: publisher, stage: publishing, reason: media_or_connection_failed}`. Não houve evento de início; o pedido continuou Agendado, e o aviso mostrou Sem conexão.
- Espectador autenticado: página e indicador A conectar… visíveis; chat/produtos permaneceram disponíveis. Em 390 × 844 não houve excesso horizontal; computador verificado em 1280 × 1800.
- A Live criada neste ensaio foi apagada pela interface; as duas Lives anteriores foram preservadas.
- Consulta dos últimos sete dias devolveu zero tipos de eventos capturados. O ensaio localhost inspecionou o callback, não o coletor: não é prova de receção de analytics na aplicação publicada.

## Pendências que não podem ser apresentadas como concluídas

- Vídeo efetivamente recebido e reconexão após perda real de rede: pendentes porque a ligação ao serviço de vídeo não se estabeleceu neste ensaio. Não foram simulados estados de sucesso.
- Receção dos quatro eventos no coletor: utilizar a versão atual na pré-visualização/aplicação, aceitar consentimento quando aplicável e desativar Global Privacy Control; consultar depois. Publicação não efetuada neste pedido.
- Cenários de serviços com e sem subscrição: cobertos por testes de lógica, não por sessões reais dessas contas.
- Fase financeira 1, M1/M2 e pagamentos permanecem fora das alterações desta entrega. SQL financeiro continua sujeito à revisão e autorização expressa; banco depende de documentação e credenciais oficiais.

## Métrica da estrela-guia

Encomendas marcadas como entregues ao cliente por semana não têm cobertura no catálogo atual. A instrumentação desse momento exige pedido próprio; não foi acrescentada à medição de Lives.