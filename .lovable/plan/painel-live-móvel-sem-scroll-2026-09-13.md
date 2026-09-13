# Painel Live móvel sem scroll

## Objetivo
Reorganizar apenas o painel de transmissão ativo do lojista para que câmara, conversas e resposta coexistam no mesmo ecrã móvel, preservando toda a lógica atual de vídeo, áudio, câmaras externas, auditoria e exportação.

## Alterações
- Transformar a transmissão ativa num espaço de operação de altura controlada, com vídeo em destaque e cabeçalho compacto sobreposto.
- Mostrar estado da live, espectadores e partilha nos cantos superiores, com controlos curtos e legíveis.
- Fixar o chat à zona inferior da transmissão, limitando o histórico a uma área interna deslocável; o campo “Responder à audiência...” e o envio permanecem sempre visíveis acima da navegação do telemóvel.
- Recolher microfone, supressão de ruído, qualidade da ligação, câmaras externas, auditoria e CSV numa gaveta “Definições e estatísticas”.
- Manter os controlos essenciais de iniciar/parar transmissão acessíveis no ecrã principal.
- Manter criação e histórico de lives como estão quando nenhuma transmissão está aberta; ao abrir o painel, priorizar exclusivamente a operação em direto.

## Detalhes técnicos
- Compor a vista ativa nas estruturas existentes, sem alterar regras de publicação, dados, segurança ou cálculos.
- Adaptar `LivePublisher`, `LojistaLivePanel`, `LiveCameraManager` e `LiveAuditLog` com modos compactos reutilizáveis.
- Usar os componentes existentes de botões e gaveta, tokens visuais do projeto e limites baseados em `dvh`/safe areas.
- A partilha usará a API nativa quando disponível e copiará o endereço como alternativa.
- Validar em 360×688 e num ecrã móvel maior: sem scroll da página durante a operação, resposta sempre visível, sem sobreposições e sem regressões funcionais.
