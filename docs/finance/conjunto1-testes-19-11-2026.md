# Conjunto 1 — Testes em PostgreSQL local descartável (19/11/2026). Base real NÃO alterada.
Migração não aplicada: recusada pelo utilizador na aprovação.
T1 registo com NIF/BI: PASS (NIF/BI removidos dos metadados da conta)
T2 NIF repetido com formatação diferente: PASS (recusado)
T3 BI repetido: PASS (recusado) | T4 formato inválido: PASS (recusado)
T5 verificação prévia: PASS (taken/available, sem revelar conta)
T6 dois registos simultâneos: PASS (1 aceite, 1 recusado, 1 linha)
T7/T8 utilizador altera/apaga o próprio NIF/BI: PASS (recusado)
T9 outros dados editáveis: PASS | T10 segundo registo de identidade: PASS (recusado)
T11 conta existente completa identidade: PASS (estado mascarado •••888)
T12 conta existente com NIF de outra: PASS (recusado)
T13 não-admin corrige: PASS (forbidden) | T14 sem justificação: PASS (recusado)
T15 admin para NIF de outra conta: PASS (recusado) | T16 admin com justificação: PASS
T17 auditoria mascarada com autor e motivo: PASS
T18 outro utilizador lê documentos: PASS (0 linhas)
T19 registo sem NIF/BI (Google/contas antigas): PASS
Pendente: aplicar na base real, ecrã de registo/perfil, teste no navegador.
