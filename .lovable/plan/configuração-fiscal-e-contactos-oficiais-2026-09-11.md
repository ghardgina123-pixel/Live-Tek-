# Configuração fiscal e contactos oficiais

## Objetivo
Atualizar, numa única entrega, a identidade fiscal oficial da TUSSALA KAKA e os contactos de suporte do Live Teká, sem alterar faturação, pagamentos, segurança ou histórico.

## Alterações
- Acrescentar à configuração fiscal existente os campos opcionais `entity_type` e `vat_regime`; o segundo permanecerá nulo por não estar verificado.
- Atualizar a única identidade fiscal da plataforma com a razão social, NIF, morada, localização, tipo de entidade, regime de Imposto Industrial, moeda, estado ativo, email e telefone fornecidos.
- Manter o país no código já usado pelo sistema (`AO`, correspondente a Angola) e a moeda em `AOA`.
- Substituir apenas os contactos oficiais de suporte encontrados:
  - ajuda: email, WhatsApp e telefone;
  - rodapé da página inicial;
  - apoio ao lojista;
  - rodapé da página “Sobre”.
- Preservar contactos dinâmicos de prestadores e imobiliárias, pois pertencem aos respetivos parceiros e não ao suporte da aplicação.

## Segurança e preservação
- Não alterar RLS, permissões, funções financeiras, comissões, pagamentos, webhooks, snapshots já gravados, PDFs ou documentos históricos.
- A atualização da identidade fiscal afetará apenas snapshots criados futuramente; facturas existentes permanecerão imutáveis.
- Não criar facturas, séries, números fiscais, taxas ou validações AGT.

## Validação
- Consultar novamente a identidade fiscal e confirmar todos os valores, incluindo `vat_regime = NULL`.
- Fazer busca global pelo telefone e email antigos e confirmar que já não são usados como suporte.
- Confirmar a presença dos novos contactos nos locais corretos.
- Executar verificação de tipos, todos os testes automatizados e compilação de produção.
- Rever o estado final de compilação e reportar qualquer item não comprovável como **NÃO VERIFICADO**.
