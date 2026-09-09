import { demoContacts, type DemoMessage } from './demo-conversations';
import { currentAccount } from './tenant-context';
import { supabaseCompanyId, supabaseRequest } from './supabase';

type ThreadRow = { contact_id: string; assigned_broker_id: string; messages: DemoMessage[]; revision: number };
export type SharedDemoThread = { id: string; assignedTo: string | null; assignedBrokerId: string | null; messages: DemoMessage[]; revision: number };

export async function listSharedDemoThreads(): Promise<SharedDemoThread[]> {
  const companyId = supabaseCompanyId();
  const [threads, brokers] = await Promise.all([
    supabaseRequest<ThreadRow[]>(`demo_conversation_threads?company_id=eq.${companyId}&select=contact_id,assigned_broker_id,messages,revision`),
    supabaseRequest<Array<{ id: string; name: string }>>(`broker_accounts?company_id=eq.${companyId}&select=id,name`),
  ]);
  return demoContacts.map(contact => {
    const thread = threads.find(item => item.contact_id === contact.id);
    return {
      id: `lead-example-${contact.id}`, revision: thread?.revision || 0,
      assignedBrokerId: thread?.assigned_broker_id || null,
      assignedTo: brokers.find(broker => broker.id === thread?.assigned_broker_id)?.name || null,
      messages: [...contact.messages, ...(thread?.messages || [])],
    };
  });
}

export async function saveSharedDemoAction(input: { contactId: string; content?: string; messageId?: string; propertyId?: string }) {
  const account = currentAccount();
  if (!account) throw new Error('Entre na sua conta para continuar.');
  const contactId = input.contactId.replace(/^example-/, '');
  if (!demoContacts.some(contact => contact.id === contactId)) throw new Error('Contato de demonstração inválido.');
  let message: DemoMessage | null = null;
  if (input.content) {
    message = { id: input.messageId!, side: 'outgoing', text: input.content, time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) };
    if (input.propertyId) {
      const properties = await supabaseRequest<Array<{ title: string; images: string[] }>>(`properties?company_id=eq.${supabaseCompanyId()}&id=eq.${encodeURIComponent(input.propertyId)}&select=title,images&limit=1`);
      if (!properties.length) throw new Error('Imóvel não encontrado nesta imobiliária.');
      message.images = properties[0].images?.slice(0, 5) || [];
      message.propertyTitle = properties[0].title;
    }
  }
  const [thread] = await supabaseRequest<ThreadRow[]>('rpc/record_demo_conversation_action', {
    method: 'POST', body: { p_company_id: account.companyId, p_broker_id: account.brokerId, p_contact_id: contactId, p_message: message },
  });
  const assignedTo = thread.assigned_broker_id === account.brokerId ? account.name
    : (await supabaseRequest<Array<{ name: string }>>(`broker_accounts?company_id=eq.${account.companyId}&id=eq.${thread.assigned_broker_id}&select=name&limit=1`))[0]?.name || null;
  return { id: `lead-example-${contactId}`, revision: thread.revision, assignedTo, assignedBrokerId: thread.assigned_broker_id,
    messages: [...demoContacts.find(contact => contact.id === contactId)!.messages, ...thread.messages] };
}
