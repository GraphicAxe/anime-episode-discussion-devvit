import { Hono } from 'hono';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { settings } from '@devvit/settings';

type EpisodePayload = {
  episodeNumber: number;
  episodeTitle: string;
  synopsis: string;
  jstTime: string;
  etTime: string;
  cestTime: string;
  episodeStaff: string;
  previousEpisodeLink: string;
  nextEpisodeLink: string;
};

type ExternalEpisodePayload = Partial<EpisodePayload> & {
  episode?: number;
  number?: number;
  title?: string;
  synopsis?: string;
  summary?: string;
  jstTime?: string;
  etTime?: string;
  cestTime?: string;
  episodeStaff?: string;
  previousEpisodeLink?: string;
  nextEpisodeLink?: string;
  airingAt?: number | string;
  airingTime?: string;
  totalEpisodes?: number;
};

type RunOptions = {
  force?: boolean;
  episodeNumberOverride?: number;
};

type DiscordNotificationType = 'success' | 'update' | 'error';

const ET_TIME_ZONE = 'America/New_York';
const REDIS_KEY_LAST_POSTED_EPISODE = 'last_posted_episode_number';
const REDIS_KEY_LAST_POSTED_ET_DATE = 'last_posted_et_date';
const REDIS_KEY_EPISODE_POST_ID_PREFIX = 'episode_post_id_';
const REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX = 'episode_post_permalink_';
const REDIS_KEY_LAST_CAST_AND_STAFF = 'last_successful_cast_and_staff';

const SERIES_TITLE = 'Goodbye, Lara';
const POST_TITLE_TEMPLATE = 'Goodbye, Lara - Episode {EPISODE_NUMBER} Discussion';
const PREMIERE_DATE_ET = '2026-07-05';
const PREMIERE_EPISODE_NUMBER = 1;
const POSTING_WINDOW_START_ET = '10:30';
const POSTING_WINDOW_END_ET = '10:45';
const DEFAULT_AIRING_TIME_ET = '11:30';
const DEFAULT_EPISODE_STAFF = 'TBA';
const INITIAL_LAST_POSTED_EPISODE_NUMBER = 1;
const EPISODE_ONE_DISCUSSION_URL = 'https://www.reddit.com/r/GoodbyeLara/comments/1uo5xv4/goodbye_lara_episode_1_discussion/';
const DISCUSSION_FLAIR_ID = '45a92b8e-7724-11f1-aa18-6e578d5a10fa';
const JIKAN_ANIME_ID = '58878';
const ANILIST_MEDIA_ID = '177637';
const KITSU_ANIME_ID = '48880';
const WIKIPEDIA_PAGE_TITLE = 'Goodbye,_Lara';
const DEFAULT_MAX_EPISODES = 13;
const MOCK_EPISODE_TITLE = 'Episode';
const MOCK_EPISODE_SYNOPSIS =
  'Long, long ago, there lived a mermaid princess named Lara. She was raised with love by her father, the king of sea and her sisters. One day, Lara fell in love with a human prince who lived on land. It was a forbidden love-one that was not allowed in the world of mermaids. Still, Lara journeyed to the surface. With a potion, given to her from the witch Grace, she became human. But the potion came at a cost-fail to find true love, and she would turn into foam and vanish into the ocean. Though she was a princess of the sea, Lara chose love. Yet, her wish went unfulfilled and she vanished into the sea. Two hundred years later, Lara awakens once more, in Lake Biwa to finally search for her true love.';
const MOCK_EPISODE_STAFF = `**Cast (EN/JP)**
- Lara - (EN: TBA / JP: Hishikawa, Hana)
- Ootsu, Mari - (EN: TBA / JP: Kawaishi, Nana)
- Grace - (EN: TBA / JP: Fukami, Rica)
- Luca - (EN: TBA / JP: Murase, Ayumu)
- Ootsu, Ema - (EN: TBA / JP: Sumitomo, Nanae)

**Staff (JP source)**
- Studio: Kinema Citrus
- Producer: Kadokawa
- Episode staff credits: TBA`;

const HARDCODED_CAST_AND_STAFF = `**Cast (EN/JP)**
- Lara - (EN: Brianna Knickerbocker / JP: Hana Hishikawa)
- Mari Otsu - (EN: Anairis Quinones / JP: Nana Kawaishi)
- Grace - (EN: Tiana Camacho / JP: Rica Fukami)
- Luca - (EN: Kieran Regan / JP: Ayumu Murase)
- Yoshihiro Otsu - (EN: TBA / JP: Tomohiro Ōno)
- Ema Otsu - (EN: TBA / JP: Nanae Sumitomo)
- Rowan - (EN: Brook Chalmers / JP: Masaki Terasoma)
- Lisa - (EN: Cat Protano / JP: Minami Tsuda)

**Staff (JP source)**
- Director: Takushi Koide
- Series Composition: Anna Kawahara
- Character Design: Shiori Tani
- Music: Yuma Yamaguchi`;

let cachedAniListMediaId: number | null | undefined;
let cachedWikipediaCharactersSection: string | null | undefined;
let cachedWikipediaEpisodesSection: string | null | undefined;
let cachedWikipediaCharactersSectionIndex: number | null | undefined;
let cachedWikipediaEpisodesSectionIndex: number | null | undefined;

type WikipediaSection = {
  toclevel: number;
  level: string;
  line: string;
  number: string;
  index: string;
  fromtitle: string;
  byteoffset: number;
  anchor: string;
  linkAnchor: string;
};

const OFFICIAL_LINKS_MARKDOWN = `* [Official website](https://goodbyelara.com/)
* [Official On Air / Japanese streaming schedule](https://goodbyelara.com/onair/)
* [Latest official trailer](https://www.youtube.com/watch?v=gjq7xyVdv5I)
* [Character page](https://goodbyelara.com/#character)
* [Staff and cast page](https://goodbyelara.com/#staffcast)
* [Crunchyroll streaming announcement](https://www.crunchyroll.com/news/latest/2026/6/20/goodbye-lara-anime-unveils-new-art-trailer-and-cast-additions)
* [Legal streaming wiki](/r/GoodbyeLara/wiki/streaming)`;
const COMMUNITY_LINKS_MARKDOWN = `* [Episode discussion archive](/r/GoodbyeLara/wiki/episodes)
* [Rules and spoiler policy](/r/GoodbyeLara/wiki/rules)
* [FAQ](/r/GoodbyeLara/wiki/faq)
* [Official resources](/r/GoodbyeLara/wiki/resources)
* [Timeline](/r/GoodbyeLara/wiki/timeline)
* [Mermaid lore](/r/GoodbyeLara/wiki/mermaid-lore)`;
const DEFAULT_TEMPLATE = `# {SERIES_TITLE} - Episode {EPISODE_NUMBER} Discussion

**Episode title:** {EPISODE_TITLE}

**Release time:** {JST_TIME} JST / {ET_TIME} ET / {CEST_TIME} CEST

**Short spoiler-safe synopsis:** {SYNOPSIS}

# Legal Streams and Official Links

{OFFICIAL_LINKS}

# Episode Staff

{EPISODE_STAFF}

# Spoiler Policy

1. This thread allows spoilers through **Episode {EPISODE_NUMBER}**.
2. Do not discuss future episodes, leaks, unreleased screenshots, early screenings, raws, or datamined information unless moderators create a designated thread.
3. Outside this thread, use Reddit spoiler tags: \`>!spoiler text!<\`
4. For the first 24 hours after this thread goes live, keep new Episode {EPISODE_NUMBER} discussion in this thread.

# Community Links

{COMMUNITY_LINKS}

# Navigation

**Previous episode:** {PREVIOUS_EPISODE_LINK}

**Next episode:** {NEXT_EPISODE_LINK}

# Previous Discussions

{DISCUSSIONS_GRID}

Questions, spoiler reports, source corrections, or wiki updates can be sent through [modmail](https://www.reddit.com/message/compose?to=/r/{SUBREDDIT_NAME}).`;

function truncateDiscordValue(value: string, maxLength = 1024): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

async function getDiscordWebhookUrl(): Promise<string | undefined> {
  return await settings.get<string>('discordWebhook');
}

