import { Hono } from 'hono';
import { buildEpisodePostMarkdown, buildEpisodePayload, postCurrentEpisodeDiscussion } from './cron';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }, 200));

api.post('/run-now', async (c) => {
  const result = await postCurrentEpisodeDiscussion({ force: true });
  return c.json(result, 200);
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
