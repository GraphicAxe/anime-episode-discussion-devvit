import { Context, Hono } from 'hono';
import { redis } from '@devvit/redis';

export const triggers = new Hono();

interface InstallRequest {
  subreddit?: {
    name?: string;
  };
}

async function handleInstallOrUpgrade(c: Context, eventName: string) {
  const input = await c.req.json<InstallRequest>();
  const name = input.subreddit?.name;

  if (name) {
    await redis.set('installed_subreddit', name);
    console.log(`[${eventName}] Installed/upgraded in r/${name}`);
  } else {
    console.log(`[${eventName}] No subreddit name in payload.`);
  }

  return c.json({ status: 'success' }, 200);
}

triggers.post('/on-app-install', async (c) => {
  return await handleInstallOrUpgrade(c, 'onAppInstall');
});

triggers.post('/on-app-upgrade', async (c) => {
  return await handleInstallOrUpgrade(c, 'onAppUpgrade');
});
