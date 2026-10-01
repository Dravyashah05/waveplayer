export default function handler(_req: any, res: any) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(200).json({ ok: true, service: 'wave-player' });
  } else {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'wave-player' }));
  }
}
