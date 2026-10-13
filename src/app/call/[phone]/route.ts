// Telegram buttons cannot open tel: links directly, so the courier's "Позвонить" button lands here.
export async function GET(_request: Request, { params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  if (!/^992\d{9}$/.test(phone)) return new Response('Неверный номер', { status: 404 });
  const tel = `tel:+${phone}`;
  const shown = `+992 ${phone.slice(3, 6)} ${phone.slice(6, 8)} ${phone.slice(8, 10)} ${phone.slice(10)}`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Позвонить ${shown}</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f3f5f4;color:#14201a}
main{display:grid;gap:14px;justify-items:center;padding:24px;text-align:center}p{margin:0;color:#66706a}
a{display:block;padding:18px 28px;border-radius:16px;background:#187a3c;color:#fff;font-size:22px;font-weight:700;text-decoration:none}</style>
</head><body><main><p>Звонок клиенту</p><a href="${tel}">📞 ${shown}</a><p>Если набор не начался, нажмите на кнопку.</p></main>
<script>location.href=${JSON.stringify(tel)};</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
