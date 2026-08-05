'use client';

export default function ExportButton({ orders }: { orders: any[] }) {
  const handleExport = () => {
    if (orders.length === 0) {
      alert('Нет данных для экспорта');
      return;
    }

    // Fixed markup is 5%. 
    // Profit = Total Price - (Total Price / 1.05)
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Номер заказа,Дата,Клиент,Телефон,Сумма (с.),Чистая прибыль (с.),Статус\n";

    orders.forEach(order => {
      const date = new Date(order.created_at).toLocaleString('ru-RU').replace(',', '');
      const total = Number(order.total_price);
      const profit = total - (total / 1.05); // 5% markup profit
      
      const row = [
        order.id,
        date,
        `"${order.customer_name}"`, // escape commas in name
        order.phone,
        total.toFixed(2),
        profit.toFixed(2),
        order.status
      ].join(",");
      
      csvContent += row + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vatan_orders_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <button 
      onClick={handleExport}
      style={{
        background: '#4CAF50',
        color: 'white',
        border: 'none',
        padding: '10px 20px',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: 'bold',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      Экспорт в Excel (CSV)
    </button>
  );
}
