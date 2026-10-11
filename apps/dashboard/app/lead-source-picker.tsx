'use client';

import { useId } from 'react';
import { leadSourceOptions } from '@/lib/lead-sources';
import s from './lead-source-picker.module.css';

type Props = { value: string; onChange: (value: string) => void; options?: readonly string[]; disabled?: boolean; required?: boolean; id?: string };
const otherPrefix = 'Outros: ';

export default function LeadSourcePicker({ value, onChange, options, disabled = false, required = false, id }: Props) {
  const generatedId = useId();
  const groupId = id || generatedId;
  const isOther = value === 'Outros' || value.startsWith(otherPrefix);
  const detail = value.startsWith(otherPrefix) ? value.slice(otherPrefix.length) : '';
  const choices = leadSourceOptions(options, isOther ? 'Outros' : value);

  return <fieldset className={s.picker} disabled={disabled} aria-describedby={`${groupId}-hint`}>
    <legend className={s.legend}>Origem do cliente{required && <span aria-hidden="true"> *</span>}</legend>
    <p className={s.hint} id={`${groupId}-hint`}>Marque uma origem principal: como este cliente chegou até a imobiliária.</p>
    <div className={s.options}>
      {choices.map(option => <label className={s.option} key={option}>
        <input className={s.radio} type="radio" name={`${groupId}-source`} value={option} checked={option === 'Outros' ? isOther : value === option} onChange={() => onChange(option)} required={required} />
        <span className={s.box} aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <span className={s.label}>{option}</span>
      </label>)}
    </div>
    {isOther && <label className={s.detail} htmlFor={`${groupId}-other`}>Qual foi a origem? <span>(opcional)</span>
      <input id={`${groupId}-other`} type="text" value={detail} maxLength={200 - otherPrefix.length} onChange={event => { const text = event.target.value.trimStart(); onChange(text ? `${otherPrefix}${text}` : 'Outros'); }} onBlur={() => { const text = detail.trim(); const normalized = text ? `${otherPrefix}${text}` : 'Outros'; if (normalized !== value) onChange(normalized); }} placeholder="Ex.: evento da região" />
    </label>}
  </fieldset>;
}
