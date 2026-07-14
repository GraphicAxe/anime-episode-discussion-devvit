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

type ExternalEpisodePayload = {
  episode?: number;
  title?: string;
  synopsis?: string;
  jstTime?: string;
  etTime?: string;
  cestTime?: string;
  episodeStaff?: string;
  previousEpisodeLink?: string;
  nextEpisodeLink?: string;
  airingAt?: number | string;
  totalEpisodes?: number;
};

type RunOptions = {
  force?: boolean;
  episodeNumberOverride?: number;
};

type DiscordNotificationType = 'success' | 'update' | 'error' | 'alert';

export const ET_TIME_ZONE = 'America/New_York';
export const REDIS_KEY_LAST_POSTED_EPISODE = 'last_posted_episode_number';
export const REDIS_KEY_LAST_POSTED_ET_DATE = 'last_posted_et_date';
export const REDIS_KEY_EPISODE_POST_ID_PREFIX = 'episode_post_id_';
export const REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX = 'episode_post_permalink_';
export const REDIS_KEY_LAST_CAST_AND_STAFF = 'last_successful_cast_and_staff';
export const REDIS_KEY_PENDING_RETRY_EPISODE = 'pending_retry_episode';
export const REDIS_KEY_EPISODE_RELEASE_VERIFIED_PREFIX = 'episode_release_verified_';

const SERIES_TITLE = 'Goodbye, Lara';
const POST_TITLE_TEMPLATE = 'Goodbye, Lara - Episode {EPISODE_NUMBER} Discussion';
const PREMIERE_DATE_ET = '2026-07-05';
const PREMIERE_EPISODE_NUMBER = 1;
const POSTING_WINDOW_START_ET = '10:30';
const DEFAULT_AIRING_TIME_ET = '11:30';
const DEFAULT_EPISODE_STAFF = 'TBA';

const MANUAL_EPISODE_POSTS: Record<number, string> = {
  1: 'https://www.reddit.com/r/GoodbyeLara/comments/1uo5xv4/goodbye_lara_episode_1_discussion/',
  2: 'https://www.reddit.com/r/GoodbyeLara/comments/1uuj2b0/goodbye_lara_episode_2_discussion/',
};

const DISCUSSION_FLAIR_ID = '45a92b8e-7724-11f1-aa18-6e578d5a10fa';
const JIKAN_ANIME_ID = '58878';
const ANILIST_MEDIA_ID = '177637';
const KITSU_ANIME_ID = '48880';
const WIKIPEDIA_PAGE_TITLE = 'Goodbye,_Lara';
export const DEFAULT_MAX_EPISODES = 13;

interface CastMember {
  character: string;
  enActor: string;
  jpActor: string;
}

interface StaffMember {
  role: string;
  name: string;
}

const HARDCODED_CAST: CastMember[] = [
  { character: 'Lara', enActor: 'Brianna Knickerbocker', jpActor: 'Hana Hishikawa' },
  { character: 'Mari Otsu', enActor: 'Anairis Quiñones', jpActor: 'Nana Kawaishi' },
  { character: 'Luca', enActor: 'Kieran Regan', jpActor: 'Ayumu Murase' },
  { character: 'Grace', enActor: 'Tiana Camacho', jpActor: 'Rica Fukami' },
  { character: 'Luna', enActor: 'Madeline Dorroh', jpActor: 'Honoka Inoue' },
  { character: 'Lisa', enActor: 'Cat Protano', jpActor: 'Minami Tsuda' },
  { character: 'Rowan', enActor: 'Brook Chalmers', jpActor: 'Masaki Terasoma' },
  { character: 'Laura', enActor: 'Tara Sands', jpActor: 'Umeka Shōji' },
  { character: 'Fish', enActor: 'Jonathon Ha', jpActor: 'TBA' },
  { character: 'Ema Otsu', enActor: 'TBA', jpActor: 'Nanae Sumitomo' },
  { character: 'Makoto Otsu', enActor: 'TBA', jpActor: 'Mitsuaki Madono' },
  { character: 'Yoshihiro Otsu', enActor: 'TBA', jpActor: 'Tomohiro Ōno' },
  { character: 'Kota', enActor: 'TBA', jpActor: 'Kazutomi Yamamoto' }
];

