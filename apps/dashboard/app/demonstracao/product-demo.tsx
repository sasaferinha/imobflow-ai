'use client';

import { useEffect, useState } from 'react';
import DashboardClient from '../dashboard-client';
import { installProductDemoTransport } from '@/lib/dashboard-transport';
import { createProductDemoTransport, productDemoAccount } from '@/lib/product-demo-data';
import './product-demo.css';

export default function ProductDemo() {
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('Explore o painel. Os dados são fictícios e as alterações não são salvas.');
  useEffect(() => {
    const uninstall = installProductDemoTransport(createProductDemoTransport());
    const timer = window.setTimeout(() => setReady(true), 0);
    // Height follows the actual panel so the landing keeps one natural page scroll.
    const resize = new ResizeObserver(() => {
      const height = document.querySelector('.public-product-demo')?.getBoundingClientRect().height;
      window.parent.postMessage({ type: 'imobflow-demo-height', height }, window.location.origin);
    });
    resize.observe(document.body);
    const blockNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a[href]')) {
        event.preventDefault();
        event.stopPropagation();
        setNotice('Este é um exemplo do painel. Nenhum contato externo é realizado.');
      }
    };
    document.addEventListener('click', blockNavigation, true);
    return () => { uninstall(); clearTimeout(timer); resize.disconnect(); document.removeEventListener('click', blockNavigation, true); };
  }, []);

  return <div className="public-product-demo">
    <div className="public-demo-notice" role="status"><strong>Demonstração</strong><span>{notice}</span></div>
    {ready ? <DashboardClient publicDemo account={productDemoAccount} initialView="conversations" /> : <p className="public-demo-loading">Carregando o painel demonstrativo…</p>}
  </div>;
}
