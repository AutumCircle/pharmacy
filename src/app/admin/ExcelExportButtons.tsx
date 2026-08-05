'use client';

import { useState } from 'react';
import ExcelJS from 'exceljs';

export default function ExcelExportButtons() {
  const [downloadingInternal, setDownloadingInternal] = useState(false);
  const [downloadingPartner, setDownloadingPartner] = useState(false);

  // Mock data for exports since API is not connected yet
  const mockMedicines = [
    { name: 'Аспирин Кардио тб 100мг №28', quantity: 15, basePrice: 12.10 },
    { name: 'Кетамин г/х амп 5% 2мл №10', quantity: 5, basePrice: 45.50 },
    { name: 'Детская присыпка Good Sbook 200г', quantity: 20, basePrice: 10.00 },
  ];

  const calculateClientPrice = (basePrice: number) => {
    return Math.ceil(basePrice * 1.05); // +5% CEIL
  };

  const handleDownloadInternal = async () => {
    setDownloadingInternal(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Внутренний Отчет');
      
      sheet.columns = [
        { header: 'Название', key: 'name', width: 40 },
        { header: 'Кол-во', key: 'qty', width: 10 },
        { header: 'Цена закупки', key: 'basePrice', width: 15 },
        { header: 'Цена продажи', key: 'sellPrice', width: 15 },
        { header: 'Чистая прибыль', key: 'profit', width: 15 },
      ];

      // Style headers
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      mockMedicines.forEach(med => {
        const sell = calculateClientPrice(med.basePrice);
        sheet.addRow({
          name: med.name,
          qty: med.quantity,
          basePrice: med.basePrice,
          sellPrice: sell,
          profit: (sell - med.basePrice).toFixed(2)
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Internal_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Ошибка при генерации отчета');
    } finally {
      setDownloadingInternal(false);
    }
  };

  const handleDownloadPartner = async () => {
    setDownloadingPartner(true);
    try {
      const workbook = new ExcelJS.Workbook();
      // Protect workbook
      await workbook.protect('vatan123');

      const sheet = workbook.addWorksheet('Отчет для партнера');
      
      sheet.columns = [
        { header: 'Название', key: 'name', width: 40 },
        { header: 'Кол-во', key: 'qty', width: 10 },
        { header: 'Базовая стоимость', key: 'basePrice', width: 20 },
      ];

      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      mockMedicines.forEach(med => {
        sheet.addRow({
          name: med.name,
          qty: med.quantity,
          basePrice: med.basePrice
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Partner_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Ошибка при генерации отчета');
    } finally {
      setDownloadingPartner(false);
    }
  };

  return (
    <div style={{ background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>Выгрузка отчетов (Excel)</h2>
      
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        
        <button 
          onClick={handleDownloadInternal}
          disabled={downloadingInternal}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#e3f2fd', color: '#1976d2', border: 'none', padding: '15px 25px', borderRadius: '8px', cursor: downloadingInternal ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '15px' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          {downloadingInternal ? 'Генерация...' : 'Скачать внутренний отчет'}
        </button>
        
        <button 
          onClick={handleDownloadPartner}
          disabled={downloadingPartner}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f3e5f5', color: '#7b1fa2', border: 'none', padding: '15px 25px', borderRadius: '8px', cursor: downloadingPartner ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '15px' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          {downloadingPartner ? 'Генерация...' : 'Скачать отчет для партнера'}
        </button>

      </div>
      <p style={{ marginTop: '15px', fontSize: '13px', color: '#888' }}>* Отчет для партнера генерируется в режиме "только для чтения".</p>
    </div>
  );
}
