export type PickerItem = { id: string; title: string; detail: string; extra: string; search: string; category: string; status: string; createdAt: string; disabled?: boolean };
export type PickerFilters = { query: string; category: string; status: string; order: string };
export const normalizePickerText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
export function filterPickerItems(items: PickerItem[], filters: PickerFilters) {
  const tokens = normalizePickerText(filters.query).trim().split(/\s+/).filter(Boolean);
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  return items.filter(item => (!filters.category || item.category === filters.category)
    && (!filters.status || item.status === filters.status)
    && tokens.every(token => normalizePickerText(`${item.title} ${item.search} ${item.detail} ${item.extra}`).includes(token)))
    .sort((a,b) => {
      if(filters.order === 'recent') {
        const delta=(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0);
        if(delta) return delta;
      }
      return (filters.order === 'za' ? -1 : 1)*collator.compare(a.title,b.title) || a.id.localeCompare(b.id);
    });
}
