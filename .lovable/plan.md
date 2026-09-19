# Controlos laterais da transmissão

## Objetivo
Manter o vídeo central totalmente livre e mover todos os comandos reais da transmissão para um painel lateral direito, sem alterar LiveKit, chat ou o layout fullscreen.

## Alterações
- Remover os botões grandes sobre o centro do vídeo apenas no modo de estúdio do lojista.
- Usar o ícone de menu existente para abrir um painel lateral responsivo.
- Ligar no painel as ações reais de preparar/iniciar/parar a transmissão, ligar/desligar câmara e microfone e alternar entre câmaras frontal/traseira.
- Manter as definições, microfone externo, supressão de ruído, qualidade, câmaras integradas e auditoria no mesmo painel.
- Preservar os controlos atuais fora do modo fullscreen.

## Validação
- Confirmar TypeScript, testes focados e compilação.
- Abrir `/lojista/lives` num ecrã móvel, confirmar ausência do botão central e testar cada comando disponível com uma live real.