const HARDCODED_STAFF: StaffMember[] = [
  { role: 'Director', name: 'Takushi Koide' },
  { role: 'Series Composition', name: 'Anna Kawahara' },
  { role: 'Character Design', name: 'Shiori Tani' },
  { role: 'Music', name: 'Yuma Yamaguchi' },
  { role: 'Art Director', name: 'Mari Fujino' },
  { role: 'Sound Director', name: 'Haru Yamada' },
  { role: 'Director of Photography', name: 'Kazuto Izumita' }
];

function buildHardcodedCastAndStaffMarkdown(): string {
  const castLines = HARDCODED_CAST.map(
    (c) => `- ${c.character} - (EN: ${c.enActor} / JP: ${c.jpActor})`
  );
  const staffLines = HARDCODED_STAFF.map(
    (s) => `- ${s.role}: ${s.name}`
  );
  return `**Cast (EN/JP)**\n${castLines.join('\n')}\n\n**Staff (JP)**\n${staffLines.join('\n')}`;
}

function resolveEnglishVoiceActor(characterName: string): string {
  const norm = characterName.toLowerCase().replace(/[^a-z]/g, '');
  if (norm.length === 0) return 'TBA';

  // Pass 1: exact match (highest confidence)
  for (const c of HARDCODED_CAST) {
    const normKey = c.character.toLowerCase().replace(/[^a-z]/g, '');
    if (norm === normKey) {
      return c.enActor;
    }
  }

  // Pass 2: substring match, but only when the shorter string covers >= 80% of
  // the longer one. This prevents false-positives like "lara" matching "laura".
  for (const c of HARDCODED_CAST) {
    const normKey = c.character.toLowerCase().replace(/[^a-z]/g, '');
    if (norm.length >= 3 && normKey.length >= 3) {
      if (norm.includes(normKey) || normKey.includes(norm)) {
        const shorter = Math.min(norm.length, normKey.length);
        const longer = Math.max(norm.length, normKey.length);
        if (shorter / longer >= 0.8) {
          return c.enActor;
        }
      }
    }
  }

  // Hardcoded aliases for searchability
  if (norm.includes('mariotsu') || (norm.includes('otsu') && norm.includes('mari'))) {
    const mari = HARDCODED_CAST.find(c => c.character === 'Mari Otsu');
    if (mari) return mari.enActor;
  }
  if (norm.includes('risa') || norm.includes('lisa')) {
    const lisa = HARDCODED_CAST.find(c => c.character === 'Lisa');
    if (lisa) return lisa.enActor;
  }
  return 'TBA';
}

let cachedAniListMediaId: number | null | undefined;
let cachedWikipediaCharactersSection: string | null | undefined;
let cachedWikipediaEpisodesSection: string | null | undefined;
let cachedWikipediaCharactersSectionIndex: number | null | undefined;
let cachedWikipediaEpisodesSectionIndex: number | null | undefined;

const episodeMetadataCache: Record<number, ExternalEpisodePayload | null> = {};
let cachedTotalEpisodes: number | null | undefined;

