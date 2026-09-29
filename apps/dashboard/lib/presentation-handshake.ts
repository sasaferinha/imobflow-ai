type Options = {
  host: Window;
  getFrameWindow: () => Window | null;
  isView: (value: unknown) => boolean;
  onReady: (view: string) => void;
  onTimeout: () => void;
  timeoutMs?: number;
  retryMs?: number;
};

/** Recover a ready announcement lost before the parent or child hydrated. */
export function startPresentationHandshake({
  host, getFrameWindow, isView, onReady, onTimeout,
  timeoutMs = 15_000, retryMs = 750,
}: Options) {
  let disposed = false;
  let acknowledged = false;
  let retry: number | undefined;
  let timeout: number | undefined;
  const origin = host.location.origin;

  const stopTimers = () => {
    host.clearInterval(retry);
    host.clearTimeout(timeout);
    retry = undefined;
    timeout = undefined;
  };
  const request = () => {
    if (disposed) return;
    try {
      getFrameWindow()?.postMessage({ type: 'imobflow-demo-status-request' }, origin);
    } catch {
      // A blocked/unavailable frame must reach the bounded fallback, not crash.
    }
  };
  const receive = (event: MessageEvent) => {
    const target = getFrameWindow();
    if (disposed || !target || event.origin !== origin || event.source !== target) return;
    if (event.data?.type !== 'imobflow-demo-active' || typeof event.data.view !== 'string' || !isView(event.data.view)) return;
    acknowledged = true;
    stopTimers();
    // Keep receiving navigation updates, including a late reply after timeout.
    onReady(event.data.view);
  };

  host.addEventListener('message', receive);
  retry = host.setInterval(request, retryMs);
  timeout = host.setTimeout(() => {
    stopTimers();
    if (!disposed && !acknowledged) onTimeout();
  }, timeoutMs);
  request();

  return {
    request,
    dispose() {
      disposed = true;
      stopTimers();
      host.removeEventListener('message', receive);
    },
  };
}
