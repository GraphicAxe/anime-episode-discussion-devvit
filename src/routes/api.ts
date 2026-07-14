import { Hono } from 'hono';
import { buildEpisodePostMarkdown, buildEpisodePayload, postCurrentEpisodeDiscussion, notifyDiscordError } from './cron';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }, 200));

api.post('/run-now', async (c) => {
  try {
    const result = await postCurrentEpisodeDiscussion({ force: true });
    return c.json(result, 200);
  } catch (error) {
    console.error('[api] /run-now failed:', error);
    try {
      await notifyDiscordError(undefined, 'Manual Run Failed (/run-now)', error);
    } catch (discordErr) {
      console.error('[api] Failed to send Discord error:', discordErr);
    }
    return c.json({ error: String(error) }, 500);
  }
});

api.get('/preview/:episode', async (c) => {
  const episode = Number(c.req.param('episode'));
  if (!Number.isInteger(episode) || episode < 1) {
    return c.json({ error: 'Episode must be a positive integer.' }, 400);
  }

  try {
    const payload = await buildEpisodePayload(episode);
    const markdown = await buildEpisodePostMarkdown(payload);
    return c.json({ payload, markdown }, 200);
  } catch (error) {
    console.error(`[api] /preview/${String(episode)} failed:`, error);
    return c.json({ error: `Preview generation failed: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});
