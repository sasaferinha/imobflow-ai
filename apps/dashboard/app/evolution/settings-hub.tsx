'use client';

import type { ReactNode } from 'react';
import type { CrmState } from '@/lib/evolution/model';
import s from './settings-hub.module.css';

type Props = {
  state: CrmState; isAdmin: boolean; integrated: boolean; children: ReactNode;
  onWhatsApp: () => void; onAI: () => void; onWebsite: () => void; onTeam: () => void;
  onAccount?: () => void;
  onCaptureGoal: () => void;
};

function Symbol({ kind }: { kind: 'chat' | 'ai' | 'site' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'chat' ? <path d="M21 11.5a8.5 8.5 0 0 1-12 7.7L3 21l1.8-6A8.5 8.5 0 1 1 21 11.5ZM8 9h8M8 13h5" /> : kind === 'site' ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 6.5h.1M10 6.5h.1M8 13h8M8 16h5" /></> : <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /></>}
  </svg>;
}

export default function SettingsHub({ state, isAdmin, integrated, children, onWhatsApp, onAI, onWebsite, onTeam, onAccount, onCaptureGoal }: Props) {
  if (!isAdmin) return <section className={s.root} aria-labelledby="settings-access-title">
    <header className={s.intro}><div><span className={s.eyebrow}>CONFIGURAÇÕES DA IMOBILIÁRIA</span><h2 id="settings-access-title">Acesso exclusivo do administrador</h2><p>Você está usando uma conta de corretor.</p></div><span className={s.badge}>Perfil de corretor</span></header>
    <div className={`${s.card} ${s.accessCard}`}>
      <h3>As configurações da empresa ficam com o administrador</h3>
      <p>Conexões dos canais, preferências da IA e regras de atendimento só podem ser alteradas pelo administrador da imobiliária.</p>
      <p>Se você também possui uma conta de administrador, abra o menu do seu nome no canto superior direito, saia da conta atual e entre com esse acesso. Caso contrário, peça ao administrador para fazer os ajustes.</p>
      {integrated && onAccount && <button type="button" className={s.secondary} onClick={onAccount}>Minha conta <span aria-hidden="true">→</span></button>}
    </div>
  </section>;
  return <div className={s.root}>
    <header className={s.intro}><div><span className={s.eyebrow}>COMECE POR AQUI</span><h2>Prepare sua imobiliária para trabalhar</h2><p>Conecte seus canais e defina como a ImobFlow deve ajudar sua equipe.</p></div><span className={s.badge}>Somente administrador</span></header>
    <div className={s.cards}>
      <section className={s.card}>
        <div className={s.cardTop}><span className={s.symbol}><Symbol kind="chat" /></span><span className={s.step}>01</span></div>
        <h3>WhatsApp da empresa</h3><p>Autorize o número da imobiliária para centralizar as conversas e o atendimento.</p>
        <span className={s.status}>Conexão pela Meta</span>
        <button type="button" className={s.primary} disabled={!integrated} onClick={onWhatsApp}>Configurar WhatsApp <span aria-hidden="true">→</span></button>
        <small>{integrated ? 'Você verá a situação do número antes de conectar ou alterar qualquer coisa.' : 'A conexão fica disponível no painel real da imobiliária.'}</small>
      </section>
      <section className={s.card}>
        <div className={s.cardTop}><span className={s.symbol}><Symbol kind="ai" /></span><span className={s.step}>02</span></div>
        <h3>IA de atendimento</h3><p>Escolha venda, locação ou ambos. Defina o atendimento automático e o apoio ao corretor.</p>
        <span className={s.status}>{state.settings.ai ? 'Preferências salvas' : 'Revise suas preferências'}</span>
        <button type="button" className={s.secondary} onClick={onAI}>Configurar IA <span aria-hidden="true">→</span></button>
        <small>Salvar preferências não confirma o funcionamento do provedor de IA.</small>
      </section>
      <section className={s.card}>
        <div className={s.cardTop}><span className={s.symbol}><Symbol kind="site" /></span><span className={s.step}>03</span></div>
        <h3>Site da imobiliária</h3><p>Prepare a conexão para publicar imóveis, atualizar anúncios e retirar os indisponíveis.</p>
        <span className={`${s.status} ${s.pending}`}>{state.settings.website?.url ? 'Aguardando integração' : 'Integração ainda não ativa'}</span>
        <button type="button" className={s.secondary} onClick={onWebsite}>{state.settings.website?.url ? 'Ver preparação do site' : 'Preparar conexão do site'} <span aria-hidden="true">→</span></button>
        <small>Depende da compatibilidade com quem fornece o site. Nenhum anúncio é enviado nesta etapa.</small>
      </section>
    </div>
    {integrated && <div className={s.team}><div><strong>Quem vai atender seus clientes?</strong><p>Cadastre os corretores e ajuste os acessos da equipe.</p></div><button type="button" className={s.secondary} onClick={onTeam}>Corretores e acessos <span aria-hidden="true">→</span></button></div>}
    <div className={s.team}><div><strong>Metas de captação de imóveis</strong><p>Defina quantos imóveis cada corretor deve captar por mês e finalidade.</p></div><button type="button" className={s.secondary} onClick={onCaptureGoal}>Criar meta de captação <span aria-hidden="true">→</span></button></div>
    <details className={s.advanced}><summary><span><strong>Regras e opções da operação</strong><small>Prazos, preenchimento de cadastros, origens e motivos de perda.</small></span><span aria-hidden="true">⌄</span></summary><div className={s.advancedBody}>{children}</div></details>
  </div>;
}
