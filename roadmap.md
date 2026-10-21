# Roadmap

- [x] Rever migrations 0005/0006 e funções financeiras ativas sem criar saldos ou pagamentos.
- [x] Preparar SQL completo das quatro correções e revisão independente sem aplicar; aguardar autorização.
- [ ] Aplicar as quatro correções e verificar funções, permissões, RLS e painel administrativo; bloqueado porque a migration autorizada abortou em executor_membership_not_isolated. Não enfraquecer isolamento nem aplicar correções parciais.
- [ ] Preparar SQL revisto com mínimo de 10.000 Kz para lojistas/afiliados/entregadores e limpeza explícita de pertenças da role; apresentar para autorização antes de aplicar.
- [ ] Após autorização, refletir o mínimo nos botões e testar recusas sem criar dinheiro no ambiente partilhado.
- [ ] Validar saques com saldo fictício de 50.000 Kz exclusivamente num ambiente de teste isolado; nunca na base partilhada de produção/pré-visualização.
- [ ] Validar concorrência, total diário e duplicação com saldo/transações reais ou ambiente oficial; bloqueado por ausência desses dados.

- [x] Transformar o ecrã público da LIVE numa experiência vertical em ecrã completo.
- [x] Sobrepor dados reais da loja, estado, audiência e ações sociais.
- [x] Manter comentários Realtime e campo de mensagem sobre o vídeo.
- [x] Apresentar produtos reais e ligar compra ao carrinho/checkout existente.
- [x] Ligar o botão Acompanhar à relação persistente do utilizador com a loja.
- [x] Validar ações e apresentação em dois tamanhos Android.
- [x] Restaurar no menu lateral todos os comandos de transmissão, câmara, microfone, câmaras externas/CCTV e estado.
- [x] Remover textos/botões grandes no centro do vídeo do estúdio.
- [x] Corrigir o erro de RLS ao enviar mensagens em `live_messages` (lojista dono da live).
- [x] Corrigir o chat do estúdio: sem texto vazio sobre o vídeo, caixa fixa em baixo, texto digitado branco.