async function sendDiscordNotification(
  webhookUrl: string,
  notificationType: DiscordNotificationType,
  title: string,
  details: { postUrl?: string; episodeNumber?: number; error?: Error } = {}
) {
  const isSuccess = notificationType === 'success';
  const isUpdate = notificationType === 'update';
  const isError = notificationType === 'error';
  const payload = {
    content: isSuccess
      ? '✅ **WORKFLOW SUCCESS** ✅'
      : isUpdate
        ? '🔄 **POST UPDATED** 🔄'
        : '🚨 **BOT EXCEPTION** 🚨',
    embeds: [
      {
        title: isSuccess
          ? 'Episode Discussion Posted Successfully'
          : isUpdate
            ? 'Episode Discussion Updated'
            : 'Episode Discussion Failed',
        description: isSuccess
          ? 'The automation ran successfully and posted a new episode discussion thread.'
          : isUpdate
            ? 'The automation refreshed an existing episode discussion thread with updated metadata.'
            : 'The automation encountered an error while trying to create the episode discussion thread.',
        color: isSuccess ? 5763719 : isUpdate ? 3447003 : 16711680,
        fields: [
          {
            name: 'Title',
            value: truncateDiscordValue(title),
          },
          ...(typeof details.episodeNumber === 'number'
            ? [
                {
                  name: 'Episode Number',
                  value: String(details.episodeNumber),
                },
              ]
            : []),
          ...(details.postUrl
            ? [
                {
                  name: 'Post URL',
                  value: truncateDiscordValue(details.postUrl),
                },
              ]
            : []),
          ...(details.error
            ? [
                {
                  name: 'Error Message',
                  value: truncateDiscordValue(details.error.message || 'Unknown error'),
                },
                {
                  name: 'Stack Trace',
                  value: truncateDiscordValue(details.error.stack || 'No stack trace available', 900),
                },
              ]
            : []),
        ],
        footer: {
          text: isError ? 'Devvit Automation • Status: Unhealthy' : 'Devvit Automation • Status: Healthy',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`Discord notification failed: ${res.status} ${res.statusText}`);
  }
}

async function getSeriesTitle(): Promise<string> {
  return SERIES_TITLE;
}

async function hasEpisodeOneDiscussionUrl(): Promise<boolean> {
  return EPISODE_ONE_DISCUSSION_URL.trim().length > 0;
}

async function getPostTitleTemplate(): Promise<string> {
  return POST_TITLE_TEMPLATE;
}

async function getBodyTemplate(): Promise<string> {
  return DEFAULT_TEMPLATE;
}

function applyCommonPlaceholders(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{${key}}`, value),
    template
  );
}

function getTimePartsInET(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => {
    const found = parts.find((p) => p.type === type)?.value;
    if (!found) throw new Error(`Unable to parse ET datetime part: ${type}`);
    return found;
  };

  return {
    weekday: getPart('weekday'),
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: Number(getPart('hour')),
    minute: Number(getPart('minute')),
  };
}

function parseTimeHHMM(value: string, fallback: string): { hour: number; minute: number } {
  const source = value || fallback;
  const match = source.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    const fallbackMatch = fallback.match(/^(\d{1,2}):(\d{2})$/);
    if (!fallbackMatch) {
      throw new Error('Fallback HH:mm value is invalid.');
    }
    return { hour: Number(fallbackMatch[1]), minute: Number(fallbackMatch[2]) };
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function localTimeToMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

async function isScheduledWindowNow(now: Date): Promise<boolean> {
  const et = getTimePartsInET(now);
  const scheduledWeekday = await getScheduledWeekdayEt();
  const isPostingDay = et.weekday === scheduledWeekday;
  const start = parseTimeHHMM(POSTING_WINDOW_START_ET, POSTING_WINDOW_START_ET);
  const end = parseTimeHHMM(POSTING_WINDOW_END_ET, POSTING_WINDOW_END_ET);

  const nowMinutes = localTimeToMinutes(et.hour, et.minute);
  const startMinutes = localTimeToMinutes(start.hour, start.minute);
  const endMinutes = localTimeToMinutes(end.hour, end.minute);
  const isInWindow = nowMinutes >= startMinutes && nowMinutes < endMinutes;

  return isPostingDay && isInWindow;
}

async function getScheduledWeekdayEt(): Promise<string> {
  const premiereNoonEt = zonedTimeToUtc(PREMIERE_DATE_ET, '12:00', ET_TIME_ZONE);
  return getTimePartsInET(premiereNoonEt).weekday;
}

function getEtDateKey(now: Date): string {
  const et = getTimePartsInET(now);
  return `${et.year}-${et.month}-${et.day}`;
}

async function getSubredditName(): Promise<string> {
  const installed = await redis.get('installed_subreddit');
  if (!installed) {
    throw new Error('No installed subreddit found. Install the app to a subreddit before running scheduler tasks.');
  }
  return installed;
}


function addDaysToDateString(dateString: string, days: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateString.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const utcMidnight = Date.UTC(year, month - 1, day);
  const shifted = new Date(utcMidnight + days * 24 * 60 * 60 * 1000);

  const y = shifted.getUTCFullYear().toString().padStart(4, '0');
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = shifted.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getZoneParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (!value) throw new Error(`Missing datetime part: ${type}`);
    return Number(value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function zonedTimeToUtc(dateString: string, timeHHMM: string, timeZone: string): Date {
  const [yearRaw, monthRaw, dayRaw] = dateString.split('-');
  const { hour, minute } = parseTimeHHMM(timeHHMM, '11:30');

  const targetYear = Number(yearRaw);
  const targetMonth = Number(monthRaw);
  const targetDay = Number(dayRaw);

  let utcGuessMs = Date.UTC(targetYear, targetMonth - 1, targetDay, hour, minute, 0, 0);

  for (let i = 0; i < 4; i += 1) {
    const zoneParts = getZoneParts(new Date(utcGuessMs), timeZone);
    const represented = Date.UTC(zoneParts.year, zoneParts.month - 1, zoneParts.day, zoneParts.hour, zoneParts.minute, 0, 0);
    const desired = Date.UTC(targetYear, targetMonth - 1, targetDay, hour, minute, 0, 0);
    const deltaMinutes = Math.round((desired - represented) / 60000);

    if (deltaMinutes === 0) break;
    utcGuessMs += deltaMinutes * 60000;
  }

  return new Date(utcGuessMs);
}

function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

async function readErrorSummary(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`.trim();

  try {
    const text = await res.text();
    if (!text) {
      return fallback;
    }

    const parsed = JSON.parse(text) as {
      message?: string;
      type?: string;
      error?: string;
      errors?: Array<{ message?: string; status?: number }>;
    };

    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const first = parsed.errors[0];
      return first?.message || fallback;
    }

    return parsed.message || parsed.error || parsed.type || text || fallback;
  } catch {
    return fallback;
  }
}

async function computeAiringDateUtc(episodeNumber: number): Promise<Date> {
  const premiereDate = PREMIERE_DATE_ET;
  const baseEpisodeNumber = PREMIERE_EPISODE_NUMBER;
  const airingEt = DEFAULT_AIRING_TIME_ET;

  const dayOffset = (episodeNumber - baseEpisodeNumber) * 7;
  const episodeDateEt = addDaysToDateString(premiereDate, dayOffset);
  return zonedTimeToUtc(episodeDateEt, airingEt, ET_TIME_ZONE);
}

async function isMockModeEnabled(): Promise<boolean> {
  const raw = ((await settings.get<string>('mockMode')) || 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

async function getMockEpisodeMetadata(episodeNumber: number): Promise<ExternalEpisodePayload> {
  const airingDate = await computeAiringDateUtc(episodeNumber);

  return {
    episode: episodeNumber,
    title: `${MOCK_EPISODE_TITLE} ${String(episodeNumber)}`,
    synopsis: MOCK_EPISODE_SYNOPSIS,
    episodeStaff: MOCK_EPISODE_STAFF,
    airingAt: airingDate.getTime(),
  };
}

function isMeaningfulText(value?: string): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function englishTextScore(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const letters = trimmed.match(/[A-Za-z]/g)?.length ?? 0;
  // eslint-disable-next-line no-control-regex
  const nonAscii = trimmed.match(/[^\x00-\x7F]/g)?.length ?? 0;
  return letters - nonAscii;
}

function sanitizeEpisodeTitle(value: string): string {
  return value
    .replace(/\s*\((english\s+)?dub\)\s*$/i, '')
    .replace(/\s*-\s*(english\s+)?dub\s*$/i, '')
    .trim();
}

function choosePreferredEnglish(primary?: string, secondary?: string): string | undefined {
  if (!isMeaningfulText(primary) && !isMeaningfulText(secondary)) {
    return undefined;
  }

  if (isMeaningfulText(primary) && !isMeaningfulText(secondary)) {
    return primary;
  }

  if (!isMeaningfulText(primary) && isMeaningfulText(secondary)) {
    return secondary;
  }

  const primaryValue = primary!;
  const secondaryValue = secondary!;
  const primaryScore = englishTextScore(primaryValue);
  const secondaryScore = englishTextScore(secondaryValue);
  return secondaryScore > primaryScore ? secondaryValue : primaryValue;
}

function toRoleLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCharacterName(name: string): string {
  return name
    .toLowerCase()
    .replace(/oo/g, 'o')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function mergeCastBlocks(primaryBlock?: string, secondaryBlock?: string): string | undefined {
  if (!isMeaningfulText(primaryBlock) && !isMeaningfulText(secondaryBlock)) {
    return undefined;
  }
  if (isMeaningfulText(primaryBlock) && !isMeaningfulText(secondaryBlock)) {
    return primaryBlock;
  }
  if (!isMeaningfulText(primaryBlock) && isMeaningfulText(secondaryBlock)) {
    return secondaryBlock;
  }

  const primaryLines = primaryBlock!.split('\n');
  const secondaryLines = secondaryBlock!.split('\n');

  const primaryCast: Array<{ character: string; rawLine: string; en: string; jp: string }> = [];
  const secondaryCast: Array<{ character: string; rawLine: string; en: string; jp: string }> = [];
  const staffLines: string[] = [];

  const castRegex = /^\s*-\s*(.+?)\s*-\s*\(\s*EN:\s*(.+?)\s*\/\s*JP:\s*(.+?)\s*\)/i;

  for (const line of primaryLines) {
    const match = line.match(castRegex);
    if (match && match[1] && match[2] && match[3]) {
      primaryCast.push({
        character: match[1].trim(),
        rawLine: line,
        en: match[2].trim(),
        jp: match[3].trim(),
      });
    } else {
      if (!line.includes('**Cast (EN/JP)**')) {
        staffLines.push(line);
      }
    }
  }

  for (const line of secondaryLines) {
    const match = line.match(castRegex);
    if (match && match[1] && match[2] && match[3]) {
      secondaryCast.push({
        character: match[1].trim(),
        rawLine: line,
        en: match[2].trim(),
        jp: match[3].trim(),
      });
    }
  }

  const mergedCast: Array<{ character: string; en: string; jp: string }> = [];

  for (const p of primaryCast) {
    const pNorm = normalizeCharacterName(p.character);
    const sMatch = secondaryCast.find((s) => normalizeCharacterName(s.character) === pNorm);

    let finalEn = p.en;
    let finalJp = p.jp;

    if (sMatch) {
      if (finalEn === 'TBA' && sMatch.en !== 'TBA') {
        finalEn = sMatch.en;
      }
      if (finalJp === 'TBA' && sMatch.jp !== 'TBA') {
        finalJp = sMatch.jp;
      }
    }

    mergedCast.push({
      character: p.character,
      en: finalEn,
      jp: finalJp,
    });
  }

  for (const s of secondaryCast) {
    const sNorm = normalizeCharacterName(s.character);
    const pMatch = primaryCast.some((p) => normalizeCharacterName(p.character) === sNorm);
    if (!pMatch) {
      mergedCast.push({
        character: s.character,
        en: s.en,
        jp: s.jp,
      });
    }
  }

  const resultLines: string[] = ['**Cast (EN/JP)**'];
  for (const c of mergedCast) {
    resultLines.push(`- ${c.character} - (EN: ${c.en} / JP: ${c.jp})`);
  }

  if (staffLines.length > 0) {
    resultLines.push('');
    resultLines.push(...staffLines);
  }

  return resultLines.join('\n');
}


function cleanWikipediaText(value: string): string {
  return value
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/>]*\/>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[0-9]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWikipediaSectionIndex(sectionName: string): Promise<number | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=sections&page=${encodeURIComponent(WIKIPEDIA_PAGE_TITLE)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[cron] Wikipedia sections request failed: ${await readErrorSummary(res)}`);
    return null;
  }
  const payload = (await res.json()) as { parse?: { sections?: WikipediaSection[] } };
  const sections = payload.parse?.sections ?? [];
  const found = sections.find((s) => s.line.toLowerCase() === sectionName.toLowerCase());
  if (!found) {
    console.error(`[cron] Wikipedia section not found: ${sectionName}`);
    return null;
  }
  return Number(found.index);
}

async function getWikipediaCharactersSectionIndex(): Promise<number | null> {
  if (cachedWikipediaCharactersSectionIndex !== undefined) {
    return cachedWikipediaCharactersSectionIndex;
  }
  cachedWikipediaCharactersSectionIndex = await fetchWikipediaSectionIndex('Characters');
  return cachedWikipediaCharactersSectionIndex;
}

async function getWikipediaEpisodesSectionIndex(): Promise<number | null> {
  if (cachedWikipediaEpisodesSectionIndex !== undefined) {
    return cachedWikipediaEpisodesSectionIndex;
  }
  cachedWikipediaEpisodesSectionIndex = await fetchWikipediaSectionIndex('Episodes');
  return cachedWikipediaEpisodesSectionIndex;
}

async function fetchWikipediaSectionWikitext(section: number): Promise<string | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext` +
    `&page=${encodeURIComponent(WIKIPEDIA_PAGE_TITLE)}&section=${String(section)}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[cron] Wikipedia request failed: ${await readErrorSummary(res)}`);
    return null;
  }

  const payload = (await res.json()) as { parse?: { wikitext?: string } };
  const text = payload.parse?.wikitext;
  return isMeaningfulText(text) ? text : null;
}

async function getWikipediaCharactersSection(): Promise<string | null> {
  if (cachedWikipediaCharactersSection !== undefined) {
    return cachedWikipediaCharactersSection;
  }

  const index = await getWikipediaCharactersSectionIndex();
  if (index === null) {
    cachedWikipediaCharactersSection = null;
    return null;
  }

  cachedWikipediaCharactersSection = await fetchWikipediaSectionWikitext(index);
  return cachedWikipediaCharactersSection;
}

async function getWikipediaEpisodesSection(): Promise<string | null> {
  if (cachedWikipediaEpisodesSection !== undefined) {
    return cachedWikipediaEpisodesSection;
  }

  const index = await getWikipediaEpisodesSectionIndex();
  if (index === null) {
    cachedWikipediaEpisodesSection = null;
    return null;
  }

  cachedWikipediaEpisodesSection = await fetchWikipediaSectionWikitext(index);
  return cachedWikipediaEpisodesSection;
}

function extractWikipediaEpisodeTitle(wikitext: string, episodeNumber: number): string | undefined {
  // Strip reference tags first to prevent matching reference titles
  const wikitextNoRefs = wikitext
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/>]*\/>/gi, '');

  const blocks = wikitextNoRefs.split(/\{\{(?:\^\|)?Episode\s+list/gi);
  if (blocks.length > episodeNumber) {
    const block = blocks[episodeNumber]!;
    const titleMatch = block.match(/\|\s*Title\s*=\s*([^\n|]+)/i);
    if (titleMatch && titleMatch[1]) {
      const trimmed = cleanWikipediaText(titleMatch[1]).replace(/^"|"$/g, '').trim();
      return isMeaningfulText(trimmed) ? trimmed : undefined;
    }
  }

  const tableMatches = Array.from(wikitextNoRefs.matchAll(/\|\s*\d+\s*\|\|\s*"([^"]+)"/g)).map((m) =>
    cleanWikipediaText(m[1] ?? '')
  );
  if (tableMatches.length >= episodeNumber) {
    const title = (tableMatches[episodeNumber - 1] ?? '').trim();
    return isMeaningfulText(title) ? title : undefined;
  }

  return undefined;
}

function cleanVoicedByLine(line: string): string {
  let cleaned = line.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  cleaned = cleaned.replace(/<ref[^/>]*\/>/gi, '');
  return cleaned;
}

function extractWikipediaCastBlock(wikitext: string): string | undefined {
  const lines = wikitext.split('\n');
  const castLines: string[] = [];

  let currentCharacter: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Check if line defines a character
    if (line.startsWith(';')) {
      const nihongoMatch = line.match(/\{\{Nihongo\|([^|}]+)/i);
      if (nihongoMatch && nihongoMatch[1]) {
        currentCharacter = cleanWikipediaText(nihongoMatch[1]);
      } else {
        currentCharacter = cleanWikipediaText(line.substring(1).trim());
      }
      continue;
    }

    // Check if line contains Voiced by
    if (line.startsWith(':') && currentCharacter) {
      const cleanedLine = cleanVoicedByLine(line);
      const voicedByMatch = cleanedLine.match(/\{\{Voiced by\|([^}]+)\}\}/i);
      if (voicedByMatch && voicedByMatch[1]) {
        const parts = voicedByMatch[1].split('|').map((p) => cleanWikipediaText(p.trim()));
        const jpActor = parts[0] || 'TBA';
        const enActor = parts[1] || 'TBA';

        castLines.push(`- ${currentCharacter} - (EN: ${enActor} / JP: ${jpActor})`);
        currentCharacter = null; // Reset for next character
        if (castLines.length >= 5) {
          break;
        }
      }
    }

    // Fallback/alternative support for the previous Voiced by format
    if (line.startsWith('*') && /Voiced by:/i.test(line)) {
      const characterMatch = line.match(/'''([^']+)'''/);
      const characterName = cleanWikipediaText(characterMatch?.[1] ?? '');
      if (isMeaningfulText(characterName)) {
        const voicedSplit = line.split(/Voiced by:/i);
        if (voicedSplit.length >= 2) {
          const voicedPart = voicedSplit[1] ?? '';
          const jpMatch = voicedPart.match(/([^;\n]+?)\s*\(Japanese\)/i);
          const enMatch = voicedPart.match(/;\s*([^;\n]+?)\s*\(English\)/i);

          const jpActor = cleanWikipediaText(jpMatch?.[1] ?? '');
          const enActorRaw = cleanWikipediaText(enMatch?.[1] ?? '');
          const enActor =
            isMeaningfulText(enActorRaw) &&
            (!isMeaningfulText(jpActor) || normalizeName(enActorRaw) !== normalizeName(jpActor))
              ? enActorRaw
              : 'TBA';
          const jpDisplay = isMeaningfulText(jpActor) ? jpActor : 'TBA';

          castLines.push(`- ${characterName} - (EN: ${enActor} / JP: ${jpDisplay})`);
          if (castLines.length >= 5) {
            break;
          }
        }
      }
    }
  }

  if (castLines.length === 0) {
    return undefined;
  }

  return `**Cast (EN/JP)**\n${castLines.join('\n')}`;
}

