import { Router } from 'express';

type TokenResponse = { access_token: string; token_type: string };

export function createAuthRouter(clientId: string, clientSecret: string): Router {
  const router = Router();

  router.post('/api/token', async (req, res) => {
    const code = req.body?.code as string | undefined;
    if (!code) return res.status(400).json({ error: 'missing_code' });

    try {
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(400).json({ error: 'token_exchange_failed', details: text });
      }

      const data = (await response.json()) as TokenResponse;
      res.json({ access_token: data.access_token });
    } catch {
      res.status(500).json({ error: 'internal_server_error' });
    }
  });

  router.get('/health', (_req, res) => res.json({ ok: true }));

  return router;
}
