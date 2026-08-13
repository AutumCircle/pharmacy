import { listCatalogSyncs } from '@/lib/api-v1/admin-server';
import { requireAdminSession } from '@/lib/admin-auth';
import type { CatalogSyncSummary } from '@/lib/api-v1/admin-types';

export const dynamic = 'force-dynamic';
const PHARMACY_TIME_ZONE = 'Asia/Dushanbe';
const STATUS_LABELS: Record<CatalogSyncSummary['status'], string> = {
  awaiting_upload: 'Ожидает загрузки',
  validating: 'Проверяется',
  importing: 'Импортируется',
  succeeded: 'Успешно',
  failed: 'Ошибка',
};

export default async function AdminHistory() {
  let logs: CatalogSyncSummary[] = [];
  let error: string | null = null;

  try {
    await requireAdminSession();
    logs = (await listCatalogSyncs()).data;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Unknown error';
  }

  // Sort logs by newest first if possible
  logs.sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
          {logs.map((log) => {
            const dateObj = new Date(log.completed_at || log.created_at);
            const timeStr = dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: PHARMACY_TIME_ZONE });
            const dateStr = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', timeZone: PHARMACY_TIME_ZONE });
            const succeeded = log.status === 'succeeded';
            const failed = log.status === 'failed';
            const statusColor = succeeded ? '#2e7d32' : failed ? '#c62828' : '#9a6700';
            const statusBackground = succeeded ? '#e8f5e9' : failed ? '#ffebee' : '#fff8e1';
            
            return (
              <div key={log.sync_id} style={{
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
                  <div style={{ background: statusBackground, color: statusColor, width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px', fontWeight: 700 }}>
                    {succeeded ? '✓' : failed ? '!' : '…'}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#313131' }}>{timeStr}</div>
                  <div style={{ fontSize: '13px', color: '#888', textAlign: 'center' }}>{dateStr}</div>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                    <div>
                      <strong style={{ color: statusColor }}>{STATUS_LABELS[log.status]}</strong>
                      <div style={{ color: '#777', fontSize: 12, marginTop: 4 }}>Источник: {log.source_id}</div>
                    </div>
                    <code style={{ color: '#666', fontSize: 12, overflowWrap: 'anywhere' }}>{log.sync_id}</code>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '12px', alignItems: 'center' }}>
                  <div style={{ background: '#F9F9F9', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: '5px' }}>Получено строк</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#313131' }}>{Number(log.received_row_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  <div style={{ background: '#F9F9F9', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: '5px' }}>Добавлено / обновлено</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#313131' }}>{Number(log.inserted_count || 0).toLocaleString('ru-RU')} / {Number(log.updated_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  <div style={{ background: '#e8f5e9', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#2e7d32', marginBottom: '5px' }}>В наличии</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2e7d32' }}>{Number(log.in_stock_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  <div style={{ background: '#ffebee', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#c62828', marginBottom: '5px' }}>В архиве (Нет в наличии)</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c62828' }}>{Number(log.out_of_stock_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  <div style={{ background: log.conflict_count ? '#fff8e1' : '#F9F9F9', padding: '15px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: '5px' }}>Конфликты</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: log.conflict_count ? '#9a6700' : '#313131' }}>{Number(log.conflict_count || 0).toLocaleString('ru-RU')}</div>
                  </div>
                  </div>
                  {log.error_code && <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#ffebee', color: '#c62828' }}>Код ошибки: {log.error_code}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
