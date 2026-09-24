import type { BusinessHours } from './business-hours';
import type { ConversationAttendanceSummary, ConversationMessage } from './conversations';
import { demoContacts } from './demo-conversations';
import type { LeadProfile } from './leads';
import type { AppointmentRecord, PerformanceSnapshot, PropertyRecord } from './operations';
import type { Opportunity } from './opportunities';
import type { SharedDemoThread } from './shared-demo-conversations';

// Public fictional examples. This module never reads an account, cookie or API.
export const productDemoAccount = {
  brokerId: '00000000-0000-4000-8000-000000000101',
  name: 'Marina Alves',
  company: 'Imobiliária Exemplo',
  role: 'owner' as const,
};

const secondBrokerId = '00000000-0000-4000-8000-000000000102';
const readOnlyMessage = 'Esta é uma demonstração com dados fictícios. Alterações e envios estão disponíveis no painel da sua imobiliária.';

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function dateInSaoPaulo(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(date);
}

/** Independent, read-only in-memory transport for the public product preview. */
export function createProductDemoTransport(): typeof fetch {
  const today = dateInSaoPaulo(new Date());
  const month = today.slice(0, 7);
  const timestamp = `${today}T12:00:00.000Z`;
  const saleDate = `${month}-${String(Math.min(Number(today.slice(-2)), 5)).padStart(2, '0')}`;
  const leadBase = {
    phone: '', email: null, source: 'WhatsApp',
    scoreDefined: true, lastContactAt: timestamp, inactivityDays: 0,
    recoveryPotential: 'Baixo' as const, recoverySelected: false, createdAt: timestamp,
  };
  const leads: LeadProfile[] = [
    {
      ...leadBase, id: '00000000-0000-4000-8000-000000000201', name: 'Ana Martins',
      goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro, Lavras', budget: 'Até R$ 500 mil',
      details: '2 quartos, 1 vaga. Deseja conhecer opções de financiamento.',
      summary: 'Busca apartamento de dois quartos no Centro, até R$ 500 mil. Visita agendada com Marina.',
      score: 82, temperature: 'Quente', assignedTo: 'Marina Alves', lifecycleStatus: 'Visita',
      scoreReasons: ['Objetivo definido', 'Orçamento informado', 'Visita agendada'],
    },
    {
      ...leadBase, id: '00000000-0000-4000-8000-000000000202', name: 'Lucas Oliveira',
      goal: 'Alugar', propertyType: 'Casa', region: 'Jardim Europa, Lavras', budget: 'Até R$ 2.500 por mês',
      details: '2 quartos e quintal. Pretende se mudar no próximo mês.',
      summary: 'Procura casa para alugar no Jardim Europa, até R$ 2.500 mensais. Rafael acompanha o atendimento.',
      score: 65, temperature: 'Morno', assignedTo: 'Rafael Costa', lifecycleStatus: 'Em atendimento',
      scoreReasons: ['Objetivo definido', 'Região informada', 'Orçamento informado'],
    },
    {
      ...leadBase, id: '00000000-0000-4000-8000-000000000203', name: 'Beatriz Costa',
      goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro, Lavras', budget: 'Até R$ 500 mil',
      details: 'Compra concluída. Apartamento de 2 quartos.',
      summary: 'Compra concluída com Marina. Negócio de R$ 480 mil registrado no período.',
      score: 90, temperature: 'Quente', assignedTo: 'Marina Alves', lifecycleStatus: 'Convertido',
      scoreReasons: ['Compra concluída'],
    },
  ];
  const properties: PropertyRecord[] = [
    {
      id: '00000000-0000-4000-8000-000000000301', code: 'AP-101', title: 'Apartamento no Centro',
      description: 'Exemplo de imóvel do catálogo: apartamento com dois quartos, sala integrada e uma vaga.',
      district: 'Centro', city: 'Lavras', price: 'R$ 450.000', meta: '2 quartos · 1 vaga · 72 m²',
      tone: 'blue', purpose: 'Venda', propertyType: 'Apartamento', bedrooms: 2, parkingSpaces: 1,
      area: 72, status: 'Disponível', keyInOffice: true, occupied: false,
      catalogedOnInstagram: false, catalogedOnSite: true, images: [], createdAt: timestamp,
    },
    {
      id: '00000000-0000-4000-8000-000000000302', code: 'CA-202', title: 'Casa Jardim Europa',
      description: 'Exemplo de imóvel do catálogo: casa com quintal, dois quartos e uma vaga.',
      district: 'Jardim Europa', city: 'Lavras', price: 'R$ 2.300', meta: '2 quartos · 1 vaga · 110 m²',
      tone: 'green', purpose: 'Aluguel', propertyType: 'Casa', bedrooms: 2, parkingSpaces: 1,
      area: 110, status: 'Disponível', keyInOffice: true, occupied: false,
      catalogedOnInstagram: true, catalogedOnSite: true, images: [], createdAt: timestamp,
    },
    {
      id: '00000000-0000-4000-8000-000000000303', code: 'AP-103', title: 'Apartamento Vista Clara',
      description: 'Exemplo de imóvel vendido: compra concluída por Beatriz Costa.',
      district: 'Centro', city: 'Lavras', price: 'R$ 480.000', meta: '2 quartos · 1 vaga · 80 m²',
      tone: 'sand', purpose: 'Venda', propertyType: 'Apartamento', bedrooms: 2, parkingSpaces: 1,
      area: 80, status: 'Vendido', keyInOffice: false, occupied: true,
      catalogedOnInstagram: false, catalogedOnSite: false, images: [], createdAt: timestamp,
    },
  ];
  const appointments: AppointmentRecord[] = [{
    id: '00000000-0000-4000-8000-000000000401', date: today, time: '15:00',
    name: leads[0].name, property: properties[0].title, broker: 'Marina Alves',
    status: 'Confirmada', color: 'green', createdAt: timestamp,
  }];
  const attendance: ConversationAttendanceSummary[] = leads.map((lead, index) => ({
    leadId: lead.id, attendanceMode: index === 2 ? 'closed' : 'human', assignedTo: lead.assignedTo,
    assignedBrokerId: index === 1 ? secondBrokerId : productDemoAccount.brokerId,
  }));
  const dialogues: Array<Array<[ConversationMessage['side'], string]>> = [
    [
      ['incoming', 'Olá! Procuro um apartamento para comprar no Centro.'],
      ['outgoing', 'Olá, Ana! Qual valor você pretende investir e quantos quartos precisa?'],
      ['incoming', 'Até R$ 500 mil, com dois quartos. Tenho interesse em financiar.'],
      ['outgoing', 'Obrigada pelas informações! Vou encaminhar seu atendimento para uma corretora.'],
      ['outgoing', 'Ana, sou a Marina. Temos um apartamento por R$ 450 mil que combina com seu perfil. Podemos visitar hoje às 15h?'],
      ['incoming', 'Pode agendar, por favor!'],
    ],
    [
      ['incoming', 'Gostaria de alugar uma casa no Jardim Europa.'],
      ['outgoing', 'Olá, Lucas! Qual o seu limite mensal e o que não pode faltar?'],
      ['incoming', 'Até R$ 2.500, com dois quartos e quintal.'],
      ['outgoing', 'Sou o Rafael. Encontrei uma opção por R$ 2.300 e vou conferir os detalhes para você.'],
    ],
    [
      ['incoming', 'Marina, já assinei os documentos do apartamento.'],
      ['outgoing', 'Obrigada, Beatriz! Registramos a conclusão da compra. Vou acompanhar a entrega das chaves com você.'],
      ['incoming', 'Obrigada por todo o atendimento!'],
    ],
  ];
  const messages: ConversationMessage[] = leads.flatMap((lead, leadIndex) => dialogues[leadIndex].map(([side, text], index) => ({
    id: `example-message-${leadIndex}-${index}`, leadId: lead.id, side, text,
    time: `09:${String(10 + index * 2).padStart(2, '0')}`, images: [],
    ...(side === 'outgoing' ? { deliveryStatus: 'read' as const, sender: index < 4 && leadIndex < 2 ? 'Automático' : lead.assignedTo || 'Corretor' } : {}),
    attendanceMode: attendance[leadIndex].attendanceMode, assignedBrokerId: attendance[leadIndex].assignedBrokerId,
  })));
  const opportunities: Opportunity[] = [0, 1].map(index => ({
    id: `example-opportunity-${index + 1}`, leadId: leads[index].id, propertyId: properties[index].id,
    leadName: leads[index].name, propertyTitle: properties[index].title, city: 'Lavras',
    district: properties[index].district, price: index === 0 ? 450000 : 2300,
    bedrooms: 2, parkingSpaces: 1, score: 100, status: index === 0 ? 'contacted' : 'open',
    reasons: [index === 0 ? 'Compra' : 'Aluguel', properties[index].propertyType!, properties[index].district, 'Dentro do orçamento'],
    assignedTo: leads[index].assignedTo, inactivityDays: 0,
    notificationId: `example-notification-${index + 1}`, unread: index === 1,
  }));
  const settings: BusinessHours = {
    timeZone: 'America/Sao_Paulo', opens: '08:00', closes: '18:00', weekdays: [1, 2, 3, 4, 5], holidays: [],
    awayMessage: 'Recebemos suas informações. Nossa equipe continua o atendimento no próximo horário comercial.',
  };
  const team = [
    { id: productDemoAccount.brokerId, name: productDemoAccount.name, role: 'owner', email: 'marina@example.invalid', active: true, created_at: timestamp },
    { id: secondBrokerId, name: 'Rafael Costa', role: 'broker', email: 'rafael@example.invalid', active: true, created_at: timestamp },
  ];
  const sharedThreads: SharedDemoThread[] = demoContacts.map(contact => ({
    id: `lead-example-${contact.id}`, assignedTo: null, assignedBrokerId: null,
    messages: contact.messages.map(message => ({ ...message })), revision: 0,
  }));

  function performance(requestedMonth: string): PerformanceSnapshot {
    const selected = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : month;
    const active = selected === month;
    const history = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(`${selected}-01T12:00:00.000Z`);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      const period = date.toISOString().slice(0, 7);
      return { month: period, sold: period === month ? 480000 : 0 };
    });
    return {
      dataMode: 'demo', month: selected, companyGoal: 1000000, totalSold: active ? 480000 : 0,
      salesCount: active ? 1 : 0, averageTicket: active ? 480000 : 0,
      leadsReceived: active ? 3 : 0, convertedLeads: active ? 1 : 0, recoveredLeads: 0,
      conversionRate: active ? 100 / 3 : 0, history,
      brokers: team.map((broker, index) => ({
        broker: broker.name, goal: 500000, sold: active && index === 0 ? 480000 : 0,
        salesCount: active && index === 0 ? 1 : 0, progress: active && index === 0 ? 96 : 0,
        leadsReceived: active ? index === 0 ? 2 : 1 : 0, convertedLeads: active && index === 0 ? 1 : 0,
        recoveredLeads: 0, visits: active && index === 0 ? 1 : 0,
        conversionRate: active && index === 0 ? 50 : 0,
        history: history.map(item => ({ ...item, sold: index === 0 ? item.sold : 0 })),
      })),
      sales: active ? [{
        id: 'example-sale-1', dealType: 'Venda', date: saleDate, broker: 'Marina Alves',
        property: properties[2].title, client: leads[2].name, amount: 480000, createdAt: `${saleDate}T12:00:00.000Z`,
      }] : [],
    };
  }

  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const signal = init?.signal || request?.signal;
    if (signal?.aborted) throw new DOMException('Demonstração cancelada.', 'AbortError');
    const base = typeof location === 'undefined' ? 'https://demo.imobflow.invalid' : location.origin;
    const url = new URL(request ? request.url : String(input), base);
    if (url.origin !== base) return response({ error: readOnlyMessage }, 403);
    const method = (init?.method || request?.method || 'GET').toUpperCase();
    // Preparing a fictional draft is a read-only action. The URL has no recipient.
    if (method === 'POST' && url.pathname === '/api/opportunities') {
      let body: { id?: string; action?: string } = {};
      try { body = JSON.parse(typeof init?.body === 'string' ? init.body : request ? await request.clone().text() : '{}'); } catch { /* reject below */ }
      const item = opportunities.find(opportunity => opportunity.id === body?.id);
      if (body?.action === 'draft' && item) return response({ data: {
        message: `Olá, ${item.leadName.split(' ')[0]}! Encontrei uma opção que combina com seu perfil: ${item.propertyTitle}, em ${item.district}. Quer conhecer os detalhes?\n\nDemonstração: nenhuma mensagem será enviada.`,
        url: '#demonstracao-sem-envio',
      } });
    }
    if (method !== 'GET') return response({ error: readOnlyMessage }, 403);
    switch (url.pathname) {
      case '/api/leads': return response({ data: leads });
      case '/api/conversations': return response({ data: messages, attendance });
      case '/api/conversations/demo': return response({ data: sharedThreads });
      case '/api/conversations/settings': return response({ data: settings });
      case '/api/properties': return response({ data: properties });
      case '/api/appointments': return response({ data: appointments });
      case '/api/performance': return response({ data: performance(url.searchParams.get('month') || month) });
      case '/api/opportunities': {
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        if (url.searchParams.get('mode') === 'inactive') return response({ data: [], hasMore: false });
        return response({ data: opportunities.slice(offset, offset + 50) });
      }
      case '/api/brokers': return response({ data: team, brokerLimit: 5, publicContactPath: '' });
      case '/api/conversations/whatsapp': return response({ data: {
        configured: true, phoneNumberId: '000000000000001', apiVersion: 'v26.0', enabled: true,
        hasAccessToken: true, verification: 'verified', displayPhoneNumber: '+55 (00) 00000-0000',
        verifiedName: 'Imobiliária Exemplo · demonstração', verifiedAt: timestamp,
      } });
      case '/api/integrations/meta/embedded-signup': return response({ data: {
        appId: '', configId: '', available: false, loginConfigured: false, webhookConfigured: false, apiVersion: 'v26.0',
      } });
      case '/api/version': return response({ version: process.env.NEXT_PUBLIC_APP_RELEASE || 'development' });
      default: return response({ error: 'Esta consulta não faz parte da demonstração.' }, 404);
    }
  };
}
