import http, { IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JWTService } from './jwt.js';
import { RateLimiter } from './rate-limiter.js';

export interface BFFServerConfig {
  port?: number;
  jwtSecret?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  deepseekApiKey?: string;
  rateLimitMax?: number;
  /** Directory for server-side JSONL logging of /agents/plan (spec §9.2).
   * null disables logging. */
  datasetDir?: string | null;
}

/** Structural mirror of the engine's PlanRequest — the BFF never imports the
 * engine, it just relays and logs. */
interface AgentPlanRequest {
  requestId: string;
  reason: 'dawn' | 'surprise' | 'dialogue' | 'reflection';
  agentId: string;
  participantIds?: string[];
  tick?: number;
  hour?: number;
  persona?: string;
  role?: string;
  tribe?: string;
  needs?: Record<string, number>;
  place?: string | null;
  memories?: string[];
  beliefs?: Array<{ objectId: string; type: string; distance: number; state: Record<string, number> }>;
  tools?: Array<{ verb: string; objectId?: string; type?: string; distance?: number }>;
  currentPlan?: string[];
}

const MOCK_PLAN_VERB_PREFERENCE = ['gather_berries', 'gather_wood', 'gather_flint', 'light_fire'];

export class CardinalBFFServer {
  private server: http.Server;
  private jwt: JWTService;
  private rateLimiter: RateLimiter;
  private config: BFFServerConfig;

  constructor(config: BFFServerConfig = {}) {
    this.config = config;
    this.jwt = new JWTService(config.jwtSecret);
    this.rateLimiter = new RateLimiter({
      windowMs: 60000,
      maxRequests: config.rateLimitMax ?? 60,
    });

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public get httpServer(): http.Server {
    return this.server;
  }

  private setCORS(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCORS(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    try {
      // 1. Health check
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
        return;
      }

      // 2. Issue Session Token
      if (url.pathname === '/api/auth/session' && req.method === 'POST') {
        const bodyText = await this.readBody(req);
        const body = bodyText ? JSON.parse(bodyText) : {};
        const subject = body.deviceId || `quest_${Date.now()}`;
        const expiresInSeconds = 3600;

        const token = this.jwt.sign(subject, expiresInSeconds, body.role || 'player');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, expiresInSeconds }));
        return;
      }

      // 3. Proxy Chat Completions
      if (url.pathname === '/api/v1/cardinal/chat' && req.method === 'POST') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');

