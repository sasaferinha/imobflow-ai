import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/painel', name: 'ImobFlow', short_name: 'ImobFlow', lang: 'pt-BR',
    description: 'Atendimento e gestão imobiliária ImobFlow.',
    start_url: '/painel', scope: '/painel', display: 'standalone',
    background_color: '#f3f8ff', theme_color: '#0066f5',
    icons: [{ src: '/brand/imobflow-mark-v1.png', sizes: '1254x1254', type: 'image/png', purpose: 'any' }],
  };
}
