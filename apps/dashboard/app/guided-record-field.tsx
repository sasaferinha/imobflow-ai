'use client';

import { useState } from 'react';
import { customFeatures, featureSelected, replaceCustomFeatures, toggleFeature } from '@/lib/guided-record-fields';
import s from './guided-record-field.module.css';

type Option = string | { value: string; label: string };
export type GuidedRecordFieldProps = {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode: 'choices' | 'count' | 'suggestions' | 'multi';
  options?: readonly Option[];
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
  allowCustom?: boolean;
};

/** Native radios, checkboxes and inputs keep keyboard access and form validation. */
export default function GuidedRecordField({ id, name = id, label, value, onChange, mode, options = [], required, disabled, hint, placeholder, allowCustom }: GuidedRecordFieldProps) {
  const choices = options.map(option => typeof option === 'string' ? { value: option, label: option } : option);
  const matched = choices.some(option => option.value === value);
  const [customOpen, setCustomOpen] = useState(Boolean(value && !matched));
  const customActive = allowCustom && (customOpen || Boolean(value && !matched));
  const [customDraft, setCustomDraft] = useState(() => customFeatures(value, choices.map(option => option.value)));
  const hintId = hint ? `${id}-hint` : undefined;
  const title = <>{label}{required && <span className={s.required}> *</span>}</>;

  if (mode === 'suggestions') return <div className={s.field}>
    <label htmlFor={id}>{title}</label>
    <input id={id} name={name} type="text" list={`${id}-options`} value={value} onChange={event => onChange(event.target.value)} required={required} disabled={disabled} aria-describedby={hintId} placeholder={placeholder || 'Selecione uma sugestão ou digite'} maxLength={500} />
    <datalist id={`${id}-options`}>{choices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>
    {hint && <small id={hintId} className={s.hint}>{hint}</small>}
  </div>;

  return <fieldset className={s.field} disabled={disabled} aria-describedby={hintId}>
    <legend>{title}</legend>
    {mode === 'choices' && <>
      <input type="hidden" name={name} value={value} />
      <div className={s.choices}>
        {choices.map(option => <label key={option.value} className={s.choice}>
          <input type="radio" name={`${name}-choice`} value={option.value} required={required} checked={!customActive && value === option.value} onChange={() => { setCustomOpen(false); onChange(option.value); }} />
          <span>{option.label}</span>
        </label>)}
        {allowCustom && <label className={s.choice}><input type="radio" name={`${name}-choice`} value="__custom" required={required} checked={Boolean(customActive)} onChange={() => { setCustomOpen(true); if (matched) onChange(''); }} /><span>Outro tipo</span></label>}
        {!allowCustom && value && !matched && <label className={s.choice}><input type="radio" name={`${name}-choice`} value={value} checked readOnly /><span>{value}</span></label>}
      </div>
      {customActive && <label className={s.custom}><span>Qual tipo de imóvel?</span><input id={id} value={value} required={required} maxLength={500} onChange={event => onChange(event.target.value)} placeholder="Digite o tipo" /></label>}
      {!required && value && <button className={s.clear} type="button" onClick={() => { setCustomOpen(false); onChange(''); }}>Limpar seleção</button>}
    </>}
    {mode === 'count' && <div className={s.count}>
      <div className={s.countChoices}>{[0, 1, 2, 3, 4, 5].map(count => <button key={count} type="button" aria-label={`${label}: ${count}`} aria-pressed={value === String(count)} onClick={() => onChange(String(count))}>{count}</button>)}</div>
      <input id={id} name={name} type="number" min="0" step="1" value={value} onChange={event => onChange(event.target.value)} required={required} aria-label={`${label} — quantidade exata`} placeholder="Outra quantidade" />
    </div>}
    {mode === 'multi' && <>
      <input type="hidden" name={name} value={value} />
      <div className={s.choices}>{choices.map(option => <label key={option.value} className={s.choice}><input type="checkbox" checked={featureSelected(value, option.value)} onChange={event => { const next = toggleFeature(value, option.value, event.target.checked); setCustomDraft(customFeatures(next, choices.map(item => item.value))); onChange(next); }} /><span>{option.label}</span></label>)}</div>
      <label className={s.custom}><span>Outras características <small>(opcional)</small></span><input id={id} value={customDraft} maxLength={5000} onChange={event => { setCustomDraft(event.target.value); onChange(replaceCustomFeatures(value, choices.map(option => option.value), event.target.value, customDraft)); }} placeholder="Ex.: escritório, área gourmet" /></label>
    </>}
    {hint && <small id={hintId} className={s.hint}>{hint}</small>}
  </fieldset>;
}
