// Shared by the real dashboard and its public, isolated demonstration.
// Production keeps the native fetch behavior. The demo never falls through to it.
let demoTransport: typeof fetch | undefined;

export function isProductDemo() {
  return typeof window !== 'undefined' && /^\/demonstracao\/?$/.test(window.location.pathname);
}

export function installProductDemoTransport(transport: typeof fetch) {
  if (!isProductDemo()) throw new Error('Demo transport requires the demonstration page.');
  demoTransport = transport;
  return () => { demoTransport = undefined; };
}

export const dashboardFetch: typeof fetch = (input, init) => {
  if (isProductDemo()) {
    if (demoTransport) return demoTransport(input, init);
    return Promise.resolve(Response.json({ error: 'A demonstração está carregando.' }, { status: 503 }));
  }
  return globalThis.fetch(input, init);
};
