import React, { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dispatch } from 'redux';
import { dsnBomEntry } from '../../model/dsnBomEntry';

export interface BomProps {
  bom: dsnBomEntry[];
  dispatch: Dispatch<any>;
}

export const Bom: FunctionComponent<BomProps> = (props: BomProps) => {
  const { t } = useTranslation();

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="scroll-container">
        <div>
          <h1 className="bom-header">{t('bom.title')}</h1>
          <table className="table-container bomTable">
            <thead>
              <tr>
                <th>{t('bom.reference')}</th>
                <th>{t('bom.quantity')}</th>
                <th>{t('bom.name')}</th>
              </tr>
            </thead>
            <tbody>
              {props.bom?.map((bom) => (
                <tr key={bom.Name}>
                  <td>{bom.References.join(',')}</td>
                  <td>{bom.Quantity}</td>
                  <td>{bom.Name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
