# Live Teká — Entregadores ligados a empresas

**Proposta para aprovação — 7 de novembro de 2026. Nada nesta proposta foi aplicado.**

## 1. Resultado pretendido

Um entregador ligado a uma empresa não pode pedir levantamentos individuais. Os ganhos das entregas aceites nessa condição pertencem à empresa e só podem ser levantados para uma conta financeira da empresa, pela pessoa autorizada a representá-la. O bloqueio será obrigatório na base de dados, e não apenas a remoção de um botão.

Mantêm-se Angola/AOA, mínimo **10.000 AOA por levantamento**, máximo **200.000 AOA por titular por dia**, dia calculado em **Africa/Luanda**. O teto agrega os canais de levantamento existentes pertencentes ao mesmo titular, sem multiplicação por entregador, tipo de pedido ou empresa. Suspensão não confisca ganhos, nem transferência de vínculo reatribui dinheiro antigo.

## 2. Inventário confirmado e lacunas

Inspeção de leitura da base principal e dos dois históricos de migrações:

| Estrutura existente | Reutilização / lacuna |
| --- | --- |
| `couriers` com `id`, `user_id`, `courier_type`, `company_name`, `status` | `empresa` já existe. `company_name` é texto, não vínculo ou prova de titularidade. Não existe ligação relacional entregador/empresa. |
| `deliveries.courier_id`, `courier_fee_aoa` | Manter atribuição e logística/GPS. Falta um beneficiário financeiro imutável separado do executante. |
| `courier_withdrawable()` | Atualmente agrega `orders.shipping_aoa` de entregas concluídas. O detalhe mostra `COALESCE(courier_fee_aoa, shipping_aoa)`: divergência a reconciliar, sem reescrever valores históricos. |
| `payout_requests`, `request_payout()`, `admin_settle_payout()` | Reutilizar pedidos/estados/liquidação. Falta beneficiário explícito e pedido por representante; existe lock por utilizador/tipo, insuficiente para teto conjunto. |
| `withdrawal_limits` | Manter configuração e validadores; Angola 10.000/200.000 AOA. |
| `ledger_entries` | Ledger append-only já existente, atualmente exclusivo de lojas (`store_id` obrigatório). Estender o mesmo ledger para beneficiários de entregas, sem carteira/tabela financeira paralela. |
| `user_payment_accounts` | Reutilizar contas de pagamento. Os campos autodeclarados não provam conta empresarial nem confirmação bancária. |
| `user_roles`, `has_role`, `fin_audit`, `financial_audit_log` | Reutilizar autenticação, autorização administrativa e histórico imutável. M2/permissões granulares ainda aguardam aprovação. |

Outras incompatibilidades a incluir na alteração aprovada: constraint original de `payout_requests.status` sem `rejected`; cálculo diário que exclui `cancelled` mas não `rejected`; somas de saldo mutáveis quando uma entrega é reatribuída ou um entregador eliminado. Nenhuma destas regras foi alterada agora.

## 3. Modelo mínimo proposto

### Empresa e vínculo

- Uma empresa é o registo já existente de `couriers` com `courier_type='empresa'`; seu `user_id` identifica inicialmente o único representante financeiro. Não criar empresas falsas como lojas.
- Acrescentar `couriers.company_courier_id` nullable, referindo `couriers.id`, com eliminação restrita quando há vínculo/histórico financeiro. Impedir auto-vínculo, ciclos, cadeias, empresa ligada a outra empresa e empresas não elegíveis.
- Só a gestão autorizada altera o vínculo, com motivo obrigatório e confirmação registada da empresa e do entregador. Sem convidar utilizadores através de papéis autodeclarados. Delegação futura depende de M2 aprovado, não de uma nova estrutura de permissões.
- Inserção e edição do próprio perfil não podem escrever vínculo, beneficiário, validação empresarial ou titularidade. Proteger também INSERT: RLS de linha, por si só, não protege estes campos.
- Usar `financial_audit_log` para ator, antes/depois, motivo, data efetiva e revisão, e gravar a revisão de vínculo no snapshot de cada atribuição. Sem tabela duplicada de histórico.

### Titularidade por entrega

Acrescentar em `deliveries` um snapshot protegido: executante, empresa na aceitação, beneficiário courier, beneficiário user, moeda, taxa acordada, revisão do vínculo e instante de atribuição. A fronteira proposta é a **atribuição/aceitação**, não o dia do levantamento.

`assign_delivery_courier()` e `courier_accept_delivery()` gravam estes valores atomicamente. Mudança posterior de empresa afeta apenas futuras atribuições. Reatribuição antes da conclusão é uma transição administrativa auditada; após lançamento de ganho é proibido reescrever o beneficiário. Usar compensação aprovada se houver erro.

### Ledger existente

