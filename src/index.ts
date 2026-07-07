import { Devvit, SettingScope } from '@devvit/public-api';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { createServer, getServerPort } from '@devvit/web/server';
import { settings } from '@devvit/settings';
import { api } from './routes/api';
import { triggers } from './routes/triggers';
import { cron, postCurrentEpisodeDiscussion } from './routes/cron';

Devvit.addSettings([
  {
    type: 'string',
    name: 'discordWebhook',
    label: 'Discord Webhook URL',
    helpText: 'Optional Discord webhook for success/error notifications.',
    scope: SettingScope.App,
    isSecret: true,
  },
  {
    type: 'string',
    name: 'mockMode',
    label: 'Mock Mode',
    helpText: 'Set to true to use mock metadata for playtest and dry runs instead of live APIs.',
    defaultValue: 'false',
    scope: SettingScope.App,
  },
  {
    type: 'string',
    name: 'apiPlaytestMode',
    label: 'API Playtest Mode',
    helpText:
      'Set to true to run an automatic API validation flow on playtest startup (forces Episode 1 then Episode 2).',
    defaultValue: 'false',
    scope: SettingScope.App,
  },
]);

const app = new Hono();
let startupMockCheckDone = false;

app.use('*', logger());

app.use('*', async (_c, next) => {
  if (!startupMockCheckDone) {
    startupMockCheckDone = true;

    try {
      const mockModeRaw = ((await settings.get<string>('mockMode')) || 'false').toLowerCase();
      const mockModeEnabled =
        mockModeRaw === 'true' || mockModeRaw === '1' || mockModeRaw === 'yes' || mockModeRaw === 'on';
      const apiPlaytestModeRaw = ((await settings.get<string>('apiPlaytestMode')) || 'false').toLowerCase();
      const apiPlaytestModeEnabled =
        apiPlaytestModeRaw === 'true' ||
        apiPlaytestModeRaw === '1' ||
        apiPlaytestModeRaw === 'yes' ||
        apiPlaytestModeRaw === 'on';

      if (mockModeEnabled) {
        const result = await postCurrentEpisodeDiscussion({ force: true });
        console.log('[startup] Mock mode enabled; startup post check result:', result);
      }

      if (apiPlaytestModeEnabled) {
        const episode1Result = await postCurrentEpisodeDiscussion({ force: true, episodeNumberOverride: 1 });
        console.log('[startup] API playtest mode episode 1 result:', episode1Result);

        const episode2Result = await postCurrentEpisodeDiscussion({ force: true, episodeNumberOverride: 2 });
        console.log('[startup] API playtest mode episode 2 result:', episode2Result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('No installed subreddit found')) {
        console.log('[startup] Startup playtest flow skipped: App is not installed to a subreddit yet.');
        startupMockCheckDone = false;
      } else {
        console.error('[startup] Startup playtest flow failed:', error);
      }
    }
  }

  await next();
});

app.onError((err, c) => {
  console.error('[Hono Server Error]:', err);
  return c.text('Internal Server Error', 500);
});

const internal = new Hono();
internal.route('/triggers', triggers);
internal.route('/cron', cron);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
