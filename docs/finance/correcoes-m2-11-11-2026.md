# M2 — correções pontuais para nova revisão

**11/11/2026. SOMENTE REVISÃO. Nenhuma migração nem alteração de dados.** A tentativa anterior foi cancelada antes de executar; a autorização anterior não se estende a esta versão modificada. M1 permanece inalterado e não será aplicado nesta fase.

## 1. Aprovação independente

O diagnóstico tem uma nuance: administradores sem registo em staff_members podiam aprovar pelo fallback has_role. Membros ativos, incluindo gestores, não podiam: staff_can recusava team.approve explicitamente e staff_permissions_valid não a admitia.

Correção limitada às validações existentes:
- Admitir team.approve exclusivamente na categoria gestor, exigindo team.read.
- Reconhecer essa permissão em staff_can para membros ativos com permissões válidas; conservar deny-first para suspensos/revogados.
- Manter o bloqueio proposer = approver, target = proposer/approver, alteração de função usada pelo próprio e proteção de administradores.
- Rever novamente a autoridade do proponente no momento da aprovação, incluindo validade da categoria/permissões; um admin com vínculo de equipa não contorna as permissões desse vínculo.
- Nenhum membro recebe a nova permissão automaticamente; concessões passam pelo workflow existente de pedido e aprovação.

Se houver apenas um administrador e nenhum aprovador independente configurado, a primeira criação de função continuará bloqueada. Isso é separação de responsabilidades, não um erro a contornar. Não criar um aprovador fictício nem autoaprovar.

## 2. Gestor 1: único autorizador de convites

Consulta apenas de leitura confirmou a conta indicada como existente, email confirmado e papel admin. A proposta fixa **o UUID dessa conta real e o email autorizado** e compara-os com auth.uid() e auth.users no servidor, nunca com um email enviado pelo navegador ou metadados editáveis.

staff_invite_authorize verifica a identidade protegida e a situação atual. É obrigatória em criação/reemissão, consulta do destinatário para envio, registo do envio e revogação de convite. team.manage sozinho não autoriza nenhuma dessas operações. Aceitar um convite é uma operação do destinatário e não dá poderes para convidar.

O único autorizador pode perder esse poder se a conta deixar de corresponder ao UUID/email confirmado, perder admin ou for suspensa/revogada. Não há fallback para outro administrador, service_role ou outra conta com o mesmo email.

## 3. Pessoas ainda sem conta

O SQL anterior exigia encontrar uma conta confirmada antes de criar o convite; portanto não suportava este caso.

Acrescentar apenas staff_invitations é necessário para guardar email/token antes de existir um user_id real. Preservar staff_members e a sua chave por utilizador, staff_roles, staff_change_requests e a autenticação existente. Não gerar UUID fictício de utilizador, não criar conta automaticamente e não alterar tabelas geridas de autenticação.

Fluxo proposto: Gestor 1 convida email → destinatário abre /convite → entra ou regista-se pelo fluxo existente → confirma o email → apresenta o token com sessão da conta correspondente → aceitação cria/reativa o vínculo real e consome o token atomicamente. Antes disso não existe acesso de equipa.

O fragmento da ligação deve ser recolhido e removido imediatamente pela página. Durante registo/confirmação conservar o convite apenas em armazenamento da sessão na origem da aplicação, nunca em query string, redirecionamento externo, telemetria ou logs. A página deve permitir retomar a ligação original se a sessão não sobreviver ao registo.

## 4. Tokens

- 32 bytes aleatórios (256 bits), hash SHA-256; validade sete dias.
- Hash sem leitura por roles da aplicação e fora da auditoria.
- Reenvio gera novo token e invalida imediatamente o anterior; convites aceites/revogados não podem ser aceites novamente.
- Conta autenticada + email confirmado correspondem ao destinatário; token de outro email é recusado.
- A aceitação verifica novamente a identidade/autoridade de Gestor 1 e a versão/permissões da função; função alterada exige novo convite, sem ampliação silenciosa de poderes.
- Lock comum e FOR UPDATE protegem consumo único, reenvio e revogação concorrentes.
- Token entregue uma vez ao fluxo autenticado do Gestor 1 para envio; nunca retornar no resultado da função de servidor ao navegador nem registá-lo.

## 5. Entrega real de email — lacuna que não pode ser resolvida apenas com SQL

Estado consultado: domínio ativo e fila saudável; zero envios nos últimos sete dias. Isso não prova que um convite foi entregue. Não enviei emails nesta revisão.

Inspeção do código existente:
- Não existe template staff-invite no registo de emails.
- A rota de envio atual ignora recipientEmail e envia ao próprio utilizador autenticado; usá-la sem adaptação enviaria o convite à pessoa errada.
- O helper interno aceita destinatários arbitrários e não valida a identidade do autorizador; não é um caminho autorizado para convites.
- O helper chama queued de sent e a sua verificação prévia de idempotência não é prova de exclusão concorrente.

**Correção necessária após aprovação, não executada agora:** na rota única de envio, adicionar um ramo dedicado staff-invite que valide o bearer com getUser, obtenha o cliente autenticado do mesmo utilizador e execute staff_invite_authorize/validação do convite antes de qualquer envio privilegiado. Usar destinatário, função e token derivados do convite validado, nunca dados arbitrários do browser. Bloquear o template no helper interno genérico e quaisquer triggers, tarefas ou chamadas que dispensem Gestor 1.

Uma função de servidor autenticada encadeia emissão do token e envio por esse ramo; não envia um lote. A operação usa chave idempotente derivada de invitation_id + version, supressão fail-closed, fila e footer obrigatórios existentes. O token só aparece no conteúdo da mensagem na fila restrita para entrega; nunca em logs, auditoria, URLs de pedido ou metadados de idempotência.

Fila confirmada = queued; falha = failed; supressão = suppressed. Nunca anunciar delivered ou chegada à caixa com base em queued. Falha depois de criação deixa convite pendente e permite reemissão explícita pelo Gestor 1. O SQL regista estado operacional, mas chamar o RPC de delivery não constitui evidência independente de entrega e deve ocorrer só após o resultado real do enfileiramento. A validação do envio e aceitação é feita como o utilizador real, não como service_role.

## 6. Ficheiros e verificações

- Versão integral atualizada: proposta-m2-integracao-revisada.sql.
- Diff pontual contra a versão apresentada: correcoes-m2-11-11-2026.patch.
- Estruturas corretas de membros, funções, pedidos e auditoria preservadas; M1 inalterado.
- Apenas inspeção e parsing local; testes SQL de permissões, concorrência e envio ponta a ponta **PENDENTES**. Não há PASS funcional nem prova de entrega.
- Reversão anterior deverá contemplar os RPCs de convite e staff_invitations adicionados antes de futura execução; não executar a reversão nesta fase.

**Nova aprovação expressa do SQL atualizado é necessária. Não executar migrações durante esta revisão.**