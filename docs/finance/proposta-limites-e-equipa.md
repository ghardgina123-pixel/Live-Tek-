# Proposta Técnica Consolidada — Gestão de Limites Financeiros + Gestão de Equipa e Permissões

**Estado: APENAS PROPOSTA PARA REVISÃO. Nada foi aplicado. Nenhum código, tabela, dado, função ou política foi alterado.**

Data: 2026-11-07 · Solicitante: António Garcia

---

## 1. AUDITORIA — O que já existe

### 1.1 Limites financeiros

| Item | Estado atual |
|---|---|
| `withdrawal_limits` (currency PK, max_daily_amount, min_amount, timezone, updated_at) | Existe. AOA: mínimo 10.000, máximo diário 200.000, fuso Africa/Luanda. |
| `financial_settings.min_withdrawal_aoa` | Existe com valor **200.000** — divergente do mínimo real de 10.000. Hoje prevalece `withdrawal_limits`, mas o valor antigo serve de fallback em `min_withdrawal_aoa()`. |
| Enforcement no backend | `request_store_withdrawal`, `request_payout` (afiliados/entregadores) consultam limites, verificam saldo e usam locks transacionais. |
| Funções `min_withdrawal_aoa()` / `max_daily_withdrawal_aoa()` | Existem; **fixas em AOA**, sem resolução por país/mercado. |
| RLS/permissões | `withdrawal_limits`: apenas SELECT para authenticated. Sem escrita direta. `financial_settings`: SELECT authenticated. |
| Auditoria | `financial_audit_log` (actor_id, action, resource, previous_state, new_state, result, operation_id, metadata, created_at), append-only com trigger anti-UPDATE/DELETE. Hoje só contém eventos `withdrawal_request` (19). |
| Identificação de país | `countries`, `profiles.country_id/country_code`, lojas/entregadores com país. |
| Painel admin | `admin.financeiro.tsx` gere pedidos de levantamento. **Não existe UI nem RPC para editar limites.** |

### 1.2 Equipa e permissões

| Item | Estado atual |
|---|---|
| `user_roles` (user_id, role) + enum `app_role` (customer, seller, admin) + `has_role()` security definer | Existe. Apenas 3 papéis globais. Um único admin real (Tónio GharDgina). |
| Funções `admin_*` (28) | Verificam `has_role(auth.uid(),'admin')`. |
| `financial_audit_log` / `security_audit_log` | Existem, com actor e resultado. |
| Tabela de funcionários, convites, permissões granulares, funções Contabilista/Financeiro | **Não existe.** |
| Separação consultar/preparar/aprovar/executar | **Não existe** — admin faz tudo. |
| Monitorização por funcionário | Parcial: audit logs registam actor_id, mas não há ecrã de supervisão por membro. |

### 1.3 Lacunas e riscos confirmados

1. Limites identificados só por moeda — dois países com a mesma moeda não podem ter regras diferentes.
2. Resolução de limites fixa em AOA; sem seleção por país/mercado.
3. `financial_settings.min_withdrawal_aoa = 200000` divergente (fallback perigoso).
4. Sem histórico versionado de alterações de limites (quem, quando, motivo, valores anteriores/novos).
5. Teto diário de afiliados e entregadores contabilizado separadamente — não garante teto conjunto de 200.000 para quem acumula funções.
6. Sem RBAC granular: não é possível ter Contabilista (só consulta/registo) e Financeiro (prepara/aprova) sem ser admin total.
7. Sem gestão de convites, suspensão ou revogação de acessos de equipa.
8. Sem ecrã de supervisão das operações por funcionário.

---

## 2. PROPOSTA — Módulo 1: Gestão de Limites Financeiros

### 2.1 Tabelas novas (aditivas)

