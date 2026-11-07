# Live Teká — alterações mínimas sobre a arquitetura existente

07/11/2026. Inventário de leitura do código e do catálogo ativo. Sem aplicação de SQL, alteração de dados ou ativação de funcionalidades. As consultas executadas foram exclusivamente SELECT de diagnóstico; nenhum teste financeiro foi executado.

## Decisão de âmbito

As propostas `proposta-m1-limites.sql` e `proposta-m2-equipa.sql` não fazem parte do pacote a implementar. Permanecem preservadas para rastreabilidade, mas NÃO devem ser executadas, copiadas para migrations ou aceites através do rascunho financeiro. Este documento substitui o seu desenho de implementação; não substitui os 55 critérios de teste.

Não criar `lt_limit_rules_v2`, mercados financeiros paralelos, contas de liquidação, reservas/eventos de quota, gates ou gestores raiz paralelos. Não reconstruir checkout, pedidos, carteiras, Ledger, comissões, saques ou painéis existentes. Gestão da equipa exige apenas os metadados de autorização ausentes, ligados à identidade e papéis atuais, não outra autenticação.

## Inventário confirmado

| Estrutura atual | Evidência | Alteração necessária |
|---|---|---|
| `withdrawal_limits` | AOA, mínimo 10000, máximo diário 200000, Africa/Luanda | Fonte única de limites; editar através de RPC autenticada, não DML do browser |
| `countries` | Código, moeda, estado, locale existentes | Reutilizar catálogo; contexto financeiro não pode ser escolhido através de perfil editável |
| `user_roles` / `has_role` | customer/seller/admin; papéis separados do perfil | Preservar papéis; acrescentar autorização administrativa granular sem promover funcionários a admin |
| `financial_audit_log` / `fin_audit` | Actor, data, before/after e metadata existentes | Reutilizar histórico para alterações de limites; rever ACL/triggers antes de permitir nova operação |
| Painel `/admin-dashboard` | Gestão de membros atual cria/lista lojas | Não confundir lojas com funcionários; acrescentar equipa ao mesmo painel |
| Painel `/admin/financeiro` | Resumo, transações, saques, documentos fiscais | Integrar limites sem criar outro dashboard; filtrar acesso por operação |
| `request_store_withdrawal` / `request_payout` | RPCs e locks existentes | Preservar contratos JSON, saldo/reservas e cálculos server-side; adaptar apenas resolução/consumo conjunto |
| `admin_withdrawal_action` / `admin_settle_payout` | RPCs atuais controlam alterações financeiras | Autorizar cada ação e preservar transições/ledger; não duplicar RPC de liquidação |
| `payments.functions.ts` | Intent Multicaixa existente; checkoutToken null | Preparar adaptador sobre o intent existente; não criar novo checkout |
| Equipa/permissões/banco | Nenhuma tabela/função equivalente encontrada na consulta direcionada do catálogo; nenhum adaptador Atlântico no código | Acrescentar só metadados comprovadamente ausentes; confirmar novamente antes de cada criação |

## Problemas ativos que condicionam a integração

