# Arquitetura de Segurança — Live Teká

Documento de referência para auditorias. Descreve as camadas de defesa
(Defense in Depth) implementadas e o que ainda depende de decisão do produto.

## 1. Transporte (TLS)

- Todo o tráfego é servido exclusivamente por HTTPS/TLS pela plataforma.
- `src/server.ts` aplica em **todas** as respostas:
  `Strict-Transport-Security` (2 anos, subdomínios, preload),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (câmara/microfone/GPS só same-origin)
  e `Cross-Origin-Opener-Policy: same-origin`.

## 2. Autenticação e sessão

- Autenticação gerida pelo backend (JWT de curta duração + refresh rotativo).
- Timeout de inatividade de 30 minutos em `src/hooks/use-auth.tsx` (`signOut` automático).
- Rotas privadas protegidas pelo gate `src/routes/_authenticated/route.tsx`.
- Tokens nunca são persistidos em código; o bearer é anexado às chamadas de
  servidor por `attachSupabaseAuth` (`src/start.ts`).

## 3. Autorização (RLS + RBAC)

- Papéis em tabela dedicada `user_roles` + função `has_role()` (SECURITY DEFINER).
- RLS activo em todas as tabelas do schema `public`, com GRANTs explícitos.
- Funções `admin_*` e utilitários sensíveis com `EXECUTE` revogado a `anon`.
- Triggers `BEFORE UPDATE` impedem escalonamento (auto-aprovação de lojas,
  auto-marcação de pedidos como pagos, alteração de estado por não-admins).

## 4. Endpoints

- Lógica interna: `createServerFn` com `.middleware([requireSupabaseAuth])` —
  a identidade vem sempre do token, nunca do payload do cliente.
- Entrada validada com Zod em todos os `inputValidator`.
- Endpoints públicos (`src/routes/api/public/*`) validam segredo partilhado com
  comparação *timing-safe* e registam tentativas falhadas.

## 5. Credenciais e dados em repouso

- Segredos (LiveKit, VAPID, Multicaixa) vivem apenas em variáveis de ambiente
  do servidor; nunca no bundle do browser.
- O segredo do webhook de push é lido do **Vault** encriptado, não de migração.
- A base de dados é encriptada em repouso (AES-256) ao nível do storage;
  segredos aplicacionais adicionais devem ir para o Vault, não para colunas.

## 6. LiveKit

- Tokens emitidos apenas por `src/lib/livekit.functions.ts`, autenticado.
- TTL de **10 minutos**; renovados a cada entrada na sala.
- `canPublish` só é concedido ao dono da loja da live; pedidos negados geram
  evento de auditoria `livekit.publish_denied`.
- O identificador interno `livekit_room` nunca é exposto ao browser.

## 7. Auditoria

- Tabela `public.security_audit_log` (leitura só para admins, escrita só pelo
  service role) com `event`, `severity`, `actor_id`, `subject_id`, `ip`,
  `user_agent`, `metadata`.
- Helper `src/lib/audit.server.ts` (`recordSecurityEvent`) — nunca lança erro.
- Eventos já cobertos: emissão/negação de tokens LiveKit, webhooks de push com
  autorização inválida ou assinatura errada.
- Auditoria de domínio (lives, câmaras) continua em `live_events`.

## 8. Rotação e resposta a incidentes

1. Rodar o segredo afectado (Vault / variáveis de ambiente).
2. Consultar `security_audit_log` filtrando por `event` e `occurred_at`.
3. Revogar papéis em `user_roles` se houver conta comprometida.

## 9. Ponto em aberto

- **Rate limiting / anti-força-bruta**: o backend não dispõe de primitiva
  padrão de limitação de pedidos. Requer decisão explícita antes de se
  implementar uma solução ad-hoc (contadores por IP em tabela + bloqueio
  temporário), com o custo de escrita extra por tentativa de login.