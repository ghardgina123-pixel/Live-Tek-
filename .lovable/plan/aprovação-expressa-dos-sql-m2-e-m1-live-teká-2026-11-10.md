# Aprovação expressa dos SQL M2 e M1 — Live Teká

## Ponto retomado
As propostas completas já preparadas foram preservadas sem recomeçar a auditoria. A cópia de reversão foi concluída; não foi aplicado SQL nem criado outro ambiente de testes.

## SQL completos para aprovação
1. **M2**, primeiro: `docs/finance/proposta-m2-integracao-revisada.sql` — equipa, funções, permissões, convites por token, aceitação, estados e auditoria.
2. **M1**, depois: `docs/finance/proposta-m1-integracao-revisada.sql` — edição persistente em withdrawal_limits, validações dos pedidos existentes, teto diário conjunto, autorizações e histórico.

Os dois ficheiros completos são apresentados como anexos nesta conversa. A aprovação deste cartão autoriza expressamente aplicar estes SQL, por esta ordem, e concluir a integração nas interfaces existentes; não autoriza pagamentos, SQL bancário, outras propostas ou reversão automática.

## Resultado a concluir após aprovação
- Enviar convites reais por email com token vinculado à conta confirmada, validade de sete dias e utilização única; implementar `/convite` e aceitação.
- Gerir membros, funções e permissões nas páginas existentes, com suspensão/revogação efetivas, controlo de versões e histórico.
- Ligar edição e gravação de limites aos validadores existentes; mostrar responsável, motivo e antes/depois.
- Preservar, na instalação, mínimo 10.000 AOA e máximo diário 200.000 AOA, no fuso de Luanda.
- Validar os fluxos autenticados e as alterações sem criar outra área de testes ou movimentar saldos fictícios na base partilhada.

## Condições operacionais explícitas
- Os convites desta proposta destinam-se a contas existentes com email confirmado; não criam contas nem concedem automaticamente o papel admin.
- A criação/alteração de funções e permissões requer aprovação por outro administrador: quem pediu não pode aprovar. Não contornar essa separação se faltar outro administrador autorizado.
- O Contabilista não pode processar nem executar pagamentos.
- Convite colocado na fila não equivale a entrega confirmada na caixa de email; mostrar os estados reais.
- Banco Atlântico fica fora deste pedido; pagamento final permanece bloqueado sem confirmação oficial.

## Reversão concluída
`docs/finance/reversao-limites-equipa.sql` contém contenção não destrutiva e o inventário das 15 definições anteriores capturadas em leitura. As seis políticas anteriores estão preservadas em `reversao-politicas-anteriores.sql` como referência inativa.

A contenção bloqueia mutações de equipa, limites e operações financeiras afetadas; mantém dados, histórico, configurações e proteções atuais. Não elimina tabelas/colunas e não restaura automaticamente validadores antigos que perderiam o teto conjunto ou proteção bancária. As páginas devem voltar à consulta no mesmo procedimento. A sua execução exige autorização separada; não foi ensaiada nem declarada aprovada funcionalmente.

## Detalhes técnicos
- Aplicação por migrações transacionais, M2 → M1, sem alterar migrações históricas.
- Reutilizar autenticação/user_roles, withdrawal_limits, auditoria, pedidos, ledger, serviço de email e páginas existentes.
- Funções autenticadas e políticas de acesso aplicadas também às chamadas diretas; tokens fora do histórico e dos registos.
- Se houver falha, relatar a operação concreta e interromper a ativação incompleta, sem anunciar conclusão ou testes não executados.

**A execução fica agora à espera da sua aprovação expressa destes SQL completos.**