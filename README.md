# Goodbye Lara Episode Discussion Bot (Devvit)

This app automatically posts Goodbye, Lara episode discussion threads to the subreddit where it is installed, stickies/highlights them, and maintains a cross-linked history grid.

## Features

- **Sequential Airing Counters**: Resolves the next episode number by checking the last posted episode in Redis (`lastEpisode + 1`). This prevents scheduling drift during holiday delays, broadcast rescheduling, or double-episode drops.
- **Dynamic Discussion Archive Grid**: Automatically compiles a row-major, 4-column Markdown table linking all historical episode threads and inserts it at the bottom of the post, dynamically scaling with the show's season length.
- **Retroactive Updates**: When a new thread is posted, the bot retroactively edits all previous threads to insert the updated archive grid and link to the new episode.
- **Release Delay Auto-Deletion**: Checks Jikan, AniList, and Kitsu APIs on the scheduled day after 12:00 PM ET. If the episode is delayed, the bot automatically deletes the discussion thread, resets its Redis state (allowing reposting), and alerts moderators via Discord.
- **Manual Post Safeguard**: Bypasses editing Episode 1 and Episode 2 in production (since they were created manually and cannot be edited by the bot), while still fully resolving their links in the archive grids.
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
   ```
   *The subreddit is determined by where the app is installed, not by a setting.*
4. Upload app to the Reddit developer portal:
   ```bash
   npm run deploy
   ```
5. Publish app:
   ```bash
   npm run launch
   ```

---

## App Settings

Configure these settings via the Reddit UI (App Settings page) or using the Devvit CLI:

| Setting Key | Type | Default | Description |
|---|---|---|---|
| `discordWebhook` | string | `""` | Optional Discord webhook URL to receive success, update, and deletion alerts. |
| `apiPlaytestMode` | string | `"false"` | Set to `"true"` to bypass Sunday schedule constraints and duplicate limits during playtests. |
| `cleanProfile` | string | `"false"` | Set to `"true"` to delete all bot discussion threads belonging to the current subreddit from the bot's profile, and clear Redis state on startup/upgrade. |

Example setting command:
```bash
npx devvit settings set apiPlaytestMode "true"
```

---

## Template Customization

* **Human Reference:** The template layout is documented in `REFERENCES/Goodbye, Lara - Episode Post Template.md`.
* **Runtime Template:** Devvit runs in a sandboxed, serverless worker environment that blocks local filesystem APIs (e.g. `fs.readFile`). Therefore, the active post template is hardcoded as `DEFAULT_TEMPLATE` inside [cron.ts](src/routes/cron.ts) at runtime. Any permanent edits to the post body layout should be updated directly in `DEFAULT_TEMPLATE`.

---

## Scheduler & Delay Verification

- The cron job runs every 30 minutes (`*/30 * * * *`).
- The scheduled weekday is derived from `PREMIERE_DATE_ET`. The posting window opens at **10:30 AM ET** on that weekday (about an hour before the expected 11:30 AM ET release).
- If a post was created today, and the time is **after 12:00 PM ET**, the bot runs `performReleaseCorrectionCheck`:
  - Queries AniList/Jikan/Kitsu.
  - If they confirm the episode is delayed, it deletes the thread and rolls back the sequence counter in Redis by 1 (allowing the bot to safely retry posting the thread when the release goes live).
  - If the episode is verified as aired, it saves a verified flag to Redis so it skips future checks for that episode.
  - If all metadata APIs are offline, it defaults to true (aired) as a fallback to avoid deleting the discussion thread during API outages.
- If it is after **12:00 PM ET** on the scheduled weekday and no post exists today (either not yet created or deleted due to delay), the bot will verify if the episode has aired *before* creating the post to prevent post-and-delete loops.
- To prevent rate limiting on Jikan/AniList/Kitsu, API queries and metadata fetches are cached in-memory for the duration of a single execution.

---

## API Playtest Mode Behavior

- When `apiPlaytestMode=true` (playtesting), the bot uses live API integrations to retrieve episode details, cast, and staff.
- Bypasses the schedule window checks and the daily duplicate check, allowing you to run dry runs at any `:00` and `:30` interval.
- Automatically skips past Episodes 1 and 2 (since they are registered in the manual post mapping), starting the sequence by fetching and posting Episode 3.

---

## Manual Testing Endpoints

- **Health check**: `GET /api/health`
- **Force run posting flow**: `POST /api/run-now`
- **Preview post markdown**: `GET /api/preview/:episode`

Recommended playtest flow:
1. Install the app to your playtest subreddit.
2. Set `apiPlaytestMode` to `true` and start `npx devvit playtest`.
3. The app will run on schedule every 30 minutes, or you can trigger `/api/run-now` manually to test the end-to-end flow.
