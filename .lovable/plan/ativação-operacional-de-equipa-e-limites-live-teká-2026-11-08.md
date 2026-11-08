# Ativação operacional de equipa e limites — Live Teká

## Autorização identificada

O botão «Convidar membro» tem `disabled` no código e a mensagem «Aguarda aprovação de segurança» é texto da entrega anterior. Não é um pedido de autorização do Lovable nem uma verificação administrativa em curso.

O servidor atual só consulta dados e exige o papel administrador. A base atual não contém `staff_members`, `staff_can` ou a operação de gravação de limites. As propostas M1/M2 não foram aplicadas e não ativam integralmente permissões granulares.

Falta a aprovação expressa do responsável pelo projeto para o **SQL completo final**, conforme a instrução anterior de rever alterações financeiras antes da aplicação. Essa aprovação será solicitada nesta conversa após apresentar o SQL, não num botão dentro da aplicação. Não existe atualmente um pedido Allow/Approve pendente.

Equipa e limites não dependem do Banco Atlântico. O domínio de envio de emails está ativo; o modelo de email de convite ainda precisa de implementação. Tokens de convite serão gerados pela aplicação, sem pedir segredos em mensagens. Permissões administrativas internas serão verificadas para cada operação depois da ativação.

**A aprovação deste plano autoriza preparar a implementação e o SQL para revisão; não autoriza aplicar alterações financeiras ainda não apresentadas.**

## Alterações necessárias

### 1. Revisar o SQL completo e os pontos de acesso
- Atualizar as propostas existentes, sem instalar a fundação financeira v2 retirada.
- Inventariar os controlos das duas páginas e cada operação correspondente: leitura, preparação, aprovação, rejeição, execução, documentos, equipa e limites.
- Mapear funções administrativas, regras de acesso e verificações atuais antes de conceder uma permissão. Não promover funcionários ao papel `admin` para contornar restrições.
- Apresentar o SQL completo, a matriz operação/permissão e os efeitos sobre dados existentes; aguardar autorização expressa para aplicar.

### 2. Equipa operacional
- Reutilizar autenticação, `user_roles`, auditoria e envio de emails. Acrescentar somente os vínculos, funções e permissões sem equivalente existente.
- Convidar por email da conta confirmada; enviar um convite real com token vinculado ao destinatário, expirável, de utilização única e armazenado apenas como hash.
- Aceitar o convite com sessão da conta correta; não conceder acesso antes da aceitação. Exibir estados reais de convite/envio e tratar falhas sem anunciar envio inexistente.
- Configurar funções e permissões individuais; consultar e editar membros, suspender, retomar e revogar acessos com proteção contra conflitos de atualização.
- Impedir autoelevação e autoaprovação; Contabilista nunca executa pagamentos. Suspensão/revogação prevalece nos caminhos de autorização correspondentes.
- Registar ações reais com responsável, instante, motivo e alterações, sem guardar tokens na auditoria.

### 3. Limites operacionais
- Manter `withdrawal_limits` como autoridade única e reutilizar os pedidos de levantamento existentes.
- Preservar na instalação Angola: mínimo **10.000 AOA**, máximo diário **200.000 AOA**, fuso **Africa/Luanda**. Apenas alterações posteriores explicitamente submetidas por um utilizador autorizado mudam os valores.
- Editar e guardar mínimo/máximo com validação no servidor, revisão concorrente e motivo obrigatório.
- Ler os valores atuais nas validações reais dos pedidos; assegurar o teto diário conjunto aplicável ao mesmo titular nos fluxos existentes, sem criar carteira, ledger ou mecanismo paralelo.
- Mostrar histórico real com antes/depois, responsável, data, hora e motivo. Rejeitar configurações inválidas e moedas incompatíveis com o motor AOA.

### 4. Integração indivisível e segurança
- Ligar os formulários e ações às operações autorizadas, não apenas desbloquear os botões.
- Aplicar permissões em funções do servidor, RPCs e políticas RLS correspondentes; proteger também chamadas diretas.
- Preservar estados financeiros terminais, histórico, cálculos e proteções bancárias. Uma permissão de execução nunca substitui confirmação bancária autenticada.
- Não acrescentar aprovações simuladas, dados fictícios de histórico ou controlos de operações inexistentes.

## Validação e entrega

Depois da aprovação do SQL, ensaiar a instalação e a reversão num ambiente isolado, sem alterar saldos reais. Testar concretamente:
1. Criar e enviar convite; aceitar com a conta correta.
2. Rejeitar token expirado, reutilizado ou apresentado por outra conta.
3. Atribuir/alterar funções e permissões; negar autoelevação e autoaprovação.
4. Suspender/revogar e confirmar recusa nas operações protegidas, inclusive chamadas diretas.
5. Alterar limites no isolado, ler de volta e provar a aplicação dos novos valores nos pedidos existentes.
6. Confirmar mínimo, teto diário conjunto, concorrência e fuso de Luanda.
7. Consultar auditoria real de equipa e limites.
8. Percorrer as duas áreas com contas autorizadas e não autorizadas em telemóvel e computador.

Relatar separadamente resultados executados, falhas e verificações pendentes. Não enviar convites a contas reais nem mudar limites de produção para testes. Os 12 testes bancários permanecem separados e dependem da integração oficial.

## Detalhes técnicos

- Consultas atuais: `src/lib/admin-management.functions.ts`; páginas existentes: `/admin/equipa` e `/admin/limites`.
- Revisar `docs/finance/proposta-m1-limites.sql` e `proposta-m2-equipa.sql`; não aplicar as versões atuais incompletas.
- Usar funções autenticadas TanStack com cliente do utilizador/RLS; privilégio administrativo somente após verificação no servidor.
- Novas tabelas estritamente necessárias exigem grants explícitos e RLS; funções com privilégios elevados exigem proprietário verificado, `search_path` fixo e grants mínimos.
- Envio pelo serviço de emails existente, um destinatário por convite, com idempotência e sem segredos nos registos.