async function fetchFromWikipedia(episodeNumber: number): Promise<{ online: boolean; data: ExternalEpisodePayload | null }> {
  try {
    const [episodesSection, charactersSection] = await Promise.all([
      getWikipediaEpisodesSection(),
      getWikipediaCharactersSection(),
    ]);

    const result: ExternalEpisodePayload = { episode: episodeNumber };
    let hasAnyField = false;

    if (episodesSection) {
      const title = extractWikipediaEpisodeTitle(episodesSection, episodeNumber);
      if (isMeaningfulText(title)) {
        result.title = title;
        hasAnyField = true;
      }
    }

    if (charactersSection) {
      const castBlock = extractWikipediaCastBlock(charactersSection);
      if (isMeaningfulText(castBlock)) {
        result.episodeStaff = castBlock;
        hasAnyField = true;
      }
    }

    return { online: true, data: hasAnyField ? result : null };
  } catch (err) {
    console.error(`[cron] Wikipedia fetch failed:`, err);
    return { online: false, data: null };
  }
}

async function resolveAniListMediaId(): Promise<number | null> {
  if (cachedAniListMediaId !== undefined) {
    return cachedAniListMediaId;
  }

  const explicitId = Number(ANILIST_MEDIA_ID);
  if (Number.isFinite(explicitId) && explicitId > 0) {
    cachedAniListMediaId = explicitId;
    return cachedAniListMediaId;
  }

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
      }
    }
  `;

  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: { search: SERIES_TITLE } }),
  });

  if (!res.ok) {
    console.error(`[cron] AniList media-id lookup failed: ${await readErrorSummary(res)}`);
    cachedAniListMediaId = null;
    return cachedAniListMediaId;
  }

  const payload = (await res.json()) as { data?: { Media?: { id?: number } } };
  const mediaId = payload.data?.Media?.id;
  cachedAniListMediaId = Number.isFinite(mediaId) ? mediaId ?? null : null;
  return cachedAniListMediaId;
}

async function fetchFromAniList(episodeNumber: number): Promise<{ online: boolean; data: ExternalEpisodePayload | null }> {
  try {
    const mediaId = await resolveAniListMediaId();
    if (!mediaId) {
      return { online: false, data: null };
    }

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          episodes
          nextAiringEpisode {
            episode
            airingAt
          }
          streamingEpisodes {
            title
          }
          characters(sort: [ROLE, RELEVANCE], perPage: 10) {
            edges {
              role
              node {
                name {
                  full
                }
              }
              japaneseVoiceActors: voiceActors(language: JAPANESE, sort: [RELEVANCE]) {
                name {
                  full
                }
              }
            }
          }
          staff(sort: [RELEVANCE], perPage: 5) {
            edges {
              role
              node {
                name {
                  full
                }
              }
            }
          }
        }
      }
    `;

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables: { id: mediaId } }),
    });

    if (!res.ok) {
      if (res.status >= 500) {
        return { online: false, data: null };
      }
      return { online: true, data: null };
    }

    const payload = (await res.json()) as {
      data?: {
        Media?: {
          episodes?: number;
          nextAiringEpisode?: { episode?: number; airingAt?: number };
          streamingEpisodes?: Array<{ title?: string }>;
          characters?: {
            edges?: Array<{
              role?: string;
              node?: { name?: { full?: string } };
              japaneseVoiceActors?: Array<{ name?: { full?: string } }>;
            }>;
          };
          staff?: {
            edges?: Array<{
              role?: string;
              node?: { name?: { full?: string } };
            }>;
          };
        };
      };
    };

    const media = payload.data?.Media;
    if (!media) return { online: true, data: null };

    const result: ExternalEpisodePayload = {
      episode: episodeNumber,
    };

    if (media.episodes) {
      result.totalEpisodes = media.episodes;
    }

    const nextAiring = media.nextAiringEpisode;
    if (nextAiring?.episode === episodeNumber && nextAiring.airingAt) {
      result.airingAt = nextAiring.airingAt * 1000;
    }

    const streamingTitle = media.streamingEpisodes?.[episodeNumber - 1]?.title;
    if (isMeaningfulText(streamingTitle)) {
      result.title = streamingTitle;
    }

    // Format JP cast & staff only
    const charEdges = media.characters?.edges ?? [];
    const castEntries = charEdges
      .map((edge) => {
        const characterName = edge.node?.name?.full;
        const jpActor = edge.japaneseVoiceActors?.[0]?.name?.full;
        if (!isMeaningfulText(characterName) || !isMeaningfulText(jpActor)) {
          return undefined;
        }
        return `${characterName} - (EN: TBA / JP: ${jpActor})`;
      })
      .filter((v): v is string => isMeaningfulText(v))
      .slice(0, 5);

    const staffEdges = media.staff?.edges ?? [];
    const staffEntries = staffEdges
      .map((edge) => {
        const staffName = edge.node?.name?.full;
        if (!isMeaningfulText(staffName)) return undefined;
        const roleLabel = isMeaningfulText(edge.role) ? toRoleLabel(edge.role) : 'Staff';
        return `${roleLabel}: ${staffName}`;
      })
      .filter((v): v is string => isMeaningfulText(v))
      .slice(0, 5);

    if (castEntries.length > 0 || staffEntries.length > 0) {
      const sections: string[] = [];
      if (castEntries.length > 0) {
        sections.push(`**Cast (EN/JP)**\n${castEntries.map(l => `- ${l}`).join('\n')}`);
      }
      if (staffEntries.length > 0) {
        sections.push(`**Staff (JP source)**\n${staffEntries.map(l => `- ${l}`).join('\n')}`);
      }
      result.episodeStaff = sections.join('\n\n');
    }

    return { online: true, data: result };
  } catch (err) {
    console.error(`[cron] AniList fetch failed:`, err);
    return { online: false, data: null };
  }
}

