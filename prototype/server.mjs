import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulator } from './simulator.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const simulator = new Simulator(process.env.SIM_API_KEY);
const snapshot = JSON.parse(await readFile(resolve(root, 'data/snapshot.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return json(res, 405, { error: 'This research prototype only reads simulator data. Upstream writes are not enabled.' });
  try {
    if (url.pathname.startsWith('/api/')) {
      const captured = url.searchParams.get('mode') === 'snapshot';
      const id = url.searchParams.get('patient') || snapshot.patient.id;
      if (!/^SIM-\d{6}$/.test(id)) return json(res, 400, { error: 'Use a SIM patient identifier.' });
      if (url.pathname === '/api/context') {
        const [team, clock] = captured ? [snapshot.team, snapshot.view] : await Promise.all([simulator.read('/api/team'), simulator.read('/api/clock')]);
        return json(res, 200, { team, now: clock.now, paused: clock.paused, mode: captured ? 'snapshot' : 'live', capturedAt: captured ? snapshot.capturedAt : null });
      }
      if (url.pathname === '/api/patients') {
        const q = (url.searchParams.get('q') || '').slice(0, 200);
        if (captured) {
          const match = JSON.stringify(snapshot.patient).toLowerCase().includes(q.toLowerCase());
          return json(res, 200, { items: match ? [snapshot.patient] : [], total: match ? 1 : 0 });
        }
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        return json(res, 200, await simulator.read('/api/sites/gp/patients', { q, offset }));
      }
      if (url.pathname === '/api/patient') {
        if (captured && id !== snapshot.patient.id) return json(res, 404, { error: 'This snapshot contains Eleanor Chen only. Switch to live data to open another patient.' });
        const [patient, view] = captured ? [snapshot.patient, snapshot.view] : await Promise.all([simulator.patient(id), simulator.view(id)]);
        return json(res, 200, { patient, view, mode: captured ? 'snapshot' : 'live' });
      }
      if (url.pathname === '/api/appointments') {
        const date = url.searchParams.get('date') || '2026-09-12';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Use a YYYY-MM-DD date.' });
        if (captured && date !== '2026-09-12') return json(res, 404, { error: 'Appointment snapshot covers 12 September 2026. Switch to live data for other dates.' });
        return json(res, 200, captured ? snapshot.appointments : await simulator.read('/api/sites/gp/appointments', { date, offset: 0 }));
      }
      return json(res, 404, { error: 'Unknown read endpoint.' });
    }
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(root + sep) || !types[extname(path)] || path.includes(`${sep}data${sep}`)) return json(res, 404, { error: 'Not found' });
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch (error) {
    json(res, error.code === 'ENOENT' ? 404 : 502, { error: error.name === 'TimeoutError' ? 'Simulator timed out. Retry or use captured snapshot mode.' : error.message });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  http.createServer(handle).listen(port, '127.0.0.1', () => console.log(`GP Records prototype: http://localhost:${port}`));
}