1. Limites só têm chave por moeda. Acrescentar identificação de país/mercado de forma aditiva e compatível, sem substituir a chave usada pelos consumidores AOA enquanto estes não forem adaptados. Um país suportado não implica contabilidade multimoeda disponível.
2. `min_withdrawal_aoa` usa fallback legado e `max_daily_withdrawal_aoa` pode devolver NULL quando falta configuração. A resolução deverá recusar configuração inexistente/inválida, sem retirar o suporte Angola.
3. `request_payout` bloqueia por utilizador **e tipo**, e calcula restante por tipo. Não garante teto conjunto afiliado/entregador/lojas. Usar as fontes de pedidos existentes e um lock comum por beneficiário, sem tabela de quota paralela. Todos os writers/transições relacionados precisam de ordem de locks consistente.
4. Guards do painel e funções atuais verificam admin. Dar permissões a um funcionário não basta: adaptar cada leitura/ação e políticas correspondentes; nunca adicionar um `admin OU permissão` que contorne suspensão.
5. A chamada ativa `admin_settle_payout` ainda tem EXECUTE para PUBLIC/anon, embora faça verificação interna de admin. Reduzir a superfície por assinatura exata no pacote aprovado. Não alterar privilégios de outras funções fora do âmbito.
6. O corpo ativo de `admin_settle_payout` considera referência manual suficiente para verification_source=manual e não contém verificação explícita de autoaprovação. Não é prova bancária oficial. Compatibilidade das colunas/statuses e triggers ainda exige inspeção completa antes de corrigir.
7. `admin_withdrawal_action` também usa referência manual para pay. Referência não substitui autenticação e confirmação final do banco. Preparação de integração não autoriza estes pagamentos nem os declara seguros.
8. A consulta `information_schema.role_table_grants` não devolveu linhas para as três tabelas inspecionadas. Isso não prova ausência de privilégios efetivos: inspecionar ACL nativas, memberships e ownership no SQL de preflight.

## Alterações estritamente necessárias

- **Limites:** estender a configuração existente apenas quando necessário; função administrativa autenticada com validação de números finitos/precisão/min≤max, país/moeda/fuso suportados, controlo de versão e motivo. Atualização e histórico real na mesma transação. Valores de Angola não são alterados pela instalação.
- **Equipa:** identidade de `auth` e papéis em `user_roles` permanecem autoridades existentes. Se confirmada ausência, criar apenas estado de vínculo/permissões e proposta de alteração sensível necessários. Sem duplicação de perfil, saldo, pedido ou autenticação. Adesão vinculada ao utilizador confirmado exato; ninguém aceita convite alheio.
- **Permissões:** separar consultar, preparar, aprovar, processar/rejeitar, executar, gerir limites e gerir equipa. Contabilista nunca executa pagamentos. Impedir autoelevação e autoaprovação; grants sensíveis requerem aprovação independente, payload imutável e aplicação única. Suspensão/revogação revalidada no backend, não na sessão/cache.
- **Integração:** conservar os nomes/parâmetros/defaults dos RPCs atuais. O painel e as políticas devem usar a mesma decisão server-side por ação. Não habilitar novas permissões antes de todos os consumidores relacionados estarem adaptados.
- **Banco:** seam interna no fluxo existente, sem endpoint público que aceite confirmação não autenticada. Faltam protocolo oficial, assinatura/certificados, credenciais, conta/identidade, idempotência/replay e ambiente oficial. Não inventar headers/assinaturas. Prova conjunta ID/tipo/referência/montante/moeda/destinatário obrigatória antes de PAID; retries exatos não repetem ledger/notificações.

## Controlo de aplicação e reversão

Preparar SQL mínimo completo em `docs/finance` após este plano, com preflight de equivalentes/ACL/contratos/Angola e sem executar os SQL anteriores. Apresentar para autorização financeira expressa antes de aplicação. Não interpretar aprovação do plano como aprovação de SQL ainda não apresentado.

Ensaio isolado requer autorização própria: snapshot de schema, funções, ACL e dados fictícios; instalação aditiva; falha transacional; concorrência real; reexecução; reversão antes e depois de atividade. Comparar históricos e saldos sem inventar snapshots antigos. Não aceitar o rascunho financeiro nem transportar suas migrations para produção.

Na reversão, preservar estados terminais, história, reservas, suspensão e limites. Nunca restaurar um bypass administrativo ou pagamento manual inseguro; se não existir versão segura anterior, suspender novas operações afetadas e usar correção forward/reconciliação.

## Estado da entrega

Inventário e correção de âmbito concluídos; interfaces novas, migrações, permissões e integração bancária NÃO implementadas nesta preparação. F1–F12 originais e S1–S15/L1–L15/I1–I5/R1–R8 continuam **PENDENTES**, inclusive reversão. Nenhum resultado PASS é reivindicado.