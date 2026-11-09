# Ativação funcional — Limites Financeiros e Gestão de Equipa (Live Teká)

## Estado da revisão (concluído nesta mensagem)

- Sintaxe validada com parser PostgreSQL (pglast): M2 = 44 statements / 11 funções; M1 = 68 statements / 19 funções — sem erros.
- Compatibilidade verificada contra a base de dados real: todas as funções, políticas e colunas referenciadas existem (`fin_audit` 8 argumentos, `block_mutation`, `ledger_balances`, `has_role`, políticas `ledger_select_owner_admin`, `withdrawals_select_owner_admin`, `own payout requests`, `fin_audit_select_admin`, `invoices_admin_read`, `invoice_items_read_via_owned_invoice`; colunas de `store_withdrawals` e `payout_requests` confirmadas).
- `staff_members`, `staff_roles`, `staff_change_requests` não existem — sem conflito nem duplicação.
- Email: domínio `notify.livemarketplece.live` ativo e fila saudável — os convites podem ser enviados pela infraestrutura de email já configurada, sem fornecedor externo em falta.
- Limites atuais confirmados e preservados: AOA mínimo 10.000, máximo diário 200.000, fuso Africa/Luanda.

## SQL apresentado para aprovação (nada aplicado)

Ficheiros completos no projeto, para revisão integral:
- `docs/finance/proposta-m2-integracao-revisada.sql` — equipa e permissões (aplicar primeiro)
- `docs/finance/proposta-m1-integracao-revisada.sql` — limites e operações financeiras (aplicar depois)

### M2 — Gestão de Equipa (novo, sem tocar em `user_roles`)

1. Pré-verificações: falha se já existir estrutura equivalente; exige `user_roles`, `financial_audit_log` e `fin_audit` existentes; exige dono de função verificado e que as roles da aplicação não herdem o dono.
2. `staff_roles` (nome único, categoria contabilista/financeiro/gestor, permissões, versão) e `staff_members` (user_id, função, estado invited/active/suspended/revoked, permissões individuais, hash SHA-256 do token, expiração, estado de entrega do convite) e `staff_change_requests` (pedidos de alteração com aprovação separada).
3. `staff_permissions_valid`: lista fechada de permissões (finance.view/prepare/approve/process/reject/execute, finance.invoice.register, limits.read/manage, team.read/manage); contabilista nunca executa nem processa; permissões superiores exigem as de leitura correspondentes.
4. `staff_can(permissão)`: deny-first; membro suspenso/revoked/invited não tem acesso; sem membro, só admin (`has_role`) tem acesso; `team.approve` nunca é concedido a membros (só admin).
5. `staff_authorize`: lock de autorização + verificação; usado por todas as operações.
6. Convites: `admin_invite_staff` gera token de 256 bits, guarda só o hash SHA-256, expira em 7 dias, devolve o token uma única vez ao fluxo do servidor para envio por email; `staff_invitation_recipient` valida token+email para o envio; `staff_invitation_delivery` regista queued/failed/suppressed; `accept_staff_invite` valida formato, hash, expiração, uso único (consome o token), email confirmado e autoridade do convidador no momento da aceitação.
7. Alterações de funções/permissões passam por pedido + aprovação de outra pessoa (`admin_request_staff_change` / `admin_review_staff_change`): ninguém aprova o próprio pedido, nem altera a própria função, nem altera admins.
8. `admin_set_staff_status`: suspender/reativar/revogar com versão e motivo; revogar anula token pendente; sem auto-alteração.
9. RLS: leitura de membros/funções/pedidos só para o próprio ou quem tem `team.read`; GRANT de SELECT sem a coluna do hash; triggers anti-TRUNCATE; tudo auditado em `financial_audit_log` (hash nunca registado).

### M1 — Limites e operações financeiras (sobre estruturas existentes)

1. Pré-verificações: falha se os limites de Angola não forem exatamente 10.000/200.000/Africa-Luanda; exige M2 aplicado; falha se as colunas novas já existirem.
2. `withdrawal_limits` ganha `country_code`, `market_code`, `revision` (backfill AO/AO-main só de metadados; valores monetários intocados). `financial_settings.min_withdrawal_aoa` marcado DEPRECATED.
3. `withdrawal_limit_aoa_required()`: fail-closed — configuração inválida ou em falta bloqueia levantamentos, sem fallback.
4. `admin_save_withdrawal_limit`: só com `limits.manage`; lock de configuração; só AO/AO-main/AOA; validação de valores (positivos, 2 casas, máximo ≥ mínimo); controlo de concorrência por revisão; motivo obrigatório; auditoria com antes/depois.
5. Escrita direta em `withdrawal_limits` revogada (só via função); leitura mantida; `financial_audit_log` protegido contra TRUNCATE e sem escrita direta.
6. `user_withdrawn_today` e `withdrawal_day_start`: soma conjunta loja+afiliado+entregador no dia (fuso configurado).
7. `request_store_withdrawal` e `request_payout` reemitidos com locks ordenados, teto diário conjunto, mínimo, saldo, pedido em aberto e auditoria — mesma lógica atual, agora com limites centralizados.
8. `admin_withdrawal_action` e `admin_settle_payout`: permissões por ação (approve/process/reject/execute), separação de funções (quem aprovou não processa; ninguém trata o próprio pedido), estados terminais respeitados, e `paid`/`pay` continuam bloqueados até confirmação bancária oficial (Banco Atlântico) — nenhuma liquidação manual inventada.
9. Políticas de leitura financeira passam a usar `staff_can('finance.view')` (admins continuam com acesso via fallback).
10. REVOKE/GRANT de EXECUTE explícitos em todas as funções.

### Procedimento de reversão

- Antes de aplicar: cópia de segurança lógica das definições atuais das funções substituídas (pg_get_function_definition) e das políticas alteradas, guardada em `docs/finance/reversao-limites-equipa.sql`.
- Reverter M1 = restaurar as definições anteriores das funções e políticas e remover as 3 colunas novas (aditivas, sem dados dependentes).
- Reverter M2 = revogar EXECUTE das funções novas e remover as 3 tabelas novas (sem dados financeiros dependentes); `user_roles` e fluxos atuais ficam intactos porque M2 não os modifica.
- Em caso de falha a meio, a migração é transacional: ou aplica tudo ou nada.

## Depois da sua aprovação expressa (execução integral)

1. Aplicar M2, depois M1, na base de dados.
2. Backend: server functions autenticadas para convidar, reenviar/revogar convite, aceitar convite, alterar estado, pedir/aprovar alterações de funções e guardar limites.
3. Email: modelo `staff-invite` (React Email, português, marca Live Teká) registado no sistema de email já ativo; envio real com ligação de aceitação contendo o token; estado de entrega registado (queued/failed/suppressed).
4. Interface: página de aceitação do convite (`/convite`), Gestão de Equipa totalmente operacional (convidar, pesquisar, editar permissões com aprovação, suspender/reativar/revogar, histórico) e Gestão de Limites editável (com revisão, motivo e histórico antes/depois).
5. Testes reais no ambiente isolado (rascunho com base de dados própria): convite ponta a ponta, token expirado/revogado/reutilizado rejeitado, permissões respeitadas, limites alterados e aplicados em levantamento real, histórico correto, acesso negado sem autorização (frontend e chamada direta). Resultados apresentados sem inventar PASS.

## Fora de âmbito desta aprovação

- Liquidação de pagamentos (`paid`) continua bloqueada até às credenciais oficiais do Banco Atlântico.
- Nenhum levantamento fictício na base principal; testes com dados fictícios só no ambiente isolado.
