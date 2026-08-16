import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardinalBFFServer } from '../src/server';
import { JWTService } from '../src/jwt';
import { RateLimiter } from '../src/rate-limiter';

describe('Cardinal BFF Proxy Server', () => {
  let server: CardinalBFFServer;
  const port = 3099;
  const baseUrl = `http://localhost:${port}`;

  beforeAll(async () => {
    server = new CardinalBFFServer({
      port,
      jwtSecret: 'test_jwt_secret_key_123',
      rateLimitMax: 5,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('JWTService & RateLimiter', () => {
    it('should sign and verify valid JWT token', () => {
      const jwt = new JWTService('test_jwt_secret_key_123');
      const token = jwt.sign('quest_device_001', 3600);

      const result = jwt.verify(token);
      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe('quest_device_001');
    });

    it('should reject tampered or invalid JWT signature', () => {
      const jwt = new JWTService('test_jwt_secret_key_123');
      const token = jwt.sign('quest_device_001', 3600);

      const badJwt = new JWTService('different_secret_key');
      const result = badJwt.verify(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature');
    });

    it('should enforce rate limiting bounds', () => {
      const limiter = new RateLimiter({ windowMs: 10000, maxRequests: 2 });
      expect(limiter.isAllowed('client_a')).toBe(true);
      expect(limiter.isAllowed('client_a')).toBe(true);
      expect(limiter.isAllowed('client_a')).toBe(false);
      expect(limiter.isAllowed('client_b')).toBe(true);
    });
  });

  describe('HTTP Endpoints', () => {
    it('should return 200 on /health', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
    });

    it('should issue a session JWT on POST /api/auth/session', async () => {
      const res = await fetch(`${baseUrl}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'quest_pro_unit_1' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { token: string; expiresInSeconds: number };
      expect(json.token).toBeDefined();
      expect(json.expiresInSeconds).toBe(3600);
    });

    it('should reject unauthenticated requests to /api/v1/cardinal/chat', async () => {
      const res = await fetch(`${baseUrl}/api/v1/cardinal/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [] }),
      });

      expect(res.status).toBe(401);
    });
  });
});

describe('/agents/plan (mock mode, server-side jsonl logging)', () => {
  let server: CardinalBFFServer;
  let datasetDir: string;
  const port = 3098;
  const baseUrl = `http://localhost:${port}`;
  const savedEnv: Record<string, string | undefined> = {};

  async function getToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'sim_test' }),
    });
    return ((await res.json()) as { token: string }).token;
  }

  function dawnRequest() {
    return {
      requestId: 'mira:100:dawn',
      reason: 'dawn',
      agentId: 'mira',
      tick: 100,
      hour: 6,
      persona: 'Douce et prévoyante',
      role: 'Cueilleuse',
      tribe: 'Aube',
      needs: { hunger: 20, warmth: 80, energy: 70, affection: 80, stress: 10 },
      place: 'camp_aube',
      memories: [],
      beliefs: [
        { objectId: 'berry_bush_1', type: 'berry_bush', distance: 2, state: { berriesLeft: 8 } },
      ],
      tools: [
        { verb: 'gather_berries', objectId: 'berry_bush_1', type: 'berry_bush', distance: 2 },
        { verb: 'eat_berries' },
      ],
      currentPlan: [],
    };
  }

  beforeAll(async () => {
    // Force mock mode even if real API keys/endpoints leak from the shell.
    for (const key of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    datasetDir = mkdtempSync(join(tmpdir(), 'cardinal-datasets-'));
    server = new CardinalBFFServer({
      port,
      jwtSecret: 'test_jwt_secret_key_123',
      rateLimitMax: 100,
      datasetDir,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    rmSync(datasetDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it('rejects requests without a token', async () => {
    const res = await fetch(`${baseUrl}/agents/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: dawnRequest() }),
    });
    expect(res.status).toBe(401);
  });

  it('mock mode returns a valid dawn plan and logs jsonl', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/agents/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ request: dawnRequest() }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requestId: string;
      agentId: string;
      steps: Array<{ verb: string; objectId?: string; predicted: string }>;
    };
    expect(body.requestId).toBe('mira:100:dawn');
    expect(body.agentId).toBe('mira');
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.steps[0]).toMatchObject({ verb: 'gather_berries', objectId: 'berry_bush_1' });
    expect(body.steps.some((s) => s.verb === 'eat_berries')).toBe(true);
    for (const step of body.steps) expect(step.predicted.length).toBeGreaterThan(0);

    // Wait a beat for the fire-and-forget append, then check the jsonl.
    await new Promise((r) => setTimeout(r, 100));
    const files = readdirSync(datasetDir).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);
    const lines = readFileSync(join(datasetDir, files[0]!), 'utf8').trim().split('\n');
    const logged = JSON.parse(lines[lines.length - 1]!);
    expect(logged.request.requestId).toBe('mira:100:dawn');
    expect(logged.response.steps.length).toBeGreaterThan(0);
  });

  it('mock dialogue returns lines and shares the first belief', async () => {
    const token = await getToken();
    const request = {
      ...dawnRequest(),
      requestId: 'ana:200:dialogue',
      reason: 'dialogue',
      agentId: 'ana',
      participantIds: ['ana', 'ben'],
    };
    const res = await fetch(`${baseUrl}/agents/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ request }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      participantIds: string[];
      lines: Array<{ speaker: string; text: string }>;
      sharedFacts: Array<{ objectId: string }>;
    };
    expect(body.participantIds).toEqual(['ana', 'ben']);
    expect(body.lines.length).toBeGreaterThanOrEqual(2);
    expect(body.lines.length).toBeLessThanOrEqual(4);
    expect(body.lines[0]?.speaker).toBe('ana');
    expect(body.sharedFacts[0]?.objectId).toBe('berry_bush_1');
  });

  it('mock player_dialogue returns an in-character reply', async () => {
    const token = await getToken();
    const request = {
      ...dawnRequest(),
      requestId: 'mira:300:player_dialogue',
      reason: 'player_dialogue',
      participantIds: ['player', 'mira'],
      playerText: 'Bonjour !',
    };
    const res = await fetch(`${baseUrl}/agents/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ request }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply.length).toBeGreaterThan(0);
  });

  it('trajectories/batch appends jsonl per run and stats counts them', async () => {
    const token = await getToken();
    const post = await fetch(`${baseUrl}/trajectories/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        runId: 'vr-test-1',
        decisions: [{ a: 1 }],
        episodes: [{ tick: 1 }, { tick: 2 }],
      }),
    });
    expect(post.status).toBe(200);
    const posted = (await post.json()) as { appended: Record<string, number> };
    expect(posted.appended).toEqual({ decisions: 1, predictions: 0, episodes: 2 });

    const stats = await fetch(`${baseUrl}/trajectories/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as { runs: Array<Record<string, unknown>> };
    const run = body.runs.find((r) => r.runId === 'vr-test-1');
    expect(run).toMatchObject({ decisions: 1, predictions: 0, episodes: 2 });
  });

  it('rejects malicious runIds', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/trajectories/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId: '../../etc', episodes: [{}] }),
    });
    expect(res.status).toBe(400);
  });

  it('mock reflection returns insights', async () => {
    const token = await getToken();
    const request = { ...dawnRequest(), requestId: 'mira:2100:reflection', reason: 'reflection' };
    const res = await fetch(`${baseUrl}/agents/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ request }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { insights: string[] };
    expect(body.insights.length).toBeGreaterThan(0);
  });

  describe('custom OpenAI-compatible upstream (local MLX/exo-style server)', () => {
    let llmServer: CardinalBFFServer;
    let fakeUpstream: import('node:http').Server;
    let capturedBody: Record<string, unknown> | null = null;
    let capturedAuth: string | undefined;
    const llmPort = 3096;
    const upstreamPort = 3097;
    const llmBase = `http://localhost:${llmPort}`;

    beforeAll(async () => {
      const http = await import('node:http');
      fakeUpstream = http.createServer((req, res) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          capturedBody = JSON.parse(data);
          capturedAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          // Small local models often wrap JSON in markdown fences — the BFF
          // must parse leniently.
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '```json\n{"steps":[{"goal":"cueillir","verb":"gather_berries","objectId":"berry_bush_1","predicted":"+2 baies"}]}\n```',
                  },
                },
              ],
            })
          );
        });
      });
      await new Promise<void>((r) => fakeUpstream.listen(upstreamPort, r));
      llmServer = new CardinalBFFServer({
        port: llmPort,
        jwtSecret: 'test_jwt_secret_key_123',
        rateLimitMax: 100,
        datasetDir: null,
        llmBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        llmModel: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
        llmApiKey: 'x',
      });
      await llmServer.start();
    });

    afterAll(async () => {
      await llmServer.stop();
      await new Promise<void>((r) => fakeUpstream.close(() => r()));
    });

    it('routes /agents/plan to the custom endpoint with model, key, and lenient JSON parsing', async () => {
      const sessionRes = await fetch(`${llmBase}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'llm_test' }),
      });
      const { token } = (await sessionRes.json()) as { token: string };

      const res = await fetch(`${llmBase}/agents/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request: dawnRequest() }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { steps: Array<{ verb: string }> };
      expect(body.steps[0]?.verb).toBe('gather_berries');

      expect(capturedBody?.model).toBe('mlx-community/Llama-3.2-1B-Instruct-4bit');
      expect(capturedBody).not.toHaveProperty('response_format'); // local servers often reject it
      expect(capturedAuth).toBe('Bearer x');
    });
  });
});
