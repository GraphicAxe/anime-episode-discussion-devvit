import { Hono } from 'hono';
import { buildEpisodePostMarkdown, buildEpisodePayload, postCurrentEpisodeDiscussion } from './cron';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }, 200));

api.post('/run-now', async (c) => {
  try {
    const result = await postCurrentEpisodeDiscussion({ force: true });
    return c.json(result, 200);
  } catch (error) {
    console.error('[api] /run-now failed:', error);
    const discordWebhook = await import('@devvit/settings').then(s => s.settings.get<string>('discordWebhook')).catch(() => undefined);
    if (discordWebhook) {
      const payload = {
        content: '🚨 **BOT EXCEPTION** 🚨',
        embeds: [{
          title: 'Manual Run Failed',
          description: 'The /run-now endpoint encountered an error.',
          color: 16711680,
          fields: [
            { name: 'Error Message', value: String(error instanceof Error ? error.message : error).slice(0, 1024) },
          ],
          footer: { text: 'Devvit Automation • Status: Unhealthy' },
          timestamp: new Date().toISOString()
        }]
      };
      await fetch(discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('[api] Failed to send Discord error:', err));
    }
    return c.json({ error: String(error) }, 500);
  }
});

api.get('/preview/:episode', async (c) => {
  const episode = Number(c.req.param('episode'));
  if (!Number.isInteger(episode) || episode < 1) {
    return c.json({ error: 'Episode must be a positive integer.' }, 400);
  }

  const payload = await buildEpisodePayload(episode);
  const markdown = await buildEpisodePostMarkdown(payload);
  return c.json({ payload, markdown }, 200);
});