```sql
-- Regras de limite por mercado (país) + moeda, versionadas
CREATE TABLE public.withdrawal_limit_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid REFERENCES public.countries(id),
  currency text NOT NULL,
  min_amount numeric NOT NULL CHECK (min_amount > 0),
  max_daily_amount numeric NOT NULL CHECK (max_daily_amount >= min_amount),
  timezone text NOT NULL DEFAULT 'Africa/Luanda',
  applies_to text[] NOT NULL DEFAULT '{store,affiliate,courier}',  -- funções abrangidas
  combined_daily_cap boolean NOT NULL DEFAULT true,               -- teto conjunto multi-função
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Regra: no máximo UMA regra ativa por (country_id, currency) — enforced por índice parcial:
CREATE UNIQUE INDEX withdrawal_limit_rules_one_active
  ON public.withdrawal_limit_rules (country_id, currency) WHERE is_active;

-- Histórico imutável de alterações de limites
CREATE TABLE public.withdrawal_limit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.withdrawal_limit_rules(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,              -- created, updated, activated, suspended
  reason text NOT NULL,
  previous_state jsonb,
  new_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 2.2 Funções

- `resolve_withdrawal_limits(p_user_id uuid, p_kind text)` — função central (security definer, stable): determina país/moeda do utilizador a partir de dados validados no servidor (loja para lojista; perfil/país para afiliado/entregador), devolve a regra ativa. **Sem regra ativa → devolve vazio e o pedido é bloqueado (fail-closed).**
- `admin_save_withdrawal_limit(...)` — security definer: exige permissão `limits.manage`; valida mínimo > 0, mínimo ≤ máximo, moeda do país, fuso válido; suspende a regra anterior e insere a nova na mesma transação; regista em `withdrawal_limit_history` com motivo e valores anteriores/novos.
- `admin_set_withdrawal_limit_active(rule_id, active, reason)` — ativa/suspende com histórico.
- Alteração de `request_store_withdrawal` / `request_payout` para usarem `resolve_withdrawal_limits` e, quando `combined_daily_cap = true`, somarem levantamentos do dia do utilizador em **todas** as funções (loja + afiliado + entregador) no mesmo fuso da regra.

### 2.3 Divergência `financial_settings.min_withdrawal_aoa = 200000`

Resolução sem perda de dados:
1. Manter a linha (histórico), mas deixar de a usar como fallback: `min_withdrawal_aoa()` passa a ler apenas a regra ativa; configuração ausente → bloqueia.
2. Marcar a coluna como deprecada: `COMMENT ON COLUMN public.financial_settings.min_withdrawal_aoa IS 'DEPRECATED: substituído por withdrawal_limit_rules (mínimo real 10.000 AOA). Valor legado 200000 preservado apenas como histórico.'`
3. Migração de dados: inserir em `withdrawal_limit_rules` a regra Angola/AOA (10.000 / 200.000 / Africa/Luanda, created_by = admin atual) e registar em `withdrawal_limit_history` como `created` com motivo "migração da configuração inicial".

---

## 3. PROPOSTA — Módulo 2: Gestão de Equipa e Permissões

### 3.1 Modelo RBAC granular (sem duplicar `user_roles`)

`user_roles`/`app_role` mantêm-se para papéis de plataforma (customer/seller/admin). A equipa administrativa fica num modelo próprio:

```sql
-- Funções administrativas configuráveis (Contabilista, Financeiro, futuras)
CREATE TABLE public.staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,          -- 'contabilista', 'financeiro', ...
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Permissões atómicas
CREATE TABLE public.staff_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,          -- 'finance.view', 'finance.prepare', 'finance.approve',
                                      -- 'finance.execute', 'limits.manage', 'team.manage', ...
  label text NOT NULL
);

-- Permissões por função (modelo base)
CREATE TABLE public.staff_role_permissions (
  role_id uuid REFERENCES public.staff_roles(id) ON DELETE CASCADE,
  permission_id uuid REFERENCES public.staff_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Membros da equipa (contas individuais, nunca partilhadas)
CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,       -- conta individual em auth.users
  role_id uuid NOT NULL REFERENCES public.staff_roles(id),
  full_name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')),
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Permissões específicas por funcionário (exceções ao modelo da função)
CREATE TABLE public.staff_member_permissions (
  member_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  permission_id uuid REFERENCES public.staff_permissions(id) ON DELETE CASCADE,
  granted boolean NOT NULL,           -- true = concede, false = revoga excecionalmente
  reason text NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, permission_id)
);

-- Convites
CREATE TABLE public.staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.staff_roles(id),
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 Funções

- `has_staff_permission(p_user_id uuid, p_permission text)` — security definer, stable: membro ativo + permissão via função ou exceção concedida, menos exceções revogadas. **Admin (app_role) mantém acesso total.**
- `admin_invite_staff(email, role_code, full_name)` — cria convite com token; envio de email pelo fluxo de email existente (`enqueue_email`).
- `accept_staff_invite(token)` — no primeiro acesso: cria/liga a conta individual e o `staff_members` (status active).
- `admin_update_staff(member_id, ...)` / `admin_set_staff_status(member_id, status, reason)` — alterar função, suspender, revogar. Revogação é imediata: `has_staff_permission` devolve false para status ≠ active.
- `admin_grant_staff_permission(member_id, permission, granted, reason)` — exceções individuais.
- Reescrita das verificações nas funções financeiras sensíveis: `admin_settle_payout`, `admin_withdrawal_action`, `admin_register_external_invoice` passam a exigir permissões específicas (`finance.approve`, `finance.execute`) em vez de apenas `admin`. **Contabilista recebe apenas `finance.view` + `finance.prepare` — nunca `finance.execute`.**

### 3.3 Auditoria de equipa

- Reutilizar `financial_audit_log` para operações financeiras (já tem actor/result/estados) e `security_audit_log` para eventos de acesso (convite, suspensão, revogação, login).
- Nova RPC `admin_staff_activity(member_id, from, to)` — security definer, só `team.manage`/admin: junta ambos os logs por actor, com operação, data/hora e resultado. Ecrã "Equipa → atividade" no painel.
- Ambos os logs já têm triggers anti-UPDATE/DELETE; manter e estender a mesma proteção às tabelas novas de histórico.

---

## 4. Permissões e políticas (resumo)