function clearInMemoryCaches(): void {
  cachedAniListMediaId = undefined;
  cachedWikipediaCharactersSection = undefined;
  cachedWikipediaEpisodesSection = undefined;
  cachedWikipediaCharactersSectionIndex = undefined;
  cachedWikipediaEpisodesSectionIndex = undefined;
  cachedTotalEpisodes = undefined;
  for (const key of Object.keys(episodeMetadataCache)) {
    delete episodeMetadataCache[Number(key)];
  }
}


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
  const isAlert = notificationType === 'alert';
  const payload = {
    content: isSuccess
      ? '✅ **WORKFLOW SUCCESS** ✅'
      : isUpdate
        ? '🔄 **POST UPDATED** 🔄'
        : isAlert
          ? '⚠️ **BOT ALERT** ⚠️'
          : '🚨 **BOT EXCEPTION** 🚨',
    embeds: [
      {
        title: isSuccess
          ? 'Episode Discussion Posted Successfully'
          : isUpdate
            ? 'Episode Discussion Updated'
            : isAlert
              ? 'Post Deleted Externally'
              : 'Episode Discussion Failed',
        description: isSuccess
          ? 'The automation ran successfully and posted a new episode discussion thread.'
          : isUpdate
            ? 'The automation refreshed an existing episode discussion thread with updated metadata.'
            : isAlert
              ? (details.error?.message || 'An existing episode discussion thread was deleted externally. The bot is cleaning up state.')
              : 'The automation encountered an error while trying to create the episode discussion thread.',
        color: isSuccess ? 5763719 : isUpdate ? 3447003 : isAlert ? 16753920 : 16711680,
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
          // Only show error details for 'error' type, not for 'alert' (which uses synthetic errors for descriptions)
          ...(!isAlert && details.error
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
          text: isError
            ? 'Devvit Automation • Status: Unhealthy'
            : isAlert
              ? 'Devvit Automation • Status: Attention Required'
              : 'Devvit Automation • Status: Healthy',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Discord notification failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('[cron] Discord webhook request failed:', err);
  }
}

function getSeriesTitle(): string {
  return SERIES_TITLE;
}

function getPostTitleTemplate(): string {
  return POST_TITLE_TEMPLATE;
}

function getBodyTemplate(): string {
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
    hourCycle: 'h23',
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

  const nowMinutes = localTimeToMinutes(et.hour, et.minute);
  const startMinutes = localTimeToMinutes(start.hour, start.minute);
  const isInWindow = nowMinutes >= startMinutes;

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



async function getManualEpisodePost(ep: number): Promise<string | undefined> {
  return MANUAL_EPISODE_POSTS[ep];
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
    hourCycle: 'h23',
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

async function isApiPlaytestModeEnabled(): Promise<boolean> {
  const raw = ((await settings.get<string>('apiPlaytestMode')) || 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
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

/**
 * Normalizes character names for fuzzy matching across JP/EN sources.
 * - Collapses double vowels (e.g. "Oono" → "Ono") for romanization variants like ō/ou/oo.
 * - Sorts name parts so "Mari Otsu" matches "Otsu Mari" (JP vs EN name ordering).
 * This is intentionally lossy — it's only used for cast merging, not display.
 */
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

  // Filter out empty/whitespace-only lines to prevent junk in output
  const cleanedStaffLines = staffLines.filter(line => line.trim().length > 0);
  if (cleanedStaffLines.length > 0) {
    resultLines.push('');
    resultLines.push(...cleanedStaffLines);
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
        let enActor = parts[1] || 'TBA';
        if (enActor === 'TBA' && currentCharacter) {
          enActor = resolveEnglishVoiceActor(currentCharacter);
        }

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
          let enActor =
            isMeaningfulText(enActorRaw) &&
            (!isMeaningfulText(jpActor) || normalizeName(enActorRaw) !== normalizeName(jpActor))
              ? enActorRaw
              : 'TBA';
          if (enActor === 'TBA' && characterName) {
            enActor = resolveEnglishVoiceActor(characterName);
          }
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

    // Search for a matching episode title by parsing "Episode N" from the title string
    const streamingEpisodes = media.streamingEpisodes ?? [];
    const epPattern = new RegExp(`Episode\\s+${String(episodeNumber)}\\b`, 'i');
    const streamingMatch = streamingEpisodes.find((se) => epPattern.test(se.title ?? ''));
    const streamingTitle = streamingMatch?.title ?? streamingEpisodes[episodeNumber - 1]?.title;
    if (isMeaningfulText(streamingTitle)) {
      // Strip the "Episode N - " prefix if present to get just the title
      result.title = streamingTitle.replace(/^Episode\s+\d+\s*-\s*/i, '').trim() || streamingTitle;
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
        const enActor = resolveEnglishVoiceActor(characterName);
        return `${characterName} - (EN: ${enActor} / JP: ${jpActor})`;
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
        sections.push(`**Staff (JP)**\n${staffEntries.map(l => `- ${l}`).join('\n')}`);
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

      // Note: payload.meta.count is the number of episode records currently in Kitsu's
      // database, NOT the planned series total. For airing shows it may be less than the
      // actual episode count (e.g. 5 of 13), so we intentionally do NOT use it as
      // totalEpisodes. AniList and Jikan provide the authoritative planned count.

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
          // Normalize date string to Unix ms for consistent typing
          try {
            const airdateUtc = zonedTimeToUtc(attributes.airdate, DEFAULT_AIRING_TIME_ET, ET_TIME_ZONE);
            result.airingAt = airdateUtc.getTime();
          } catch {
            // Fallback: store as ISO string if parsing fails
            result.airingAt = attributes.airdate;
          }
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
  if (cachedTotalEpisodes !== undefined) {
    return cachedTotalEpisodes;
  }

  const malId = JIKAN_ANIME_ID;
  if (!malId) {
    cachedTotalEpisodes = null;
    return null;
  }

  const url = `https://api.jikan.moe/v4/anime/${malId}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[cron] Jikan anime request failed: ${await readErrorSummary(res)}`);
    cachedTotalEpisodes = null;
    return null;
  }

  const payload = (await res.json()) as { data?: { episodes?: number } };
  cachedTotalEpisodes = payload.data?.episodes ?? null;
  return cachedTotalEpisodes;
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
      return `**Staff (JP)**\n${staffLines.join('\n')}`;
    }
  } catch (err) {
    console.error('[cron] Jikan staff fetch failed:', err);
  }
  return undefined;
}

async function fetchJikanEpisodeStaff(): Promise<string | undefined> {
  // Sequential calls to avoid exceeding Jikan's 3 req/s unauthenticated rate limit
  const cast = await fetchStaffFromJikan();
  const staff = await fetchJikanStaff();
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
  // Filter out synopses that are just source attribution tags from Wikipedia
  if (/\(source:\s*wikipedia\)/i.test(text)) return false;
  return true;
}

function cleanSynopsisSource(text: string): string {
  return text.replace(/\s*(\(Source:[^)]+\))/gi, ' $1').trim();
}

async function getEpisodeMetadata(episodeNumber: number): Promise<ExternalEpisodePayload | null> {
  if (episodeMetadataCache[episodeNumber] !== undefined) {
    return episodeMetadataCache[episodeNumber];
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
  // Prefer AniList's nextAiringEpisode timestamp (most reliable), then Kitsu, then computed schedule
  if (aniList.online && aniList.data?.airingAt && typeof aniList.data.airingAt === 'number') {
    merged.airingAt = aniList.data.airingAt;
  } else if (kitsu.online && kitsu.data?.airingAt && typeof kitsu.data.airingAt === 'number') {
    merged.airingAt = kitsu.data.airingAt;
  } else {
    // Fallback to weekly schedule when APIs are down or don't have airing info
    const scheduled = await computeAiringDateUtc(episodeNumber);
    merged.airingAt = scheduled.getTime();
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
    merged.episodeStaff = cachedStaff || buildHardcodedCastAndStaffMarkdown();
  }

  if (merged.synopsis !== undefined) {
    merged.synopsis = cleanSynopsisSource(merged.synopsis);
  }

  episodeMetadataCache[episodeNumber] = merged;
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
  const seriesTitle = getSeriesTitle();
  const template = getPostTitleTemplate();
  return applyCommonPlaceholders(template, {
    SERIES_TITLE: seriesTitle,
    EPISODE_NUMBER: String(episodeNumber),
  });
}

async function findEpisodeDiscussionPostPermalink(subredditName: string, episodeNumber: number): Promise<string | null> {
  const redisPermalink = await redis.get(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`);
  if (redisPermalink) return redisPermalink;

  const manualUrl = await getManualEpisodePost(episodeNumber);
  if (manualUrl) {
    try {
      const parsedUrl = new URL(manualUrl);
      const permalink = parsedUrl.pathname;
      await redis.set(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`, permalink);
      return permalink;
    } catch {
      // fallback to list scan if URL parsing fails
    }
  }

  // Search the bot's own posts (not the entire subreddit) since the bot is always the author
  try {
    const appUser = await reddit.getAppUser();
    if (appUser) {
      const listing = appUser.getPosts({ sort: 'new', limit: 100, pageSize: 100 });
      const posts = await listing.all(); // Fetch all bot posts to ensure we can build archive grids
      const exactTitle = (await buildDiscussionTitle(episodeNumber)).toLowerCase();

      const found = posts.find((p) => p.title.toLowerCase() === exactTitle && p.subredditName === subredditName);
      if (found) {
        await redis.set(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`, found.id);
        await redis.set(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`, found.permalink);
        return found.permalink;
      }
    }
  } catch (err) {
    console.error(`[cron] Failed to search bot's own posts for episode ${episodeNumber}:`, err);
  }

  return null;
}

async function buildPreviousEpisodeLink(episodeNumber: number, subredditName: string): Promise<string> {
  if (episodeNumber <= 1) {
    return 'N/A (Season premiere)';
  }

  const previousEpisodeNumber = episodeNumber - 1;

  const manualUrl = await getManualEpisodePost(previousEpisodeNumber);
  if (manualUrl) {
    return `[Episode ${previousEpisodeNumber} discussion](${manualUrl})`;
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

  let storedPost;
  try {
    storedPost = await reddit.getPostById(storedPostId as `t3_${string}`);
  } catch (err) {
    // Post was deleted externally (e.g., by a moderator). Clean up stale Redis keys
    // so the flow falls through to create a new post.
    console.error(`[cron] Stored post ${storedPostId} for episode ${String(episodeNumber)} not found (likely deleted). Cleaning up Redis keys.`, err);
    try {
      const postTitle = await buildDiscussionTitle(episodeNumber);
      await notifyDiscordPostDeleted(episodeNumber, postTitle, storedPostId, false);
    } catch (discordErr) {
      console.error('[cron] Could not send Discord post deleted notification:', discordErr);
    }
    await redis.del(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`);
    await redis.del(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`);
    // rollback so it tries to repost
    await redis.del(REDIS_KEY_LAST_POSTED_ET_DATE);
    await redis.set(REDIS_KEY_LAST_POSTED_EPISODE, String(episodeNumber - 1));
    await redis.set(REDIS_KEY_PENDING_RETRY_EPISODE, String(episodeNumber));

    return { updated: false };
  }

  if (!storedPost.body) {
    return { updated: false, postId: storedPost.id, permalink: storedPost.permalink };
  }

  if (storedPost.removed || storedPost.spam) {
    console.log(`[cron] Episode ${String(episodeNumber)} post ${storedPost.id} is removed or marked as spam by moderators. Skipping edit.`);
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
  const maxEpisodes = await getConfiguredOrApiMaxEpisodes(episodeNumber);
  if (maxEpisodes !== null && episodeNumber >= maxEpisodes) {
    return 'N/A (Season Finished)';
  }
  const nextEpisodeNumber = episodeNumber + 1;
  const permalink = await findEpisodeDiscussionPostPermalink(subredditName, nextEpisodeNumber);
  if (!permalink) {
    return 'TBA after the next thread posts.';
  }
  return `[Episode ${nextEpisodeNumber} discussion](https://reddit.com${permalink})`;
}

export async function buildArchiveGrid(currentEpisodeNumber: number, subredditName: string): Promise<string> {
  const maxEpisodesRaw = (await getConfiguredOrApiMaxEpisodes(currentEpisodeNumber)) ?? 13;
  const maxEpisodes = Math.max(currentEpisodeNumber, maxEpisodesRaw);
  const episodeCells: string[] = [];

  for (let ep = 1; ep <= maxEpisodes; ep++) {
    if (ep > currentEpisodeNumber) {
      episodeCells.push(`${ep} (TBA)`);
      continue;
    }
    const manualUrl = await getManualEpisodePost(ep);
    if (manualUrl) {
      episodeCells.push(`[${ep}](${manualUrl})`);
    } else {
      const permalink = await findEpisodeDiscussionPostPermalink(subredditName, ep);
      if (permalink) {
        episodeCells.push(`[${ep}](https://reddit.com${permalink})`);
      } else {
        episodeCells.push(`${ep} (TBA)`);
      }
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
  // Clear in-memory caches when entering from non-cron entry points (e.g. /api/preview)
  // to prevent stale data from persisting across warm container reuses.
  // This is idempotent — clearInMemoryCaches() is safe to call multiple times.
  clearInMemoryCaches();

  const external = await getEpisodeMetadata(episodeNumber);
  const subredditName = await getSubredditName();

  const scheduledAiringDate = await computeAiringDateUtc(episodeNumber);

  return {
    episodeNumber,
    episodeTitle: external?.title ?? 'TBA',
    synopsis: external?.synopsis ?? 'TBA',
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
  const seriesTitle = getSeriesTitle();
  const template = getBodyTemplate();
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

export async function notifyDiscordError(episodeNumber: number | undefined, title: string, error: unknown) {
  const discordWebhook = await getDiscordWebhookUrl();
  if (!discordWebhook) return;

  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const payload: { episodeNumber?: number; error: Error } = { error: normalizedError };
  if (typeof episodeNumber === 'number') {
    payload.episodeNumber = episodeNumber;
  }

  await sendDiscordNotification(discordWebhook, 'error', title, payload);
}

async function notifyDiscordPostDeleted(
  episodeNumber: number,
  postTitle: string,
  storedPostId: string,
  isPastEpisode: boolean
) {
  const discordWebhook = await getDiscordWebhookUrl();
  if (!discordWebhook) return;

  const errorMsg = isPastEpisode
    ? `Past episode discussion post ID ${storedPostId} was deleted externally. Cleared Redis state for this episode; it will now display as TBA in grids.`
    : `Active episode discussion post ID ${storedPostId} was deleted externally. Cleared Redis state for this episode and initiated reposting.`;

  await sendDiscordNotification(discordWebhook, 'alert', postTitle, {
    episodeNumber,
    error: new Error(errorMsg),
  });
}

async function updateAllPastEpisodesGrid(currentEpisodeNumber: number, subredditName: string): Promise<void> {
  console.log(`[cron] Retroactively updating grids for episodes 1 to ${currentEpisodeNumber}`);
  for (let ep = 1; ep <= currentEpisodeNumber; ep++) {
    const manualUrl = await getManualEpisodePost(ep);
    if (manualUrl) {
      continue; // Skip editing manually created posts
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
          if (storedPost.removed || storedPost.spam) {
            console.log(`[cron] Retroactive grid update: Episode ${ep} post ${storedPost.id} is removed or marked as spam by moderators. Skipping.`);
            continue;
          }
          const payload = await buildEpisodePayload(ep);
          const updatedBody = await buildEpisodePostMarkdown(payload);
          if (storedPost.body.trim() !== updatedBody.trim()) {
            await storedPost.edit({ text: updatedBody });
            console.log(`[cron] Retroactively updated grid for episode ${ep}`);
          }
        }
      } catch (err) {
        console.error(`[cron] Failed to retroactively edit episode ${ep} post (likely deleted). Cleaning up Redis keys:`, err);
        try {
          const postTitle = await buildDiscussionTitle(ep);
          await notifyDiscordPostDeleted(ep, postTitle, finalPostId, true);
        } catch (discordErr) {
          console.error('[cron] Could not send Discord past post deleted notification:', discordErr);
        }
        await redis.del(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${ep}`);
        await redis.del(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${ep}`);
      }
    }
  }
}

function isFlairRelatedPostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /flair|template|invalid.*flair|unknown.*flair|flair.*not found/i.test(message);
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


async function verifyEpisodeIsAired(episodeNumber: number): Promise<boolean> {
  if (await isApiPlaytestModeEnabled()) {
    console.log('[cron] API playtest mode enabled; bypass release verification and return true.');
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

    // Check if AniList indicates the episode is in the future via nextAiringEpisode
    if (fromAniList?.airingAt && typeof fromAniList.airingAt === 'number') {
      const airingTime = fromAniList.airingAt > 10_000_000_000 ? fromAniList.airingAt : fromAniList.airingAt * 1000;
      if (airingTime > Date.now()) {
        console.log(
          `[cron] AniList reports episode ${String(episodeNumber)} airs in the future: ${new Date(airingTime).toISOString()}`
        );
        return false;
      }
    }

    // Check if Kitsu reports an airing date in the future
    if (fromKitsu?.airingAt && typeof fromKitsu.airingAt === 'number') {
      const kitsuAiringTime = fromKitsu.airingAt > 10_000_000_000 ? fromKitsu.airingAt : fromKitsu.airingAt * 1000;
      if (kitsuAiringTime > Date.now()) {
        console.log(
          `[cron] Kitsu reports episode ${String(episodeNumber)} airs in the future: ${new Date(kitsuAiringTime).toISOString()}`
        );
        return false;
      }
    }

    const anyApiOnline = jikan.online || aniList.online || kitsu.online;
    if (!anyApiOnline) {
      console.log('[cron] All metadata APIs are offline. Defaulting to true to avoid deleting thread during API outages.');
      return true;
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

  // Check if it is after 12:00 PM ET
  const nowMinutes = localTimeToMinutes(et.hour, et.minute);
  const checkMinutes = localTimeToMinutes(12, 0);
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

  console.log(`[cron] Performing release correction check for episode ${String(episodeNumber)} after 12:00 PM ET`);

  const aired = await verifyEpisodeIsAired(episodeNumber);
  if (aired) {
    await redis.set(`${REDIS_KEY_EPISODE_RELEASE_VERIFIED_PREFIX}${episodeNumber}`, 'true');
    console.log(`[cron] Episode ${String(episodeNumber)} successfully verified as aired.`);
    return;
  }

  console.log(`[cron] Episode ${String(episodeNumber)} is NOT live after 12:00 PM ET. Initiating auto-deletion...`);

  const postId = await redis.get(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`);
  if (!postId) {
    console.log(`[cron] No post ID found for episode ${String(episodeNumber)} during correction check. Likely already cleaned up.`);
    return;
  }
  let permalink = '';

  try {
    const post = await reddit.getPostById(postId as `t3_${string}`);
    permalink = post.permalink;
    await post.delete();
    console.log(`[cron] Deleted delayed episode discussion thread: postId=${postId}`);
  } catch (err) {
    console.error(`[cron] Failed to delete post ${postId}:`, err);
  }

  // Reset Redis keys so we can attempt to post it later/next time
  await redis.del(REDIS_KEY_LAST_POSTED_ET_DATE);
  await redis.set(REDIS_KEY_LAST_POSTED_EPISODE, String(episodeNumber - 1));
  await redis.del(`${REDIS_KEY_EPISODE_POST_ID_PREFIX}${episodeNumber}`);
  await redis.del(`${REDIS_KEY_EPISODE_POST_PERMALINK_PREFIX}${episodeNumber}`);

  // Set pending retry flag so the bot can attempt posting on non-posting weekdays
  await redis.set(REDIS_KEY_PENDING_RETRY_EPISODE, String(episodeNumber));
  console.log(`[cron] Set pending retry flag for episode ${String(episodeNumber)}`);

  try {
    const discordWebhook = await getDiscordWebhookUrl();
    if (discordWebhook) {
      const postTitle = await buildDiscussionTitle(episodeNumber);
      const discordDetails: { episodeNumber: number; postUrl?: string; error: Error } = {
        episodeNumber,
        error: new Error(
          `The episode did not appear on Kitsu/AniList/Jikan APIs by 12:00 PM ET. The discussion thread has been deleted and the scheduler state has been reset to allow reposting.`
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
  // Clear in-memory caches at the start of each invocation to prevent stale data
  // from persisting across warm container reuses in Devvit's serverless model
  clearInMemoryCaches();

  const force = options.force ?? false;
  const episodeNumberOverride = options.episodeNumberOverride;
  const now = new Date();

  try {


    const lastEpisode = await redis.get(REDIS_KEY_LAST_POSTED_EPISODE);
    const lastPostedNumber = lastEpisode ? Number(lastEpisode) : 0;
    
    let calculatedEpisode = lastPostedNumber + 1;
    while (await getManualEpisodePost(calculatedEpisode)) {
      console.log(`[cron] Auto-skipping manual post for Episode ${calculatedEpisode}`);
      calculatedEpisode++;
    }

    const episodeNumber =
      typeof episodeNumberOverride === 'number' && Number.isInteger(episodeNumberOverride) && episodeNumberOverride > 0
        ? episodeNumberOverride
        : calculatedEpisode;

    const apiPlaytestModeEnabled = await isApiPlaytestModeEnabled();
    let bypassWindow = apiPlaytestModeEnabled;

    // Check if there is a pending retry from a previously delayed episode for the CURRENT episode we are attempting to post.
    // If so, bypass the weekday-window gate to allow posting on any day.
    const pendingRetryEpisode = await redis.get(REDIS_KEY_PENDING_RETRY_EPISODE);
    if (pendingRetryEpisode === String(episodeNumber) && !bypassWindow) {
      console.log(`[cron] Pending retry detected for episode ${pendingRetryEpisode}. Bypassing weekday-window gate.`);
      bypassWindow = true;
    }

    console.log(
      `[cron] postCurrentEpisodeDiscussion start force=${String(force)} apiPlaytestMode=${String(apiPlaytestModeEnabled)} pendingRetry=${pendingRetryEpisode ?? 'none'} now=${now.toISOString()}`
    );

    if (!force && !bypassWindow && !(await isScheduledWindowNow(now))) {
      console.log('[cron] Skip: outside scheduled window.');
      return {
        posted: false,
        reason: 'outside-scheduled-window',
      };
    }

    const etDateKey = getEtDateKey(now);
    const alreadyPostedToday = await redis.get(REDIS_KEY_LAST_POSTED_ET_DATE);
    if (!force && !bypassWindow && alreadyPostedToday === etDateKey) {
      console.log(`[cron] Skip: already posted for ET date ${etDateKey}. Reconciling current post.`);
      const lastEpisode = await redis.get(REDIS_KEY_LAST_POSTED_EPISODE);
      if (lastEpisode) {
        try {
          await reconcileExistingEpisodeDiscussionPost(Number(lastEpisode));
        } catch (err) {
          console.error('[cron] Failed to reconcile existing post on duplicate check:', err);
        }
      }
      try {
        await performReleaseCorrectionCheck(now);
      } catch (err) {
        console.error('[cron] Self-correction check failed:', err);
      }
      return {
        posted: false,
        reason: 'already-posted-for-et-date',
        etDateKey,
      };
    }


    // Refuse to post if it is manual
    const manualUrl = await getManualEpisodePost(episodeNumber);
    if (manualUrl) {
      console.log(`[cron] Refusing to post: Episode ${episodeNumber} is registered as manually posted: ${manualUrl}`);
      // Clear pending retry flag if set — this episode won't be auto-posted
      try { await redis.del(REDIS_KEY_PENDING_RETRY_EPISODE); } catch { /* non-critical */ }
      return {
        posted: false,
        reason: 'episode-is-manually-posted',
        episodeNumber,
      };
    }

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

    // Airing date guard: verify the current date matches the expected airing date
    // This prevents the bot from posting just because it's the right weekday
    if (!force && !apiPlaytestModeEnabled) {
      const expectedAiringDate = await computeAiringDateUtc(episodeNumber);
      const expectedEtDate = getEtDateKey(expectedAiringDate);
      const currentEtDate = getEtDateKey(now);

      // Also check API-reported airing dates
      const metadata = await getEpisodeMetadata(episodeNumber);
      if (metadata?.airingAt && typeof metadata.airingAt === 'number') {
        const apiAiringTime = metadata.airingAt > 10_000_000_000 ? metadata.airingAt : metadata.airingAt * 1000;
        if (apiAiringTime > Date.now()) {
          const apiAiringDate = getEtDateKey(new Date(apiAiringTime));
          // String comparison is safe here: getEtDateKey returns YYYY-MM-DD format
          // where lexicographic ordering matches chronological ordering.
          if (currentEtDate < apiAiringDate) {
            console.log(
              `[cron] Skip: API reports episode ${String(episodeNumber)} airs on ${apiAiringDate} but today is ${currentEtDate}`
            );
            return {
              posted: false,
              reason: 'episode-airs-in-future',
              episodeNumber,
              expectedDate: apiAiringDate,
            };
          }
        }
      }

      // Computed schedule check: don't post before the computed airing date
      // String comparison is safe: YYYY-MM-DD format ensures lexicographic = chronological
      if (currentEtDate < expectedEtDate) {
        console.log(
          `[cron] Skip: computed airing date is ${expectedEtDate} but today is ${currentEtDate}`
        );
        return {
          posted: false,
          reason: 'before-airing-date',
          episodeNumber,
          expectedDate: expectedEtDate,
        };
      }
    }

    const et = getTimePartsInET(now);
    const nowMinutes = localTimeToMinutes(et.hour, et.minute);
    const checkMinutes = localTimeToMinutes(12, 0);
    
    // If we are bypassing the window (pending retry), we MUST verify it has aired, 
    // because we are off-schedule and don't know if the delay is over.
    // Otherwise, we only verify on the scheduled day if it's after 12:00 PM.
    const requiresAiringVerification = !force && !apiPlaytestModeEnabled && (bypassWindow || nowMinutes >= checkMinutes);

    if (requiresAiringVerification) {
      const aired = await verifyEpisodeIsAired(episodeNumber);
      if (!aired) {
        console.log(`[cron] Episode ${episodeNumber} has not aired yet. Skipping post creation.`);
        // Set pending retry so we keep trying on subsequent days
        await redis.set(REDIS_KEY_PENDING_RETRY_EPISODE, String(episodeNumber));
        return {
          posted: false,
          reason: 'episode-not-aired-yet',
          episodeNumber,
        };
      }
    }

    const maxEpisodes = await getConfiguredOrApiMaxEpisodes(episodeNumber);
    if (!force && maxEpisodes !== null && episodeNumber > maxEpisodes) {
      console.log(
        `[cron] Skip: season finished. episode=${String(episodeNumber)} maxEpisodes=${String(maxEpisodes)}`
      );
      // Clear pending retry flag if set — season is over, no more episodes to post
      try { await redis.del(REDIS_KEY_PENDING_RETRY_EPISODE); } catch { /* non-critical */ }
      return {
        posted: false,
        reason: 'season-finished',
        episodeNumber,
        maxEpisodes,
      };
    }


    console.log(
      `[cron] Episode state current=${String(episodeNumber)} lastPosted=${String(lastPostedNumber)}`
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

    // Clear pending retry flag if it was set (episode successfully posted)
    try {
      await redis.del(REDIS_KEY_PENDING_RETRY_EPISODE);
    } catch {
      // Non-critical: ignore if del fails
    }

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
  // Consume the request body (Devvit scheduler sends a JSON payload but we don't use it)
  await c.req.json().catch(() => {});
  const result = await postCurrentEpisodeDiscussion({ force: false });
  return c.json(result, 200);
});
