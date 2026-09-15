# Novo ecrã de Live — Live Teká

## Objetivo
Transformar apenas o ecrã público de uma LIVE numa experiência vertical de ecrã completo, mantendo o vídeo LiveKit e todos os dados reais já existentes.

## Alterações
- Fazer o vídeo preencher todo o display móvel, respeitando as áreas seguras do Android e sem scroll da página.
- Sobrepor no topo: voltar, avatar e nome da loja, estado LIVE, espectadores, acompanhar e partilhar.
- Organizar na lateral direita ações compactas para gosto, comentários e partilha, com contadores reais.
- Sobrepor na zona inferior o nome, título da LIVE, comentários em Realtime e o campo de mensagem sempre acessível.
- Mostrar os produtos reais associados à LIVE numa faixa compacta; abrir o produto real sem terminar a transmissão, preservando a opção de compra/checkout existente.
- Ligar “Acompanhar” a uma relação persistente e protegida por utilizador/loja, reutilizando uma estrutura existente caso exista; se não existir, criar apenas a estrutura mínima com RLS e Realtime.

## Segurança e dados
- Não criar produtos, lojas, lives, comentários, gostos, espectadores ou contadores de demonstração.
- Preservar LiveKit, autenticação, políticas RLS, presença, Realtime e validações atuais.
- Produtos indisponíveis não serão apresentados como compráveis.

## Validação
- Confirmar visualmente em 360×688 e num Android maior, incluindo teclado/campo de mensagem, áreas seguras e ausência de cortes.
- Testar gosto, comentário, partilha, acompanhar e abertura do produto com dados reais existentes.
- Executar testes focados da LIVE e confirmar compilação sem erros.
