-- ============================================================================
-- PROPOSTA M2 — Gestão de Equipa e Permissões (APENAS PARA REVISÃO — NÃO APLICAR)
-- Live Teká · 2026-11-07
-- Aditiva: não altera user_roles nem as funções admin_* existentes nesta fase.
-- ============================================================================

-- 1. Funções administrativas configuráveis
CREATE TABLE public.staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Permissões atómicas
CREATE TABLE public.staff_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL
);

-- 3. Permissões por função
CREATE TABLE public.staff_role_permissions (
  role_id uuid NOT NULL REFERENCES public.staff_roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.staff_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 4. Membros da equipa (contas individuais)
CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  role_id uuid NOT NULL REFERENCES public.staff_roles(id),
  full_name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')),
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Exceções de permissão por funcionário
CREATE TABLE public.staff_member_permissions (
  member_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.staff_permissions(id) ON DELETE CASCADE,
  granted boolean NOT NULL,
  reason text NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, permission_id)
);

-- 6. Convites
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

-- Grants
GRANT SELECT ON public.staff_roles, public.staff_permissions, public.staff_role_permissions,
  public.staff_members, public.staff_member_permissions TO authenticated;
GRANT ALL ON public.staff_roles, public.staff_permissions, public.staff_role_permissions,
  public.staff_members, public.staff_member_permissions, public.staff_invites TO service_role;

-- RLS
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_roles_read ON public.staff_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_staff_permission(auth.uid(), 'team.manage'));
CREATE POLICY staff_permissions_read ON public.staff_permissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_staff_permission(auth.uid(), 'team.manage'));
CREATE POLICY staff_role_permissions_read ON public.staff_role_permissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_staff_permission(auth.uid(), 'team.manage'));
CREATE POLICY staff_members_read ON public.staff_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
         OR public.has_staff_permission(auth.uid(), 'team.manage'));
CREATE POLICY staff_member_permissions_read ON public.staff_member_permissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_staff_permission(auth.uid(), 'team.manage'));
-- staff_invites: sem acesso direto; apenas via RPCs security definer.