async function fetchFromKitsu(episodeNumber: number): Promise<{ online: boolean; data: ExternalEpisodePayload | null }> {
  if (!isMeaningfulText(KITSU_ANIME_ID)) return { online: false, data: null };

  const offsets = [Math.max(0, episodeNumber - 1), 0];
  const limit = 10;
  let lastError: any = null;

  for (const offset of offsets) {
    const url =
      `https://kitsu.io/api/edge/anime/${encodeURIComponent(KITSU_ANIME_ID)}/episodes` +
      `?page[limit]=${String(limit)}&page[offset]=${String(offset)}`;

    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      });

      if (!res.ok) {
        if (res.status >= 500) {
          lastError = new Error(`Kitsu server returned ${res.status}`);
          continue;
        }
        return { online: true, data: null };
      }

      const payload = (await res.json()) as {
        data?: Array<{
          attributes?: {
            number?: number;
            canonicalTitle?: string;
            titles?: { en?: string; en_jp?: string; ja_jp?: string };
            synopsis?: string;
            description?: string;
            airdate?: string;
          };
        }>;
        meta?: { count?: number };
      };

      const episodes = payload.data ?? [];
      const match = episodes.find((entry) => entry.attributes?.number === episodeNumber);
      
      const result: ExternalEpisodePayload = {
        episode: episodeNumber,
      };

      if (typeof payload.meta?.count === 'number' && payload.meta.count > 0) {
        result.totalEpisodes = payload.meta.count;
      }

      if (match) {
        const attributes = match.attributes ?? {};
        const title = choosePreferredEnglish(
          attributes.titles?.en,
          choosePreferredEnglish(attributes.canonicalTitle, attributes.titles?.en_jp)
        );
        const synopsis = choosePreferredEnglish(attributes.synopsis, attributes.description);

        if (title !== undefined && isMeaningfulText(title)) {
          result.title = sanitizeEpisodeTitle(title);
        }

        const validSyn = isValidSynopsis(synopsis) ? synopsis : undefined;
        if (validSyn !== undefined) {
          result.synopsis = validSyn;
        }

        if (attributes.airdate !== undefined && isMeaningfulText(attributes.airdate)) {
          result.airingAt = attributes.airdate;
        }
      }

      return { online: true, data: result };
    } catch (err) {
      lastError = err;
    }
  }

  console.error(`[cron] Kitsu request failed completely:`, lastError);
  return { online: false, data: null };
}

