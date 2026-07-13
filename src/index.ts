import { Devvit, SettingScope } from '@devvit/public-api';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { triggers } from './routes/triggers';
import { cron } from './routes/cron';

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
    name: 'apiPlaytestMode',
    label: 'API Playtest Mode',
    helpText:
      'Set to true to run an automatic API validation flow on playtest startup (forces Episode 1 then Episode 2).',
    defaultValue: 'false',
    scope: SettingScope.App,
  },
  {
    type: 'string',
    name: 'cleanProfile',
    label: 'Clean Profile',
    helpText:
      'Set to true to wipe all bot discussion threads from the subreddit profile on startup/installation/upgrade.',
    defaultValue: 'false',
    scope: SettingScope.App,
  },
]);



const app = new Hono();
app.use('*', logger());

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