-- 7. Verificação central de permissão de equipa
CREATE OR REPLACE FUNCTION public.has_staff_permission(p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_members m
    JOIN public.staff_roles r ON r.id = m.role_id AND r.is_active
    JOIN public.staff_role_permissions rp ON rp.role_id = r.id
    JOIN public.staff_permissions p ON p.id = rp.permission_id AND p.code = p_permission
    WHERE m.user_id = p_user_id AND m.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_member_permissions mp
        WHERE mp.member_id = m.id AND mp.permission_id = p.id AND mp.granted = false
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.staff_members m
    JOIN public.staff_member_permissions mp ON mp.member_id = m.id AND mp.granted = true
    JOIN public.staff_permissions p ON p.id = mp.permission_id AND p.code = p_permission
    WHERE m.user_id = p_user_id AND m.status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION public.has_staff_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(uuid, text) TO authenticated;

-- 8. Funções e permissões iniciais (Contabilista e Financeiro)
INSERT INTO public.staff_roles (code, label) VALUES
  ('contabilista', 'Contabilista'),
  ('financeiro', 'Financeiro');

INSERT INTO public.staff_permissions (code, label) VALUES
  ('finance.view', 'Consultar operações financeiras'),
  ('finance.prepare', 'Preparar operações financeiras'),
  ('finance.approve', 'Aprovar operações financeiras'),
  ('finance.execute', 'Executar pagamentos e liquidações'),
  ('limits.manage', 'Gerir limites financeiros'),
  ('team.manage', 'Gerir equipa e permissões');

-- Contabilista: consulta e prepara; NUNCA executa dinheiro
INSERT INTO public.staff_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.staff_roles r, public.staff_permissions p
WHERE r.code = 'contabilista' AND p.code IN ('finance.view', 'finance.prepare');

-- Financeiro: consulta, prepara e aprova (execução só por exceção individual)
INSERT INTO public.staff_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.staff_roles r, public.staff_permissions p
WHERE r.code = 'financeiro' AND p.code IN ('finance.view', 'finance.prepare', 'finance.approve');

-- 9. Convite de funcionário
CREATE OR REPLACE FUNCTION public.admin_invite_staff(
  p_email text, p_role_code text, p_full_name text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_id uuid;
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_staff_permission(auth.uid(), 'team.manage') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT id INTO v_role_id FROM public.staff_roles WHERE code = p_role_code AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown role'; END IF;

  INSERT INTO public.staff_invites (email, role_id, token, invited_by, expires_at)
  VALUES (lower(btrim(p_email)), v_role_id, encode(gen_random_bytes(24), 'hex'),
          auth.uid(), now() + interval '7 days')
  RETURNING id INTO v_id;

  INSERT INTO public.security_audit_log (event, severity, actor_id, metadata)
  VALUES ('staff_invite_created', 'info', auth.uid(),
          jsonb_build_object('invite_id', v_id, 'email', lower(btrim(p_email)), 'role', p_role_code));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_invite_staff(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_invite_staff(text, text, text) TO authenticated;

-- 10. Aceitar convite (conta individual do utilizador autenticado)
CREATE OR REPLACE FUNCTION public.accept_staff_invite(p_token text, p_full_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite public.staff_invites;
  v_member_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_invite FROM public.staff_invites
  WHERE token = p_token AND status = 'pending' AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid or expired invite'; END IF;

  -- uma conta individual só pode ter um lugar na equipa
  IF EXISTS (SELECT 1 FROM public.staff_members WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'user already in staff';
  END IF;

  INSERT INTO public.staff_members (user_id, role_id, full_name, status, invited_by)
  VALUES (auth.uid(), v_invite.role_id, p_full_name, 'active', v_invite.invited_by)
  RETURNING id INTO v_member_id;

  UPDATE public.staff_invites SET status = 'accepted' WHERE id = v_invite.id;

  INSERT INTO public.security_audit_log (event, severity, actor_id, metadata)
  VALUES ('staff_invite_accepted', 'info', auth.uid(),
          jsonb_build_object('member_id', v_member_id, 'invite_id', v_invite.id));

  RETURN v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_staff_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(text, text) TO authenticated;

-- 11. Alterar função / suspender / revogar
CREATE OR REPLACE FUNCTION public.admin_set_staff_status(
  p_member_id uuid, p_status text, p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev public.staff_members;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_staff_permission(auth.uid(), 'team.manage') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_status NOT IN ('active','suspended','revoked') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  SELECT * INTO v_prev FROM public.staff_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found'; END IF;
  IF v_prev.status = 'revoked' THEN RAISE EXCEPTION 'revoked is terminal'; END IF;
  IF v_prev.user_id = auth.uid() THEN RAISE EXCEPTION 'cannot change own status'; END IF;

  UPDATE public.staff_members SET status = p_status, updated_at = now() WHERE id = p_member_id;

  INSERT INTO public.security_audit_log (event, severity, actor_id, subject_id, metadata)
  VALUES ('staff_status_changed', 'warning', auth.uid(), v_prev.user_id,
          jsonb_build_object('member_id', p_member_id, 'from', v_prev.status,
                             'to', p_status, 'reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_status(uuid, text, text) TO authenticated;

-- 12. Exceção individual de permissão
CREATE OR REPLACE FUNCTION public.admin_grant_staff_permission(
  p_member_id uuid, p_permission text, p_granted boolean, p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_permission_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_staff_permission(auth.uid(), 'team.manage') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT id INTO v_permission_id FROM public.staff_permissions WHERE code = p_permission;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown permission'; END IF;

  INSERT INTO public.staff_member_permissions (member_id, permission_id, granted, reason, granted_by)
  VALUES (p_member_id, v_permission_id, p_granted, p_reason, auth.uid())
  ON CONFLICT (member_id, permission_id)
  DO UPDATE SET granted = p_granted, reason = p_reason, granted_by = auth.uid(), created_at = now();

  INSERT INTO public.security_audit_log (event, severity, actor_id, metadata)
  VALUES ('staff_permission_override', 'warning', auth.uid(),
          jsonb_build_object('member_id', p_member_id, 'permission', p_permission,
                             'granted', p_granted, 'reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_staff_permission(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_staff_permission(uuid, text, boolean, text) TO authenticated;

-- 13. Supervisão: atividade de um membro (consultas, alterações, aprovações, pagamentos)
CREATE OR REPLACE FUNCTION public.admin_staff_activity(
  p_member_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
)
RETURNS TABLE(source text, action text, result text, occurred_at timestamptz, metadata jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_staff_permission(auth.uid(), 'team.manage') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT user_id INTO v_user_id FROM public.staff_members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found'; END IF;

  RETURN QUERY
    SELECT 'financial'::text, f.action, f.result, f.created_at, f.metadata
    FROM public.financial_audit_log f
    WHERE f.actor_id = v_user_id
      AND (p_from IS NULL OR f.created_at >= p_from)
      AND (p_to IS NULL OR f.created_at <= p_to)
    UNION ALL
    SELECT 'security'::text, s.event, s.severity, s.occurred_at, s.metadata
    FROM public.security_audit_log s
    WHERE s.actor_id = v_user_id
      AND (p_from IS NULL OR s.occurred_at >= p_from)
      AND (p_to IS NULL OR s.occurred_at <= p_to)
    ORDER BY occurred_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_staff_activity(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_staff_activity(uuid, timestamptz, timestamptz) TO authenticated;

-- NOTA: a passagem das funções admin_* financeiras (admin_settle_payout,
-- admin_withdrawal_action, admin_register_external_invoice) de "só admin" para
-- "admin OU permissão específica" (finance.approve / finance.execute) fica para
-- a fase de implementação, após testes em ambiente isolado, para não alterar
-- fluxos financeiros ativos sem validação.
