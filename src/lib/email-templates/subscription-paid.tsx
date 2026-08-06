import * as React from 'react'
import type { TemplateEntry } from './registry'
import { SubscriptionShell, money, dateFmt, type SubscriptionEmailProps } from './subscription-layout'

const Email = ({ storeName, planName, amountAoa, expiresAt, invoiceNumber }: SubscriptionEmailProps) => (
  <SubscriptionShell
    preview={`Pagamento confirmado — plano ${planName ?? ''} ativo`}
    heading="Pagamento confirmado"
    intro={`Olá${storeName ? ` ${storeName}` : ''}, o seu pagamento foi confirmado e o plano está ativo. Já pode transmitir em direto.`}
    rows={[
      ['Plano', planName ?? '—'],
      ['Valor pago', money(amountAoa)],
      ['Válido até', dateFmt(expiresAt)],
      ['Fatura', invoiceNumber ?? 'disponível no painel'],
    ]}
    ctaLabel="Descarregar fatura"
    ctaUrl="https://www.livemarketplece.live/lojista/subscricao"
  />
)

export const template = {
  component: Email,
  subject: 'Pagamento confirmado — subscrição ativa na Live Teká',
  displayName: 'Subscrição: pagamento confirmado',
  previewData: { storeName: 'Loja Teste', planName: 'Profissional', amountAoa: 55000, expiresAt: new Date().toISOString() },
} satisfies TemplateEntry
