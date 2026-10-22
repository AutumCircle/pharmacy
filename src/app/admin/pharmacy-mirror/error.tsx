'use client';
export default function MirrorError({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <h2>Не удалось прочитать базу аптеки</h2>
      <p>Проверьте соединение и повторите попытку.</p>
      <button onClick={reset}>Повторить</button>
    </div>
  );
}
