import { isProductDemo } from './dashboard-transport';

const CHANNEL = 'imobflow_data_sync';
const LOCAL_EVENT = 'imobflow_data_changed';

export function announceDashboardChange(entity: string) {
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: { entity } }));
  if (!isProductDemo() && 'BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ entity });
    channel.close();
  }
}

// A slow response must not overlap a newer read or overwrite a completed write.
export function subscribeDashboardSync<T>({ entities, load, apply, onError, interval = 3000, timeout = 20000 }: {
  entities: string[]; load: (signal: AbortSignal) => Promise<T>; apply: (data: T) => void;
  onError?: (error: unknown) => void; interval?: number; timeout?: number;
}) {
  let stopped = false;
  let running = false;
  let generation = 0;
  let queued = false;
  let controller: AbortController | undefined;
  const refresh = async (invalidate = false) => {
    if (stopped) return;
    if (invalidate) { generation++; queued = true; }
    if (running || document.visibilityState === 'hidden') return;
    running = true;
    queued = false;
    const started = generation;
    controller = new AbortController();
    const requestController = controller;
    let deadline: number | undefined;
    try {
      // A stalled request must not permanently lock all later refreshes.
      const result = await Promise.race([
        load(requestController.signal),
        new Promise<never>((_, reject) => {
          deadline = window.setTimeout(() => {
            requestController.abort();
            reject(new Error('dashboard_sync_timeout'));
          }, timeout);
        }),
      ]);
      if (!stopped && started === generation) apply(result);
    } catch (error) {
      if (!stopped && started === generation) onError?.(error);
    } finally {
      window.clearTimeout(deadline);
      running = false;
      if (queued && !stopped) void refresh();
    }
  };
  const onChange = (event: MessageEvent | CustomEvent) => {
    const entity = 'data' in event ? event.data?.entity : event.detail?.entity;
    if (entities.includes(entity)) void refresh(true);
  };
  const onFocus = () => { void refresh(true); };
  const onLocal = (event: Event) => onChange(event as CustomEvent);
  const channel = !isProductDemo() && 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
  if (channel) channel.onmessage = onChange;
  window.addEventListener(LOCAL_EVENT, onLocal);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  const timer = window.setInterval(() => { void refresh(); }, interval);
  void refresh();
  return () => {
    stopped = true;
    controller?.abort();
    channel?.close();
    window.clearInterval(timer);
    window.removeEventListener(LOCAL_EVENT, onLocal);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
}
