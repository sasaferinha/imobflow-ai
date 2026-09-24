'use client';

import { useState, type FormEvent } from 'react';
import { dashboardFetch as fetch, isProductDemo } from '@/lib/dashboard-transport';

type Profile = { name: string; company: string };

export default function ProfileModal({ profile, isOwner, close, save }: {
  profile: Profile; isOwner: boolean; close: () => void; save: (profile: Profile) => void;
}) {
  // Keep the version opened by the user, even if background sync changes props.
  const [initial] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const demo = isProductDemo();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || demo) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), company: isOwner ? form.get('company') : initial.company, expectedName: initial.name, expectedCompany: initial.company }),
      });
      const result = await response.json() as { data?: Profile; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível salvar o perfil.');
      save(result.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar. Confira a conexão e tente novamente.');
    } finally { setSaving(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!saving) close(); }}>
    <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" aria-busy={saving} onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Minha conta</p><h2 id="profile-modal-title">Editar perfil</h2></div><button type="button" aria-label="Fechar" disabled={saving} onClick={close}>×</button></div>
      <label>Nome<input name="name" defaultValue={initial.name} minLength={2} maxLength={120} disabled={saving || demo} autoFocus required /></label>
      <label>Imobiliária<input name="company" defaultValue={initial.company} minLength={2} maxLength={120} readOnly={!isOwner} disabled={saving || demo} required /></label>
      <p className="profile-save-note">{demo ? 'Perfil fictício. As alterações ficam disponíveis na conta da sua imobiliária.' : isOwner ? 'O nome da imobiliária será atualizado para toda a equipe. Seu histórico e suas metas serão preservados.' : 'O nome da imobiliária é administrado pelo responsável da empresa. Seu histórico e suas metas serão preservados.'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" disabled={saving} onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={saving || demo}>{saving ? 'Salvando…' : 'Salvar perfil'}</button></div>
    </form>
  </div>;
}