Estender `ledger_entries` com `beneficiary_courier_id`, `delivery_id` e `payout_request_id`, mantendo a identidade de loja nos lançamentos antigos. A validação exige exatamente um ramo de titularidade: loja OU beneficiário courier. Uma alteração controlada à obrigatoriedade global de `store_id` é necessária; o ramo loja continua obrigatoriamente com `store_id` e suas proteções atuais. Esta alteração não pode ser aplicada isoladamente.

- Crédito de entrega concluída, uma vez, pela taxa acordada no snapshot.
- Reserva ao criar pedido; libertação em cancelamento/rejeição; consumo da reserva em confirmação bancária válida.
- Chaves únicas por entrega/evento e pedido/evento; nenhuma duplicação em retries.
- Guardas de saldo não negativo, RLS e helpers existentes estendidos ao novo ramo. As consultas de lojas filtram explicitamente seu ramo; não somam ganhos de entregadores.
- Sem UPDATE/DELETE de movimentos, sem escrita financeira pelo telemóvel e sem novo motor financeiro paralelo.

## 4. Levantamentos e conta destinatária

`request_payout('courier', ...)` conserva a entrada atual, mas resolve o titular autenticado no servidor.

1. Entregador com vínculo ativo: recusar **todo pedido individual**, inclusive saldo individual anterior, devolvendo `company_affiliated_withdrawal_blocked`; não reservar saldo nem consumir limite. Saldo anterior permanece seu e só volta a ser levantável após desvinculação autorizada e reconciliação. Não transferi-lo automaticamente à empresa.
2. Representante da empresa: pedir exclusivamente o saldo cujo beneficiário é essa empresa. Manter `kind='courier'`; acrescentar beneficiário imutável e `requested_by` a `payout_requests`, preservando `user_id` do titular responsável.
3. Independente sem vínculo: manter fluxo atual sobre ganhos individuais reconciliados.
4. Conta empresarial: resolver `user_payment_accounts` do titular e validar vínculo empresarial/titularidade administrativamente. Não confiar em `destination` enviado pelo cliente. Guardar snapshot imutável de conta e titular; alteração posterior da conta não altera pedidos já emitidos.
5. Enquanto não existe evidência oficial de titularidade/integração Banco Atlântico, não autorizar liquidação real. Uma referência manual não confirma pagamento.

O total diário, a reserva e a unicidade de pedido aberto usam o titular financeiro, nunca o motorista. Um lock comum por titular/AOA é partilhado pelos RPCs existentes de lojas, afiliados e entregadores. Empresas controladas pelo mesmo utilizador não multiplicam o limite; o vínculo empresa/representante não pode mudar enquanto existirem reservas sem transição aprovada.

`admin_settle_payout()` mantém autorização de gestão, impede autoaprovação e revalida beneficiário, destino, valor, moeda e identidade bancária autenticada. `paid`, `rejected`, `cancelled` são terminais; retries exatos não geram novo lançamento. Corrigir constraint e quota de rejeitados na mesma entrega aprovada, preservando registros antigos.

## 5. Ecrãs existentes, sem novo painel financeiro

- Gestão de entregadores: consultar/alterar vínculo e ver histórico apenas com autorização.
- Área do entregador: empresa, ganho por corrida e estado de crédito empresarial; sem botão de levantamento enquanto vinculado. Não mostrar saldo bancário/destino da empresa.
- Área `transportador` da empresa: saldo da empresa, ganhos dos entregadores e pedidos existentes, visíveis só ao representante autorizado.
- `PayoutWallet`: refletir a recusa real do servidor; nunca usar ocultação do botão como controlo de acesso.
- Área financeira da gestão: beneficiário, solicitante e auditoria do pedido, sem alterar autoridade de liquidação existente.

## 6. Concorrência, acesso e preservação

Ordem uniforme de locks: titular financeiro/moeda → vínculo → entrega/pedido. Se uma operação envolver dois titulares, adquirir por identificador ordenado. Atribuição, mudança de vínculo, crédito e reserva verificam a mesma revisão; conflito exige repetir a operação, nunca usar um snapshot obsoleto.

RLS de leitura restrita ao executante para logística, ao titular para finanças e à gestão autorizada. Empresa só vê os ganhos de sua titularidade; não ganha acesso a pedidos completos, método de pagamento ou outras empresas. Funções SECURITY DEFINER têm search_path fixo, identidade autenticada e EXECUTE apenas aos papéis necessários. Revogação/suspensão administrativa prevalece sobre todas as permissões delegadas.

Não eliminar dados antigos, alterar saldos por cálculo aproximado, reinterpretar `company_name`, mudar o estado de pedidos antigos ou mexer em Realtime/GPS. Nenhum endpoint/assinatura Banco Atlântico é inventado.

## 7. Migração e reconciliação propostas

