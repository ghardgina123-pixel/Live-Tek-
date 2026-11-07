# Gestão de limites e equipa sobre o Live Teká existente

## Âmbito corrigido

Reutilizar `withdrawal_limits`, `user_roles`, autenticação, auditoria, painel e RPCs atuais. Não executar M1/M2 v2 nem criar Ledger, carteiras, quotas, saques, checkout ou dashboards paralelos. Angola permanece com mínimo **10.000 AOA** e máximo diário **200.000 AOA**, hora de Luanda.

## Alterações necessárias

1. **Corrigir as propostas:** substituir o desenho financeiro paralelo por alterações aditivas mínimas na configuração atual. Preservar a versão anterior como referência, não como SQL executável. Manter os 12 testes bancários e os 43 adicionais.
2. **Gestão de Limites Financeiros:** acrescentar a área ao painel financeiro existente; apresentar configuração real e histórico de alterações. Gravar por operação administrativa autenticada, com motivo, valores anteriores/novos e controlo de concorrência. Reutilizar validadores dos saques e retirar bypass por configuração ausente. País/moeda não suportados não operam sobre saldos AOA.
3. **Gestão de Equipa:** integrar no painel do gestor, separada da gestão de lojas. Reutilizar contas confirmadas e papéis atuais; acrescentar apenas metadados de vínculo/permissões comprovadamente ausentes. Não promover funcionários a admin. Adesão vinculada à identidade exata, suspensão/revogação efetiva e histórico real.
4. **Permissões nos fluxos atuais:** autorizar leitura/preparação/aprovação/processamento/rejeição/execução separadamente nas funções e políticas existentes. Bloquear autoelevação, autoaprovação e execução por contabilista. Alterações sensíveis com autorização independente. Preservar nomes, parâmetros, resultados e comportamento legítimo dos RPCs.
5. **Concorrência e segurança:** combinar consumo diário nas fontes atuais com lock comum por beneficiário, sem nova reserva de quota. Rever writers, estados terminais, ACL e idempotência antes de habilitar as permissões. Não reconstruir movimentos históricos.
6. **Banco Atlântico:** preparar apenas o adaptador interno para os intents/pedidos existentes. Nenhuma assinatura inventada, nenhum pagamento confirmado por referência manual ou booleano do cliente. Ativação espera documentação, credenciais e validação oficial conjunta de operação, montante, moeda e destinatário.

## Execução controlada

- Primeiro entregar SQL mínimo completo para revisão, com inventário de equivalentes, dependências e permissões efetivas.
- **Não aplicar alterações financeiras sem autorização expressa desse SQL. Aprovar este plano não aprova SQL ainda não apresentado.**
- Não executar testes financeiros na base partilhada nem aceitar o rascunho de testes. A autorização para criar estrutura/executar fixtures no isolado continua por obter.
- Após autorização e ensaio isolado, aplicar mudanças compatíveis, integrar o painel e habilitar somente fluxos testados. Não apresentar controlos que aparentem funcionar antes das operações server-side existirem.

## Validação e reversão

Todos os **55 testes continuam PENDENTES**. Ensaio de reversão antes da aplicação: snapshot de funções/ACL/schema/dados fictícios, instalação, falha intermédia, concorrência e comparação após reversão. Preservar histórico, reservas, estados finais, Angola e suspensão; nunca regressar a permissões ou pagamentos inseguros. Banco real continua bloqueado até evidência oficial.

## Detalhes técnicos

Diagnóstico atual: `withdrawal_limits` só indexa moeda; helpers AOA têm fallback/NULL; payout usa lock e teto por tipo; painel usa admin; falta estrutura de equipa; `admin_settle_payout` conserva EXECUTE público e confirmação manual no corpo ativo. Esses pontos exigem correção localizada, não instalação da fundação paralela v2. Evidência e limites da inspeção estão em `docs/finance/escopo-integracao-existente.md`.