import { fetchAdminData } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminHistory() {
  let logsData: any = null;
  let error = null;

  try {
    const res = await fetchAdminData('history');
    logsData = res;
  } catch (err: any) {
    error = err.message;
  }

  const logs = Array.isArray(logsData?.history) ? logsData.history : (Array.isArray(logsData) ? logsData : []);

  // Sort logs by newest first if possible
  logs.sort((a: any, b: any) => {
    return new Date(b.sync_time || 0).getTime() - new Date(a.sync_time || 0).getTime();
  });

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '30px' }}>История синхронизаций</h1>
      
      {error && (
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '8px', color: '#c62828', marginBottom: '20px' }}>
          Ошибка загрузки данных API: {error}
        </div>
      )}

      {logs.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#888', background: 'white', borderRadius: '12px' }}>
          Логи синхронизации отсутствуют
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {logs.map((log: any, idx: number) => {
            const dateObj = new Date(log.sync_time);
            const timeStr = dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const dateStr = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
            
            return (
              <div key={idx} style={{ 
                background: 'white', 
                borderRadius: '16px', 
                border: '1px solid #E8E8E8', 
                padding: '24px',
                display: 'flex',
                gap: '24px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
              }}>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  minWidth: '100px',
                  borderRight: '1px solid #F0F0F0',
                  paddingRight: '24px'
                }}>
                  <div style={{ background: '#e8f5e9', color: '#2e7d32', width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#313131' }}>{timeStr}</div>
                  <div style={{ fontSize: '13px', color: '#888', textAlign: 'center' }}>{dateStr}</div>
                </div>

                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', alignItems: 'center' }}>
                  <div style={{ background: '#F9F9F9', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: '5px' }}>Обновлено товаров</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#313131' }}>{Number(log.upserted_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  <div style={{ background: '#e8f5e9', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#2e7d32', marginBottom: '5px' }}>В наличии</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2e7d32' }}>{Number(log.in_stock_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  <div style={{ background: '#ffebee', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#c62828', marginBottom: '5px' }}>В архиве (Нет в наличии)</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c62828' }}>{Number(log.out_of_stock_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
