import * as React from 'react'
import type { TemplateEntry } from './registry'
import { SubscriptionShell, dateFmt, type SubscriptionEmailProps } from './subscription-layout'

const Email = ({ storeName, planName, expiresAt }: SubscriptionEmailProps) => (
  <SubscriptionShell
    preview="A sua subscrição expirou"
    heading="Subscrição expirada"
    intro={`Olá${storeName ? ` ${storeName}` : ''}, o seu plano expirou. A criação de novas lives está bloqueada até renovar. Todo o histórico de faturação continua disponível no painel.`}
    rows={[
      ['Plano', planName ?? '—'],
      ['Expirou em', dateFmt(expiresAt)],
    ]}
    ctaLabel="Renovar plano"
    ctaUrl="https://www.livemarketplece.live/lojista/subscricao"
  />
)

export const template = {
  component: Email,
  subject: 'A sua subscrição expirou — Live Teká',
  displayName: 'Subscrição: expirada',
  previewData: { storeName: 'Loja Teste', planName: 'Básico', expiresAt: new Date().toISOString() },
} satisfies TemplateEntry
