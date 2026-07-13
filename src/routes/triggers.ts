import { Context, Hono } from 'hono';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { settings } from '@devvit/settings';

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

    // Check cleanProfile setting
    try {
      const cleanProfileRaw = ((await settings.get<string>('cleanProfile')) || 'false').toLowerCase();
      const shouldClean =
        cleanProfileRaw === 'true' ||
        cleanProfileRaw === '1' ||
        cleanProfileRaw === 'yes' ||
        cleanProfileRaw === 'on';

      if (shouldClean) {
        console.log(`[cleanProfile] cleanProfile=true: Wiping all bot discussion posts on startup...`);
        const appUser = await reddit.getAppUser();
        if (appUser) {
          console.log(`[cleanProfile] App user username: "${appUser.username}"`);
          
          const posts = await appUser.getPosts({}).all();
          console.log(`[cleanProfile] Found ${posts.length} posts on bot profile`);

          let deletedCount = 0;
          for (const profilePost of posts) {
            const isMatch = profilePost.title.toLowerCase().startsWith('goodbye, lara - episode');
            if (isMatch) {
              if (profilePost.subredditName === name) {
                console.log(`[cleanProfile] Deleting post: ${profilePost.title} (id: ${profilePost.id})`);
                try {
                  const post = await reddit.getPostById(profilePost.id as `t3_${string}`);
                  await post.delete();
                  deletedCount++;
                } catch (postErr) {
                  console.error(`[cleanProfile] Failed to delete post ${profilePost.id}:`, postErr);
                }
              } else {
                console.log(`[cleanProfile] Skipping post from different subreddit r/${profilePost.subredditName}: ${profilePost.title}`);
              }
            }
          }
          console.log(`[cleanProfile] Successfully deleted ${deletedCount} posts.`);
        } else {
          console.log(`[cleanProfile] App user not found.`);
        }

        // Clean up Redis tracking keys as well
        await redis.del('last_posted_episode_number');
        await redis.del('last_posted_et_date');
        await redis.del('pending_retry_episode');
        
        // Delete all episode tracking keys
        for (let ep = 1; ep <= 30; ep++) {
          await redis.del(`episode_post_id_${ep}`);
          await redis.del(`episode_post_permalink_${ep}`);
          await redis.del(`episode_release_verified_${ep}`);
        }
        console.log(`[cleanProfile] Completed profile wiping and cleared Redis.`);
      }
    } catch (err) {
      console.error(`[cleanProfile] Failed to run profile cleanup on startup:`, err);
    }
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
