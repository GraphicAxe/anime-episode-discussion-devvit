# Goodbye Lara Episode Discussion Bot (Devvit)

This app automatically posts Goodbye, Lara episode discussion threads to the subreddit where it is installed, stickies/highlights them, and maintains a cross-linked history grid.

## Features

- **Sequential Airing Counters**: Resolves the next episode number by checking the last posted episode in Redis (`lastEpisode + 1`). This prevents scheduling drift during holiday delays, broadcast rescheduling, or double-episode drops.
- **Dynamic Discussion Archive Grid**: Automatically compiles a row-major, 4-column Markdown table linking all historical episode threads and inserts it at the bottom of the post.
- **Retroactive Updates**: When a new thread is posted, the bot retroactively edits all previous threads to insert the updated archive grid and link to the new episode.
- **Release Delay Auto-Deletion**: Checks Jikan, AniList, and Kitsu APIs on the scheduled day after 11:45 ET. If the episode is delayed, the bot automatically deletes the discussion thread, resets its Redis state (allowing reposting), and alerts moderators via Discord.
- **Manual Post Safeguard**: Bypasses editing Episode 1 in production (since it was created manually and cannot be edited by the bot), while still fully resolving its links in the archive grids.
- **Graceful Startup Handling**: Prevents installation race conditions during initial local playtesting setup.
- **Multi-API Integration**: Whitelists and queries AniList, Kitsu, and Jikan APIs for robust, merged metadata.
- **Built-in Fallbacks**: Computes JST / ET / CEST times from a single airing date, falling back to 13 total episodes.

---

## Required Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Login to Devvit CLI:
   ```bash
   npm run login
   ```
3. Required settings:
   ```bash
   npx devvit settings set discordWebhook "https://discord.com/api/webhooks/..."
   npx devvit settings set mockMode "true"
   ```
   *The subreddit is determined by where the app is installed, not by a setting. Turn off `mockMode` for production.*
4. Upload app to the Reddit developer portal:
   ```bash
   npm run deploy
   ```
5. Publish app:
   ```bash
   npm run launch
   ```

---

## Template Customization

* **Human Reference:** The template layout is documented in `REFERENCES/Goodbye, Lara - Episode Post Template.md`.
* **Runtime Template:** Devvit runs in a sandboxed, serverless worker environment that blocks local filesystem APIs (e.g. `fs.readFile`). Therefore, the active post template is hardcoded as `DEFAULT_TEMPLATE` inside [cron.ts](src/routes/cron.ts) at runtime. Any permanent edits to the post body layout should be updated directly in `DEFAULT_TEMPLATE`.

---

## Scheduler & Delay Verification

- The cron job runs once per hour at `:30` every day (`30 * * * *`).
- The scheduled weekday is derived from `PREMIERE_DATE_ET`. The posting window opens between **10:30 and 10:45 AM ET** on that weekday (about an hour before the expected 11:30 AM ET release).
- If a post was created today, and the time is **after 11:45 AM ET**, the bot runs `performReleaseCorrectionCheck`:
  - Queries AniList/Jikan/Kitsu.
  - If they confirm the episode is delayed, it deletes the thread and resets Redis keys so the bot can repost the thread when the release goes live.
  - If the episode is verified as aired, it saves a verified flag to Redis so it skips future checks for that episode.

---

## Mock Mode Behavior

- When `mockMode=true` (playtesting), metadata uses built-in mock values and does not call external APIs.
- Bypasses the schedule window check, allowing immediate test posts to be created.
- Bypasses delayed-episode check to prevent accidental deletions of your playtest threads.
- Enables Episode 1 retroactive editing so you can test next-episode linking and table backfills locally.

---

## Manual Testing Endpoints

- **Health check**: `GET /api/health`
- **Force run posting flow**: `POST /api/run-now`
- **Preview post markdown**: `GET /api/preview/:episode`

Recommended playtest flow:
1. Install the app to your playtest subreddit.
2. Set `mockMode` to `true` and start `npx devvit playtest`.
3. Refresh the playtest URL and verify that the Episode 1 and Episode 2 dummy posts are created, stickied, cross-linked, and contain the discussion grid.
