'use client';
/* eslint-disable @next/next/no-img-element -- property previews */
import { useEffect, useState } from 'react';
import s from './opportunity-photos.module.css';

export default function OpportunityPhotos({ images, message, customer }: { images: string[]; message: string; customer: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<{ source: string; file: File; url: string }[]>([]);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    void (async () => {
      try {
        const files = await Promise.all(selected.map(async (source, index) => {
          const response = await fetch(source, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), credentials: 'omit' });
          if (!response.ok) throw new Error('Não foi possível preparar as fotos. Selecione novamente para tentar.');
          const blob = await response.blob();
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size > 8_000_000) throw new Error('Uma das fotos tem formato ou tamanho incompatível.');
          if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
          const file = new File([blob], `imovel-foto-${index + 1}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]}`, { type: blob.type });
          const url = URL.createObjectURL(file); urls.push(url);
          return { source, file, url };
        }));
        if (!controller.signal.aborted) setPrepared(files);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Não foi possível preparar as fotos.'); }
    })();
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [selected]);
  const ready = selected.length > 0 && prepared.length === selected.length && prepared.every(item => selected.includes(item.source));
  const files = prepared.map(item => item.file);
  const canShare = ready && typeof navigator !== 'undefined' && (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }));
  async function share() {
    if (!canShare || sharing) return;
    setSharing(true); setNotice(''); setError('');
    try {
      await navigator.share({ files, text: message });
      setNotice('Compartilhamento aberto. Confira o destinatário e finalize o envio no WhatsApp.');
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError('O compartilhamento não foi concluído. Você pode baixar as fotos abaixo e anexá-las no WhatsApp.');
    } finally { setSharing(false); }
  }
  return <section className={s.box} aria-label="Fotos para enviar ao cliente">
    <div className={s.heading}><strong>Adicionar fotos à mensagem</strong><span>{selected.length} selecionadas</span></div>
    {images.length ? <><p>Selecione as fotos do imóvel que deseja compartilhar com {customer}.</p><div className={s.gallery}>{images.slice(0,5).map((image,index) => <label className={s.photo} key={image}><img src={image} alt={`Foto ${index + 1} do imóvel`}/><span><input type="checkbox" checked={selected.includes(image)} disabled={sharing} onChange={() => { setError(''); setNotice(''); setPrepared([]); setSelected(current => current.includes(image) ? current.filter(value => value !== image) : [...current,image]); }}/>{index === 0 ? 'Capa' : `Foto ${index + 1}`}</span></label>)}</div></> : <p>Este imóvel ainda não tem fotos. Adicione-as em Catálogo e fotos → Gerenciar fotos.</p>}
    {selected.length > 0 && !ready && !error && <p role="status">Preparando as fotos…</p>}
    {ready && <><div className={s.actions}>{canShare && <button type="button" disabled={sharing} onClick={() => void share()}>{sharing ? 'Compartilhando…' : 'Compartilhar texto e fotos'}</button>}{prepared.map((item,index) => <a key={item.source} href={item.url} download={item.file.name}>Baixar foto {index + 1}</a>)}</div><p>{canShare ? `Escolha o WhatsApp e o contato de ${customer} na tela de compartilhamento.` : 'Neste navegador, baixe as fotos acima. Depois abra o WhatsApp pelo botão abaixo e anexe os arquivos à conversa.'} O botão “Continuar no WhatsApp” leva somente o texto.</p></>}
    {error && <p role="alert" className={s.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
