# Roadmap

- [ ] Implementar exclusivamente limites e equipa sobre withdrawal_limits, autenticação/papéis e operações existentes; inventariar equivalentes e apresentar plano/SQL mínimo antes de aplicação financeira.
- [ ] Retirar da proposta ativa os mecanismos financeiros v2 paralelos; preservar contratos, dados e limites Angola 10.000/200.000 AOA.
- [ ] Preparar apenas pontos de integração Banco Atlântico que aguardam documentação/credenciais oficiais; não ativar pagamentos nem declarar os 55 testes aprovados.

- [x] Corrigir os três documentos de proposta M1/M2: fundação dormente, dependências/owner, RBAC, quota conjunta privada, mercados, histórico e contrato de cutover/repli; sem executar SQL ou alterar funcionalidades. Integração financeira completa não incluída nem autorizada.
- [x] Consolidar matriz dos 12 testes financeiros/bancários e 43 cenários adicionais; todos os 55 testes e reversão permanecem PENDENTES, exigem ambiente isolado e integração oficial quando aplicável.

- [x] Concluir proposta completa e aditiva da Migration B, com estados terminais, identidade bancária conjunta, idempotência, auditoria de saldos e permissões; somente revisão, sem aplicar nem modificar dados.
- [x] Preparar riscos, evidências de inspeção e matriz dos 12 testes obrigatórios; todos PENDENTES, sem execução financeira.
- [ ] Aplicar Migration B somente após nova autorização expressa; proposta não pronta para produção, concorrência e integração oficial por validar.
- [x] Concluir scan aprofundado iniciado em 07/11/2026: 1 aviso sobre token de cancelamento de emails nos logs; documentado sem alterar código.

- [x] Rever migrations 0005/0006 e funções financeiras ativas sem criar saldos ou pagamentos.
- [x] Preparar SQL completo das quatro correções e revisão independente sem aplicar; aguardar autorização.
- [ ] Aplicar conjuntamente as quatro correções e o mínimo, verificar permissões/RLS/painel; SQL autorizado, mas tentativa integralmente revertida: o executor não pode revogar a pertença concedida por supabase_admin. Requer executor privilegiado da plataforma; não baixar isolamento nem aplicar correções parciais.
- [x] Preparar SQL revisto com mínimo de 10.000 Kz para lojistas/afiliados/entregadores e limpeza explícita de pertenças da role; apresentar para autorização antes de aplicar.
- [ ] Após aplicação bem-sucedida, refletir o mínimo nos botões e testar recusas sem criar dinheiro no ambiente partilhado; bloqueado pela permissão da migration.
- [ ] Validar saques com saldo fictício de 50.000 Kz exclusivamente num ambiente de teste isolado; nunca na base partilhada de produção/pré-visualização.
- [ ] Validar concorrência, total diário e duplicação com saldo/transações reais ou ambiente oficial; bloqueado por ausência desses dados.
- [x] Proposta de schema `test_env`/painel financeiro paralelo retirada do âmbito; reutilizar apenas ambiente isolado independente, sem aceitar alterações automaticamente no projeto real.
- [ ] Após o sandbox validado, aplicar as correções equivalentes ao sistema real (funções public.*) — aguarda autorização explícita do utilizador.

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