async function maybeFetchTotalEpisodesFromJikan(): Promise<number | null> {
  const malId = JIKAN_ANIME_ID;
  if (!malId) return null;

  const url = `https://api.jikan.moe/v4/anime/${malId}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[cron] Jikan anime request failed: ${await readErrorSummary(res)}`);
    return null;
  }

  const payload = (await res.json()) as { data?: { episodes?: number } };
  return payload.data?.episodes ?? null;
}

async function fetchFromJikan(episodeNumber: number): Promise<{ online: boolean; title?: string | undefined; synopsis?: string | undefined }> {
  const malId = JIKAN_ANIME_ID;
  if (!malId) return { online: false };

  const url = `https://api.jikan.moe/v4/anime/${malId}/episodes/${episodeNumber}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status >= 500) {
        return { online: false };
      }
      return { online: true };
    }

    const payload = (await res.json()) as {
      data?: {
        title?: string;
        synopsis?: string;
      };
    };

    const data = payload.data;
    return {
      online: true,
      title: data?.title || undefined,
      synopsis: data?.synopsis || undefined,
    };
  } catch (err) {
    console.error(`[cron] Jikan episodes fetch failed:`, err);
    return { online: false };
  }
}

async function fetchStaffFromJikan(): Promise<string | undefined> {
  const malId = JIKAN_ANIME_ID;
  if (!malId) return undefined;

  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/characters`);
    if (!res.ok) return undefined;

    const payload = (await res.json()) as {
      data?: Array<{
        character?: { name?: string };
        voice_actors?: Array<{ person?: { name?: string }; language?: string }>;
      }>;
    };

    const characters = payload.data ?? [];
    const castLines: string[] = [];
    for (const char of characters) {
      const charName = char.character?.name;
      const jpActor = char.voice_actors?.find(va => va.language === 'Japanese')?.person?.name;
      if (charName && jpActor) {
        castLines.push(`- ${charName} - (EN: TBA / JP: ${jpActor})`);
        if (castLines.length >= 5) break;
      }
    }

    if (castLines.length > 0) {
      return `**Cast (EN/JP)**\n${castLines.join('\n')}`;
    }
  } catch (err) {
    console.error('[cron] Jikan characters fetch failed:', err);
  }
  return undefined;
}

async function fetchJikanStaff(): Promise<string | undefined> {
  const malId = JIKAN_ANIME_ID;
  if (!malId) return undefined;

  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/staff`);
    if (!res.ok) return undefined;

    const payload = (await res.json()) as {
      data?: Array<{
        person?: { name?: string };
        positions?: string[];
      }>;
    };

    const staff = payload.data ?? [];
    const staffLines: string[] = [];
    for (const st of staff) {
      const name = st.person?.name;
      const position = st.positions?.[0];
      if (name && position) {
        staffLines.push(`- ${position}: ${name}`);
        if (staffLines.length >= 5) break;
      }
    }

    if (staffLines.length > 0) {
      return `**Staff (JP source)**\n${staffLines.join('\n')}`;
    }
  } catch (err) {
    console.error('[cron] Jikan staff fetch failed:', err);
  }
  return undefined;
}

async function fetchJikanEpisodeStaff(): Promise<string | undefined> {
  const [cast, staff] = await Promise.all([
    fetchStaffFromJikan(),
    fetchJikanStaff()
  ]);
  const sections: string[] = [];
  if (cast) sections.push(cast);
  if (staff) sections.push(staff);
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

async function fetchAniListDescription(): Promise<string | undefined> {
  try {
    const mediaId = await resolveAniListMediaId();
    if (!mediaId) return undefined;

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          description(asHtml: false)
        }
      }
    `;
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables: { id: mediaId } }),
    });
    if (!res.ok) return undefined;
    const payload = (await res.json()) as { data?: { Media?: { description?: string } } };
    return payload.data?.Media?.description || undefined;
  } catch {
    return undefined;
  }
}

function isValidSynopsis(text?: string): boolean {
  if (!isMeaningfulText(text)) return false;
  if (text.toLowerCase().includes('wikipedia')) return false;
  return true;
}

function cleanSynopsisSource(text: string): string {
  return text.replace(/\s*(\(Source:[^)]+\))/gi, ' $1').trim();
}

async function getEpisodeMetadata(episodeNumber: number): Promise<ExternalEpisodePayload | null> {
  if (await isMockModeEnabled()) {
    return await getMockEpisodeMetadata(episodeNumber);
  }

  // Fetch Kitsu, AniList and Wikipedia in parallel
  const [kitsu, aniList, wikipedia] = await Promise.all([
    fetchFromKitsu(episodeNumber),
    fetchFromAniList(episodeNumber),
    fetchFromWikipedia(episodeNumber),
  ]);

  const merged: ExternalEpisodePayload = {
    episode: episodeNumber,
  };

  // 1. Episode Title Sourcing
  if (kitsu.online) {
    merged.title = kitsu.data?.title ?? 'TBA';
  } else {
    // Wikipedia fallback when Kitsu is down
    merged.title = wikipedia.data?.title ?? 'TBA';
  }

  // 2. Episode Synopsis Sourcing
  if (kitsu.online) {
    merged.synopsis = kitsu.data?.synopsis ?? 'TBA';
  } else {
    // Fallback: AniList/Jikan shorter synopsis when Kitsu is down
    let fallbackSynopsis = 'TBA';
    const [jikanRes, aniListDesc] = await Promise.all([
      fetchFromJikan(episodeNumber),
      fetchAniListDescription(),
    ]);
    const jikanSyn = isValidSynopsis(jikanRes.synopsis) ? jikanRes.synopsis : undefined;
    const aniListSyn = isValidSynopsis(aniListDesc) ? aniListDesc : undefined;

    if (jikanSyn && aniListSyn) {
      fallbackSynopsis = jikanSyn.length < aniListSyn.length ? jikanSyn : aniListSyn;
    } else if (jikanSyn) {
      fallbackSynopsis = jikanSyn;
    } else if (aniListSyn) {
      fallbackSynopsis = aniListSyn;
    }
    merged.synopsis = fallbackSynopsis;
  }

  // 3. Airing Time (used for verify/airing checks)
  if (kitsu.online && kitsu.data?.airingAt) {
    merged.airingAt = kitsu.data.airingAt;
  } else {
    // Fallback to weekly schedule when Kitsu is down
    const scheduled = await computeAiringDateUtc(episodeNumber);
    merged.airingAt = scheduled.toISOString();
  }

  // 4. Total Episodes
  const total = kitsu.data?.totalEpisodes ?? aniList.data?.totalEpisodes;
  if (total) {
    merged.totalEpisodes = total;
  }

  // 5. Cast and Staff Merging
  let jpCastAndStaff: string | undefined;
  if (aniList.online) {
    jpCastAndStaff = aniList.data?.episodeStaff;
  } else {
    // Fallback JP Cast: Jikan, or if Jikan is down, Wikipedia
    const jikanStaff = await fetchJikanEpisodeStaff();
    if (jikanStaff) {
      jpCastAndStaff = jikanStaff;
    } else {
      jpCastAndStaff = wikipedia.data?.episodeStaff;
    }
  }

  let enCastBlock: string | undefined;
  if (wikipedia.online) {
    enCastBlock = wikipedia.data?.episodeStaff;
  }

  let finalEpisodeStaff = DEFAULT_EPISODE_STAFF;
  if (jpCastAndStaff && enCastBlock) {
    finalEpisodeStaff = mergeCastBlocks(jpCastAndStaff, enCastBlock) || DEFAULT_EPISODE_STAFF;
  } else if (jpCastAndStaff) {
    finalEpisodeStaff = jpCastAndStaff;
  } else if (enCastBlock) {
    finalEpisodeStaff = enCastBlock;
  }

  // Store in Redis if successfully resolved and non-default
  if (finalEpisodeStaff !== DEFAULT_EPISODE_STAFF && isMeaningfulText(finalEpisodeStaff)) {
    try {
      await redis.set(REDIS_KEY_LAST_CAST_AND_STAFF, finalEpisodeStaff);
    } catch (err) {
      console.error('[cron] Failed to cache cast and staff in Redis:', err);
    }
    merged.episodeStaff = finalEpisodeStaff;
  } else {
    // Fallback: Redis cache, or HARDCODED_CAST_AND_STAFF if Redis is empty
    let cachedStaff: string | undefined = undefined;
    try {
      cachedStaff = await redis.get(REDIS_KEY_LAST_CAST_AND_STAFF);
    } catch (err) {
      console.error('[cron] Failed to fetch cached cast and staff:', err);
    }
    merged.episodeStaff = cachedStaff || HARDCODED_CAST_AND_STAFF;
  }

  if (merged.synopsis !== undefined) {
    merged.synopsis = cleanSynopsisSource(merged.synopsis);
  }

  return merged;
}