        const verification = this.jwt.verify(token);
        if (!verification.valid || !verification.payload) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: verification.error || 'Unauthorized' }));
          return;
        }

        const clientId = verification.payload.sub;
        if (!this.rateLimiter.isAllowed(clientId)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Too many requests, rate limit exceeded' }));
          return;
        }

        const bodyText = await this.readBody(req);
        const chatPayload = JSON.parse(bodyText);

        // Resolve upstream provider (Default: Groq for fast VR responses)
        const apiKey =
          this.config.groqApiKey ||
          this.config.openaiApiKey ||
          this.config.deepseekApiKey ||
          process.env.GROQ_API_KEY ||
          process.env.OPENAI_API_KEY ||
          'mock_secret_key';

        const upstreamURL =
          this.config.openaiApiKey
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://api.groq.com/openai/v1/chat/completions';

        // Upstream fetch
        const upstreamResponse = await fetch(upstreamURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(chatPayload),
        });

        const data = await upstreamResponse.text();
        res.writeHead(upstreamResponse.status, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
      }

      // 4. Agent Mode-2 planning (LLM or deterministic mock) + JSONL logging
      if (url.pathname === '/agents/plan' && req.method === 'POST') {
        await this.handleAgentsPlan(req, res);
        return;
      }

      // 5. Trajectory ingestion + stats (spec §9.2)
      if (url.pathname === '/trajectories/batch' && req.method === 'POST') {
        await this.handleTrajectoriesBatch(req, res);
        return;
      }
      if (url.pathname === '/trajectories/stats' && req.method === 'GET') {
        await this.handleTrajectoriesStats(req, res);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
    }
  }

  /** Shared JWT + rate-limit gate. Writes the error response and returns
   * null when the caller must abort. */
  private authorize(req: IncomingMessage, res: ServerResponse): string | null {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const verification = this.jwt.verify(token);
    if (!verification.valid || !verification.payload) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: verification.error || 'Unauthorized' }));
      return null;
    }
    if (!this.rateLimiter.isAllowed(verification.payload.sub)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests, rate limit exceeded' }));
      return null;
    }
    return verification.payload.sub;
  }

  // --- /agents/plan -------------------------------------------------------

  private async handleAgentsPlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.authorize(req, res) === null) return;

    const bodyText = await this.readBody(req);
    const request = (bodyText ? JSON.parse(bodyText) : {}).request as AgentPlanRequest | undefined;
    if (!request || typeof request.requestId !== 'string' || typeof request.agentId !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing request' }));
      return;
    }

    const realKey =
      this.config.groqApiKey ||
      this.config.openaiApiKey ||
      this.config.deepseekApiKey ||
      process.env.GROQ_API_KEY ||
      process.env.OPENAI_API_KEY ||
      null;

    let response: Record<string, unknown>;
    if (realKey === null) {
      response = this.mockPlan(request);
    } else {
      try {
        response = await this.llmPlan(request, realKey);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `invalid llm output: ${String(err)}` }));
        return;
      }
    }

    // Server-side dataset logging (spec §9.2) — fire-and-forget, never blocks
    // nor fails the response.
    void this.appendDatasetLine({ at: Date.now(), request, response });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /** Deterministic offline planner: keeps dev, tests and demos alive with no
   * API key. Chooses believable steps from the provided tool candidates. */
  private mockPlan(request: AgentPlanRequest): Record<string, unknown> {
    const base = {
      requestId: request.requestId,
      reason: request.reason,
      agentId: request.agentId,
      ...(request.participantIds ? { participantIds: request.participantIds } : {}),
    };

    if (request.reason === 'dialogue') {
      const [a, b] = request.participantIds ?? [request.agentId, 'inconnu'];
      const firstBelief = request.beliefs?.[0];
      const topic = firstBelief ? firstBelief.type.replace('_', ' ') : 'la journée';
      return {
        ...base,
        lines: [
          { speaker: a, text: `As-tu vu ? Près d'ici, ${topic} nous attend.` },
          { speaker: b, text: 'Bien vu — la tribu en profitera.' },
        ],
        sharedFacts: firstBelief
          ? [
              {
                objectId: firstBelief.objectId,
                type: firstBelief.type,
                x: 0,
                z: 0,
                state: firstBelief.state,
              },
            ]
          : [],
      };
    }

    if (request.reason === 'reflection') {
      return { ...base, insights: ['Jour vécu: besoins gérés, tribu soudée.'] };
    }

    const withObject = (request.tools ?? [])
      .filter((t) => t.objectId !== undefined)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    const steps: Array<{ goal: string; verb: string; objectId?: string; predicted: string }> = [];
    for (const preferred of MOCK_PLAN_VERB_PREFERENCE) {
      if (steps.length >= 3) break;
      const tool = withObject.find((t) => t.verb === preferred);
      if (tool) {
        steps.push({
          goal: `faire ${tool.verb}`,
          verb: tool.verb,
          objectId: tool.objectId,
          predicted: `réussite de ${tool.verb}`,
        });
      }
    }
    if ((request.tools ?? []).some((t) => t.verb === 'eat_berries')) {
      steps.push({ goal: 'me nourrir', verb: 'eat_berries', predicted: 'faim restaurée' });
    }
    return { ...base, steps };
  }

  private async llmPlan(request: AgentPlanRequest, apiKey: string): Promise<Record<string, unknown>> {
    const isOpenAI = Boolean(this.config.openaiApiKey || process.env.OPENAI_API_KEY);
    const upstreamURL = isOpenAI
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
    const model = isOpenAI ? 'gpt-4o-mini' : 'llama-3.1-8b-instant';

    const system = this.buildSystemPrompt(request);
    const upstream = await fetch(upstreamURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(request) },
        ],
      }),
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('empty completion');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      requestId: request.requestId,
      reason: request.reason,
      agentId: request.agentId,
      ...(request.participantIds ? { participantIds: request.participantIds } : {}),
      ...parsed,
    };
  }

  private buildSystemPrompt(request: AgentPlanRequest): string {
    if (request.reason === 'dialogue') {
      const [a, b] = request.participantIds ?? ['A', 'B'];
      return (
        `Tu écris un court dialogue préhistorique en français entre ${a} et ${b}. ` +
        `Persona de ${a}: ${request.persona}. 2 à 4 répliques naturelles, informatives ` +
        `(ressources, dangers, liens). Réponds UNIQUEMENT en JSON: ` +
        `{"lines":[{"speaker":"${a}","text":"..."}],"sharedFacts":[{"objectId":"...","type":"...","x":0,"z":0,"state":{}}]} ` +
        `— sharedFacts reprend des croyances citées dans la requête, ou [].`
      );
    }
    if (request.reason === 'reflection') {
      return (
        `Tu es ${request.persona} (${request.role}, tribu ${request.tribe}). ` +
        `Synthétise la journée décrite (souvenirs fournis) en 1 à 3 enseignements durables, ` +
        `concrets et utiles demain. Réponds UNIQUEMENT en JSON: {"insights":["..."]}`
      );
    }
    return (
      `Tu es ${request.persona} (${request.role}, tribu ${request.tribe}), un villageois autonome. ` +
      `Tes besoins (0-100, 100=satisfait sauf stress): ${JSON.stringify(request.needs)}. ` +
      `Choisis un plan de 1 à 4 pas parmi les outils fournis (verbe + objectId obligatoire pour ` +
      `les verbes-monde). Pour chaque pas, "predicted" décrit le résultat concret attendu. ` +
      `Réponds UNIQUEMENT en JSON: {"steps":[{"goal":"...","verb":"...","objectId":"...","predicted":"..."}]}`
    );
  }

  // --- /trajectories ------------------------------------------------------

  private static readonly RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  private trajectoriesDir(): string | null {
    const dir = this.config.datasetDir === undefined ? './datasets/agents' : this.config.datasetDir;
    return dir === null ? null : path.join(dir, 'trajectories');
  }

  private async handleTrajectoriesBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.authorize(req, res) === null) return;
    const bodyText = await this.readBody(req);
    const body = (bodyText ? JSON.parse(bodyText) : {}) as {
      runId?: string;
      decisions?: unknown[];
      predictions?: unknown[];
      episodes?: unknown[];
    };
    if (typeof body.runId !== 'string' || !CardinalBFFServer.RUN_ID_RE.test(body.runId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid runId' }));
      return;
    }

    const streams: Array<['decisions' | 'predictions' | 'episodes', unknown[]]> = [
      ['decisions', Array.isArray(body.decisions) ? body.decisions : []],
      ['predictions', Array.isArray(body.predictions) ? body.predictions : []],
      ['episodes', Array.isArray(body.episodes) ? body.episodes : []],
    ];
    const appended: Record<string, number> = { decisions: 0, predictions: 0, episodes: 0 };
    const base = this.trajectoriesDir();
    for (const [name, records] of streams) {
      appended[name] = records.length;
      if (base === null || records.length === 0) continue;
      try {
        const dir = path.join(base, body.runId);
        await fs.mkdir(dir, { recursive: true });
        const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
        await fs.appendFile(path.join(dir, `${name}.jsonl`), lines);
      } catch {
        // Ingestion must never fail the caller for disk reasons.
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, appended }));
  }

  private async handleTrajectoriesStats(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.authorize(req, res) === null) return;
    const base = this.trajectoriesDir();
    const runs: Array<Record<string, unknown>> = [];
    if (base !== null) {
      try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        for (const entry of entries.filter((e) => e.isDirectory())) {
          const run: Record<string, unknown> = { runId: entry.name };
          for (const stream of ['decisions', 'predictions', 'episodes'] as const) {
            try {
              const content = await fs.readFile(path.join(base, entry.name, `${stream}.jsonl`), 'utf8');
              run[stream] = content.split('\n').filter((l) => l.length > 0).length;
            } catch {
              run[stream] = 0;
            }
          }
          runs.push(run);
        }
      } catch {
        // Missing directory -> empty listing.
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runs }));
  }

  private datasetDirReady = false;

  private async appendDatasetLine(entry: Record<string, unknown>): Promise<void> {
    const dir = this.config.datasetDir === undefined ? './datasets/agents' : this.config.datasetDir;
    if (dir === null) return;
    try {
      if (!this.datasetDirReady) {
        await fs.mkdir(dir, { recursive: true });
        this.datasetDirReady = true;
      }
      const day = new Date().toISOString().slice(0, 10);
      await fs.appendFile(path.join(dir, `decisions-${day}.jsonl`), JSON.stringify(entry) + '\n');
    } catch {
      // Logging must never break planning.
    }
  }

  public async start(port?: number): Promise<void> {
    const listenPort = port ?? this.config.port ?? 3001;
    return new Promise((resolve) => {
      this.server.listen(listenPort, () => {
        console.log(`[Cardinal BFF Server] Listening on http://localhost:${listenPort}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