| Tabela | authenticated | service_role |
|---|---|---|
| withdrawal_limit_rules / history | SELECT (admin ou `limits.manage`) | ALL |
| staff_roles / staff_permissions / role_permissions | SELECT admin/`team.manage` | ALL |
| staff_members | SELECT próprio + admin/`team.manage` | ALL |
| staff_invites | sem acesso direto (só via RPC) | ALL |
| staff_member_permissions | SELECT admin/`team.manage` | ALL |

Todas com RLS ativo, GRANTs explícitos na mesma migração, e triggers `block_mutation` (UPDATE/DELETE) nas tabelas de histórico.

---

## 5. Fluxos operacionais

1. **Alterar limite:** gestor → painel "Limites Financeiros" → escolhe país/moeda → define mínimo/máximo/fuso/vigência + motivo → `admin_save_withdrawal_limit` valida, suspende regra anterior, grava nova + histórico numa transação.
2. **Pedido de levantamento:** RPC → `resolve_withdrawal_limits(user)` → sem regra ativa: bloqueia; com regra: valida mínimo, soma diária (conjunta se configurado) no fuso da regra, saldo → reserva.
3. **Convite de funcionário:** gestor → "Equipa → convidar" → email + função → convite com token → funcionário cria conta individual → `accept_staff_invite` → ativo com permissões da função.
4. **Operação financeira por funcionário:** RPC verifica `has_staff_permission` (ex.: `finance.approve`) → executa → regista em `financial_audit_log` com actor_id, estados e resultado.
5. **Supervisão:** gestor → "Equipa → atividade" → `admin_staff_activity` lista operações do membro (consultas financeiras, alterações, aprovações, pagamentos) com data/hora e resultado.
6. **Suspensão/revogação:** gestor → status suspended/revoked → acesso cortado imediatamente; histórico preservado.

---

## 6. Riscos e incompatibilidades

1. **Dupla verificação admin/permissão:** durante a transição, funções `admin_*` devem aceitar admin total **ou** a permissão específica, para não bloquear o gestor atual.
2. **Locks conjuntos multi-função:** somar levantamentos de loja+afiliado+entregador exige locks consistentes por utilizador — risco de deadlock se a ordem de locks não for uniforme (sempre bloquear por user_id antes das tabelas de valores).
3. **Fuso horário por mercado:** o "dia" do teto passa a depender do fuso da regra; pedidos antigos foram contados em Africa/Luanda — manter Angola igual.
4. **Contas partilhadas:** o modelo exige user_id único por membro; convites reutilizados ou contas partilhadas devem ser detetados (um `staff_members` por user_id).
5. **Revogação de sessões ativas:** `has_staff_permission` é avaliado por chamada, logo a revogação é efetiva de imediato; tokens JWT existentes não concedem nada por si.
6. **Divergência legada:** até a migração ser aplicada, `min_withdrawal_aoa = 200000` continua como fallback — a proposta elimina esse fallback (fail-closed).
7. **i18n:** novos ecrãs precisam de chaves de tradução nos idiomas existentes.

---

## 7. Plano de testes e critérios de aprovação (todos PENDENTES — ambiente isolado)

| # | Teste | Critério |
|---|---|---|
| T1 | Criar regra Angola 10.000/200.000 | Regra ativa única; histórico registado com responsável e motivo |
| T2 | Alterar mínimo para 15.000 | Regra anterior suspensa; histórico com valores anteriores/novos; novos pedidos < 15.000 recusados |
| T3 | Sem regra ativa para o país | Pedido bloqueado (fail-closed), nunca contorna |
| T4 | Utilizador lojista+afiliado, teto conjunto | Soma do dia em ambas as funções ≤ 200.000; excedente recusado |
| T5 | Dois países com a mesma moeda | Regras independentes por país |
| T6 | Não autorizado tenta gravar limite | Recusado no backend e na base de dados |
| T7 | Convidar contabilista | Conta individual criada; só `finance.view`/`finance.prepare`; tentativa de `admin_settle_payout` recusada |
| T8 | Financeiro aprova pagamento | Permitido com `finance.approve`; auditado com actor/resultado |
| T9 | Suspender funcionário | Acesso cortado de imediato; histórico intacto |
| T10 | Alterar/apagar histórico de limites ou auditoria | Bloqueado por trigger/permissões |
| T11 | Concorrência: 2 alterações de limite simultâneas | Uma só regra ativa; sem perda de histórico |
| T12 | Concorrência: levantamentos simultâneos no teto | Nunca ultrapassa o máximo diário |

Critério de aprovação: 12/12 PASS em ambiente isolado com dados fictícios, sem tocar no ledger de produção.

---

## 8. Migrações SQL

**Preparadas para revisão em ficheiros separados, NÃO aplicadas:**
- `docs/finance/proposta-m1-limites.sql` — tabelas, índices, RLS, grants, funções de limites, migração da regra Angola, deprecação do fallback.
- `docs/finance/proposta-m2-equipa.sql` — tabelas RBAC de equipa, seeds de funções (contabilista, financeiro) e permissões, funções, RLS, grants.

A implementação só avança após revisão e autorização expressa.