async function getConfiguredOrApiMaxEpisodes(episodeNumber: number): Promise<number | null> {
  const metadata = await getEpisodeMetadata(episodeNumber);
  if (metadata?.totalEpisodes && metadata.totalEpisodes > 0) {
    return metadata.totalEpisodes;
  }

  const jikanTotal = await maybeFetchTotalEpisodesFromJikan();
  if (jikanTotal && jikanTotal > 0) {
    return jikanTotal;
  }

  return DEFAULT_MAX_EPISODES;
}

async function buildDiscussionTitle(episodeNumber: number): Promise<string> {
  const seriesTitle = await getSeriesTitle();
  const template = await getPostTitleTemplate();
  return applyCommonPlaceholders(template, {
    SERIES_TITLE: seriesTitle,
    EPISODE_NUMBER: String(episodeNumber),
  });
}

async function findEpisodeDiscussionPostPermalink(subredditName: string, episodeNumber: number): Promise<string | null> {
  const redisPermalink = await redis.get(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`);
  if (redisPermalink) return redisPermalink;

  const listing = reddit.getNewPosts({ subredditName, limit: 100, pageSize: 100 });
  const posts = await listing.all();
  const exactTitle = (await buildDiscussionTitle(episodeNumber)).toLowerCase();

  const found = posts.find((p) => p.title.toLowerCase() === exactTitle);
  if (!found) return null;

  await redis.set(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`, found.id);
  await redis.set(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`, found.permalink);
  return found.permalink;
}

async function buildPreviousEpisodeLink(episodeNumber: number, subredditName: string): Promise<string> {
  if (episodeNumber <= 1) {
    return 'N/A (Season premiere)';
  }

  const previousEpisodeNumber = episodeNumber - 1;

  if (previousEpisodeNumber === 1) {
    const episodeOneUrl = EPISODE_ONE_DISCUSSION_URL;
    if (episodeOneUrl) {
      return `[Episode 1 discussion](${episodeOneUrl})`;
    }
  }

  const permalink = await findEpisodeDiscussionPostPermalink(subredditName, previousEpisodeNumber);

  if (!permalink) {
    return `Episode ${previousEpisodeNumber} discussion not found yet.`;
  }

  return `[Episode ${previousEpisodeNumber} discussion](https://reddit.com${permalink})`;
}


async function reconcileExistingEpisodeDiscussionPost(episodeNumber: number): Promise<{
  updated: boolean;
  postId?: string;
  permalink?: string;
}> {
  const storedPostId = await redis.get(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`);
  if (!storedPostId) {
    return { updated: false };
  }

  const storedPost = await reddit.getPostById(storedPostId as `t3_${string}`);
  if (!storedPost.body) {
    return { updated: false, postId: storedPost.id, permalink: storedPost.permalink };
  }

  const payload = await buildEpisodePayload(episodeNumber);
  const updatedBody = await buildEpisodePostMarkdown(payload);
  if (storedPost.body.trim() === updatedBody.trim()) {
    return { updated: false, postId: storedPost.id, permalink: storedPost.permalink };
  }

  await storedPost.edit({ text: updatedBody });
  console.log(`[cron] Edited existing episode post episode=${String(episodeNumber)} postId=${storedPost.id}`);

  try {
    const postTitle = await buildDiscussionTitle(episodeNumber);
    await notifyDiscordUpdate(episodeNumber, postTitle, storedPost.permalink);
  } catch (err) {
    console.error('[cron] Could not send Discord update notification:', err);
  }

  return { updated: true, postId: storedPost.id, permalink: storedPost.permalink };
}

async function buildNextEpisodeLink(episodeNumber: number, subredditName: string): Promise<string> {
  const nextEpisodeNumber = episodeNumber + 1;
  const permalink = await findEpisodeDiscussionPostPermalink(subredditName, nextEpisodeNumber);
  if (!permalink) {
    return 'TBA after the next thread posts.';
  }
  return `[Episode ${nextEpisodeNumber} discussion](https://reddit.com${permalink})`;
}

export async function buildArchiveGrid(currentEpisodeNumber: number, subredditName: string): Promise<string> {
  const maxEpisodes = 13;
  const episodeCells: string[] = [];

  for (let ep = 1; ep <= maxEpisodes; ep++) {
    if (ep > currentEpisodeNumber) {
      episodeCells.push(`${ep} (TBA)`);
      continue;
    }
    const permalink = await findEpisodeDiscussionPostPermalink(subredditName, ep);
    if (permalink) {
      episodeCells.push(`[${ep}](https://reddit.com${permalink})`);
    } else if (ep === 1 && EPISODE_ONE_DISCUSSION_URL) {
      episodeCells.push(`[1](${EPISODE_ONE_DISCUSSION_URL})`);
    } else {
      episodeCells.push(`${ep} (TBA)`);
    }
  }

  const numColumns = 4;
  const numRows = Math.ceil(maxEpisodes / numColumns);

  const headers = Array.from({ length: numColumns }, () => 'Episode').join(' | ');
  const alignment = Array.from({ length: numColumns }, () => ':---:').join(' | ');

  const rows: string[] = [];
  for (let r = 0; r < numRows; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < numColumns; c++) {
      const cellIndex = r * numColumns + c;
      if (cellIndex < maxEpisodes) {
        rowCells.push(episodeCells[cellIndex]!);
      } else {
        rowCells.push('');
      }
    }
    rows.push(`| ${rowCells.join(' | ')} |`);
  }

  return `| ${headers} |\n| ${alignment} |\n${rows.join('\n')}`;
}

export async function buildEpisodePayload(episodeNumber: number): Promise<EpisodePayload> {
  const external = await getEpisodeMetadata(episodeNumber);
  const subredditName = await getSubredditName();

  const scheduledAiringDate = await computeAiringDateUtc(episodeNumber);

  return {
    episodeNumber: external?.episodeNumber ?? external?.episode ?? external?.number ?? episodeNumber,
    episodeTitle: external?.episodeTitle ?? external?.title ?? 'TBA',
    synopsis: external?.synopsis ?? external?.summary ?? 'TBA',
    jstTime: external?.jstTime ?? formatTimeInZone(scheduledAiringDate, 'Asia/Tokyo'),
    etTime: external?.etTime ?? formatTimeInZone(scheduledAiringDate, ET_TIME_ZONE),
    cestTime: external?.cestTime ?? formatTimeInZone(scheduledAiringDate, 'Europe/Paris'),
    episodeStaff: external?.episodeStaff ?? DEFAULT_EPISODE_STAFF,
    previousEpisodeLink: external?.previousEpisodeLink ?? (await buildPreviousEpisodeLink(episodeNumber, subredditName)),
    nextEpisodeLink: await buildNextEpisodeLink(episodeNumber, subredditName),
  };
}

export async function buildEpisodePostMarkdown(payload: EpisodePayload): Promise<string> {
  const subredditName = await getSubredditName();
  const seriesTitle = await getSeriesTitle();
  const template = await getBodyTemplate();
  const baseValues = {
    SERIES_TITLE: seriesTitle,
    SUBREDDIT_NAME: subredditName,
    EPISODE_NUMBER: String(payload.episodeNumber),
    EPISODE_TITLE: payload.episodeTitle,
    JST_TIME: payload.jstTime,
    ET_TIME: payload.etTime,
    CEST_TIME: payload.cestTime,
    SYNOPSIS: payload.synopsis,
    EPISODE_STAFF: payload.episodeStaff,
    PREVIOUS_EPISODE_LINK: payload.previousEpisodeLink,
    NEXT_EPISODE_LINK: payload.nextEpisodeLink,
  };
  const officialLinksRaw = OFFICIAL_LINKS_MARKDOWN;
  const communityLinksRaw = COMMUNITY_LINKS_MARKDOWN;
  const officialLinks = applyCommonPlaceholders(officialLinksRaw, baseValues);
  const communityLinks = applyCommonPlaceholders(communityLinksRaw, baseValues);

  return applyCommonPlaceholders(template, {
    ...baseValues,
    OFFICIAL_LINKS: officialLinks,
    COMMUNITY_LINKS: communityLinks,
    DISCUSSIONS_GRID: await buildArchiveGrid(payload.episodeNumber, subredditName),
  });
}

async function notifyDiscordSuccess(episodeNumber: number, postTitle: string, postPermalink: string) {
  const discordWebhook = await getDiscordWebhookUrl();
  if (!discordWebhook) return;

  await sendDiscordNotification(discordWebhook, 'success', postTitle, {
    episodeNumber,
    postUrl: `https://reddit.com${postPermalink}`,
  });
}

async function notifyDiscordUpdate(episodeNumber: number, postTitle: string, postPermalink: string) {
  const discordWebhook = await getDiscordWebhookUrl();
  if (!discordWebhook) return;

  await sendDiscordNotification(discordWebhook, 'update', postTitle, {
    episodeNumber,
    postUrl: `https://reddit.com${postPermalink}`,
  });
}

async function notifyDiscordError(episodeNumber: number | undefined, title: string, error: unknown) {
  const discordWebhook = await getDiscordWebhookUrl();
  if (!discordWebhook) return;

  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const payload: { episodeNumber?: number; error: Error } = { error: normalizedError };
  if (typeof episodeNumber === 'number') {
    payload.episodeNumber = episodeNumber;
  }

  await sendDiscordNotification(discordWebhook, 'error', title, payload);
}

async function updateAllPastEpisodesGrid(currentEpisodeNumber: number, subredditName: string): Promise<void> {
  console.log(`[cron] Retroactively updating grids for episodes 1 to ${currentEpisodeNumber}`);
  for (let ep = 1; ep <= currentEpisodeNumber; ep++) {
    if (ep === 1) {
      const mockModeEnabled = await isMockModeEnabled();
      if (!mockModeEnabled) {
        continue; // Skip editing Episode 1 in production since it was created manually and cannot be edited by the bot
      }
    }
    const storedPostId = await redis.get(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${ep}`);
    if (!storedPostId) {
      await findEpisodeDiscussionPostPermalink(subredditName, ep);
    }

    const finalPostId = await redis.get(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${ep}`);
    if (finalPostId) {
      try {
        const storedPost = await reddit.getPostById(finalPostId as `t3_${string}`);
        if (storedPost && storedPost.body) {
          const payload = await buildEpisodePayload(ep);
          const updatedBody = await buildEpisodePostMarkdown(payload);
          if (storedPost.body.trim() !== updatedBody.trim()) {
            await storedPost.edit({ text: updatedBody });
            console.log(`[cron] Retroactively updated grid for episode ${ep}`);
          }
        }
      } catch (err) {
        console.error(`[cron] Failed to retroactively edit episode ${ep} post:`, err);
      }
    }
  }
}

function isFlairRelatedPostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /flair|template|invalid.*flair|unknown.*flair|not found/i.test(message);
}

async function submitEpisodeDiscussionPost(options: {
  subredditName: string;
  title: string;
  body: string;
  flairId?: string;
}) {
  const submit = async (includeFlair: boolean) => {
    const postOptions = {
      subredditName: options.subredditName,
      title: options.title,
      text: options.body,
    } as {
      subredditName: string;
      title: string;
      text: string;
      flairId?: string;
    };

    if (includeFlair && options.flairId) {
      postOptions.flairId = options.flairId;
    }

    return await reddit.submitPost(postOptions);
  };

  try {
    return await submit(true);
  } catch (error) {
    if (options.flairId && isFlairRelatedPostError(error)) {
      console.error('[cron] Post failed with flair set; retrying without flair.', error);
      try {
        return await submit(false);
      } catch (retryError) {
        console.error('[cron] Retry without flair also failed.', retryError);
        throw retryError;
      }
    }

    throw error;
  }
}

const REDIS_KEY_EPISODE_RELEASE_VERIFIED_PREFIX = 'episode_release_verified_';

async function verifyEpisodeIsAired(episodeNumber: number): Promise<boolean> {
  if (await isMockModeEnabled()) {
    console.log('[cron] Mock mode enabled; bypass release verification and return true.');
    return true;
  }
  try {
    const [jikan, aniList, kitsu] = await Promise.all([
      fetchFromJikan(episodeNumber).catch(() => ({ online: false, title: undefined, synopsis: undefined })),
      fetchFromAniList(episodeNumber).catch(() => ({ online: false, data: null })),
      fetchFromKitsu(episodeNumber).catch(() => ({ online: false, data: null })),
    ]);

    const fromJikan = jikan.online ? jikan : null;
    const fromAniList = aniList.online ? aniList.data : null;
    const fromKitsu = kitsu.online ? kitsu.data : null;

    console.log(
      `[cron] Verifying release for episode ${String(episodeNumber)}. Jikan=${String(!!fromJikan)} AniList=${String(!!fromAniList)} Kitsu=${String(!!fromKitsu)}`
    );

    // Check if AniList indicates the episode is in the future
    if (fromAniList?.airingAt && typeof fromAniList.airingAt === 'number') {
      const airingTime = fromAniList.airingAt > 10_000_000_000 ? fromAniList.airingAt : fromAniList.airingAt * 1000;
      if (airingTime > Date.now()) {
        console.log(
          `[cron] AniList reports episode ${String(episodeNumber)} airs in the future: ${new Date(airingTime).toISOString()}`
        );
        return false;
      }
    }

    // Check if at least one metadata source successfully found the episode title/synopsis and it is not "TBA".
    const hasJikan = fromJikan && isMeaningfulText(fromJikan.title) && fromJikan.title !== 'TBA';
    const hasAniList = fromAniList && isMeaningfulText(fromAniList.title) && fromAniList.title !== 'TBA';
    const hasKitsu = fromKitsu && isMeaningfulText(fromKitsu.title) && fromKitsu.title !== 'TBA';

    if (hasJikan || hasAniList || hasKitsu) {
      console.log(
        `[cron] Release verified: hasJikan=${String(hasJikan)} hasAniList=${String(hasAniList)} hasKitsu=${String(hasKitsu)}`
      );
      return true;
    }

    console.log('[cron] Release check failed: No verified title/details found in any api source.');
    return false;
  } catch (err) {
    console.error('[cron] Error in verifyEpisodeIsAired:', err);
    return true; // Fallback: default to true to avoid deleting in case of API failure
  }
}

async function performReleaseCorrectionCheck(now: Date): Promise<void> {
  const et = getTimePartsInET(now);
  const scheduledWeekday = await getScheduledWeekdayEt();
  const isPostingDay = et.weekday === scheduledWeekday;
  if (!isPostingDay) {
    return;
  }

  // Check if we posted today
  const etDateKey = getEtDateKey(now);
  const alreadyPostedToday = await redis.get(REDIS_KEY_LAST_POSTED_ET_DATE);
  if (alreadyPostedToday !== etDateKey) {
    return;
  }

  // Check if it is after 11:45 ET
  const nowMinutes = localTimeToMinutes(et.hour, et.minute);
  const checkMinutes = localTimeToMinutes(11, 45);
  if (nowMinutes < checkMinutes) {
    return;
  }

  const lastEpisodeStr = await redis.get(REDIS_KEY_LAST_POSTED_EPISODE);
  if (!lastEpisodeStr) return;
  const episodeNumber = Number(lastEpisodeStr);

  const alreadyVerified = await redis.get(`${REDIS_KEY_EPISODE_RELEASE_VERIFIED_PREFIX}${episodeNumber}`);
  if (alreadyVerified === 'true') {
    return;
  }

  console.log(`[cron] Performing release correction check for episode ${String(episodeNumber)} after 11:45 ET`);

  const aired = await verifyEpisodeIsAired(episodeNumber);
  if (aired) {
    await redis.set(`${REDIS_KEY_EPISODE_RELEASE_VERIFIED_PREFIX}${episodeNumber}`, 'true');
    console.log(`[cron] Episode ${String(episodeNumber)} successfully verified as aired.`);
    return;
  }

  console.log(`[cron] Episode ${String(episodeNumber)} is NOT live after 11:45 ET. Initiating auto-deletion...`);

  const postId = await redis.get(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`);
  let permalink = '';

  if (postId) {
    try {
      const post = await reddit.getPostById(postId as `t3_${string}`);
      permalink = post.permalink;
      await post.delete();
      console.log(`[cron] Deleted delayed episode discussion thread: postId=${postId}`);
    } catch (err) {
      console.error(`[cron] Failed to delete post ${postId}:`, err);
    }
  }

  // Reset Redis keys so we can attempt to post it later/next time
  await redis.del(REDIS_KEY_LAST_POSTED_ET_DATE);
  await redis.del(REDIS_KEY_LAST_POSTED_EPISODE);
  await redis.del(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`);
  await redis.del(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`);

  try {
    const discordWebhook = await getDiscordWebhookUrl();
    if (discordWebhook) {
      const postTitle = await buildDiscussionTitle(episodeNumber);
      const discordDetails: { episodeNumber: number; postUrl?: string; error: Error } = {
        episodeNumber,
        error: new Error(
          `The episode did not appear on Kitsu/AniList/Jikan APIs by 11:45 ET. The discussion thread has been deleted and the scheduler state has been reset to allow reposting.`
        ),
      };
      if (permalink) {
        discordDetails.postUrl = `https://reddit.com${permalink}`;
      }
      await sendDiscordNotification(discordWebhook, 'error', `Post DELETED: ${postTitle}`, discordDetails);
    }
  } catch (err) {
    console.error('[cron] Failed to send Discord deletion notification:', err);
  }
}

