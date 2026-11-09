import LiveEvolutionClient from './legacy-panel';
import { evolutionIntegrated, getEvolutionSnapshot } from '@/lib/evolution/server';
import type { Actor } from '@/lib/evolution/model';

export default async function EvolutionEntry({ actor, initialPage }: { actor: Actor & { company?: string }; initialPage?: 'integrations' | 'settings' | 'campaigns' }) {
  let snapshot: Awaited<ReturnType<typeof getEvolutionSnapshot>>;
  try {
    snapshot = await getEvolutionSnapshot(actor);
  } catch {
    return <main className="crm-access-surface crm-unavailable"><section><p>ImobFlow · Gestão imobiliária</p><h1>Não foi possível carregar o novo painel</h1><p>Tente atualizar a página. Seus dados continuam preservados, e você pode acessar o painel anterior enquanto isso.</p><a href="/painel?experiencia=classica">Abrir painel anterior</a></section></main>;
  }
  return <LiveEvolutionClient initialState={snapshot.state} actor={actor} integrated={evolutionIntegrated()} initialPage={initialPage} />;
}
