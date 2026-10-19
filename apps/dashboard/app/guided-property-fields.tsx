'use client';

import { useState } from 'react';
import type { PropertyRecord } from '@/lib/operations';
import { PROPERTY_TYPE_CHOICES } from '@/lib/guided-record-fields';
import GuidedRecordField from './guided-record-field';

/** Keeps the canonical catalog FormData contract, including historical custom types. */
export default function GuidedPropertyFields({ property, properties }: { property: PropertyRecord | null; properties: PropertyRecord[] }) {
  const [purpose, setPurpose] = useState(property?.purpose || '');
  const [propertyType, setPropertyType] = useState(property?.propertyType || '');
  const [city, setCity] = useState(property?.city || '');
  const [district, setDistrict] = useState(property?.district || '');
  const [bedrooms, setBedrooms] = useState(property?.bedrooms === undefined ? '' : String(property.bedrooms));
  const [parking, setParking] = useState(property?.parkingSpaces === undefined ? '' : String(property.parkingSpaces));
  const options = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return <>
    <section className="property-form-section">
      <h3>Localização e valores</h3>
      <div className="form-grid">
        <GuidedRecordField id="property-purpose" name="purpose" label="Finalidade" mode="choices" options={['Venda', 'Aluguel']} value={purpose} onChange={setPurpose} required />
        <label>Preço *<input name="price" defaultValue={property?.price} placeholder="Ex.: R$ 650.000" required /></label>
      </div>
      <div className="form-grid">
        <GuidedRecordField id="property-city" name="city" label="Cidade" mode="suggestions" options={options(properties.map(item => item.city || ''))} value={city} onChange={setCity} required />
        <GuidedRecordField id="property-district" name="district" label="Bairro" mode="suggestions" options={options(properties.filter(item => !city || (item.city || '').trim().toLocaleLowerCase('pt-BR') === city.trim().toLocaleLowerCase('pt-BR')).map(item => item.district))} value={district} onChange={setDistrict} required />
      </div>
      <label>Endereço <small>(opcional)</small><input name="address" defaultValue={property?.address} placeholder="Rua, número e complemento" /></label>
    </section>
    <section className="property-form-section">
      <h3>Características</h3>
      <GuidedRecordField id="property-type" name="propertyType" label="Tipo de imóvel" mode="choices" options={PROPERTY_TYPE_CHOICES} value={propertyType} onChange={setPropertyType} allowCustom required />
      <div className="form-grid">
        <GuidedRecordField id="property-bedrooms" name="bedrooms" label="Quartos" mode="count" value={bedrooms} onChange={setBedrooms} hint="Selecione 0 quando não houver quartos." required />
        <GuidedRecordField id="property-parking" name="parkingSpaces" label="Vagas" mode="count" value={parking} onChange={setParking} hint="Selecione 0 quando não houver vaga." required />
      </div>
      <div className="form-grid">
        <label>Área (m²) *<input name="area" type="number" min="0.01" step="0.01" defaultValue={property?.area} placeholder="Ex.: 98" required /></label>
        <label>Situação<select name="status" defaultValue={property?.status || 'Disponível'}><option>Disponível</option><option>Reservado</option><option>Vendido</option><option>Alugado</option></select></label>
      </div>
    </section>
  </>;
}