1. Apresentar **SQL completo de avanço e contingência**, com dependências M1/M2 explicitadas, antes de qualquer aplicação financeira. Esta proposta funcional/técnica não constitui SQL instalável nem autorização para executá-lo.
2. Ensaio em base isolada com ambos os históricos de migração, fixtures declaradamente fictícias, sem dados/pagamentos reais.
3. Inventariar ganhos individuais, pedidos pagos, abertos e devolvidos. Fixar marco de corte e reconciliar saldos por titular. Ausência de evidência histórica é bloqueio, não saldo zero.
4. Ganhos antigos ficam atribuídos ao titular comprovado na origem. Backfill não presume empresa com base no vínculo atual. Lançamentos de abertura distinguem disponível e reservado; pedidos antigos pagos não são debitados duas vezes. Totais antes/depois têm de coincidir.
5. Instalar adições e proteções de forma indivisível, com ativação empresarial desligada. Fazer leitura comparativa sem gerar movimentos financeiros.
6. Ativar somente após reconciliação e testes; contas empresariais sem validação continuam impedidas de liquidar dinheiro real.

## 8. Matriz obrigatória de aprovação

Todos os testes financeiros abaixo estão **PENDENTES**, não executados. Os 12 testes bancários originais continuam preservados e pendentes; os testes locais de privacidade não os substituem.

| Teste | Resultado exigido |
| --- | --- |
| C01 vínculo próprio/falso/cíclico e alteração direta | Recusa na base, sem mudança de titularidade. |
| C02 entregador vinculado pede saque por RPC | Recusa, mesmo com saldo individual anterior; saldo/quota intactos. |
| C03 empresa levanta ganhos de dois entregadores | Soma creditada à empresa, sem crédito duplicado aos executantes. |
| C04 empresa alheia/cliente consulta ou levanta | Recusa, sem exposição de saldo/destino. |
| C05 atribuir → mudar vínculo → concluir | Beneficiário da atribuição preservado. |
| C06 corrida com taxa diferente de shipping | Crédito igual ao snapshot comprovado, detalhe/carteira reconciliados. |
| C07 conclusão e confirmação repetidas | Um crédito/uma liquidação; audit trail íntegro. |
| C08 mínimo | 9.999,99 AOA recusado; 10.000 AOA aceite havendo saldo/quota. |
| C09 teto conjunto e concorrência | Soma diária por titular até 200.000 AOA; excedente recusado inclusive entre canais. |
| C10 mudança de dia | Quota renova à meia-noite de Luanda, sem corrida concorrente ultrapassar teto. |
| C11 cancelamento/rejeição | Reserva devolvida uma vez e quota conforme regra aprovada; constraint aceita estado. |
| C12 dinheiro e auditoria | Disponível/reservado/pago conservados; ator e antes/depois reais; saldo não negativo. |
| C13 conta manipulada/titularidade não validada | Recusa; não usar destino enviado pelo cliente. |
| C14 funcionário suspenso/autoaprovação | Recusa em todos os acessos; contabilista não executa pagamentos. |
| C15 históricos/backfill | Totais iguais ao marco de corte; sem transferência automática à empresa ou débito duplo. |
| C16 contingência antes/depois de movimentos | Sem perda de saldo/histórico; retomada reconciliada. |
| C17 regressões | Lojas, afiliados, logística, mapas/GPS e notificações mantêm contratos. |

Critério: nenhum FAIL ou teste financeiro necessário PENDENTE na ativação correspondente; evidência reproduzível e aprovação explícita. Liquidação real exige ainda validação bancária oficial.

## 9. Contingência

Antes de novos lançamentos: desligar ativação empresarial e restaurar consumidores antigos após provar ausência de movimentos/reservas empresariais. Depois de lançamentos: bloquear novas operações empresariais, manter leitura e liquidação ledger-aware dos pedidos já existentes, reconciliar reservas e corrigir erros somente por movimentos compensatórios aprovados. Nunca voltar ao SUM antigo, apagar snapshots/ledger ou entregar saldo empresarial aos motoristas.

## 10. Alteração de privacidade autorizada separadamente

A migração `0008_courier_delivery_payment_privacy.sql` removeu `orders.payment_method` do SELECT e do JSON de `courier_delivery_detail()`. Preservou autorização, endereços, contactos, taxa, itens, coordenadas e rota. A função continua acessível apenas aos papéis já autorizados; não modifica pedidos/pagamentos. O tipo do ecrã deixou de declarar o campo.

As listas de entregas já usam projeções sem método de pagamento; Realtime de `deliveries` não contém esse campo; `getDeliveryRoute` devolve apenas geografia. A RLS de `orders` não concede leitura pelo mero facto de ser entregador. Clientes, lojistas e gestores mantêm sua leitura legítima: um entregador que seja também cliente do próprio pedido continua a poder vê-lo na qualidade de cliente, não na resposta de logística.

Verificação: teste PostgreSQL local com entrega e método fictícios reproduziu divulgação antes e validou ausência depois, preservando dados de logística e recusando outro entregador. Inspeção pós-migração confirma ausência do campo em funções courier e preservação das permissões. Nenhum levantamento fictício ou teste bancário executado. Percurso numa conta real de entregador não foi verificado.