'use client';
import { useState } from 'react';

export default function AppointmentTimeField() {
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  return <fieldset className="visit-time-field">
    <legend>Horário da visita</legend>
    <div className="visit-time-picker">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <select aria-label="Hora da visita" required value={hour} onChange={event => setHour(event.target.value)}>
        <option value="" disabled>Hora</option>
        {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')).map(value => <option value={value} key={value}>{value}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label="Minutos da visita" required value={minute} onChange={event => setMinute(event.target.value)}>
        <option value="" disabled>Min</option>
        {Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0')).map(value => <option value={value} key={value}>{value}</option>)}
      </select>
    </div>
    <input type="hidden" name="time" value={hour && minute ? `${hour}:${minute}` : ''}/>
  </fieldset>;
}
