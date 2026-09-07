export type DemoMessage = { id: string; side: 'incoming' | 'outgoing'; text: string; time: string };
export type DemoContact = {
  id: string; name: string; initials: string; tone: number; category: string; style: string;
  goal: string; propertyType: string; region: string; budget: string; rooms: string;
  payment: string; score: number; stage: string; unread: number;
  messages: DemoMessage[]; suggestion: string;
};
const dialogue = (...lines: [DemoMessage['side'], string][]): DemoMessage[] =>
  lines.map(([side, text], index) => ({ id: 'example-' + index, side, text, time: '10:' + String(20 + index).padStart(2, '0') }));

// Fictional examples only. Never imported into leads, CRM or automation tables.
export const demoContacts: DemoContact[] = [
  {
    id: 'mariana', name: 'Mariana Costa', initials: 'MC', tone: 0, category: 'Primeiro imóvel', style: 'Acolhedor',
    goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro ou Vila Nova', budget: 'Até R$ 350 mil', rooms: '2',
    payment: 'Financiamento a avaliar', score: 58, stage: 'Em descoberta', unread: 0,
    messages: dialogue(
      ['incoming', 'Olá! Estou procurando meu primeiro apartamento, mas não sei por onde começar.'],
      ['outgoing', 'Oi, Mariana! Vamos por partes. Em quais bairros você gostaria de morar e quanto pretende investir?'],
      ['incoming', 'Centro ou Vila Nova, até R$ 350 mil. Preciso de dois quartos. Consigo usar meu FGTS?'],
      ['outgoing', 'Podemos verificar as condições de uso do FGTS e as possibilidades de financiamento com a instituição financeira. Você já fez alguma simulação?'],
      ['incoming', 'Ainda não. Gostaria de entender antes de marcar as visitas.'],
    ),
    suggestion: 'Claro, Mariana! Podemos começar pela simulação para entender uma faixa confortável para você. Depois, selecionamos os imóveis com calma.',
  },
  {
    id: 'ricardo-juliana', name: 'Ricardo e Juliana', initials: 'RJ', tone: 1, category: 'Família', style: 'Consultivo',
    goal: 'Comprar', propertyType: 'Casa', region: 'Jardim Campestre', budget: 'Até R$ 750 mil', rooms: '3',
    payment: 'Venda do imóvel atual', score: 84, stage: 'Em atendimento', unread: 2,
    messages: dialogue(
      ['incoming', 'Nossa família cresceu e estamos procurando uma casa com mais espaço.'],
      ['outgoing', 'Ricardo e Juliana, o que não pode faltar na nova casa?'],
      ['incoming', 'Três quartos, quintal para as crianças e duas vagas. Gostamos do Jardim Campestre.'],
      ['outgoing', 'Além do espaço, a proximidade de escolas é importante? E qual faixa de investimento vocês têm em mente?'],
      ['incoming', 'Sim! Até R$ 750 mil, mas precisamos vender nosso apartamento primeiro.'],
    ),
    suggestion: 'Entendi! Vamos considerar a proximidade de escolas e planejar a compra junto com a venda do apartamento. Vocês já têm uma estimativa do valor dele?',
  },
  {
    id: 'beatriz', name: 'Beatriz Lima', initials: 'BL', tone: 2, category: 'Aluguel', style: 'Direto',
    goal: 'Alugar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 2.500/mês, com encargos', rooms: '1 ou 2',
    payment: 'Garantia a definir', score: 91, stage: 'Urgente', unread: 1,
    messages: dialogue(
      ['incoming', 'Preciso me mudar ainda este mês. Vocês têm apartamento que aceite pet?'],
      ['outgoing', 'Oi, Beatriz! Qual região você prefere e qual é seu limite mensal?'],
      ['incoming', 'Centro, até R$ 2.500. Tenho um cachorro pequeno.'],
      ['outgoing', 'Esse limite precisa incluir condomínio e IPTU?'],
      ['incoming', 'Sim, tudo incluído. Consigo visitar depois das 18h.'],
    ),
    suggestion: 'Beatriz, vou conferir opções dentro do custo total e as regras para pets. Qual dia desta semana funciona melhor para você depois das 18h?',
  },
  {
    id: 'eduardo', name: 'Eduardo Nunes', initials: 'EN', tone: 3, category: 'Investidor', style: 'Analítico',
    goal: 'Investir', propertyType: 'Studio ou apartamento', region: 'Centro e região universitária', budget: 'Até R$ 800 mil', rooms: '1',
    payment: 'À vista', score: 88, stage: 'Em análise', unread: 0,
    messages: dialogue(
      ['incoming', 'Procuro apartamentos pequenos para renda com aluguel. Tenho até R$ 800 mil para investir.'],
      ['outgoing', 'Eduardo, sua prioridade é renda mensal ou valorização no longo prazo?'],
      ['incoming', 'Renda mensal. Estou avaliando comprar duas unidades menores.'],
      ['outgoing', 'Podemos comparar preço, condomínio, custos de manutenção e estimativas de aluguel das opções disponíveis.'],
      ['incoming', 'Ótimo. Inclua também uma estimativa de vacância na comparação.'],
    ),
    suggestion: 'Combinado, Eduardo. A comparação terá custos e cenários de ocupação, com as estimativas identificadas e sem tratar a rentabilidade como garantida.',
  },
  {
    id: 'joao', name: 'João Almeida', initials: 'JA', tone: 0, category: 'Novo match', style: 'Personalizado',
    goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 500 mil', rooms: '2',
    payment: 'Financiamento', score: 86, stage: 'Retomando contato', unread: 1,
    messages: dialogue(
      ['incoming', 'Procuro um apartamento de dois quartos no Centro, até R$ 500 mil.'],
      ['outgoing', 'João, no momento não temos uma opção dentro desses critérios. Você gostaria de receber um aviso quando surgir uma?'],
      ['incoming', 'Pode avisar, por favor. Não tenho pressa.'],
      ['outgoing', 'Olá, João! Cadastramos uma opção de dois quartos no Centro por R$ 480 mil. Ainda está procurando?'],
      ['incoming', 'Estou sim! Pode me mandar as fotos?'],
    ),
    suggestion: 'Claro, João! Posso apresentar os detalhes desta opção e conferir uma data de visita com você. Prefere durante a semana ou no sábado?',
  },
  {
    id: 'camila', name: 'Camila Rocha', initials: 'CR', tone: 1, category: 'Comparando opções', style: 'Sem pressão',
    goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro ou Jardim Floresta', budget: 'Até R$ 600 mil', rooms: '2 ou 3',
    payment: 'Entrada e financiamento', score: 62, stage: 'Em decisão', unread: 0,
    messages: dialogue(
      ['incoming', 'Gostei dos dois apartamentos, mas ainda não sei qual escolher.'],
      ['outgoing', 'Camila, o que pesa mais para você: localização, espaço ou custo mensal?'],
      ['incoming', 'O do Centro facilita o trabalho, mas o outro tem um quarto a mais.'],
      ['outgoing', 'Podemos comparar deslocamento, espaço e despesas mensais lado a lado. Assim você decide com mais clareza.'],
      ['incoming', 'Boa ideia. Também quero comparar os valores de condomínio.'],
    ),
    suggestion: 'Vamos incluir condomínio e IPTU na comparação, Camila. Se ajudar, podemos organizar uma segunda visita, sem compromisso.',
  },
  {
    id: 'lucas', name: 'Lucas Carvalho', initials: 'LC', tone: 0, category: 'Compra financiada', style: 'Objetivo',
    goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 600 mil', rooms: '3',
    payment: 'Financiamento', score: 86, stage: 'Em atendimento', unread: 2,
    messages: dialogue(['incoming', 'Oi! Estou procurando um apartamento de três quartos no Centro.'], ['outgoing', 'Olá, Lucas. Qual valor máximo você pretende investir?'], ['incoming', 'Até R$ 600 mil. Pode ser financiamento.'], ['outgoing', 'Vou conferir as opções disponíveis e as informações para a simulação.']),
    suggestion: 'Lucas, você já tem uma faixa de entrada planejada? Isso ajuda a direcionar a simulação de financiamento.',
  },
  {
    id: 'ana', name: 'Ana Martins', initials: 'AM', tone: 1, category: 'Visita agendada', style: 'Organizado',
    goal: 'Comprar', propertyType: 'Apartamento', region: 'Jardim Floresta', budget: 'Até R$ 900 mil', rooms: '3',
    payment: 'Entrada e financiamento', score: 90, stage: 'Visita', unread: 1,
    messages: dialogue(['incoming', 'Gostei da segunda opção, com varanda!'], ['outgoing', 'Ana, gostaria de conhecer o apartamento pessoalmente?'], ['incoming', 'Sim. Podemos combinar sábado às 10h?'], ['outgoing', 'Combinado, Ana. Sábado às 10h! Enviarei as orientações para a visita.']),
    suggestion: 'Olá, Ana! Podemos confirmar os detalhes e o ponto de encontro para a visita de sábado?',
  },
  {
    id: 'rafael', name: 'Rafael Borges', initials: 'RB', tone: 2, category: 'Atendimento humano', style: 'Atencioso',
    goal: 'Comprar', propertyType: 'Casa', region: 'Alto da Serra', budget: 'Até R$ 850 mil', rooms: '4',
    payment: 'A negociar', score: 79, stage: 'Negociação', unread: 0,
    messages: dialogue(['incoming', 'Quero falar com um corretor sobre a casa do Alto da Serra.'], ['outgoing', 'Claro, Rafael. Qual informação você gostaria de esclarecer?'], ['incoming', 'Queria entender se o proprietário aceita uma proposta com outro imóvel como parte do pagamento.']),
    suggestion: 'Rafael, posso encaminhar sua dúvida ao corretor responsável para consultar o proprietário. Você pode descrever o imóvel que pretende incluir na proposta?',
  },
  {
    id: 'carla', name: 'Carla Souza', initials: 'CS', tone: 3, category: 'Terreno', style: 'Investigativo',
    goal: 'Comprar', propertyType: 'Terreno', region: 'Reserva Sul', budget: 'Até R$ 300 mil', rooms: 'Não se aplica',
    payment: 'À vista', score: 38, stage: 'Em descoberta', unread: 0,
    messages: dialogue(['incoming', 'Estou buscando um terreno para construir. Pode ser na Reserva Sul.'], ['outgoing', 'Carla, qual metragem e faixa de investimento você procura?'], ['incoming', 'A partir de 250 m², até R$ 300 mil. Preciso saber as regras para construção.']),
    suggestion: 'Carla, vamos conferir metragem, documentação e as regras aplicáveis à construção antes de avançar. Você prefere lote plano ou aceita declive?',
  },
];

