export default function AdminLoading() {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Загрузка данных…</div>
      <div style={{ color: '#666' }}>Admin panel ожидает ответ AWS Lambda. Обычно это занимает несколько секунд после холодного запуска.</div>
    </div>
  );
}
