export type BusinessHours = {
  timeZone: string;
  opens: string;
  closes: string;
  weekdays: number[];
  holidays: string[];
  awayMessage: string;
};
export const defaultBusinessHours: BusinessHours = {
  timeZone: "America/Sao_Paulo",
  opens: "08:00",
  closes: "18:00",
  weekdays: [1, 2, 3, 4, 5],
  holidays: [],
  awayMessage:
    "Olá! Estamos fora do horário de atendimento. Retornaremos no próximo período de atendimento. Obrigado pela mensagem!",
};
export function validateBusinessHours(value: unknown): BusinessHours {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Horário inválido.");
  const v = value as BusinessHours;
  if (typeof v.timeZone !== "string" || v.timeZone.length > 100)
    throw new Error("Fuso inválido.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: v.timeZone }).format();
  } catch {
    throw new Error("Fuso inválido.");
  }
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (typeof v.opens !== "string" || typeof v.closes !== "string" ||
    !clock.test(v.opens) || !clock.test(v.closes) || v.opens >= v.closes)
    throw new Error("O fechamento deve ser depois da abertura no mesmo dia.");
  if (
    !Array.isArray(v.weekdays) ||
    !v.weekdays.length ||
    v.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new Error("Selecione dias válidos.");
  if (
    !Array.isArray(v.holidays) ||
    v.holidays.length > 366 ||
    v.holidays.some(
      (d) =>
        typeof d !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d,
    )
  )
    throw new Error("Datas inválidas.");
  if (
    typeof v.awayMessage !== "string" ||
    !v.awayMessage.trim() ||
    v.awayMessage.length > 1000
  )
    throw new Error("Informe uma mensagem com até 1000 caracteres.");
  return {
    ...v,
    weekdays: [...new Set(v.weekdays)],
    holidays: [...new Set(v.holidays)],
    awayMessage: v.awayMessage.trim(),
  };
}
export function businessTime(
  date = new Date(),
  settings = defaultBusinessHours,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  const calendar = new Date(`${day}T12:00:00Z`);
  const working = (d: Date) =>
    settings.weekdays.includes(d.getUTCDay()) &&
    !settings.holidays.includes(d.toISOString().slice(0, 10));
  const afterHours =
    !working(calendar) || time < settings.opens || time >= settings.closes;
  // Anchor the whole closed interval to the previous business day's closing date.
  // This keeps the same key through midnight, weekends and consecutive holidays.
  const previous = new Date(calendar);
  if (time < settings.closes || !working(previous))
    previous.setUTCDate(previous.getUTCDate() - 1);
  for (let i = 0; i < 740 && !working(previous); i++)
    previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    date: day,
    afterHours,
    closedPeriod: `${settings.timeZone}:${previous.toISOString().slice(0, 10)}:${settings.closes}`,
  };
}
