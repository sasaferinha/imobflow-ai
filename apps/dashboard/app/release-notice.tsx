'use client';

import { useEffect, useState } from 'react';
import { subscribeDashboardSync } from '@/lib/dashboard-sync';

export default function ReleaseNotice() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => subscribeDashboardSync({
    entities: [], interval: 60_000,
    load: async signal => {
      const response = await fetch('/api/version', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Versão indisponível.');
      return (await response.json() as { version: string }).version;
    },
    apply: version => setOutdated(Boolean(version && version !== (process.env.NEXT_PUBLIC_APP_RELEASE || 'development'))),
  }), []);
  return outdated ? <div className="release-notice" role="status">
    <span>Uma atualização do ImobFlow está disponível. Salve o que estiver editando antes de atualizar.</span>
    <button type="button" onClick={() => window.location.reload()}>Atualizar agora</button>
  </div> : null;
}