export type DemoConversationState = {
  selectedId: string;
  threads: Record<string, { messages: DemoMessage[]; draft: string; unread: number; humanMode: boolean }>;
};
export type DemoConversationAction =
  | { type: 'select'; id: string }
  | { type: 'draft'; id: string; text: string }
  | { type: 'send'; id: string; messageId: string; time: string }
  | { type: 'assign'; id: string };
export function createDemoConversationState(): DemoConversationState {
  return { selectedId: demoContacts[0].id, threads: Object.fromEntries(demoContacts.map(contact => [contact.id, { messages: contact.messages.map(message => ({ ...message })), draft: '', unread: contact.unread, humanMode: false }])) };
}
export function demoConversationReducer(state: DemoConversationState, action: DemoConversationAction): DemoConversationState {
  const thread = state.threads[action.id];
  if (!thread) return state;
  if (action.type === 'send' && !thread.draft.trim()) return state;
  const updated = action.type === 'select' ? { ...thread, unread: 0 }
    : action.type === 'draft' ? { ...thread, draft: action.text }
    : action.type === 'assign' ? { ...thread, humanMode: !thread.humanMode }
    : { ...thread, draft: '', messages: [...thread.messages, { id: action.messageId, side: 'outgoing' as const, text: thread.draft.trim(), time: action.time }] };
  return { selectedId: action.type === 'select' ? action.id : state.selectedId, threads: { ...state.threads, [action.id]: updated } };
}

// Three visual bands; matches the CRM thresholds, grouping "Muito quente"
// into "Quente" for this compact demonstration label.
export function demoTemperature(score: number): 'Frio' | 'Morno' | 'Quente' {
  return score >= 65 ? 'Quente' : score >= 45 ? 'Morno' : 'Frio';
}
