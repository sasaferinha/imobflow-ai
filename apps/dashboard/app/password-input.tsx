'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import styles from './password-input.module.css';

export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = props.id || generatedId;
  return <span className={styles.field}>
    <input {...props} id={id} type={visible ? 'text' : 'password'} />
    <button className={styles.toggle} type="button" aria-controls={id} aria-pressed={visible} disabled={props.disabled} onClick={() => setVisible(value => !value)}>{visible ? 'Ocultar senha' : 'Mostrar senha'}</button>
  </span>;
}