export async function postCurrentEpisodeDiscussion(options: RunOptions = {}) {
  const force = options.force ?? false;
  const episodeNumberOverride = options.episodeNumberOverride;
  const now = new Date();

  try {


    const mockModeEnabled = await isMockModeEnabled();
    console.log(
      `[cron] postCurrentEpisodeDiscussion start force=${String(force)} mockMode=${String(mockModeEnabled)} now=${now.toISOString()}`
    );
    if (!force && !mockModeEnabled && !(await isScheduledWindowNow(now))) {
      console.log('[cron] Skip: outside scheduled window.');
      try {
        await performReleaseCorrectionCheck(now);
      } catch (err) {
        console.error('[cron] Self-correction check failed:', err);
      }
      return {
        posted: false,
        reason: 'outside-scheduled-window',
      };
    }

    const etDateKey = getEtDateKey(now);
    const alreadyPostedToday = await redis.get(REDIS_KEY_LAST_POSTED_ET_DATE);
    if (!force && alreadyPostedToday === etDateKey) {
      console.log(`[cron] Skip: already posted for ET date ${etDateKey}.`);
      return {
        posted: false,
        reason: 'already-posted-for-et-date',
        etDateKey,
      };
    }

    const lastEpisode = await redis.get(REDIS_KEY_LAST_POSTED_EPISODE);
    const calculatedEpisode = lastEpisode ? Number(lastEpisode) + 1 : PREMIERE_EPISODE_NUMBER;

    const episodeNumber =
      typeof episodeNumberOverride === 'number' && Number.isInteger(episodeNumberOverride) && episodeNumberOverride > 0
        ? episodeNumberOverride
        : calculatedEpisode;
    const subredditName = await getSubredditName();
    const reconcileResult = await reconcileExistingEpisodeDiscussionPost(episodeNumber);
    if (reconcileResult.postId) {
      return {
        posted: false,
        reason: reconcileResult.updated ? 'refreshed-existing-post' : 'episode-already-posted',
        episodeNumber,
        updated: reconcileResult.updated,
        postId: reconcileResult.postId,
        permalink: reconcileResult.permalink,
      };
    }

    const maxEpisodes = await getConfiguredOrApiMaxEpisodes(episodeNumber);
    if (!force && maxEpisodes !== null && episodeNumber > maxEpisodes) {
      console.log(
        `[cron] Skip: season finished. episode=${String(episodeNumber)} maxEpisodes=${String(maxEpisodes)}`
      );
      return {
        posted: false,
        reason: 'season-finished',
        episodeNumber,
        maxEpisodes,
      };
    }


    const episodeOneDiscussionExists = await hasEpisodeOneDiscussionUrl();
    const initialLastPosted = episodeOneDiscussionExists ? INITIAL_LAST_POSTED_EPISODE_NUMBER : 0;
    const lastPostedNumber = Number(lastEpisode || String(initialLastPosted));
    console.log(
      `[cron] Episode state current=${String(episodeNumber)} lastPosted=${String(lastPostedNumber)} initialLastPosted=${String(initialLastPosted)}`
    );

    if (!force && episodeNumber <= lastPostedNumber) {
      console.log(`[cron] Skip: episode already posted for episode ${String(episodeNumber)}.`);
      return {
        posted: false,
        reason: 'episode-already-posted',
        episodeNumber,
      };
    }

    const payload = await buildEpisodePayload(episodeNumber);
    const title = await buildDiscussionTitle(payload.episodeNumber);
    const body = await buildEpisodePostMarkdown(payload);
    const flairId = DISCUSSION_FLAIR_ID;
    console.log(
      `[cron] Attempting submit subreddit=${subredditName} episode=${String(payload.episodeNumber)} flair=${flairId ? 'set' : 'none'}`
    );

    const submitOptions: {
      subredditName: string;
      title: string;
      body: string;
      flairId?: string;
    } = {
      subredditName,
      title,
      body,
    };

    if (flairId) {
      submitOptions.flairId = flairId;
    }

    const post = await submitEpisodeDiscussionPost(submitOptions);
    console.log(`[cron] Submit success postId=${post.id} permalink=${post.permalink}`);

    try {
      await post.sticky(1);
    } catch (err) {
      console.error('[cron] Post submitted but could not sticky/highlight it. Check mod permissions:', err);
    }

    await redis.set(REDIS_KEY_LAST_POSTED_ET_DATE, etDateKey);
    await redis.set(REDIS_KEY_LAST_POSTED_EPISODE, String(payload.episodeNumber));
    await redis.set(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${payload.episodeNumber}`, post.id);
    await redis.set(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${payload.episodeNumber}`, post.permalink);

    try {
      await updateAllPastEpisodesGrid(payload.episodeNumber, subredditName);
    } catch (err) {
      console.error('[cron] Could not retroactively update grids:', err);
    }

    try {
      await notifyDiscordSuccess(payload.episodeNumber, title, post.permalink);
    } catch (err) {
      console.error('[cron] Could not send Discord success notification:', err);
    }

    return {
      posted: true,
      episodeNumber: payload.episodeNumber,
      subredditName,
      postId: post.id,
      permalink: post.permalink,
    };
  } catch (err) {
    console.error('[cron] postCurrentEpisodeDiscussion failed:', err);
    const episodeNumber =
      typeof episodeNumberOverride === 'number' && Number.isInteger(episodeNumberOverride) && episodeNumberOverride > 0
        ? episodeNumberOverride
        : await redis.get(REDIS_KEY_LAST_POSTED_EPISODE).then(val => val ? Number(val) + 1 : PREMIERE_EPISODE_NUMBER).catch(() => undefined);
    try {
      await notifyDiscordError(episodeNumber, 'Episode Discussion Post Job', err);
    } catch (discordErr) {
      console.error('[cron] Could not send Discord error notification:', discordErr);
    }

    throw err;
  }
}

export const cron = new Hono();

cron.post('/post-episode-discussion', async (c) => {
  await c.req.json();
  const result = await postCurrentEpisodeDiscussion({ force: false });
  return c.json(result, 200);
});
