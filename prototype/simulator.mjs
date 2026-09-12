export class Simulator {
  constructor(key, { origin = 'https://sim.animahealth.com', fetcher = fetch } = {}) {
    this.key = key;
    this.origin = origin;
    this.fetcher = fetcher;
  }

  async read(path, query = {}) {
    if (!this.key) throw new Error('Set SIM_API_KEY in .env.local, or select captured snapshot mode.');
    const url = new URL(path, this.origin);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Simulator returned HTTP ${response.status}. Retry or use captured snapshot mode.`);
    return response.json();
  }

  async patient(id) {
    const data = await this.read('/api/sites/gp/patients', { q: id, offset: 0 });
    const patient = data.items.find(item => item.id === id);
    if (!patient) throw new Error('Patient was not found in this team world.');
    return patient;
  }

  async view(id) {
    const first = await this.read('/api/sites/gp/view', { patient: id, limit: 500, offset: 0 });
    const resources = [...first.resources];
    for (let offset = first.resources.length; offset < first.resourceTotal;) {
      const page = await this.read('/api/sites/gp/view', { patient: id, limit: 500, offset });
      if (!page.resources.length) throw new Error('Simulator pagination stopped before all records were returned.');
      resources.push(...page.resources);
      offset += page.resources.length;
    }
    // Site views also include service records without a patient. Keep that distinction explicit.
    return { ...first, resources, resourceOffset: 0, resourceLimit: resources.length };
  }
}
