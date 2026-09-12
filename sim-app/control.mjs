const SCOPES = ['gp', 'hospital', 'community', 'pharmacy', 'diagnostics', 'referrals', 'wearables'];

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Anima-Source': 'local-app' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let input = '';
  for await (const chunk of req) {
    input += chunk;
    if (Buffer.byteLength(input) > 256_000) throw Object.assign(new Error('Request body too large.'), { status: 413 });
  }
  try { return input ? JSON.parse(input) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

/** The copied organiser UI is backed only by the one imported local world. */
export async function createControlHandler({ pool, worldId, getClock, changeClock }) {
  async function state() {
    const [world, counts, localEvents] = await Promise.all([
      pool.query('SELECT started_at, team FROM sim.worlds WHERE world_id=$1', [worldId]),
      pool.query('SELECT (SELECT count(*) FROM sim.patients WHERE world_id=$1) AS patients, (SELECT count(*) FROM sim.resources WHERE world_id=$1) AS resources', [worldId]),
      pool.query("SELECT body FROM sim.events WHERE world_id=$1 AND body->>'actor'='Local copy' ORDER BY (body->>'time')::numeric DESC", [worldId]),
    ]);
    if (!world.rows.length) throw Object.assign(new Error('Local world not found.'), { status: 404 });
    const events = localEvents.rows.map(row => row.body);
    const logging = {
      since: new Date(world.rows[0].started_at).toISOString(), retentionDays: 0, maxRequestsPerWorld: 0,
      enabled: false, note: 'HTTP request logging is not implemented locally. Patient changes and events below come from real local actions.',
    };
    const team = {
      team: 'local-copy', teamName: 'local-copy', world: worldId,
      scopes: world.rows[0].team?.scopes || SCOPES,
      patientCount: Number(counts.rows[0].patients), resourceCount: Number(counts.rows[0].resources),
      affectedPatientCount: new Set(events.map(event => event.patientId).filter(Boolean)).size,
      requestCount: 0, lastRequestAt: null,
    };
    return { team, events, logging };
  }

  async function activity() {
    const { team, events, logging } = await state();
    const resourceIds = [...new Set(events.map(event => event.resourceId).filter(Boolean))];
    const resources = resourceIds.length ? (await pool.query('SELECT body FROM sim.resources WHERE world_id=$1 AND resource_id=ANY($2::text[])', [worldId, resourceIds])).rows.map(row => row.body) : [];
    const changes = resources.flatMap(resource => [resource.provenance?.created, ...(resource.provenance?.changes || [])]
      .filter(change => change?.actor?.name === 'Local copy')
      .map(change => ({ resourceId: resource.id, ...(resource.patientId ? { patientId: resource.patientId } : {}), title: resource.title, kind: resource.kind, ...change })))
      .sort((a, b) => b.time - a.time);
    const affected = new Map();
    for (const change of changes) {
      if (!change.patientId) continue;
      const item = affected.get(change.patientId) || { id: change.patientId, changeCount: 0, lastChangedAt: 0 };
      item.changeCount++;
      item.lastChangedAt = Math.max(item.lastChangedAt, change.time);
      affected.set(change.patientId, item);
    }
    const directory = affected.size ? (await pool.query('SELECT patient_id, directory FROM sim.patients WHERE world_id=$1 AND patient_id=ANY($2::text[])', [worldId, [...affected.keys()]])).rows : [];
    const names = new Map(directory.map(row => [row.patient_id, row.directory?.name]));
    return { team, requests: [], patients: [...affected.values()].map(item => ({ ...item, name: names.get(item.id) || item.id })), changes, events, logging };
  }

  return async function handleControl(req, res, url) {
    const path = url.pathname;
    const controlView = path === '/api/sites/control/view';
    const selectedClock = path === '/api/clock' && url.searchParams.has('world');
    if (!path.startsWith('/api/control/') && !controlView && !selectedClock) return false;
    try {
      if (req.headers.authorization !== 'Bearer local-operator') { send(res, 401, { error: 'Use the local operator token: local-operator.' }); return true; }
      const route = path.match(/^\/api\/control\/teams\/([^/]+)\/(activity|session)$/);
      const requestedWorld = route ? decodeURIComponent(route[1]) : url.searchParams.get('world');
      if (requestedWorld && requestedWorld !== worldId) { send(res, 404, { error: 'Only the imported local world is available.' }); return true; }

      if (req.method === 'GET' && path === '/api/control/worlds') send(res, 200, [worldId]);
      else if (req.method === 'GET' && path === '/api/control/teams') {
        const { team, logging } = await state(); send(res, 200, { teams: [team], logging });
      } else if (req.method === 'GET' && route?.[2] === 'activity') send(res, 200, await activity());
      else if (req.method === 'POST' && route?.[2] === 'session') {
        await body(req);
        const { team } = await state();
        res.setHeader('Set-Cookie', 'sim_session=local-demo; HttpOnly; SameSite=Strict; Path=/');
        send(res, 200, { apiKey: 'local-demo', team: team.team, teamName: team.teamName, world: worldId, scopes: team.scopes, created: false });
      } else if (controlView && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) { send(res, 400, { error: 'limit must be between 1 and 500.' }); return true; }
        const clock = await getClock();
        const [{ team }, result] = await Promise.all([state(), pool.query("SELECT body FROM sim.resources WHERE world_id=$1 AND kind='capacity' ORDER BY resource_id", [worldId])]);
        const capacities = result.rows.map(row => row.body);
        send(res, 200, { id: worldId, ...clock, population: team.patientCount, resources: capacities.slice(0, limit), capacities, total: capacities.length, incidents: [], agents: [], counters: {}, local: true, capabilities: { clock: true, capacityRead: true, incidentEngine: false, backgroundAgents: false }, note: 'Local capacities and clock are live. Original incident and background-agent engines are unavailable.' });
      } else if (selectedClock && ['GET', 'POST'].includes(req.method)) {
        send(res, 200, req.method === 'POST' ? await changeClock(await body(req)) : await getClock());
      } else if (['/api/control/incidents', '/api/control/incidents/all', '/api/control/agents', '/api/control/model-propose', '/api/control/population', '/api/control/population/publish', '/api/control/population/attach', '/api/control/teams/delete', '/api/control/snapshot'].includes(path) || req.method === 'DELETE') {
        send(res, 501, { error: `The original organiser operation ${path} is not implemented in the local copy. No changes were made.`, local: true });
      } else send(res, 404, { error: 'Unknown local organiser endpoint or unsupported method.' });
    } catch (error) { send(res, error.status || 500, { error: error.message }); }
    return true;
  };
}
