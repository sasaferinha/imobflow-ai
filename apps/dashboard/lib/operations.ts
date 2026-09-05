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
