export type PropertyRecord = {
  id: string;
  title: string;
  district: string;
  price: string;
  meta: string;
  match: number;
  tone: string;
  purpose: 'Venda' | 'Aluguel';
  images: string[];
  createdAt: string;
};

export type PropertyInput = Omit<PropertyRecord, 'id' | 'createdAt'>;

export type AppointmentStatus = 'Confirmada' | 'Aguardando';

export type AppointmentRecord = {
  id: string;
  date: string;
  time: string;
  name: string;
  property: string;
  broker: string;
  status: AppointmentStatus;
  color: string;
  createdAt: string;
};

export type AppointmentInput = Omit<AppointmentRecord, 'id' | 'createdAt'>;

export type SaleRecord = {
  id: string;
  date: string;
  broker: string;
  property: string;
  client: string;
  amount: number;
  createdAt: string;
};

export type SaleInput = Omit<SaleRecord, 'id' | 'createdAt'>;

export type BrokerPerformance = {
  broker: string;
  goal: number;
  sold: number;
  salesCount: number;
  progress: number;
  leadsReceived: number;
  convertedLeads: number;
  recoveredLeads: number;
  visits: number;
  conversionRate: number;
  history: Array<{ month: string; sold: number }>;
};

export type PerformanceSnapshot = {
  dataMode: 'live' | 'demo';
  month: string;
  companyGoal: number;
  totalSold: number;
  salesCount: number;
  averageTicket: number;
  leadsReceived: number;
  convertedLeads: number;
  recoveredLeads: number;
  conversionRate: number;
  brokers: BrokerPerformance[];
  history: Array<{ month: string; sold: number }>;
  sales: SaleRecord[];
};

export type PerformanceSettingsInput = {
  month: string;
  companyGoal: number;
  leadsReceived: number;
  convertedLeads: number;
  recoveredLeads: number;
  brokerGoals: Array<{ broker: string; goal: number }>;
};
