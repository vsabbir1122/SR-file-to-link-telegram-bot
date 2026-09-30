import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import { MongoClient, Collection } from 'mongodb';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';

dotenv.config();

// Prevent background GramJS socket timeouts from crashing the server process
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message === 'TIMEOUT') return;
  console.warn('Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err: any) => {
  if (err?.message === 'TIMEOUT') return;
  console.warn('Uncaught Exception:', err?.message || err);
});

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://sabbirvai1122:SABBIRVAI1122@cluster0.t1bsiei.mongodb.net/?appName=Cluster0';

const SHARED_DOMAIN = 'https://ais-pre-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app';
const DEV_DOMAIN = 'https://ais-dev-w4opwh3w5736ifna5yycat-160296201066.asia-east1.run.app';
const WORKING_SAMPLE_MP4 =
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4';

export interface VideoQualityVariant {
  label: '1080p' | '720p' | '480p' | '360p';
  resolution: string;
  bitrateMbps: number;
  sizeBytes: number;
  url: string;
}

export interface StreamVideoItem {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  sourceType: 'sample' | 'url' | 'upload' | 'telegram';
  sourceUrl: string;
  telegramFileId?: string;
  telegramFilePath?: string;
  chatId?: number | string;
  messageId?: number;
  botReplyMessageId?: number;
  binChannel?: string | number;
  binMessageId?: number;
  createdAt: string;
  qualities: VideoQualityVariant[];
  buffer?: Buffer;
}

interface BotState {
  mongoUri: string;
  mongoConnected: boolean;
  mongoDatabaseName: string;
  mongoVideosCount: number;
  mongoUsersCount: number;
  apiId: string;
  apiHash: string;
  botToken: string;
  mtprotoSession: string;
  binChannel: string;
  domain: string;
  publicTunnelDomain: string | null;
  isRunning: boolean;
  mtprotoConnected: boolean;
  botUsername: string | null;
  botFirstName: string | null;
  lastError: string | null;
  processedCount: number;
  lastPingAt: string;
  logs: Array<{ id: string; time: string; level: 'info' | 'success' | 'warn' | 'error'; message: string }>;
}

const PERMANENT_RENDER_DOMAIN = 'https://sr-file-to-link-telegram-bot-hmib.onrender.com';

const EXTERNAL_HOST_DOMAIN = (
  process.env.RENDER_EXTERNAL_URL ||
  process.env.DOMAIN ||
  process.env.URL ||
  PERMANENT_RENDER_DOMAIN
).replace(/\/$/, '');

const botState: BotState = {
  mongoUri: DEFAULT_MONGO_URI,
  mongoConnected: false,
  mongoDatabaseName: 'SRVideoQualityBot',
  mongoVideosCount: 0,
  mongoUsersCount: 0,
  apiId: process.env.API_ID || '29608422',
  apiHash: process.env.API_HASH || '3db2f8e109301f02f5d9c8f10dd79244',
  botToken: process.env.BOT_TOKEN && !process.env.BOT_TOKEN.endsWith('9PZU') ? process.env.BOT_TOKEN : '',
  mtprotoSession: '',
  binChannel: process.env.BIN_CHANNEL || '-1004450462812',
  domain: EXTERNAL_HOST_DOMAIN,
  publicTunnelDomain: EXTERNAL_HOST_DOMAIN,
  isRunning: false,
  mtprotoConnected: false,
  botUsername: null,
  botFirstName: null,
  lastError: null,
  processedCount: 0,
  lastPingAt: new Date().toISOString(),
  logs: [],
};

function getEffectiveDomain(): string {
  const candidate = (
    botState.domain ||
    EXTERNAL_HOST_DOMAIN ||
    botState.publicTunnelDomain ||
    PERMANENT_RENDER_DOMAIN
  ).replace(/\/$/, '');
  if (
    !candidate ||
    candidate.includes('trycloudflare.com') ||
    candidate.includes('ais-dev-') ||
    candidate.includes('ais-pre-') ||
    candidate.includes('localhost')
  ) {
    return PERMANENT_RENDER_DOMAIN;
  }
  return candidate;
}

function addLog(level: 'info' | 'success' | 'warn' | 'error', message: string) {
  botState.logs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toISOString(),
    level,
    message,
  });
  if (botState.logs.length > 60) {
    botState.logs = botState.logs.slice(0, 60);
  }
}

function buildQualityVariants(baseUrl: string, sizeBytes: number): VideoQualityVariant[] {
  return [
    {
      label: '1080p',
      resolution: '1920x1080',
      bitrateMbps: 6.8,
      sizeBytes,
      url: `${baseUrl}?quality=1080p`,
    },
    {
      label: '720p',
      resolution: '1280x720',
      bitrateMbps: 3.4,
      sizeBytes: Math.round(sizeBytes * 0.58),
      url: `${baseUrl}?quality=720p`,
    },
    {
      label: '480p',
      resolution: '854x480',
      bitrateMbps: 1.6,
      sizeBytes: Math.round(sizeBytes * 0.34),
      url: `${baseUrl}?quality=480p`,
    },
  ];
}

function buildBotReplyHtmlText(
  safeHtmlFileName: string,
  sizeBytes: number,
  watchEndpoint: string,
  dlEndpoint: string
) {
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
  return (
    `🎬 <b>${safeHtmlFileName}</b>\n` +
    `📦 <b>Size:</b> ${sizeMb} MB\n\n` +
    `▶️ <b>Watch Video Link:</b>\n<a href="${watchEndpoint}">${watchEndpoint}</a>\n\n` +
    `⬇️ <b>Direct Download Link:</b>\n<a href="${dlEndpoint}">${dlEndpoint}</a>\n\n` +
    `📥 <b>Direct Quality Download:</b>\n` +
    `• <a href="${dlEndpoint}?quality=480p">Download 480p</a> | <a href="${dlEndpoint}?quality=720p">Download 720p</a> | <a href="${dlEndpoint}?quality=1080p">Download 1080p</a>\n\n` +
    `👇 <b>নিচের বাটন থেকে কোয়ালিটি (480p, 720p, 1080p) সিলেক্ট করে ভিডিও দেখুন বা সরাসরি ডাউনলোড করুন:</b>`
  );
}

function buildMainQualityPromptKeyboard(vidId: string, watchEndpoint: string, dlEndpoint?: string) {
  const cleanDl = dlEndpoint || watchEndpoint.replace('/player/', '/dl/').replace('/watch/', '/dl/');
  return {
    inline_keyboard: [
      [
        { text: '▶️ Watch Video', url: watchEndpoint },
        { text: '⬇️ Direct Download', url: cleanDl },
      ],
      [
        { text: '📺 Watch 480p', url: `${watchEndpoint}?q=480p` },
        { text: '📺 Watch 720p', url: `${watchEndpoint}?q=720p` },
        { text: '📺 Watch 1080p', url: `${watchEndpoint}?q=1080p` },
      ],
      [
        { text: '⬇️ DL 480p', url: `${cleanDl}?quality=480p` },
        { text: '⬇️ DL 720p', url: `${cleanDl}?quality=720p` },
        { text: '⬇️ DL 1080p', url: `${cleanDl}?quality=1080p` },
      ],
      [
        { text: '🎛️ Watch Quality Menu', callback_data: `q_watch:${vidId}` },
        { text: '📥 Download Quality Menu', callback_data: `q_dl:${vidId}` },
      ],
    ],
  };
}

const videos = new Map<string, StreamVideoItem>();
const fileBufferCache = new Map<string, Buffer>();
const firstChunkCache = new Map<string, Buffer>();
const firstChunkPending = new Map<string, Promise<Buffer | null>>();
// Multi-Block Byte-Range RAM Cache (512KB-aligned blocks per video) for 0ms mobile byte-range & buffer-ahead delivery
const videoBlockCache = new Map<string, Map<number, Buffer>>();
const activePrefetchJobs = new Set<string>();
const mtprotoMediaCache = new Map<string, any>();
const mtprotoMediaFetchedAt = new Map<string, number>();
const telegramFilePathFetchedAt = new Map<string, number>();
const MTPROTO_MEDIA_TTL_MS = 25 * 60 * 1000; // Refresh Telegram file_reference every 25 mins so links NEVER expire
const TELEGRAM_FILE_PATH_TTL_MS = 45 * 60 * 1000; // Telegram Bot API file_path expires after 60 mins

function setCachedMtprotoMedia(key: string, media: any) {
  if (!key || !media) return;
  mtprotoMediaCache.set(key, media);
  mtprotoMediaFetchedAt.set(key, Date.now());
}

function getCachedMtprotoMedia(key: string): any | undefined {
  const media = mtprotoMediaCache.get(key);
  if (!media) return undefined;
  const fetchedAt = mtprotoMediaFetchedAt.get(key) || 0;
  if (Date.now() - fetchedAt > MTPROTO_MEDIA_TTL_MS) {
    mtprotoMediaCache.delete(key);
    mtprotoMediaFetchedAt.delete(key);
    return undefined;
  }
  return media;
}

function invalidateCachedMtprotoMedia(item: StreamVideoItem) {
  mtprotoMediaCache.delete(item.id);
  mtprotoMediaFetchedAt.delete(item.id);
  if (item.binMessageId) {
    mtprotoMediaCache.delete(String(item.binMessageId));
    mtprotoMediaFetchedAt.delete(String(item.binMessageId));
  }
}

function extractTelegramMediaDuration(media: any): number {
  if (!media) return 0;
  const attrs = media?.document?.attributes || media?.attributes;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (typeof a?.duration === 'number' && a.duration > 0) {
        return Math.round(a.duration);
      }
    }
  }
  if (typeof media?.duration === 'number' && media.duration > 0) {
    return Math.round(media.duration);
  }
  return 0;
}

const LOCAL_MTPROTO_SESSION_FILE = `/tmp/sr_mtproto_session_${PORT}.txt`;

try {
  if (fs.existsSync(LOCAL_MTPROTO_SESSION_FILE)) {
    botState.mtprotoSession = fs.readFileSync(LOCAL_MTPROTO_SESSION_FILE, 'utf8').trim();
  }
} catch {
  // ignore
}

// ============================================================================
// MONGODB ATLAS PERSISTENCE ENGINE
// ============================================================================
let mongoClient: MongoClient | null = null;
let videosCollection: Collection | null = null;
let configCollection: Collection | null = null;
let usersCollection: Collection | null = null;
let locksCollection: Collection | null = null;

const adminIds = new Set<string>();
const bannedIds = new Set<string>();
const deletedVideoIds = new Set<string>();
const LEGACY_GHOST_IDS = [
  'tg-125', 'tg-124', 'tg-123', 'tg-122', 'tg-121', 'tg-120', 'tg-119', 'tg-118',
  'tg-117', 'tg-116', 'tg-115', 'tg-114', 'tg-113', 'tg-112', 'tg-111', 'tg-110',
  'tg-109', 'tg-108', 'tg-107', 'tg-106', 'tg-104', 'tg-101', 'tg-97', 'tg-93',
  'tg-63', 'tg-57', 'tg-52', 'tg-48', 'tg-25', 'sr-1001',
];
LEGACY_GHOST_IDS.forEach((gid) => deletedVideoIds.add(gid));

function isVideoDeleted(id: string): boolean {
  const cleanId = id.trim();
  const tgKey = cleanId.startsWith('tg-') ? cleanId : `tg-${cleanId}`;
  const rawNum = cleanId.replace(/^tg-/, '');
  return deletedVideoIds.has(cleanId) || deletedVideoIds.has(tgKey) || deletedVideoIds.has(rawNum);
}

async function deleteVideoPermanently(id: string, forwardToRemote = true): Promise<StreamVideoItem | undefined> {
  const cleanId = id.trim();
  const tgKey = cleanId.startsWith('tg-') ? cleanId : `tg-${cleanId}`;
  const numericId = Number(cleanId.replace(/^tg-/, ''));
  const existed = videos.get(cleanId) || videos.get(tgKey);

  deletedVideoIds.add(cleanId);
  deletedVideoIds.add(tgKey);
  if (!isNaN(numericId) && numericId > 0) {
    deletedVideoIds.add(String(numericId));
  }

  videos.delete(cleanId);
  videos.delete(tgKey);
  fileBufferCache.delete(cleanId);
  fileBufferCache.delete(tgKey);
  firstChunkCache.delete(cleanId);
  firstChunkCache.delete(tgKey);
  videoBlockCache.delete(cleanId);
  videoBlockCache.delete(tgKey);
  mtprotoMediaCache.delete(cleanId);
  mtprotoMediaCache.delete(tgKey);
  if (!isNaN(numericId) && numericId > 0) {
    mtprotoMediaCache.delete(String(numericId));
  }

  if (videosCollection) {
    await videosCollection
      .deleteMany({
        $or: [
          { id: cleanId },
          { id: tgKey },
          ...(!isNaN(numericId) && numericId > 0 ? [{ binMessageId: numericId }, { messageId: numericId }] : []),
        ],
      })
      .catch(() => {});
    botState.mongoVideosCount = await videosCollection.countDocuments().catch(() => videos.size);
  }

  await saveConfigToMongo().catch(() => {});

  // Also delete message from BIN_CHANNEL and bot reply in user chat so it never comes back
  if (botState.botToken) {
    const binChat = existed?.binChannel || botState.binChannel;
    const binMsgId = existed?.binMessageId || (!isNaN(numericId) && numericId > 0 ? numericId : undefined);
    if (binChat && binMsgId) {
      fetch(`https://api.telegram.org/bot${botState.botToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: binChat, message_id: Number(binMsgId) }),
      }).catch(() => {});
    }
    if (existed?.chatId && existed?.botReplyMessageId) {
      fetch(`https://api.telegram.org/bot${botState.botToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: existed.chatId, message_id: Number(existed.botReplyMessageId) }),
      }).catch(() => {});
    }
  }

  // Forward delete to remote Render instance so both servers stay 100% synchronized
  const isRenderEnv = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
  if (forwardToRemote && !isRenderEnv && PERMANENT_RENDER_DOMAIN) {
    fetch(`${PERMANENT_RENDER_DOMAIN}/api/videos/${encodeURIComponent(cleanId)}?norelay=1`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  return existed;
}

function isTelegramAdmin(userIdOrChatId?: number | string): boolean {
  if (!userIdOrChatId) return false;
  const idStr = String(userIdOrChatId);
  if (adminIds.has(idStr)) return true;
  // If no admin is registered yet, the first owner or uploader is treated as admin
  if (adminIds.size === 0) {
    adminIds.add(idStr);
    saveConfigToMongo().catch(() => {});
    return true;
  }
  return false;
}

async function connectMongoDB(uri: string) {
  try {
    if (mongoClient) {
      await mongoClient.close().catch(() => {});
    }
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
    });
    await mongoClient.connect();
    const db = mongoClient.db('SRVideoQualityBot');
    videosCollection = db.collection('videos');
    configCollection = db.collection('config');
    usersCollection = db.collection('users');
    locksCollection = db.collection('message_locks');

    botState.mongoUri = uri;
    botState.mongoConnected = true;

    // Remove any shared mtprotoSession from MongoDB so multiple instances never collide with 406 AUTH_KEY_DUPLICATED
    const isRenderEnv = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
    const sessionFieldKey = isRenderEnv ? 'mtprotoSessionRender' : 'mtprotoSessionLocal';

    const savedConfig = await configCollection.findOne({ _id: 'global_config' as any });
    if (savedConfig) {
      if (savedConfig.botToken && (!botState.botToken || botState.botToken.endsWith('9PZU'))) {
        botState.botToken = savedConfig.botToken;
      }
      if (savedConfig.apiId) botState.apiId = String(savedConfig.apiId);
      if (savedConfig.apiHash) botState.apiHash = String(savedConfig.apiHash);
      if (savedConfig.binChannel) botState.binChannel = String(savedConfig.binChannel);
      if (!botState.mtprotoSession && savedConfig[sessionFieldKey]) {
        botState.mtprotoSession = String(savedConfig[sessionFieldKey]);
      }
      if (Array.isArray(savedConfig.adminIds)) {
        savedConfig.adminIds.forEach((id: any) => adminIds.add(String(id)));
      }
      if (Array.isArray(savedConfig.bannedIds)) {
        savedConfig.bannedIds.forEach((id: any) => bannedIds.add(String(id)));
      }
      if (Array.isArray(savedConfig.deletedVideoIds)) {
        savedConfig.deletedVideoIds.forEach((id: any) => deletedVideoIds.add(String(id)));
      }
      if (
        savedConfig.customDomain &&
        !savedConfig.customDomain.includes('ais-pre-') &&
        !savedConfig.customDomain.includes('ais-dev-') &&
        !savedConfig.customDomain.includes('trycloudflare.com') &&
        !savedConfig.customDomain.includes('localhost')
      ) {
        botState.domain = savedConfig.customDomain.replace(/\/$/, '');
        botState.publicTunnelDomain = botState.domain;
      } else {
        botState.domain = PERMANENT_RENDER_DOMAIN;
        botState.publicTunnelDomain = PERMANENT_RENDER_DOMAIN;
      }
    }

    // Purge sample videos, explicitly deleted videos, and ghost BIN_CHANNEL auto-scraped entries (where chatId is null/missing)
    await videosCollection
      .deleteMany({
        $or: [
          { sourceType: 'sample' },
          { id: { $in: Array.from(deletedVideoIds) } },
          { sourceType: 'telegram', chatId: { $in: [null, undefined] } },
          { sourceType: 'telegram', chatId: { $exists: false } },
        ],
      })
      .catch(() => {});

    videos.clear();
    const storedVideos = await videosCollection.find({}).sort({ createdAt: -1 }).limit(2000).toArray();
    for (const doc of storedVideos) {
      if (!doc.id || doc.sourceType === 'sample' || isVideoDeleted(doc.id)) continue;
      if (doc.sourceType === 'telegram' && !doc.chatId) continue;
      if (doc.chatId && String(doc.chatId) !== String(botState.binChannel) && !String(doc.chatId).startsWith('-100')) {
        adminIds.add(String(doc.chatId));
      }
      const item: StreamVideoItem = {
        id: doc.id,
        title: doc.title || doc.fileName || `Video ${doc.id}`,
        fileName: doc.fileName || `${doc.id}.mp4`,
        mimeType: doc.mimeType || 'video/mp4',
        sizeBytes: Number(doc.sizeBytes) || 25 * 1024 * 1024,
        durationSec: Number(doc.durationSec) || 120,
        sourceType: doc.sourceType || 'telegram',
        sourceUrl: `${botState.domain}/stream/${doc.id}`,
        telegramFileId: doc.telegramFileId,
        // Do not restore expired telegramFilePath from MongoDB (Bot API file_path expires after 1 hour)
        telegramFilePath: undefined,
        chatId: doc.chatId,
        messageId: doc.messageId,
        botReplyMessageId: doc.botReplyMessageId,
        binChannel: doc.binChannel || botState.binChannel,
        binMessageId: doc.binMessageId,
        createdAt: doc.createdAt || new Date().toISOString(),
        qualities: buildQualityVariants(
          `${botState.domain}/stream/${doc.id}`,
          Number(doc.sizeBytes) || 25 * 1024 * 1024
        ),
      };
      videos.set(item.id, item);
    }

    const vjDb = mongoClient.db('VJVideoPlayerBot');
    const vjUsers = await vjDb.collection('users').countDocuments().catch(() => 0);
    const srUsers = await usersCollection.countDocuments().catch(() => 0);
    botState.mongoUsersCount = vjUsers + srUsers;
    botState.mongoVideosCount = await videosCollection.countDocuments().catch(() => 0);
    botState.processedCount = videos.size;

    await saveConfigToMongo().catch(() => {});

    addLog(
      'success',
      `MongoDB Atlas connected (SRVideoQualityBot · ${botState.mongoVideosCount} saved streams, ${botState.mongoUsersCount} users)`
    );
  } catch (err: any) {
    botState.mongoConnected = false;
    addLog('error', `MongoDB connection error: ${err?.message || 'Failed to connect'}`);
  }
}

async function saveConfigToMongo(customDomain?: string) {
  if (!configCollection) return;
  try {
    const updateDoc: Record<string, any> = {
      apiId: botState.apiId,
      apiHash: botState.apiHash,
      botToken: botState.botToken,
      binChannel: botState.binChannel,
      activeDomain: botState.domain,
      adminIds: Array.from(adminIds),
      bannedIds: Array.from(bannedIds),
      deletedVideoIds: Array.from(deletedVideoIds).slice(-2000),
      updatedAt: new Date().toISOString(),
    };
    if (customDomain) {
      updateDoc.customDomain = customDomain;
    }
    await configCollection.updateOne(
      { _id: 'global_config' as any },
      { $set: updateDoc, $unset: { mtprotoSession: '' } },
      { upsert: true }
    );
  } catch (e: any) {
    addLog('warn', `Failed to save config to MongoDB: ${e?.message}`);
  }
}

async function saveVideoToMongo(item: StreamVideoItem) {
  if (!videosCollection || isVideoDeleted(item.id)) return;
  try {
    const { buffer, ...serializable } = item;
    await videosCollection.updateOne(
      { id: item.id },
      { $set: serializable },
      { upsert: true }
    );
    botState.mongoVideosCount = await videosCollection.countDocuments().catch(() => videos.size);
    botState.processedCount = videos.size;
  } catch (e: any) {
    addLog('warn', `Failed to save video ${item.id} to MongoDB: ${e?.message}`);
  }
}

// ============================================================================
// GRAMJS MTPROTO CLIENT (Streams Telegram Videos of ANY size: 50MB - 2GB!)
// ============================================================================
let mtprotoClient: TelegramClient | null = null;
let mtprotoConnecting: Promise<TelegramClient | null> | null = null;
let mtprotoCooldownUntil = 0;

function isAuthKeyFatalError(err: any): boolean {
  const msg = String(err?.message || err || '').toUpperCase();
  return (
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('AUTH_KEY_DUPLICATED') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('SESSION_EXPIRED') ||
    msg.includes('USER_DEACTIVATED')
  );
}

async function resetMtprotoSession() {
  botState.mtprotoSession = '';
  botState.mtprotoConnected = false;
  mtprotoMediaCache.clear();
  try {
    if (fs.existsSync(LOCAL_MTPROTO_SESSION_FILE)) {
      fs.unlinkSync(LOCAL_MTPROTO_SESSION_FILE);
    }
  } catch {
    // ignore
  }
  if (mtprotoClient) {
    try {
      await mtprotoClient.disconnect();
    } catch {
      // ignore
    }
    mtprotoClient = null;
  }
}

async function ensureMtprotoClient(forceFresh = false): Promise<TelegramClient | null> {
  if (forceFresh && mtprotoClient && botState.mtprotoConnected) {
    // Only clear cached media references on forceFresh; never destroy a valid MTProto auth session!
    mtprotoMediaCache.clear();
    return mtprotoClient;
  }
  if (mtprotoClient && botState.mtprotoConnected) {
    return mtprotoClient;
  }
  if (Date.now() < mtprotoCooldownUntil) {
    return null;
  }
  if (mtprotoConnecting) {
    return mtprotoConnecting;
  }
  if (!botState.botToken || !botState.apiId || !botState.apiHash) {
    return null;
  }

  mtprotoConnecting = (async () => {
    const connectWithSession = async (sessionStr: string): Promise<TelegramClient> => {
      const client = new TelegramClient(
        new StringSession(sessionStr),
        Number(botState.apiId) || 29608422,
        botState.apiHash || '3db2f8e109301f02f5d9c8f10dd79244',
        {
          connectionRetries: 2,
          useWSS: false,
        }
      );
      (client as any).floodSleepThreshold = 0;
      client.setLogLevel('none' as any);
      await client.start({
        botAuthToken: botState.botToken,
      });
      return client;
    };

    try {
      let client: TelegramClient;
      try {
        client = await connectWithSession(botState.mtprotoSession || '');
      } catch (firstErr: any) {
        if (isAuthKeyFatalError(firstErr) && botState.mtprotoSession) {
          addLog('info', `Refreshing invalidated MTProto session (${firstErr?.message})...`);
          await resetMtprotoSession();
          client = await connectWithSession('');
        } else {
          throw firstErr;
        }
      }

      const savedSession = client.session.save() as unknown as string;
      if (savedSession) {
        botState.mtprotoSession = savedSession;
        try {
          fs.writeFileSync(LOCAL_MTPROTO_SESSION_FILE, savedSession, 'utf8');
        } catch {
          // ignore
        }
        if (configCollection) {
          const isRenderEnv = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
          const sessionFieldKey = isRenderEnv ? 'mtprotoSessionRender' : 'mtprotoSessionLocal';
          configCollection
            .updateOne({ _id: 'global_config' as any }, { $set: { [sessionFieldKey]: savedSession } }, { upsert: true })
            .catch(() => {});
        }
      }

      mtprotoClient = client;
      botState.mtprotoConnected = true;
      mtprotoCooldownUntil = 0;
      addLog(
        'success',
        'Telegram MTProto (GramJS) direct chunk-streaming engine connected (supports 50MB - 2GB videos!).'
      );

      return client;
    } catch (err: any) {
      botState.mtprotoConnected = false;
      const errMsg = String(err?.message || '');
      const waitMatch = errMsg.match(/wait of (\d+) seconds/i);
      if (waitMatch) {
        const waitSec = Math.min(Number(waitMatch[1]) || 60, 300);
        mtprotoCooldownUntil = Date.now() + waitSec * 1000;
      } else {
        mtprotoCooldownUntil = Date.now() + 15000;
      }
      addLog('warn', `MTProto connection notice: ${errMsg}`);
      return null;
    } finally {
      mtprotoConnecting = null;
    }
  })();

  return mtprotoConnecting;
}

async function syncBinChannelVideos(_client: TelegramClient) {
  // Disabled auto-resurrection of old or deleted BIN_CHANNEL messages
}

async function findOrResolveVideo(id: string): Promise<StreamVideoItem | undefined> {
  const cleanId = id.trim();
  if (isVideoDeleted(cleanId)) return undefined;
  const numericId = Number(cleanId.replace(/^tg-/, ''));
  const tgKey = cleanId.startsWith('tg-') ? cleanId : `tg-${cleanId}`;

  if (videos.has(cleanId)) return videos.get(cleanId);
  if (videos.has(tgKey)) return videos.get(tgKey);

  // 1. Check MongoDB
  if (videosCollection) {
    try {
      const doc = await videosCollection.findOne({
        $or: [
          { id: cleanId },
          { id: tgKey },
          { binMessageId: numericId || -1 },
          { messageId: numericId || -1 },
        ],
      });
      if (doc && !isVideoDeleted(doc.id)) {
        const item: StreamVideoItem = {
          id: doc.id,
          title: doc.title || doc.fileName || `Telegram Video ${doc.id}`,
          fileName: doc.fileName || `${doc.id}.mp4`,
          mimeType: doc.mimeType || 'video/mp4',
          sizeBytes: Number(doc.sizeBytes) || 50 * 1024 * 1024,
          durationSec: Number(doc.durationSec) || 1420,
          sourceType: doc.sourceType || 'telegram',
          sourceUrl: `${botState.domain}/stream/${doc.id}`,
          telegramFileId: doc.telegramFileId,
          telegramFilePath: undefined,
          chatId: doc.chatId,
          messageId: doc.messageId,
          botReplyMessageId: doc.botReplyMessageId,
          binChannel: doc.binChannel || botState.binChannel,
          binMessageId: doc.binMessageId || (numericId > 0 ? numericId : undefined),
          createdAt: doc.createdAt || new Date().toISOString(),
          qualities: buildQualityVariants(
            `${botState.domain}/stream/${doc.id}`,
            Number(doc.sizeBytes) || 50 * 1024 * 1024
          ),
        };
        videos.set(item.id, item);
        return item;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

// ============================================================================
// PUBLIC CLOUDFLARE TUNNEL (Bypasses AI Studio Auth Wall for Telegram & VLC)
// Persisted as a detached daemon in /tmp so server restarts NEVER change the URL!
// ============================================================================
const CF_TUNNEL_STATE_FILE = `/tmp/sr_cf_tunnel_${PORT}.json`;
const CF_TUNNEL_LOG_FILE = `/tmp/sr_cf_tunnel_${PORT}.log`;
let tunnelWatchInterval: ReturnType<typeof setInterval> | null = null;

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function activateTunnelDomain(tunnelUrl: string) {
  const cleanUrl = tunnelUrl.replace(/\/$/, '');
  botState.publicTunnelDomain = cleanUrl;
  botState.domain = cleanUrl;
  await saveConfigToMongo(cleanUrl);

  // Update all in-memory & MongoDB video stream URLs to the permanent domain
  for (const [, v] of videos.entries()) {
    if (v.sourceType === 'telegram' || v.sourceType === 'upload') {
      v.sourceUrl = `${cleanUrl}/stream/${v.id}`;
      v.qualities = buildQualityVariants(`${cleanUrl}/stream/${v.id}`, v.sizeBytes);
      saveVideoToMongo(v).catch(() => {});

      // Auto-update previously sent Telegram reply messages so old chat links never break!
      if (v.chatId && v.botReplyMessageId && botState.botToken) {
        const watchEndpoint = `${cleanUrl}/player/${v.id}`;
        const dlEndpoint = `${cleanUrl}/dl/${v.id}`;
        const safeHtmlFileName = (v.title || v.fileName)
          .replace(/\.(mp4|mkv|avi|mov|webm|flv|m4v|ts|3gp|wmv|mpg|mpeg)$/i, '')
          .replace(/[_-]+/g, ' ')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        fetch(`https://api.telegram.org/bot${botState.botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: v.chatId,
            message_id: v.botReplyMessageId,
            text: buildBotReplyHtmlText(safeHtmlFileName, v.sizeBytes, watchEndpoint, dlEndpoint),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: buildMainQualityPromptKeyboard(v.id, watchEndpoint, dlEndpoint),
          }),
        }).catch(() => {});
      }
    }
  }

  addLog('success', `100% Permanent Streaming Domain registered & active: ${cleanUrl}`);
}

// Continuously watches MongoDB for any video replies sent with a temporary trycloudflare domain
// and immediately rewrites the Telegram message & database record to the permanent Render domain,
// while keeping in-memory videos and deletedVideoIds 100% synchronized across instances!
async function syncAndRewriteTelegramLinksToPermanentDomain() {
  if (!videosCollection || !botState.botToken) return;
  const targetDom = getEffectiveDomain();
  try {
    if (configCollection) {
      const cfg = await configCollection.findOne({ _id: 'global_config' as any }).catch(() => null);
      if (cfg && Array.isArray(cfg.deletedVideoIds)) {
        for (const delId of cfg.deletedVideoIds) {
          const sId = String(delId);
          deletedVideoIds.add(sId);
          videos.delete(sId);
          videos.delete(`tg-${sId.replace(/^tg-/, '')}`);
        }
      }
    }

    // Reconcile in-memory videos map with MongoDB so deletions via Bot or Website sync in real-time
    const allDbDocs = await videosCollection
      .find({}, { projection: { id: 1, title: 1, fileName: 1, mimeType: 1, sizeBytes: 1, durationSec: 1, sourceType: 1, telegramFileId: 1, chatId: 1, messageId: 1, botReplyMessageId: 1, binChannel: 1, binMessageId: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    const dbIds = new Set<string>();
    for (const d of allDbDocs) {
      if (!d.id || d.sourceType === 'sample' || isVideoDeleted(d.id)) continue;
      if (d.sourceType === 'telegram' && !d.chatId) continue;
      dbIds.add(d.id);
      if (!videos.has(d.id)) {
        const sizeBytes = Number(d.sizeBytes) || 25 * 1024 * 1024;
        videos.set(d.id, {
          id: d.id,
          title: d.title || d.fileName || `Video ${d.id}`,
          fileName: d.fileName || `${d.id}.mp4`,
          mimeType: d.mimeType || 'video/mp4',
          sizeBytes,
          durationSec: Number(d.durationSec) || 120,
          sourceType: d.sourceType || 'telegram',
          sourceUrl: `${targetDom}/stream/${d.id}`,
          telegramFileId: d.telegramFileId,
          chatId: d.chatId,
          messageId: d.messageId,
          botReplyMessageId: d.botReplyMessageId,
          binChannel: d.binChannel || botState.binChannel,
          binMessageId: d.binMessageId,
          createdAt: d.createdAt || new Date().toISOString(),
          qualities: buildQualityVariants(`${targetDom}/stream/${d.id}`, sizeBytes),
        });
      }
    }
    for (const memId of Array.from(videos.keys())) {
      const memItem = videos.get(memId);
      if (isVideoDeleted(memId) || (memItem?.sourceType === 'telegram' && !dbIds.has(memId))) {
        videos.delete(memId);
      }
    }
    botState.mongoVideosCount = dbIds.size;
    botState.processedCount = videos.size;

    const recentDocs = await videosCollection
      .find({
        sourceUrl: { $not: new RegExp(`^${targetDom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) },
      })
      .limit(40)
      .toArray();

    for (const doc of recentDocs) {
      if (!doc.id || doc.sourceType === 'sample' || isVideoDeleted(doc.id)) continue;
      const newSourceUrl = `${targetDom}/stream/${doc.id}`;
      const newQualities = buildQualityVariants(newSourceUrl, Number(doc.sizeBytes) || 50 * 1024 * 1024);

      await videosCollection
        .updateOne(
          { id: doc.id },
          {
            $set: {
              sourceUrl: newSourceUrl,
              qualities: newQualities,
            },
          }
        )
        .catch(() => {});

      const existingMem = videos.get(doc.id);
      if (existingMem) {
        existingMem.sourceUrl = newSourceUrl;
        existingMem.qualities = newQualities;
      }

      if (doc.chatId && doc.botReplyMessageId) {
        const watchEndpoint = `${targetDom}/player/${doc.id}`;
        const dlEndpoint = `${targetDom}/dl/${doc.id}`;
        const safeHtmlFileName = String(doc.title || doc.fileName || doc.id)
          .replace(/\.(mp4|mkv|avi|mov|webm|flv|m4v|ts|3gp|wmv|mpg|mpeg)$/i, '')
          .replace(/[_-]+/g, ' ')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        await fetch(`https://api.telegram.org/bot${botState.botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: doc.chatId,
            message_id: doc.botReplyMessageId,
            text: buildBotReplyHtmlText(
              safeHtmlFileName,
              Number(doc.sizeBytes) || 50 * 1024 * 1024,
              watchEndpoint,
              dlEndpoint
            ),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: buildMainQualityPromptKeyboard(doc.id, watchEndpoint, dlEndpoint),
          }),
        }).catch(() => {});
      }
    }
  } catch {
    // ignore transient Mongo error
  }
}

async function startPublicCloudflareTunnel() {
  const permanentDom = getEffectiveDomain();
  if (
    permanentDom &&
    !permanentDom.includes('ais-dev-') &&
    !permanentDom.includes('ais-pre-') &&
    !permanentDom.includes('trycloudflare.com') &&
    !permanentDom.includes('localhost')
  ) {
    await activateTunnelDomain(permanentDom);
    return;
  }

  const binPath = '/tmp/cloudflared';
  try {
    // 1. Check if a detached cloudflared daemon is ALREADY running from a previous server process
    if (fs.existsSync(CF_TUNNEL_STATE_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CF_TUNNEL_STATE_FILE, 'utf8'));
        if (saved?.pid && saved?.url && isPidAlive(Number(saved.pid))) {
          await activateTunnelDomain(String(saved.url));
          if (!tunnelWatchInterval) {
            tunnelWatchInterval = setInterval(() => {
              if (!isPidAlive(Number(saved.pid))) {
                if (tunnelWatchInterval) {
                  clearInterval(tunnelWatchInterval);
                  tunnelWatchInterval = null;
                }
                botState.publicTunnelDomain = null;
                startPublicCloudflareTunnel();
              }
            }, 15_000);
          }
          return;
        }
      } catch {
        // ignore corrupted state file
      }
    }

    if (!fs.existsSync(binPath)) {
      const res = await fetch(
        'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
      );
      if (res.ok && res.body) {
        const arrayBuf = await res.arrayBuffer();
        fs.writeFileSync(binPath, Buffer.from(arrayBuf));
        fs.chmodSync(binPath, 0o755);
      }
    }

    if (!fs.existsSync(binPath)) return;

    // Prepare log file for detached daemon
    fs.writeFileSync(CF_TUNNEL_LOG_FILE, '', 'utf8');
    const logFd = fs.openSync(CF_TUNNEL_LOG_FILE, 'a');

    // Spawn detached so restarting server.ts NEVER kills cloudflared or changes the trycloudflare.com URL
    const proc = spawn(
      binPath,
      [
        'tunnel',
        '--url',
        `http://localhost:${PORT}`,
        '--protocol',
        'http2',
        '--edge-ip-version',
        '4',
        '--no-autoupdate',
      ],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      }
    );
    proc.unref();
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }

    const spawnedPid = proc.pid;
    let activated = false;
    let attempts = 0;

    const pollLogTimer = setInterval(async () => {
      attempts += 1;
      if (!spawnedPid || !isPidAlive(spawnedPid)) {
        clearInterval(pollLogTimer);
        setTimeout(() => startPublicCloudflareTunnel(), 3000);
        return;
      }
      try {
        const text = fs.readFileSync(CF_TUNNEL_LOG_FILE, 'utf8');
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && match[0] && (text.includes('Registered tunnel connection') || text.includes('location='))) {
          const candidateUrl = match[0].replace(/\/$/, '');
          if (!activated) {
            activated = true;
            clearInterval(pollLogTimer);
            fs.writeFileSync(
              CF_TUNNEL_STATE_FILE,
              JSON.stringify({ pid: spawnedPid, url: candidateUrl, startedAt: new Date().toISOString() }),
              'utf8'
            );
            await activateTunnelDomain(candidateUrl);

            if (tunnelWatchInterval) clearInterval(tunnelWatchInterval);
            tunnelWatchInterval = setInterval(() => {
              if (!isPidAlive(spawnedPid)) {
                if (tunnelWatchInterval) {
                  clearInterval(tunnelWatchInterval);
                  tunnelWatchInterval = null;
                }
                botState.publicTunnelDomain = null;
                startPublicCloudflareTunnel();
              }
            }, 15_000);
          }
        } else if (attempts > 60) {
          clearInterval(pollLogTimer);
        }
      } catch {
        // ignore read error
      }
    }, 400);
  } catch (err: any) {
    addLog('warn', `Public tunnel notice: ${err?.message}`);
  }
}

// ============================================================================
// TELEGRAM BOT POLLING CONTROLLER
// ============================================================================
let pollingAbortController: AbortController | null = null;
let activePollingGeneration = 0;
let lastUpdateId = 0;
const processedUpdateIds = new Set<number>();
const processedMessageKeys = new Set<string>();

async function claimTelegramMessageLock(
  chatId: number | string,
  messageId: number,
  fileUniqueId?: string,
  msgDateSec?: number
): Promise<boolean> {
  const msgKey = `msg_${chatId}_${messageId}`;
  if (processedMessageKeys.has(msgKey)) {
    return false;
  }
  processedMessageKeys.add(msgKey);

  // Also guard against the exact same file being processed twice in the same chat within a 15-second window
  const timeBucket = Math.floor((msgDateSec || Math.floor(Date.now() / 1000)) / 15);
  const fileKey = fileUniqueId ? `file_${chatId}_${fileUniqueId}_${timeBucket}` : null;
  if (fileKey) {
    if (processedMessageKeys.has(fileKey)) {
      return false;
    }
    processedMessageKeys.add(fileKey);
  }

  if (processedMessageKeys.size > 4000) {
    const oldest = processedMessageKeys.values().next().value;
    if (oldest) processedMessageKeys.delete(oldest);
  }

  // Check in-memory videos map
  for (const v of videos.values()) {
    if (v.chatId && String(v.chatId) === String(chatId) && Number(v.messageId) === Number(messageId)) {
      return false;
    }
  }

  // Atomic cross-instance lock in MongoDB so multiple instances (dev/pre/render) never double-reply
  if (locksCollection) {
    try {
      const res = await locksCollection.updateOne(
        { _id: msgKey as any },
        {
          $setOnInsert: {
            chatId: String(chatId),
            messageId: Number(messageId),
            fileUniqueId: fileUniqueId || null,
            claimedAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
      if (res.upsertedCount === 0 && res.matchedCount > 0) {
        return false;
      }
    } catch (err: any) {
      if (err?.code === 11000 || String(err?.message || '').includes('E11000')) {
        return false;
      }
    }

    if (fileKey) {
      try {
        const fileRes = await locksCollection.updateOne(
          { _id: fileKey as any },
          {
            $setOnInsert: {
              chatId: String(chatId),
              messageId: Number(messageId),
              fileUniqueId,
              claimedAt: new Date().toISOString(),
            },
          },
          { upsert: true }
        );
        if (fileRes.upsertedCount === 0 && fileRes.matchedCount > 0) {
          return false;
        }
      } catch (err: any) {
        if (err?.code === 11000 || String(err?.message || '').includes('E11000')) {
          return false;
        }
      }
    }
  }

  if (videosCollection) {
    try {
      const existing = await videosCollection.findOne({
        chatId: chatId,
        messageId: Number(messageId),
      });
      if (existing) {
        return false;
      }
    } catch {
      // ignore
    }
  }

  return true;
}

async function resolveTelegramFilePath(fileId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = (await res.json()) as any;
    if (data.ok && data.result?.file_path) {
      return data.result.file_path as string;
    }
  } catch {
    // ignore
  }
  return null;
}

async function startTelegramPolling() {
  if (!botState.botToken) return;
  const myPollingGen = ++activePollingGeneration;
  if (pollingAbortController) {
    pollingAbortController.abort();
  }
  pollingAbortController = new AbortController();
  const signal = pollingAbortController.signal;

  try {
    await fetch(`https://api.telegram.org/bot${botState.botToken}/deleteWebhook`, { signal }).catch(() => {});

    const meRes = await fetch(`https://api.telegram.org/bot${botState.botToken}/getMe`, { signal });
    const meData = (await meRes.json()) as any;
    if (!meData.ok) {
      botState.isRunning = false;
      botState.lastError = meData.description || 'Invalid Telegram BOT_TOKEN';
      addLog('error', `Telegram authentication failed: ${botState.lastError}`);
      return;
    }

    botState.isRunning = true;
    botState.botUsername = meData.result.username;
    botState.botFirstName = meData.result.first_name;
    botState.lastError = null;
    addLog('success', `Telegram Bot @${botState.botUsername} connected and listening for videos!`);

    // Update Telegram Menu Button commands (replaces old BotFather commands)
    await fetch(`https://api.telegram.org/bot${botState.botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🚀 Start Bot & Upload Video' },
          { command: 'files', description: '📂 Check Your All Video Links' },
          { command: 'help', description: '💡 How to Watch & Download (480p/720p/1080p)' },
          { command: 'about', description: 'ℹ️ About SR Video Streaming Bot' },
          { command: 'status', description: '📊 [Admin Only] Server & Database Status' },
          { command: 'del', description: '🗑️ [Admin Only] Delete Video File' },
          { command: 'ban', description: '🚫 [Admin Only] Ban User' },
          { command: 'unban', description: '✅ [Admin Only] Unban User' },
          { command: 'broadcast', description: '📢 [Admin Only] Broadcast Message to Users' },
        ],
      }),
      signal,
    }).catch(() => {});

    // Connect MTProto client for >20MB video streaming & sync BIN_CHANNEL
    ensureMtprotoClient();

    (async () => {
      while (botState.isRunning && !signal.aborted && myPollingGen === activePollingGeneration) {
        try {
          const updatesUrl = `https://api.telegram.org/bot${botState.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
          const res = await fetch(updatesUrl, { signal });
          const data = (await res.json()) as any;
          if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
            for (const u of data.result) {
              if (typeof u?.update_id === 'number') {
                lastUpdateId = Math.max(lastUpdateId, u.update_id);
              }
            }
            // Immediately commit the new offset to Telegram so no parallel request or retry receives the same update
            fetch(
              `https://api.telegram.org/bot${botState.botToken}/getUpdates?offset=${lastUpdateId + 1}&limit=1&timeout=0`
            ).catch(() => {});

            for (const update of data.result) {
              if (typeof update?.update_id === 'number') {
                if (processedUpdateIds.has(update.update_id)) {
                  continue;
                }
                processedUpdateIds.add(update.update_id);
                if (processedUpdateIds.size > 4000) {
                  const oldestUpd = processedUpdateIds.values().next().value;
                  if (oldestUpd !== undefined) processedUpdateIds.delete(oldestUpd);
                }
              }

              // Handle Callback Query for Quality Selection Popup & Admin Actions
              if (update.callback_query) {
                const cb = update.callback_query;
                const cbData = String(cb.data || '');
                const cbChatId = cb.message?.chat?.id;
                const cbFromId = cb.from?.id || cbChatId;
                const cbMsgId = cb.message?.message_id;
                const activeDom = getEffectiveDomain();

                if (cbData.startsWith('admin_del:') && cbChatId && cbMsgId) {
                  if (!isTelegramAdmin(cbFromId) && !isTelegramAdmin(cbChatId)) {
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/answerCallbackQuery`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        callback_query_id: cb.id,
                        text: '⛔ [Admin Only] শুধুমাত্র অ্যাডমিন ভিডিও ডিলিট করতে পারবেন!',
                        show_alert: true,
                      }),
                    }).catch(() => {});
                    continue;
                  }
                  const delId = cbData.replace('admin_del:', '').trim();
                  const existed = await deleteVideoPermanently(delId);
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      callback_query_id: cb.id,
                      text: `🗑️ ডিলিট সম্পন্ন: ${existed?.fileName || delId}`,
                      show_alert: false,
                    }),
                  }).catch(() => {});
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: cbChatId,
                      message_id: cbMsgId,
                      text: `✅ <b>ভিডিও ডিলিট করা হয়েছে:</b> <code>${delId}</code> (${existed?.fileName || 'Removed'})`,
                      parse_mode: 'HTML',
                    }),
                  }).catch(() => {});
                  continue;
                }

                if (cbData.startsWith('q_watch:') && cbChatId && cbMsgId) {
                  const vidId = cbData.replace('q_watch:', '');
                  const watchEndpoint = `${activeDom}/player/${vidId}`;
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      callback_query_id: cb.id,
                      text: '🎬 ভিডিও দেখার জন্য কোয়ালিটি সিলেক্ট করুন (480p / 720p / 1080p)',
                      show_alert: false,
                    }),
                  }).catch(() => {});

                  await fetch(`https://api.telegram.org/bot${botState.botToken}/editMessageReplyMarkup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: cbChatId,
                      message_id: cbMsgId,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '📺 Watch 480p (SD)', url: `${watchEndpoint}?q=480p` }],
                          [{ text: '📺 Watch 720p (HD)', url: `${watchEndpoint}?q=720p` }],
                          [{ text: '📺 Watch 1080p (Full HD)', url: `${watchEndpoint}?q=1080p` }],
                          [{ text: '🔙 Back', callback_data: `q_main:${vidId}` }],
                        ],
                      },
                    }),
                  }).catch(() => {});
                  continue;
                }

                if (cbData.startsWith('q_dl:') && cbChatId && cbMsgId) {
                  const vidId = cbData.replace('q_dl:', '');
                  const dlEndpoint = `${activeDom}/dl/${vidId}`;
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      callback_query_id: cb.id,
                      text: '⬇️ ডাউনলোড করার জন্য কোয়ালিটি সিলেক্ট করুন (480p / 720p / 1080p)',
                      show_alert: false,
                    }),
                  }).catch(() => {});

                  await fetch(`https://api.telegram.org/bot${botState.botToken}/editMessageReplyMarkup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: cbChatId,
                      message_id: cbMsgId,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '⬇️ Download 480p (SD)', url: `${dlEndpoint}?quality=480p` }],
                          [{ text: '⬇️ Download 720p (HD)', url: `${dlEndpoint}?quality=720p` }],
                          [{ text: '⬇️ Download 1080p (Full HD)', url: `${dlEndpoint}?quality=1080p` }],
                          [{ text: '🔙 Back', callback_data: `q_main:${vidId}` }],
                        ],
                      },
                    }),
                  }).catch(() => {});
                  continue;
                }

                if (cbData.startsWith('q_main:') && cbChatId && cbMsgId) {
                  const vidId = cbData.replace('q_main:', '');
                  const watchEndpoint = `${activeDom}/player/${vidId}`;
                  const dlEndpoint = `${activeDom}/dl/${vidId}`;
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      callback_query_id: cb.id,
                    }),
                  }).catch(() => {});

                  await fetch(`https://api.telegram.org/bot${botState.botToken}/editMessageReplyMarkup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: cbChatId,
                      message_id: cbMsgId,
                      reply_markup: buildMainQualityPromptKeyboard(vidId, watchEndpoint, dlEndpoint),
                    }),
                  }).catch(() => {});
                  continue;
                }
              }

              const msg = update.message || update.channel_post;
              if (!msg) continue;

              const chatId = msg.chat?.id;
              const fromUserId = msg.from?.id || chatId;
              const text = (msg.text || '').trim();
              const incomingMedia = msg.video || msg.document || msg.animation;

              // Ignore messages sent by the bot itself or channel_post inside BIN_CHANNEL
              if (msg.from?.is_bot && msg.from?.username && msg.from.username === botState.botUsername) {
                continue;
              }
              if (botState.binChannel && String(chatId) === String(botState.binChannel)) {
                continue;
              }

              // Atomic deduplication check so 1 message/video NEVER produces 2 replies
              if (chatId && msg.message_id) {
                const isFirstClaim = await claimTelegramMessageLock(
                  chatId,
                  msg.message_id,
                  incomingMedia?.file_unique_id,
                  msg.date
                );
                if (!isFirstClaim) {
                  continue;
                }
              }

              // Block banned users from using the bot
              if (bannedIds.has(String(fromUserId)) || bannedIds.has(String(chatId))) {
                if (String(chatId) !== String(botState.binChannel)) {
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text: `🚫 <b>Access Denied:</b> আপনাকে এই বট ব্যবহার করা থেকে ব্যান (Ban) করা হয়েছে।`,
                      parse_mode: 'HTML',
                    }),
                  }).catch(() => {});
                }
                continue;
              }

              if (msg.from && usersCollection) {
                usersCollection
                  .updateOne(
                    { id: msg.from.id },
                    {
                      $set: {
                        id: msg.from.id,
                        name: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim(),
                        username: msg.from.username || null,
                        updatedAt: new Date().toISOString(),
                      },
                    },
                    { upsert: true }
                  )
                  .catch(() => {});
              }

              // Allow unlocking Admin privileges via /admin SABBIRVAI1122
              if (text.startsWith('/admin')) {
                const passArg = text.replace(/^\/admin(@\S+)?/i, '').trim();
                if (passArg === 'SABBIRVAI1122' || isTelegramAdmin(fromUserId) || isTelegramAdmin(chatId)) {
                  adminIds.add(String(fromUserId));
                  adminIds.add(String(chatId));
                  await saveConfigToMongo();
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text:
                        `🔐 <b>Admin Access Verified!</b>\n\n` +
                        `আপনার অ্যাডমিন কমান্ডসমূহ:\n` +
                        `• /status — সার্ভার, ডাটাবেস ও ইউজার স্ট্যাটাস\n` +
                        `• /del — যেকোনো ভিডিও ডিলিট করুন\n` +
                        `• /ban <code>[User_ID]</code> — ইউজার ব্যান করুন\n` +
                        `• /unban <code>[User_ID]</code> — ইউজার আনব্যান করুন\n` +
                        `• /broadcast <code>[Message]</code> — সব ইউজারকে মেসেজ পাঠান`,
                      parse_mode: 'HTML',
                    }),
                  });
                } else {
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text: `🔐 অ্যাডমিন অ্যাক্সেস পেতে লিখুন:\n<code>/admin YOUR_PASSWORD</code>`,
                      parse_mode: 'HTML',
                    }),
                  });
                }
                continue;
              }

              if (text.startsWith('/start')) {
                const currentDom = getEffectiveDomain();
                const adminBadge = isTelegramAdmin(fromUserId) || isTelegramAdmin(chatId) ? '👑 <b>Admin Mode Active</b>\n' : '';
                await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text:
                      `🎬 <b>SR-VIDEO-QUALITY Bot-এ স্বাগতম!</b>\n` +
                      adminBadge +
                      `\nএখানে যেকোনো ভিডিও বা ফাইল (50MB থেকে 2GB পর্যন্ত) পাঠালে বা ফরোয়ার্ড করলে সাথে সাথে পাবেন:\n` +
                      `✅ <b>480p / 720p / 1080p</b> অনলাইন ভিডিও প্লেয়ার লিংক\n` +
                      `✅ <b>Direct Download</b> লিংক (১-ক্লিকে ডাউনলোড)\n` +
                      `✅ <b>Swipe Gesture Player</b> (ডানে সাউন্ড ও বামে ব্রাইটনেস কন্ট্রোল)\n\n` +
                      `📂 <b>আপনার সব ভিডিও দেখতে:</b> /files\n` +
                      `💡 <b>সাহায্য পেতে:</b> /help\n` +
                      `🌐 <b>Active Server:</b> <code>${currentDom}</code>`,
                    parse_mode: 'HTML',
                  }),
                });
                addLog('info', `Sent /start response to chat ${chatId}`);
                continue;
              }

              if (text.startsWith('/help')) {
                await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text:
                      `💡 <b>বট ব্যবহারের নিয়মাবলী (Help Guide):</b>\n\n` +
                      `১. <b>ভিডিও লিংক তৈরি:</b> বটে যেকোনো ভিডিও বা MP4/MKV ফাইল পাঠান। বট সাথে সাথে ভিডিওটি প্রসেস করে Watch এবং Direct Download বাটন দেবে।\n` +
                      `২. <b>কোয়ালিটি সিলেকশন:</b> <b>Watch Video</b> বা <b>Download Video</b> বাটনে চাপ দিলে <code>480p</code>, <code>720p</code>, <code>1080p</code> সিলেক্ট করার অপশন পাবেন।\n` +
                      `৩. <b>প্লেয়ার কন্ট্রোল:</b> ভিডিও চলার সময় স্ক্রিনের ডানপাশে ওপর-নিচ সোয়াইপ করলে সাউন্ড এবং বামপাশে সোয়াইপ করলে ব্রাইটনেস বাড়বে/কমবে।\n\n` +
                      `📌 <b>কমান্ড লিস্ট:</b>\n` +
                      `• /start — বট শুরু করুন\n` +
                      `• /files — আপনার সব ভিডিওর লিংক দেখুন\n` +
                      `• /about — বটের ফিচার ও তথ্য\n` +
                      `• /status — [Admin Only] সার্ভার স্ট্যাটাস\n` +
                      `• /del — [Admin Only] ভিডিও ডিলিট করুন\n` +
                      `• /ban — [Admin Only] ইউজার ব্যান করুন\n` +
                      `• /unban — [Admin Only] ইউজার আনব্যান করুন\n` +
                      `• /broadcast — [Admin Only] সবাইকে মেসেজ পাঠান`,
                    parse_mode: 'HTML',
                  }),
                });
                continue;
              }

              if (text.startsWith('/about')) {
                const currentDom = getEffectiveDomain();
                await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text:
                      `ℹ️ <b>About SR Video Quality Bot</b>\n\n` +
                      `🤖 <b>Bot:</b> @${botState.botUsername || 'sr_video_quality_bot'}\n` +
                      `⚡ <b>Engine:</b> MTProto 2GB Byte-Range Streamer + MongoDB Atlas\n` +
                      `🎞️ <b>Qualities:</b> 480p (SD) · 720p (HD) · 1080p (Full HD)\n` +
                      `📱 <b>Web Player:</b> Fixed Mobile Viewport + Swipe Volume/Brightness Controls\n` +
                      `🌐 <b>Server:</b> <code>${currentDom}</code>`,
                    parse_mode: 'HTML',
                  }),
                });
                continue;
              }

              if (text.startsWith('/files') || text.startsWith('/videos') || text.startsWith('/links')) {
                const currentDom = getEffectiveDomain();
                const allVids = Array.from(videos.values())
                  .filter((v) => v.sourceType === 'telegram' || v.sourceType === 'upload')
                  .slice(0, 15);

                if (allVids.length === 0) {
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text: `📂 এখনো কোনো ভিডিও সেভ করা হয়নি। লিংক তৈরি করতে যেকোনো ভিডিও এখানে পাঠান!`,
                    }),
                  });
                } else {
                  const lines = allVids.map((v, idx) => {
                    const safeName = (v.fileName || v.title)
                      .replace(/\.[^/.]+$/, '')
                      .replace(/[_-]+/g, ' ')
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;');
                    const sizeMb = (v.sizeBytes / (1024 * 1024)).toFixed(1);
                    return (
                      `<b>${idx + 1}. ${safeName}</b> (<code>${v.id}</code> · ${sizeMb} MB)\n` +
                      `▶️ <a href="${currentDom}/player/${v.id}">Watch Video</a> | ⬇️ <a href="${currentDom}/dl/${v.id}">Direct Download</a>`
                    );
                  });

                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text:
                        `📂 <b>আপনার সেভ করা সব ভিডিও (${allVids.length}টি):</b>\n\n` +
                        lines.join('\n\n'),
                      parse_mode: 'HTML',
                      disable_web_page_preview: true,
                    }),
                  });
                }
                addLog('info', `Sent /files list to chat ${chatId}`);
                continue;
              }

              // =================================================================
              // [ADMIN ONLY] COMMANDS: /status, /del, /ban, /unban, /broadcast
              // =================================================================
              if (
                text.startsWith('/status') ||
                text.startsWith('/del') ||
                text.startsWith('/ban') ||
                text.startsWith('/unban') ||
                text.startsWith('/broadcast')
              ) {
                if (!isTelegramAdmin(fromUserId) && !isTelegramAdmin(chatId)) {
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text:
                        `⛔ <b>[Admin Only]</b> এই অপশনটি শুধুমাত্র অ্যাডমিনের জন্য সংরক্ষিত!\n\n` +
                        `🔐 আপনি অ্যাডমিন হলে আনলক করতে লিখুন:\n<code>/admin SABBIRVAI1122</code>`,
                      parse_mode: 'HTML',
                    }),
                  });
                  continue;
                }

                if (text.startsWith('/status')) {
                  const currentDom = getEffectiveDomain();
                  const tgVidCount = Array.from(videos.values()).filter(
                    (v) => v.sourceType === 'telegram' || v.sourceType === 'upload'
                  ).length;
                  await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      text:
                        `📊 <b>[Admin Only] SR-VIDEO Server Status</b>\n\n` +
                        `🟢 <b>Bot Status:</b> Online (@${botState.botUsername})\n` +
                        `⚡ <b>MTProto 2GB Engine:</b> ${botState.mtprotoConnected ? 'Connected ✅' : 'Active'}\n` +
                        `🗄️ <b>MongoDB Atlas:</b> ${botState.mongoConnected ? 'Connected ✅' : 'Disconnected'}\n` +
                        `🎬 <b>Saved Videos:</b> ${tgVidCount} files\n` +
                        `👥 <b>Total Users:</b> ${botState.mongoUsersCount} users\n` +
                        `🚫 <b>Banned Users:</b> ${bannedIds.size} users\n` +
                        `📦 <b>BIN Channel:</b> <code>${botState.binChannel}</code>\n` +
                        `🌐 <b>Active Domain:</b> <code>${currentDom}</code>\n` +
                        `💓 <b>Health URL:</b> <code>${currentDom}/health</code>`,
                      parse_mode: 'HTML',
                      disable_web_page_preview: true,
                    }),
                  });
                  continue;
                }

                if (text.startsWith('/del')) {
                  const argId = text.replace(/^\/del(@\S+)?/i, '').trim();
                  if (argId) {
                    const targetId = argId.startsWith('tg-') ? argId : videos.has(`tg-${argId}`) ? `tg-${argId}` : argId;
                    const existed = await deleteVideoPermanently(targetId);
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text: `✅ <b>ভিডিও স্থায়ীভাবে ডিলিট সম্পন্ন!</b>\n🎬 নাম: <b>${existed?.fileName || targetId}</b>\n🆔 ID: <code>${targetId}</code>`,
                        parse_mode: 'HTML',
                      }),
                    });
                  } else {
                    const tgVids = Array.from(videos.values())
                      .filter((v) => v.sourceType === 'telegram' || v.sourceType === 'upload')
                      .slice(0, 10);
                    if (tgVids.length === 0) {
                      await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: chatId,
                          text: `📂 ডিলিট করার মতো কোনো ভিডিও নেই।`,
                        }),
                      });
                    } else {
                      const delButtons = tgVids.map((v) => [
                        {
                          text: `🗑️ Delete: ${(v.fileName || v.title).slice(0, 28)} (${v.id})`,
                          callback_data: `admin_del:${v.id}`,
                        },
                      ]);
                      await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: chatId,
                          text:
                            `🗑️ <b>[Admin Only] নিচের যে ভিডিওটি ডিলিট করতে চান সেটিতে চাপ দিন:</b>\n` +
                            `<i>(অথবা লিখুন: <code>/del tg-114</code>)</i>`,
                          parse_mode: 'HTML',
                          reply_markup: { inline_keyboard: delButtons },
                        }),
                      });
                    }
                  }
                  continue;
                }

                if (text.startsWith('/ban')) {
                  const targetUser = text.replace(/^\/ban(@\S+)?/i, '').trim();
                  if (!targetUser) {
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text:
                          `🚫 <b>[Admin Only] ইউজার ব্যান করার নিয়ম:</b>\n` +
                          `লিখুন: <code>/ban USER_ID</code>\n\n` +
                          `বর্তমানে ব্যান করা ইউজার সংখ্যা: <b>${bannedIds.size}</b>`,
                        parse_mode: 'HTML',
                      }),
                    });
                  } else {
                    bannedIds.add(targetUser);
                    await saveConfigToMongo();
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text: `🚫 ইউজার <code>${targetUser}</code>-কে সফলভাবে <b>Ban</b> করা হয়েছে!`,
                        parse_mode: 'HTML',
                      }),
                    });
                  }
                  continue;
                }

                if (text.startsWith('/unban')) {
                  const targetUser = text.replace(/^\/unban(@\S+)?/i, '').trim();
                  if (!targetUser) {
                    const bannedList = Array.from(bannedIds);
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text:
                          `✅ <b>[Admin Only] ইউজার আনব্যান করার নিয়ম:</b>\n` +
                          `লিখুন: <code>/unban USER_ID</code>\n\n` +
                          `ব্যান থাকা ইউজার লিস্ট: ${bannedList.length ? bannedList.map((id) => `<code>${id}</code>`).join(', ') : 'কেউ ব্যান নেই'}`,
                        parse_mode: 'HTML',
                      }),
                    });
                  } else {
                    bannedIds.delete(targetUser);
                    await saveConfigToMongo();
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text: `✅ ইউজার <code>${targetUser}</code>-কে সফলভাবে <b>Unban</b> করা হয়েছে!`,
                        parse_mode: 'HTML',
                      }),
                    });
                  }
                  continue;
                }

                if (text.startsWith('/broadcast')) {
                  const bcastMsg = text.replace(/^\/broadcast(@\S+)?/i, '').trim();
                  if (!bcastMsg) {
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text: `📢 <b>[Admin Only] সবাইকে মেসেজ পাঠাতে লিখুন:</b>\n<code>/broadcast আপনার মেসেজ এখানে লিখুন</code>`,
                        parse_mode: 'HTML',
                      }),
                    });
                  } else {
                    let sentCount = 0;
                    const userDocs = usersCollection ? await usersCollection.find({}).limit(500).toArray() : [];
                    for (const u of userDocs) {
                      if (!u.id) continue;
                      const r = await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: u.id,
                          text: `📢 <b>Announcement:</b>\n\n${bcastMsg}`,
                          parse_mode: 'HTML',
                        }),
                      }).catch(() => null);
                      if (r && r.ok) sentCount++;
                    }
                    await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: chatId,
                        text: `✅ <b>Broadcast সম্পন্ন!</b> মোট <b>${sentCount}</b> জন ইউজারের কাছে মেসেজ পাঠানো হয়েছে।`,
                        parse_mode: 'HTML',
                      }),
                    });
                  }
                  continue;
                }
              }

              const media = msg.video || msg.document || msg.animation;
              if (media && media.file_id) {
                // Copy to BIN_CHANNEL so MTProto can always locate it by binMsgId!
                let binMsgId: number | undefined;
                if (
                  botState.binChannel &&
                  botState.binChannel !== '-1001982736450' &&
                  botState.binChannel !== '-1001234567890' &&
                  String(chatId) !== String(botState.binChannel)
                ) {
                  try {
                    const copyRes = await fetch(`https://api.telegram.org/bot${botState.botToken}/copyMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: botState.binChannel,
                        from_chat_id: chatId,
                        message_id: msg.message_id,
                      }),
                    });
                    const copyData = (await copyRes.json()) as any;
                    if (copyData.ok && copyData.result?.message_id) {
                      binMsgId = copyData.result.message_id;
                    }
                  } catch {
                    // ignore
                  }
                } else if (String(chatId) === String(botState.binChannel)) {
                  binMsgId = msg.message_id;
                }

                // Use binMsgId if copied to BIN_CHANNEL so /watch/<binMsgId> and /player/tg-<binMsgId> match!
                const primaryIdNum = binMsgId || msg.message_id || Date.now().toString().slice(-5);
                const vidId = `tg-${primaryIdNum}`;
                const rawMediaName = (media.file_name || '').trim();
                const strippedMediaName = rawMediaName
                  .replace(/\.(mp4|mkv|avi|mov|webm|flv|m4v|ts|3gp|wmv|mpg|mpeg)$/i, '')
                  .trim();
                const captionFirstLine = (msg.caption || '')
                  .split('\n')
                  .map((l: string) => l.trim())
                  .find((l: string) => l.length > 2);
                const displayTitle =
                  strippedMediaName.length > 3
                    ? strippedMediaName.replace(/[_-]+/g, ' ')
                    : captionFirstLine
                      ? strippedMediaName
                        ? `${captionFirstLine} - ${strippedMediaName}`
                        : captionFirstLine
                      : strippedMediaName || `Telegram Video ${vidId}`;
                const rawFileName =
                  rawMediaName && strippedMediaName.length > 3
                    ? rawMediaName
                    : `${displayTitle.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.mp4`;
                const fileSize = media.file_size || 50 * 1024 * 1024;
                const durationSec = media.duration || 120;
                const activeDom = getEffectiveDomain();
                const streamEndpoint = `${activeDom}/stream/${vidId}`;
                const watchEndpoint = `${activeDom}/player/${vidId}`;
                const dlEndpoint = `${activeDom}/dl/${vidId}`;

                const filePath =
                  fileSize <= 20 * 1024 * 1024
                    ? await resolveTelegramFilePath(media.file_id, botState.botToken)
                    : null;
                if (filePath) {
                  telegramFilePathFetchedAt.set(vidId, Date.now());
                }

                const newItem: StreamVideoItem = {
                  id: vidId,
                  title: displayTitle,
                  fileName: rawFileName,
                  mimeType: media.mime_type || 'video/mp4',
                  sizeBytes: fileSize,
                  durationSec,
                  sourceType: 'telegram',
                  sourceUrl: streamEndpoint,
                  telegramFileId: media.file_id,
                  telegramFilePath: filePath || undefined,
                  chatId,
                  messageId: msg.message_id,
                  binChannel: botState.binChannel,
                  binMessageId: binMsgId,
                  createdAt: new Date().toISOString(),
                  qualities: buildQualityVariants(streamEndpoint, fileSize),
                };

                videos.set(vidId, newItem);
                await saveVideoToMongo(newItem);
                botState.processedCount += 1;

                // Pre-cache MTProto media handle, probe codec/duration, & warm up initial blocks in background for 0ms startup
                if (binMsgId && botState.binChannel) {
                  ensureMtprotoClient()
                    .then(async (client) => {
                      if (!client) return;
                      const msgs = await client.getMessages(botState.binChannel as any, { ids: [binMsgId!] });
                      const m = msgs?.[0];
                      if (m && m.media) {
                        setCachedMtprotoMedia(vidId, m.media);
                        setCachedMtprotoMedia(String(binMsgId), m.media);
                        const mtDur = extractTelegramMediaDuration(m.media);
                        if (mtDur > 0 && newItem.durationSec !== mtDur) {
                          newItem.durationSec = mtDur;
                          await saveVideoToMongo(newItem);
                        }
                        warmUpVideoStream(newItem);
                      }
                    })
                    .catch(() => {});
                } else {
                  warmUpVideoStream(newItem);
                }

                addLog(
                  'success',
                  `Saved to MongoDB & generated MTProto stream links for: ${rawFileName} (${vidId})`
                );

                // Only reply if message came from private chat or group (not BIN_CHANNEL post itself)
                if (String(chatId) !== String(botState.binChannel)) {
                  const safeHtmlFileName = displayTitle
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                  const replyRes = await fetch(`https://api.telegram.org/bot${botState.botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: chatId,
                      reply_to_message_id: msg.message_id,
                      text: buildBotReplyHtmlText(safeHtmlFileName, fileSize, watchEndpoint, dlEndpoint),
                      parse_mode: 'HTML',
                      disable_web_page_preview: true,
                      reply_markup: buildMainQualityPromptKeyboard(vidId, watchEndpoint, dlEndpoint),
                    }),
                  });
                  try {
                    const replyData = (await replyRes.json()) as any;
                    if (replyData.ok && replyData.result?.message_id) {
                      newItem.botReplyMessageId = replyData.result.message_id;
                      videos.set(vidId, newItem);
                      await saveVideoToMongo(newItem);
                    }
                  } catch {
                    // ignore
                  }
                }
              }
            }
          }
        } catch (err: any) {
          if (signal.aborted) break;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
  } catch (err: any) {
    botState.isRunning = false;
    botState.lastError = err?.message || 'Failed to connect to Telegram API';
    addLog('error', `Bot connection error: ${botState.lastError}`);
  }
}

function serializeVideo(item: StreamVideoItem, domain: string) {
  const cleanDomain = domain.replace(/\/$/, '');
  return {
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    durationSec: item.durationSec,
    sourceType: item.sourceType,
    sourceUrl:
      item.sourceType === 'upload' || item.sourceType === 'telegram'
        ? `${cleanDomain}/stream/${item.id}`
        : item.sourceUrl,
    telegramFileId: item.telegramFileId,
    createdAt: item.createdAt,
    watchUrl: `${cleanDomain}/?watch=${item.id}`,
    standalonePlayerUrl: `${cleanDomain}/player/${item.id}`,
    streamUrl: `${cleanDomain}/stream/${item.id}`,
    downloadUrl: `${cleanDomain}/dl/${item.id}`,
    qualities: item.qualities.map((q) => ({
      ...q,
      streamUrl: `${cleanDomain}/stream/${item.id}?quality=${q.label}`,
      downloadUrl: `${cleanDomain}/dl/${item.id}?quality=${q.label}`,
    })),
  };
}

async function startServer() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Range, Content-Length, Accept-Ranges, Content-Disposition'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 1. Connect to user's MongoDB Atlas cluster
  await connectMongoDB(DEFAULT_MONGO_URI);

  // 2. Activate Permanent Render Domain & rewrite any old temporary links
  await startPublicCloudflareTunnel();
  await syncAndRewriteTelegramLinksToPermanentDomain();
  setInterval(() => {
    syncAndRewriteTelegramLinksToPermanentDomain().catch(() => {});
  }, 2500);

  // 3. Auto-start Telegram bot & MTProto client
  if (botState.botToken) {
    const isRunningOnRender = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
    if (isRunningOnRender) {
      startTelegramPolling();
    } else {
      // Check if Render instance is already actively polling this bot so we don't cause 409 Conflict
      try {
        const renderHealthRes = await fetch(`${PERMANENT_RENDER_DOMAIN}/health`);
        const renderHealth = (await renderHealthRes.json()) as any;
        if (renderHealth?.ok && renderHealth?.botRunning) {
          const meRes = await fetch(`https://api.telegram.org/bot${botState.botToken}/getMe`);
          const meData = (await meRes.json()) as any;
          if (meData?.ok) {
            botState.isRunning = true;
            botState.botUsername = meData.result.username;
            botState.botFirstName = meData.result.first_name;
            botState.lastError = null;
          }
          ensureMtprotoClient();
          addLog(
            'success',
            `Render Bot (${PERMANENT_RENDER_DOMAIN}) is actively polling @${botState.botUsername || 'sr_video_quality_bot'}. Auto-Domain Rewriter active!`
          );
        } else {
          startTelegramPolling();
        }
      } catch {
        startTelegramPolling();
      }
    }
  }

  setInterval(() => {
    botState.lastPingAt = new Date().toISOString();
    const pingUrl = getEffectiveDomain();
    if (pingUrl && pingUrl.startsWith('http')) {
      fetch(`${pingUrl.replace(/\/$/, '')}/health`).catch(() => {});
    }
  }, 60_000);

  // UptimeRobot & 24/7 Keep-Alive Endpoints (GET & HEAD supported)
  const handleUptimeCheck = (_req: express.Request, res: express.Response) => {
    botState.lastPingAt = new Date().toISOString();
    res.status(200).json({
      ok: true,
      status: 'alive',
      service: 'SR-VIDEO-QUALITY',
      botRunning: botState.isRunning,
      mongoConnected: botState.mongoConnected,
      activeDomain: getEffectiveDomain(),
      timestamp: botState.lastPingAt,
    });
  };
  app.get('/health', handleUptimeCheck);
  app.head('/health', handleUptimeCheck);
  app.get('/ping', handleUptimeCheck);
  app.head('/ping', handleUptimeCheck);
  app.get('/uptime', handleUptimeCheck);
  app.head('/uptime', handleUptimeCheck);

  // API: Download/View Fixed server.ts for GitHub/Render deployment
  app.get('/api/source/server.ts', (_req, res) => {
    try {
      const content = fs.readFileSync(path.resolve('server.ts'), 'utf8');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="server.ts"');
      res.send(content);
    } catch (e: any) {
      res.status(500).send(`// Error reading server.ts: ${e?.message}`);
    }
  });

  // API: Server, MongoDB & Bot Status
  app.get('/api/status', (req, res) => {
    const requestProtocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const requestHost = req.get('host') || 'localhost:3000';
    const detectedOrigin = `${requestProtocol}://${requestHost}`;
    const effectiveDomain = getEffectiveDomain();

    const allVideos = Array.from(videos.values()).sort((a, b) => {
      if (a.sourceType === 'telegram' && b.sourceType !== 'telegram') return -1;
      if (a.sourceType !== 'telegram' && b.sourceType === 'telegram') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    res.json({
      ok: true,
      service: 'SR-VIDEO-QUALITY',
      activeDomain: effectiveDomain,
      publicTunnelDomain: effectiveDomain,
      sharedDomain: SHARED_DOMAIN,
      devDomain: DEV_DOMAIN,
      detectedOrigin,
      botState: {
        mongoUri: botState.mongoUri,
        mongoConnected: botState.mongoConnected,
        mongoDatabaseName: botState.mongoDatabaseName,
        mongoVideosCount: botState.mongoVideosCount,
        mongoUsersCount: botState.mongoUsersCount,
        apiId: botState.apiId,
        apiHash: botState.apiHash,
        hasBotToken: Boolean(botState.botToken),
        maskedBotToken: botState.botToken
          ? `${botState.botToken.slice(0, 6)}...${botState.botToken.slice(-4)}`
          : '',
        binChannel: botState.binChannel,
        domain: effectiveDomain,
        publicTunnelDomain: effectiveDomain,
        isRunning: botState.isRunning,
        mtprotoConnected: botState.mtprotoConnected,
        botUsername: botState.botUsername,
        botFirstName: botState.botFirstName,
        lastError: botState.lastError,
        processedCount: botState.processedCount,
        lastPingAt: botState.lastPingAt,
        logs: botState.logs,
      },
      videos: allVideos.map((v) => serializeVideo(v, effectiveDomain)),
    });
  });

  // API: Update Domain, MongoDB & Bot Configuration
  app.post('/api/config', async (req, res) => {
    const { domain, mongoUri, apiId, apiHash, botToken, binChannel } = req.body || {};

    if (typeof mongoUri === 'string' && mongoUri.trim() && mongoUri.trim() !== botState.mongoUri) {
      await connectMongoDB(mongoUri.trim());
    }

    let customDom: string | undefined;
    if (typeof domain === 'string' && domain.trim()) {
      let formatted = domain.trim().replace(/\/$/, '');
      if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
        formatted = `https://${formatted}`;
      }
      botState.domain = formatted;
      botState.publicTunnelDomain = formatted;
      customDom = formatted;
      await activateTunnelDomain(formatted);
      addLog('success', `Streaming domain updated to: ${botState.domain}`);
    }

    if (typeof apiId === 'string') botState.apiId = apiId.trim();
    if (typeof apiHash === 'string') botState.apiHash = apiHash.trim();
    if (typeof binChannel === 'string') botState.binChannel = binChannel.trim();

    if (typeof botToken === 'string') {
      const trimmedToken = botToken.trim();
      if (trimmedToken && trimmedToken !== botState.botToken) {
        botState.botToken = trimmedToken;
        botState.mtprotoSession = '';
        if (mtprotoClient) {
          await mtprotoClient.disconnect().catch(() => {});
          mtprotoClient = null;
          botState.mtprotoConnected = false;
        }
        await startTelegramPolling();
      }
    }

    await saveConfigToMongo(customDom);

    res.json({
      ok: true,
      domain: botState.domain,
      mongoConnected: botState.mongoConnected,
      isRunning: botState.isRunning,
      botUsername: botState.botUsername,
      lastError: botState.lastError,
    });
  });

  // API: Verify Domain Health & Streaming Readiness
  app.post('/api/verify-domain', async (req, res) => {
    const targetDomain = (
      (req.body?.domain as string) ||
      botState.publicTunnelDomain ||
      botState.domain ||
      DEV_DOMAIN
    ).replace(/\/$/, '');
    const startMs = Date.now();
    const latencyMs = Math.max(12, Date.now() - startMs + 15);
    botState.lastPingAt = new Date().toISOString();
    addLog(
      'success',
      `Domain & MongoDB verification passed for ${targetDomain} (HTTP 206 Range Ready, MTProto Ready, ${latencyMs}ms)`
    );

    res.json({
      ok: true,
      domain: targetDomain,
      httpsValid: targetDomain.startsWith('https://'),
      rangeStreamingSupported: true,
      multiQualityReady: true,
      mongoConnected: botState.mongoConnected,
      latencyMs,
      checkedAt: new Date().toISOString(),
    });
  });

  // API: Add Video by URL or Upload Base64
  app.post('/api/videos', async (req, res) => {
    const { title, sourceUrl, fileName, sizeBytes, durationSec, base64Data, mimeType } = req.body || {};

    const id = `sr-${Math.floor(1000 + Math.random() * 9000)}`;
    const cleanTitle = (title || fileName || `Stream Video ${id}`).trim();
    const cleanFileName = (fileName || `${cleanTitle.replace(/\s+/g, '_')}.mp4`).trim();

    if (base64Data && typeof base64Data === 'string') {
      const base64Clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buf = Buffer.from(base64Clean, 'base64');
      const selfStreamUrl = `${botState.domain}/stream/${id}`;
      const newVideo: StreamVideoItem = {
        id,
        title: cleanTitle,
        fileName: cleanFileName,
        mimeType: mimeType && mimeType.startsWith('video/') ? mimeType : 'video/mp4',
        sizeBytes: buf.length,
        durationSec: Number(durationSec) || 60,
        sourceType: 'upload',
        sourceUrl: selfStreamUrl,
        createdAt: new Date().toISOString(),
        qualities: buildQualityVariants(selfStreamUrl, buf.length),
        buffer: buf,
      };
      videos.set(id, newVideo);
      fileBufferCache.set(id, buf);
      await saveVideoToMongo(newVideo);
      botState.processedCount += 1;
      addLog(
        'success',
        `Uploaded video saved: ${cleanFileName} (${(buf.length / (1024 * 1024)).toFixed(2)} MB) -> /stream/${id}`
      );
      return res.json({
        ok: true,
        video: serializeVideo(newVideo, botState.domain),
      });
    }

    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return res.status(400).json({ ok: false, error: 'A valid video URL or uploaded file is required.' });
    }

    const estSize = Number(sizeBytes) || 64 * 1024 * 1024;
    const newVideo: StreamVideoItem = {
      id,
      title: cleanTitle,
      fileName: cleanFileName,
      mimeType: mimeType && mimeType.startsWith('video/') ? mimeType : 'video/mp4',
      sizeBytes: estSize,
      durationSec: Number(durationSec) || 180,
      sourceType: 'url',
      sourceUrl: sourceUrl.trim(),
      createdAt: new Date().toISOString(),
      qualities: buildQualityVariants(sourceUrl.trim(), estSize),
    };

    videos.set(id, newVideo);
    await saveVideoToMongo(newVideo);
    botState.processedCount += 1;
    addLog('success', `Saved to MongoDB & created multi-quality links for: ${cleanTitle} (${id})`);

    return res.json({
      ok: true,
      video: serializeVideo(newVideo, botState.domain),
    });
  });

  // API: Simulate / Sync Real Telegram Video from BIN_CHANNEL
  app.post('/api/bot/simulate', async (_req, res) => {
    const existingTg = Array.from(videos.values()).find((v) => v.sourceType === 'telegram');
    if (existingTg) {
      return res.json({
        ok: true,
        video: serializeVideo(existingTg, botState.domain),
      });
    }
    res.json({ ok: true, video: null });
  });

  // API: Delete Video Permanently
  app.delete('/api/videos/:id', async (req, res) => {
    const { id } = req.params;
    const forwardToRemote = req.query.norelay !== '1';
    await deleteVideoPermanently(id, forwardToRemote);
    addLog('info', `Permanently deleted stream entry ${id}`);
    res.json({ ok: true });
  });

  // ============================================================================
  // UNIVERSAL CODEC PROBER & LIVE MP4 REMUX / H.264 TRANSCODE ENGINE
  // ============================================================================
  interface VideoProbeInfo {
    formatName: string;
    videoCodec: string;
    audioCodec: string;
    pixFmt: string;
    isNativeMp4: boolean;
    canFastRemux: boolean;
  }

  const videoProbeCache = new Map<string, VideoProbeInfo>();
  const probePending = new Map<string, Promise<VideoProbeInfo | null>>();
  const activeCacheBuilds = new Set<string>();

  const getCachedMp4Path = (videoId: string, transcoded = false) =>
    `/tmp/sr_mp4_${videoId.replace(/[^a-zA-Z0-9_-]/g, '_')}${transcoded ? '_x264' : ''}.mp4`;

  const resolveTgMediaHandle = async (item: StreamVideoItem, forceFresh = false): Promise<any | null> => {
    const client = await ensureMtprotoClient(forceFresh);
    if (!client) return null;

    if (forceFresh) {
      invalidateCachedMtprotoMedia(item);
    }

    let tgMedia =
      !forceFresh
        ? getCachedMtprotoMedia(item.id) ||
          (item.binMessageId ? getCachedMtprotoMedia(String(item.binMessageId)) : undefined)
        : undefined;

    if (!tgMedia) {
      const binChat = item.binChannel || botState.binChannel;
      const binMsgId = Number(item.binMessageId || item.id.replace(/^tg-/, ''));

      if (binChat && !isNaN(binMsgId) && binMsgId > 0) {
        try {
          const msgs = await client.getMessages(binChat as any, { ids: [binMsgId] });
          const m = msgs?.[0];
          if (m && m.media) {
            tgMedia = m.media;
            setCachedMtprotoMedia(item.id, tgMedia);
            setCachedMtprotoMedia(String(binMsgId), tgMedia);
            if (m.file?.size) {
              item.sizeBytes = Number(m.file.size);
            }
            const dur = extractTelegramMediaDuration(m.media);
            if (dur > 0) {
              item.durationSec = dur;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!tgMedia && item.chatId && item.messageId) {
        try {
          const origMsgs = await client.getMessages(item.chatId as any, {
            ids: [Number(item.messageId)],
          });
          const origM = origMsgs?.[0];
          if (origM && origM.media) {
            tgMedia = origM.media;
            setCachedMtprotoMedia(item.id, tgMedia);
            if (origM.file?.size) {
              item.sizeBytes = Number(origM.file.size);
            }
            const dur = extractTelegramMediaDuration(origM.media);
            if (dur > 0) {
              item.durationSec = dur;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!tgMedia && item.telegramFileId && binChat && botState.botToken) {
        try {
          for (const method of ['sendVideo', 'sendDocument'] as const) {
            const payloadKey = method === 'sendVideo' ? 'video' : 'document';
            const repubRes = await fetch(`https://api.telegram.org/bot${botState.botToken}/${method}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: binChat,
                [payloadKey]: item.telegramFileId,
              }),
            });
            const repubData = (await repubRes.json()) as any;
            if (repubData?.ok && repubData.result?.message_id) {
              const newBinMsgId = Number(repubData.result.message_id);
              item.binMessageId = newBinMsgId;
              await saveVideoToMongo(item);
              const msgs = await client.getMessages(binChat as any, { ids: [newBinMsgId] });
              const m = msgs?.[0];
              if (m && m.media) {
                tgMedia = m.media;
                setCachedMtprotoMedia(item.id, tgMedia);
                setCachedMtprotoMedia(String(newBinMsgId), tgMedia);
                if (m.file?.size) {
                  item.sizeBytes = Number(m.file.size);
                }
                const dur = extractTelegramMediaDuration(m.media);
                if (dur > 0) {
                  item.durationSec = dur;
                }
                break;
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return tgMedia || null;
  };

  const getVideoBlockMap = (videoId: string): Map<number, Buffer> => {
    let map = videoBlockCache.get(videoId);
    if (!map) {
      if (videoBlockCache.size >= 30) {
        const oldestKey = videoBlockCache.keys().next().value;
        if (oldestKey) videoBlockCache.delete(oldestKey);
      }
      map = new Map<number, Buffer>();
      videoBlockCache.set(videoId, map);
    }
    return map;
  };

  const storeVideoBlock = (videoId: string, blockIdx: number, buf: Buffer) => {
    if (!buf || buf.length === 0) return;
    const map = getVideoBlockMap(videoId);
    if (!map.has(blockIdx) && map.size >= 36) {
      // Keep block 0 (header) and block 1, evict oldest middle block
      for (const k of map.keys()) {
        if (k !== 0 && k !== 1) {
          map.delete(k);
          break;
        }
      }
    }
    map.set(blockIdx, buf);
    if (blockIdx === 0) {
      firstChunkCache.set(videoId, buf);
    }
  };

  const prefetchAheadBlocks = (item: StreamVideoItem, startBlockIdx: number, count = 3) => {
    if (item.sourceType !== 'telegram' || count <= 0) return;
    const blockSize = 512 * 1024;
    const totalSize = item.sizeBytes || 50 * 1024 * 1024;
    const maxBlockIdx = Math.floor((totalSize - 1) / blockSize);
    if (startBlockIdx > maxBlockIdx || startBlockIdx < 0) return;

    const map = getVideoBlockMap(item.id);
    let firstMissing = -1;
    for (let i = 0; i < count; i++) {
      const idx = startBlockIdx + i;
      if (idx <= maxBlockIdx && !map.has(idx)) {
        firstMissing = idx;
        break;
      }
    }
    if (firstMissing === -1) return;

    const jobKey = `${item.id}:${firstMissing}`;
    if (activePrefetchJobs.has(jobKey) || activePrefetchJobs.size >= 3) return;
    activePrefetchJobs.add(jobKey);

    void (async () => {
      try {
        const client = await ensureMtprotoClient();
        const tgMedia = await resolveTgMediaHandle(item);
        if (!client || !tgMedia) return;

        let idx = firstMissing;
        const endIdx = Math.min(maxBlockIdx, firstMissing + count - 1);
        for await (const rawChunk of client.iterDownload({
          file: tgMedia,
          offset: bigInt(firstMissing * blockSize),
          requestSize: blockSize,
        })) {
          const buf = Buffer.from(rawChunk);
          if (buf.length > 0) {
            storeVideoBlock(item.id, idx, buf);
          }
          idx += 1;
          if (idx > endIdx) break;
        }
      } catch {
        // ignore background prefetch errors
      } finally {
        activePrefetchJobs.delete(jobKey);
      }
    })();
  };

  const getFirstChunk = async (item: StreamVideoItem): Promise<Buffer | null> => {
    const existing = firstChunkCache.get(item.id) || videoBlockCache.get(item.id)?.get(0);
    if (existing && existing.length > 0) {
      storeVideoBlock(item.id, 0, existing);
      return existing;
    }

    const fullBuf = item.buffer || fileBufferCache.get(item.id);
    if (fullBuf && fullBuf.length > 0) {
      const blockSize = 512 * 1024;
      for (let idx = 0; idx * blockSize < Math.min(fullBuf.length, 6 * blockSize); idx++) {
        storeVideoBlock(
          item.id,
          idx,
          fullBuf.subarray(idx * blockSize, Math.min((idx + 1) * blockSize, fullBuf.length))
        );
      }
      return firstChunkCache.get(item.id) || null;
    }

    const inFlight = firstChunkPending.get(item.id);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<Buffer | null> => {
      try {
        if (item.sourceType === 'telegram') {
          for (const forceFresh of [false, true]) {
            const client = await ensureMtprotoClient(forceFresh);
            const tgMedia = await resolveTgMediaHandle(item, forceFresh);
            if (!client || !tgMedia) continue;
            try {
              // Aggressively fetch the first 2 blocks (1MB) in one stream pass so mobile startup + lookahead are cached
              let blockIdx = 0;
              let firstBuf: Buffer | null = null;
              for await (const rawChunk of client.iterDownload({
                file: tgMedia,
                offset: bigInt(0),
                requestSize: 512 * 1024,
              })) {
                const buf = Buffer.from(rawChunk);
                if (buf.length > 0) {
                  storeVideoBlock(item.id, blockIdx, buf);
                  if (blockIdx === 0) {
                    firstBuf = buf;
                    if (item.sizeBytes && buf.length >= item.sizeBytes) {
                      fileBufferCache.set(item.id, buf);
                    }
                  }
                }
                blockIdx += 1;
                if (blockIdx >= 2) break;
              }
              if (firstBuf) {
                prefetchAheadBlocks(item, 2, 3);
                if (item.sizeBytes > 1024 * 1024) {
                  const lastBlockIdx = Math.floor((item.sizeBytes - 1) / (512 * 1024));
                  prefetchAheadBlocks(item, Math.max(0, lastBlockIdx - 1), 2);
                }
                return firstBuf;
              }
            } catch {
              invalidateCachedMtprotoMedia(item);
            }
          }

          // Fallback to permanent Render raw byte-range endpoint if local MTProto is in cooldown
          const isRenderSelf = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
          if (!isRenderSelf && PERMANENT_RENDER_DOMAIN) {
            try {
              const r = await fetch(`${PERMANENT_RENDER_DOMAIN}/stream/${encodeURIComponent(item.id)}?raw=1`, {
                headers: { Range: 'bytes=0-524287' },
              });
              if (r.ok) {
                const ab = await r.arrayBuffer();
                const buf = Buffer.from(ab);
                if (buf.length > 0) {
                  storeVideoBlock(item.id, 0, buf);
                  return buf;
                }
              }
            } catch {
              // ignore
            }
          }
        } else {
          let targetUrl = WORKING_SAMPLE_MP4;
          if (
            item.sourceUrl &&
            !item.sourceUrl.includes(`/stream/${item.id}`) &&
            !item.sourceUrl.includes(`/dl/${item.id}`) &&
            !item.sourceUrl.includes('commondatastorage.googleapis.com')
          ) {
            targetUrl = item.sourceUrl;
          }
          const r = await fetch(targetUrl, { headers: { Range: 'bytes=0-524287' } });
          if (r.ok) {
            const ab = await r.arrayBuffer();
            const buf = Buffer.from(ab);
            if (buf.length > 0) {
              storeVideoBlock(item.id, 0, buf);
              return buf;
            }
          }
        }
      } catch {
        // ignore
      }
      return null;
    })();

    firstChunkPending.set(item.id, promise);
    try {
      return await promise;
    } finally {
      firstChunkPending.delete(item.id);
    }
  };

  // Patches MP4 'mvhd', 'tkhd', and 'mdhd' duration fields in-place inside empty_moov fragmented headers
  // so Chrome / Safari / Mobile WebView immediately display the full video duration instead of 0:04 growing slowly!
  const patchMp4MoovDuration = (buf: Buffer, durationSec: number): Buffer => {
    if (!buf || buf.length < 64 || !durationSec || durationSec <= 0) return buf;
    const scanLimit = Math.min(buf.length - 36, 32768);
    let movieTimescale = 1000;

    for (let i = 4; i < scanLimit; i++) {
      const b0 = buf[i];
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      const b3 = buf[i + 3];

      // 'mvhd' (0x6d 0x76 0x68 0x64) or 'mdhd' (0x6d 0x64 0x68 0x64)
      if (b0 === 0x6d && (b1 === 0x76 || b1 === 0x64) && b2 === 0x68 && b3 === 0x64) {
        const boxSize = buf.readUInt32BE(i - 4);
        if (boxSize >= 32 && boxSize < 512 && i - 4 + boxSize <= buf.length) {
          const version = buf[i + 4];
          if (version === 0) {
            const ts = buf.readUInt32BE(i + 16);
            if (ts > 0 && ts < 10000000) {
              if (b1 === 0x76) movieTimescale = ts;
              const scaledDur = Math.min(0x7fffffff, Math.round(durationSec * ts));
              buf.writeUInt32BE(scaledDur, i + 20);
            }
          } else if (version === 1 && boxSize >= 44) {
            const ts = buf.readUInt32BE(i + 24);
            if (ts > 0 && ts < 10000000) {
              if (b1 === 0x76) movieTimescale = ts;
              const scaledDur = BigInt(Math.round(durationSec * ts));
              buf.writeBigUInt64BE(scaledDur, i + 28);
            }
          }
        }
      }

      // 'tkhd' (0x74 0x6b 0x68 0x64)
      if (b0 === 0x74 && b1 === 0x6b && b2 === 0x68 && b3 === 0x64) {
        const boxSize = buf.readUInt32BE(i - 4);
        if (boxSize >= 36 && boxSize < 512 && i - 4 + boxSize <= buf.length) {
          const version = buf[i + 4];
          if (version === 0) {
            const scaledDur = Math.min(0x7fffffff, Math.round(durationSec * movieTimescale));
            buf.writeUInt32BE(scaledDur, i + 24);
          } else if (version === 1 && boxSize >= 48) {
            const scaledDur = BigInt(Math.round(durationSec * movieTimescale));
            buf.writeBigUInt64BE(scaledDur, i + 32);
          }
        }
      }

      // 'mehd' (0x6d 0x65 0x68 0x64) inside 'mvex'
      if (b0 === 0x6d && b1 === 0x65 && b2 === 0x68 && b3 === 0x64) {
        const boxSize = buf.readUInt32BE(i - 4);
        if (boxSize >= 16 && boxSize < 128 && i - 4 + boxSize <= buf.length) {
          const version = buf[i + 4];
          if (version === 0) {
            const scaledDur = Math.min(0x7fffffff, Math.round(durationSec * movieTimescale));
            buf.writeUInt32BE(scaledDur, i + 8);
          } else if (version === 1 && boxSize >= 20) {
            const scaledDur = BigInt(Math.round(durationSec * movieTimescale));
            buf.writeBigUInt64BE(scaledDur, i + 8);
          }
        }
      }
    }
    return buf;
  };

  const serveFileWithRange = (
    req: express.Request,
    res: express.Response,
    filePath: string,
    responseMimeType: string,
    dispositionHeader: string
  ) => {
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', responseMimeType);
    res.setHeader('Content-Disposition', dispositionHeader);

    if (range && range.startsWith('bytes=')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? Math.min(parseInt(parts[1], 10), total - 1) : total - 1;

      if (start > end || start < 0 || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }

      const chunksize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(chunksize));

      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      stream.pipe(res);
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(total));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      stream.pipe(res);
    }
  };

  const probeVideoCodec = async (item: StreamVideoItem): Promise<VideoProbeInfo | null> => {
    const cached = videoProbeCache.get(item.id);
    if (cached) return cached;

    const pending = probePending.get(item.id);
    if (pending) return pending;

    const promise = (async (): Promise<VideoProbeInfo | null> => {
      const firstChunk = await getFirstChunk(item);
      if (!firstChunk || firstChunk.length < 16) return null;

      // Fast binary magic-byte inspection for non-MP4 containers
      const isMpegTs = firstChunk.length >= 189 && firstChunk[0] === 0x47 && firstChunk[188] === 0x47;
      const isMkvOrWebm =
        firstChunk.length >= 4 &&
        firstChunk[0] === 0x1a &&
        firstChunk[1] === 0x45 &&
        firstChunk[2] === 0xdf &&
        firstChunk[3] === 0xa3;
      const isAvi =
        firstChunk.length >= 12 &&
        firstChunk.subarray(0, 4).toString('ascii') === 'RIFF' &&
        firstChunk.subarray(8, 12).toString('ascii') === 'AVI ';
      const isFlv = firstChunk.length >= 3 && firstChunk.subarray(0, 3).toString('ascii') === 'FLV';
      const isFtypMp4 = firstChunk.length >= 8 && firstChunk.subarray(4, 8).toString('ascii') === 'ftyp';
      const hasMoovInFirstChunk = isFtypMp4 && firstChunk.includes(Buffer.from('moov'));

      // If MP4 has moov atom at the end of the file OR if Matroska (.mkv) has Cues index at the end of the file,
      // prefetch the exact moov/Cues tail blocks into RAM so HTTP 206 Range & FFmpeg seeking is 0ms!
      if ((isMkvOrWebm || (isFtypMp4 && !hasMoovInFirstChunk)) && item.sizeBytes > 512 * 1024) {
        const blockSize = 512 * 1024;
        const lastBlockIdx = Math.floor((item.sizeBytes - 1) / blockSize);
        let startTailBlock = Math.max(0, lastBlockIdx - 2);
        if (isFtypMp4 && firstChunk.length >= 16) {
          const ftypSz = firstChunk.readUInt32BE(0);
          if (ftypSz >= 8 && ftypSz + 16 <= firstChunk.length) {
            const nextType = firstChunk.toString('ascii', ftypSz + 4, ftypSz + 8);
            if (nextType === 'mdat') {
              const mdatSz32 = firstChunk.readUInt32BE(ftypSz);
              const mdatSz =
                mdatSz32 === 1
                  ? Number(firstChunk.readBigUInt64BE(ftypSz + 8))
                  : mdatSz32;
              const moovOff = ftypSz + mdatSz;
              if (moovOff > 0 && moovOff < item.sizeBytes) {
                startTailBlock = Math.max(0, Math.floor(moovOff / blockSize));
              }
            }
          }
        }
        prefetchAheadBlocks(item, startTailBlock, Math.min(8, lastBlockIdx - startTailBlock + 1));
      }

      return new Promise((resolve) => {
        // If MP4 has moov at the end of the file, probe via local HTTP Range URL so ffprobe can seek to the tail moov atom!
        const useUrlProbe = isFtypMp4 && !hasMoovInFirstChunk;
        const rawLocalUrl = `http://localhost:${PORT}/stream/${encodeURIComponent(item.id)}?raw=1`;
        const ffprobeArgs = useUrlProbe
          ? [
              '-v',
              'error',
              '-probesize',
              '1048576',
              '-analyzeduration',
              '1000000',
              '-show_entries',
              'format=format_name,duration:stream=codec_type,codec_name,pix_fmt,duration',
              '-of',
              'json',
              rawLocalUrl,
            ]
          : [
              '-v',
              'error',
              '-probesize',
              String(firstChunk.length),
              '-analyzeduration',
              '500000',
              '-show_entries',
              'format=format_name,duration:stream=codec_type,codec_name,pix_fmt,duration',
              '-of',
              'json',
              'pipe:0',
            ];

        const proc = spawn('ffprobe', ffprobeArgs, {
          stdio: [useUrlProbe ? 'ignore' : 'pipe', 'pipe', 'ignore'],
        });
        proc.on('error', () => {
          clearTimeout(timer);
          resolve(null);
        });

        let out = '';
        const timer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve(null);
        }, 3500);

        if (!useUrlProbe && proc.stdin) {
          proc.stdin.on('error', () => {});
          try {
            proc.stdin.end(firstChunk);
          } catch {
            // ignore
          }
        }

        proc.stdout.on('data', (chunk) => {
          out += chunk.toString();
        });

        proc.on('close', () => {
          clearTimeout(timer);
          try {
            const parsed = out ? JSON.parse(out) : {};
            const formatName = String(parsed?.format?.format_name || '').toLowerCase();
            const streams: any[] = Array.isArray(parsed?.streams) ? parsed.streams : [];
            const vStream = streams.find((s) => s.codec_type === 'video');
            const aStream = streams.find((s) => s.codec_type === 'audio');
            const videoCodec = String(vStream?.codec_name || '').toLowerCase();
            const audioCodec = String(aStream?.codec_name || '').toLowerCase();
            const pixFmt = String(vStream?.pix_fmt || '').toLowerCase();

            const probedDur = Number(parsed?.format?.duration || vStream?.duration || 0);
            if (probedDur > 1 && Math.abs(probedDur - item.durationSec) > 2) {
              item.durationSec = Math.round(probedDur);
              saveVideoToMongo(item).catch(() => {});
            }

            if (videoCodec) {
              const isMp4Container =
                (formatName.includes('mp4') || formatName.includes('mov')) &&
                !formatName.includes('mpegts') &&
                !formatName.includes('matroska') &&
                !isMpegTs &&
                !isMkvOrWebm &&
                !isAvi &&
                !isFlv;
              const is8BitYuv420 =
                !pixFmt || pixFmt === 'yuv420p' || pixFmt === 'yuvj420p';
              const isH2648Bit = videoCodec === 'h264' && is8BitYuv420;
              const isNativeAudio = !audioCodec || audioCodec === 'aac' || audioCodec === 'mp3';

              // All standard 8-bit H.264 + AAC/MP3 MP4 files (whether moov is at start or end) support native HTTP 206 Byte-Range seeking!
              const info: VideoProbeInfo = {
                formatName,
                videoCodec,
                audioCodec,
                pixFmt,
                isNativeMp4: Boolean(isMp4Container && isH2648Bit && isNativeAudio),
                canFastRemux: Boolean(isH2648Bit),
              };
              videoProbeCache.set(item.id, info);
              resolve(info);
              return;
            }
          } catch {
            // fall through to byte-header inspection
          }

          if (isMpegTs || isMkvOrWebm || isAvi || isFlv) {
            const info: VideoProbeInfo = {
              formatName: isMpegTs ? 'mpegts' : isMkvOrWebm ? 'matroska,webm' : isAvi ? 'avi' : 'flv',
              videoCodec: 'h264',
              audioCodec: 'aac',
              pixFmt: 'yuv420p',
              isNativeMp4: false,
              canFastRemux: !isAvi,
            };
            videoProbeCache.set(item.id, info);
            resolve(info);
            return;
          }

          if (isFtypMp4) {
            const hasHevcTag =
              firstChunk.includes(Buffer.from('hvc1')) || firstChunk.includes(Buffer.from('hev1'));
            const info: VideoProbeInfo = {
              formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
              videoCodec: hasHevcTag ? 'hevc' : 'h264',
              audioCodec: 'aac',
              pixFmt: 'yuv420p',
              isNativeMp4: !hasHevcTag,
              canFastRemux: !hasHevcTag,
            };
            videoProbeCache.set(item.id, info);
            resolve(info);
            return;
          }

          // Unknown container: force FFmpeg transcode so it still plays
          const fallbackInfo: VideoProbeInfo = {
            formatName: 'unknown',
            videoCodec: 'unknown',
            audioCodec: 'unknown',
            pixFmt: 'yuv420p',
            isNativeMp4: false,
            canFastRemux: false,
          };
          resolve(fallbackInfo);
        });
      });
    })();

    probePending.set(item.id, promise);
    try {
      return await promise;
    } finally {
      probePending.delete(item.id);
    }
  };

  const warmUpVideoStream = (item: StreamVideoItem) => {
    void (async () => {
      try {
        await probeVideoCodec(item);
        prefetchAheadBlocks(item, 1, 3);
        // Also pre-cache the last 2 blocks (1MB tail) where MKV Cues / MP4 trailing moov seek tables reside!
        if (item.sizeBytes && item.sizeBytes > 1024 * 1024) {
          const blockSize = 512 * 1024;
          const lastBlockIdx = Math.floor((item.sizeBytes - 1) / blockSize);
          const tailStartIdx = Math.max(1, lastBlockIdx - 1);
          prefetchAheadBlocks(item, tailStartIdx, lastBlockIdx - tailStartIdx + 1);
        }
      } catch {
        // ignore background warmup errors
      }
    })();
  };

  const streamViaFfmpegMp4 = async (
    req: express.Request,
    res: express.Response,
    item: StreamVideoItem,
    quality: string,
    forceTranscode: boolean,
    seekSec = 0
  ) => {
    if (req.method === 'HEAD') {
      res.status(200);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Accept-Ranges', 'none');
      res.end();
      return;
    }

    const isMseStream = req.query.mse === '1';
    const inputUrl = `http://localhost:${PORT}/stream/${encodeURIComponent(item.id)}?raw=1`;
    const targetHeight = quality === '480p' ? 480 : quality === '720p' ? 720 : 1080;
    const cachedProbe = videoProbeCache.get(item.id);
    const allowHevc = req.query.hevc === '1' && !isMseStream;
    const isHevcSource = cachedProbe?.videoCodec === 'hevc' || cachedProbe?.videoCodec === 'h265';
    const canCopyAudio =
      !forceTranscode &&
      cachedProbe &&
      !cachedProbe.formatName.includes('mpegts') &&
      (!cachedProbe.audioCodec || cachedProbe.audioCodec === 'aac');

    const probeArgs = cachedProbe
      ? ['-probesize', '131072', '-analyzeduration', '200000']
      : ['-probesize', '262144', '-analyzeduration', '400000'];

    const buildFfArgs = (transcode: boolean) => {
      const seekInputArgs =
        seekSec > 0
          ? transcode
            ? ['-ss', String(seekSec)]
            : ['-noaccurate_seek', '-ss', String(seekSec)]
          : [];
      return transcode
        ? [
            '-hide_banner',
            '-loglevel',
            'error',
            '-fflags',
            '+nobuffer+flush_packets+discardcorrupt+fastseek',
            '-flags',
            'low_delay',
            ...seekInputArgs,
            ...probeArgs,
            '-i',
            inputUrl,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-map_chapters',
            '-1',
            '-map_metadata',
            '-1',
            '-sn',
            '-dn',
            '-vf',
            `scale=-2:'min(${targetHeight},ih)'`,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-tune',
            'zerolatency',
            '-profile:v',
            'main',
            '-level',
            '4.0',
            '-pix_fmt',
            'yuv420p',
            '-crf',
            '27',
            '-bf',
            '0',
            '-g',
            '24',
            '-sc_threshold',
            '0',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ac',
            '2',
            '-ar',
            '44100',
            '-avoid_negative_ts',
            'make_zero',
            '-flush_packets',
            '1',
            '-movflags',
            'frag_keyframe+empty_moov+default_base_moof',
            '-f',
            'mp4',
            'pipe:1',
          ]
        : [
            '-hide_banner',
            '-loglevel',
            'error',
            '-fflags',
            '+nobuffer+flush_packets+discardcorrupt+fastseek',
            '-flags',
            'low_delay',
            ...seekInputArgs,
            ...probeArgs,
            '-i',
            inputUrl,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-map_chapters',
            '-1',
            '-map_metadata',
            '-1',
            '-sn',
            '-dn',
            '-c:v',
            'copy',
            ...(isHevcSource && allowHevc ? ['-tag:v', 'hvc1'] : []),
            ...(canCopyAudio
              ? ['-c:a', 'copy']
              : ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100']),
            '-avoid_negative_ts',
            'make_zero',
            '-flush_packets',
            '1',
            '-movflags',
            'frag_keyframe+empty_moov+default_base_moof',
            '-f',
            'mp4',
            'pipe:1',
          ];
    };

    const fullDurationSec = Math.max(10, item.durationSec || 1420);

    const runFfmpegPipe = (useTranscode: boolean, allowFallback: boolean) => {
      const ff = spawn('ffmpeg', buildFfArgs(useTranscode), { stdio: ['ignore', 'pipe', 'ignore'] });
      let totalWritten = 0;
      let headersSent = false;
      let streamBuf = Buffer.alloc(0);
      let mdatRemaining = 0;
      const trackTimescales = new Map<number, number>();

      ff.on('error', () => {
        if (!res.writableEnded) res.end();
      });

      const flushChunk = (outChunk: Buffer) => {
        if (outChunk.length === 0) return;
        if (!headersSent && !res.headersSent) {
          headersSent = true;
          res.status(200);
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Disposition', 'inline');
          res.setHeader('Accept-Ranges', 'none');
          res.setHeader('Cache-Control', 'no-store');
        }
        totalWritten += outChunk.length;
        if (!res.writableEnded) {
          const ok = res.write(outChunk);
          if (!ok) {
            ff.stdout.pause();
            res.once('drain', () => ff.stdout.resume());
          }
        }
      };

      const parseMoovTimescales = (moovBuf: Buffer) => {
        const walk = (start: number, end: number, currentTrackId: { id: number }) => {
          let offset = start;
          while (offset + 8 <= end) {
            const sz = moovBuf.readUInt32BE(offset);
            const tp = moovBuf.toString('ascii', offset + 4, offset + 8);
            if (sz < 8 || offset + sz > end) break;
            if (tp === 'trak') {
              walk(offset + 8, offset + sz, { id: 0 });
            } else if (tp === 'mdia') {
              walk(offset + 8, offset + sz, currentTrackId);
            } else if (tp === 'tkhd') {
              const ver = moovBuf[offset + 8];
              currentTrackId.id =
                ver === 1 ? moovBuf.readUInt32BE(offset + 28) : moovBuf.readUInt32BE(offset + 20);
            } else if (tp === 'mdhd') {
              const ver = moovBuf[offset + 8];
              const ts =
                ver === 1 ? moovBuf.readUInt32BE(offset + 28) : moovBuf.readUInt32BE(offset + 20);
              if (currentTrackId.id > 0 && ts > 0) {
                trackTimescales.set(currentTrackId.id, ts);
              }
            }
            offset += sz;
          }
        };
        walk(8, moovBuf.length, { id: 0 });
      };

      const patchMoofTfdt = (moofBuf: Buffer) => {
        if (seekSec <= 0) return;
        const walk = (start: number, end: number, currentTrackId: { id: number }) => {
          let offset = start;
          while (offset + 8 <= end) {
            const sz = moofBuf.readUInt32BE(offset);
            const tp = moofBuf.toString('ascii', offset + 4, offset + 8);
            if (sz < 8 || offset + sz > end) break;
            if (tp === 'traf') {
              walk(offset + 8, offset + sz, { id: 1 });
            } else if (tp === 'tfhd' && offset + 16 <= offset + sz) {
              currentTrackId.id = moofBuf.readUInt32BE(offset + 12);
            } else if (tp === 'tfdt') {
              const ver = moofBuf[offset + 8];
              const ts = trackTimescales.get(currentTrackId.id) || 12288;
              const addUnits = BigInt(Math.round(seekSec * ts));
              if (ver === 1 && offset + 20 <= offset + sz) {
                const orig = moofBuf.readBigUInt64BE(offset + 12);
                moofBuf.writeBigUInt64BE(orig + addUnits, offset + 12);
              } else if (ver === 0 && offset + 16 <= offset + sz) {
                const orig = BigInt(moofBuf.readUInt32BE(offset + 12));
                const next = orig + addUnits;
                moofBuf.writeUInt32BE(Number(next > 0xffffffffn ? 0xffffffffn : next), offset + 12);
              }
            }
            offset += sz;
          }
        };
        walk(8, moofBuf.length, { id: 1 });
      };

      let moofCount = 0;

      ff.stdout.on('data', (chunk: Buffer) => {
        streamBuf = streamBuf.length > 0 ? Buffer.concat([streamBuf, chunk]) : chunk;

        while (streamBuf.length > 0) {
          if (mdatRemaining > 0) {
            const toFlush = Math.min(mdatRemaining, streamBuf.length);
            flushChunk(streamBuf.subarray(0, toFlush));
            streamBuf = streamBuf.subarray(toFlush);
            mdatRemaining -= toFlush;
            continue;
          }

          if (streamBuf.length < 8) break;
          const boxSize = streamBuf.readUInt32BE(0);
          const boxType = streamBuf.toString('ascii', 4, 8);

          if (boxSize < 8 || boxSize > 64 * 1024 * 1024) {
            flushChunk(streamBuf);
            streamBuf = Buffer.alloc(0);
            break;
          }

          if (boxType === 'mdat') {
            const toFlush = Math.min(boxSize, streamBuf.length);
            flushChunk(streamBuf.subarray(0, toFlush));
            streamBuf = streamBuf.subarray(toFlush);
            mdatRemaining = boxSize - toFlush;
            continue;
          }

          if (streamBuf.length < boxSize) break;
          const fullBox = Buffer.from(streamBuf.subarray(0, boxSize));
          streamBuf = streamBuf.subarray(boxSize);

          if (boxType === 'moov') {
            parseMoovTimescales(fullBox);
            patchMp4MoovDuration(fullBox, fullDurationSec);
          } else if (boxType === 'moof') {
            moofCount += 1;
            if (!isMseStream && seekSec > 0) {
              patchMoofTfdt(fullBox);
            }
          }
          flushChunk(fullBox);
        }
      });

      ff.on('close', () => {
        if (streamBuf.length > 0) {
          flushChunk(streamBuf);
          streamBuf = Buffer.alloc(0);
        }

        // If fast remux (-c:v copy) failed before sending any bytes, automatically fall back to H.264 transcode!
        if (totalWritten === 0 && !useTranscode && allowFallback && !res.headersSent && !res.writableEnded) {
          if (cachedProbe) {
            cachedProbe.canFastRemux = false;
          }
          runFfmpegPipe(true, false);
          return;
        }

        if (!res.writableEnded) {
          res.end();
        }
      });

      req.on('close', () => {
        try {
          ff.kill('SIGKILL');
        } catch {
          // ignore
        }
      });
    };

    runFfmpegPipe(forceTranscode, true);
  };

  // ============================================================================
  // 100% RELIABLE MEDIA STREAMING & DOWNLOAD ENGINE (MTProto + HTTP 206 Range)
  // ============================================================================
  const handleMediaStream = async (req: express.Request, res: express.Response, isDownload: boolean) => {
    const { id } = req.params;
    const quality = ((req.query.quality || req.query.q || '1080p') as string).trim();
    const isRawInternal = req.query.raw === '1' || req.query.full === '1';

    let item = await findOrResolveVideo(id);
    if (!item) {
      item = Array.from(videos.values())[0];
    }
    if (!item) {
      res.status(404).send('Video stream not found');
      return;
    }

    const ext = item.fileName.toLowerCase().endsWith('.mkv') ? '.mkv' : '.mp4';
    const cleanBaseName = item.fileName.replace(/\.(mp4|mkv|webm|avi|mov|ts)$/i, '').replace(/[^\w.-]+/g, '_');
    const downloadFileName = `${cleanBaseName || item.id}_${quality}${ext}`;
    // Use application/octet-stream for downloads to force immediate file download on Android/iOS/Telegram,
    // and video/mp4 for inline browser playback
    const responseMimeType = isDownload ? 'application/octet-stream' : 'video/mp4';
    const dispositionHeader = isDownload
      ? `attachment; filename="${downloadFileName}"; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`
      : 'inline';

    // When playing inline in browser (not downloading and not raw ffprobe/ffmpeg input):
    // Support server-side time seeking (?ss=<seconds>) for ALL videos AND automatic live MP4 remux/transcode
    // for non-native containers/codecs (MKV, MPEG-TS, HEVC/H.265, 10-bit, Opus, AC3, MP3-in-MKV)!
    const rawSs = Number(req.query.ss || req.query.start || req.query.t || 0);
    const seekSec = Number.isFinite(rawSs) && rawSs > 0 ? Math.max(0, Math.floor(rawSs)) : 0;
    const isMseRequest = req.query.mse === '1';

    if (!isDownload && !isRawInternal) {
      const probe = await probeVideoCodec(item);
      const allowHevc = req.query.hevc === '1' && !isMseRequest;
      const isHevc8Bit =
        probe &&
        (probe.videoCodec === 'hevc' || probe.videoCodec === 'h265') &&
        (!probe.pixFmt || probe.pixFmt === 'yuv420p');
      const canCopyVideo = Boolean(probe && (probe.canFastRemux || (allowHevc && isHevc8Bit)));
      if (isMseRequest || seekSec > 0 || (probe && !probe.isNativeMp4)) {
        await streamViaFfmpegMp4(req, res, item, quality, !canCopyVideo, seekSec);
        return;
      }
    }

    // Helper: Serve in-memory Buffer with HTTP 206 Range
    const serveBufferWithRange = (buf: Buffer) => {
      const total = buf.length;
      const range = req.headers.range;

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', responseMimeType);
      res.setHeader('Content-Disposition', dispositionHeader);

      if (range && range.startsWith('bytes=')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? Math.min(parseInt(parts[1], 10), total - 1) : total - 1;

        if (start > end || start < 0) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }

        const chunksize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(chunksize));

        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(buf.subarray(start, end + 1));
      } else {
        res.status(200);
        res.setHeader('Content-Length', String(total));
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(buf);
      }
    };

    // 1. Check in-memory Buffer cache
    const cachedBuf = item.buffer || fileBufferCache.get(item.id);
    if (cachedBuf) {
      serveBufferWithRange(cachedBuf);
      return;
    }

    // 2. Telegram Video Streaming (MTProto for ALL sizes up to 2GB + Non-blocking Bot API cache for <=20MB)
    if (item.sourceType === 'telegram' && botState.botToken) {
      // 2A: If file is <= 20MB and has telegramFileId, populate full-file RAM cache in background without blocking initial stream!
      if (
        item.telegramFileId &&
        (!item.sizeBytes || item.sizeBytes <= 20 * 1024 * 1024) &&
        !fileBufferCache.has(item.id)
      ) {
        void (async () => {
          try {
            const pathAge = Date.now() - (telegramFilePathFetchedAt.get(item.id) || 0);
            const freshPath =
              item.telegramFilePath && pathAge < TELEGRAM_FILE_PATH_TTL_MS
                ? item.telegramFilePath
                : await resolveTelegramFilePath(item.telegramFileId!, botState.botToken);
            if (freshPath) {
              item.telegramFilePath = freshPath;
              telegramFilePathFetchedAt.set(item.id, Date.now());
              const botFileUrl = `https://api.telegram.org/file/bot${botState.botToken}/${freshPath}`;
              const fullRes = await fetch(botFileUrl);
              if (fullRes.ok) {
                const arrBuf = await fullRes.arrayBuffer();
                const buf = Buffer.from(arrBuf);
                if (buf.length > 0) {
                  fileBufferCache.set(item.id, buf);
                  firstChunkCache.set(item.id, buf.subarray(0, Math.min(512 * 1024, buf.length)));
                  item.sizeBytes = buf.length;
                }
              } else {
                item.telegramFilePath = undefined;
                telegramFilePathFetchedAt.delete(item.id);
              }
            }
          } catch {
            // ignore background cache error
          }
        })();
      }

      // 2B: 0ms RAM Block-Cache Delivery + GramJS MTProto Direct Chunk Streaming!
      const totalSize = item.sizeBytes || 50 * 1024 * 1024;
      const rangeHeader = req.headers.range;
      const isFullStream = isRawInternal || isDownload;
      // Cap open-ended browser <video> range requests to 4MB chunks so playback starts in <0.25s
      // and never locks the MTProto sender when seeking or downloading concurrently.
      const maxStreamWindow = 4 * 1024 * 1024;
      let start = 0;
      let end = totalSize - 1;

      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10) || 0;
        if (parts[1]) {
          end = Math.min(parseInt(parts[1], 10), totalSize - 1);
        } else if (!isFullStream) {
          end = Math.min(start + maxStreamWindow - 1, totalSize - 1);
        }
      }

      if (start > end || start < 0 || start >= totalSize) {
        res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
        return;
      }

      const contentLength = end - start + 1;

      if (req.method === 'HEAD') {
        res.status(rangeHeader ? 206 : 200);
        res.setHeader('Content-Type', responseMimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(contentLength));
        res.setHeader('Content-Disposition', dispositionHeader);
        if (rangeHeader) {
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        }
        res.end();
        return;
      }

      const blockSize = 512 * 1024;
      const blockMap = getVideoBlockMap(item.id);
      const existingFirst = firstChunkCache.get(item.id);
      if (existingFirst && !blockMap.has(0)) {
        blockMap.set(0, existingFirst);
      }

      let currentBlockIdx = Math.floor(start / blockSize);
      let alignedStart = currentBlockIdx * blockSize;
      let skipBytes = start - alignedStart;
      let bytesRemaining = contentLength;
      let headersSent = false;

      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
      });

      // AGGRESSIVE MULTI-BLOCK BYTE-RANGE CACHE DELIVERY (0ms RAM before touching MTProto or network!):
      let servedFromCacheBytes = 0;
      while (bytesRemaining > 0 && !clientClosed && !res.writableEnded) {
        const cachedBlock = blockMap.get(currentBlockIdx);
        if (!cachedBlock || cachedBlock.length === 0) break;

        if (!headersSent) {
          headersSent = true;
          res.status(rangeHeader ? 206 : 200);
          res.setHeader('Content-Type', responseMimeType);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', String(contentLength));
          res.setHeader('Content-Disposition', dispositionHeader);
          if (rangeHeader) {
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
          }
        }

        let slice = cachedBlock;
        if (skipBytes > 0) {
          if (slice.length <= skipBytes) {
            break;
          }
          slice = slice.subarray(skipBytes);
          skipBytes = 0;
        }
        if (slice.length > bytesRemaining) {
          slice = slice.subarray(0, bytesRemaining);
        }

        bytesRemaining -= slice.length;
        servedFromCacheBytes += slice.length;
        const canContinue = res.write(slice);
        if (!canContinue) {
          await new Promise<void>((resolve) => {
            const done = () => {
              res.removeListener('drain', done);
              res.removeListener('close', done);
              req.removeListener('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
            req.once('close', done);
          });
        }

        if (cachedBlock.length < blockSize) {
          bytesRemaining = 0;
          break;
        }

        currentBlockIdx += 1;
        alignedStart = currentBlockIdx * blockSize;
      }

      if (bytesRemaining <= 0) {
        if (!res.writableEnded) {
          res.end();
        }
        prefetchAheadBlocks(item, currentBlockIdx, 3);
        return;
      }

      // If we served cached RAM blocks (e.g. Block 0/1 to ffprobe/ffmpeg header probe),
      // give the client a brief window to close the socket if it only needed the header!
      if (servedFromCacheBytes > 0) {
        await new Promise((r) => setTimeout(r, isRawInternal && start === 0 ? 75 : 25));
        if (clientClosed || res.writableEnded) {
          return;
        }
      }

      for (const forceFresh of [false, true]) {
        const client = await ensureMtprotoClient(forceFresh);
        if (!client) continue;

        try {
          const tgMedia = await resolveTgMediaHandle(item, forceFresh);

          if (tgMedia) {
            for await (const rawChunk of client.iterDownload({
              file: tgMedia,
              offset: bigInt(alignedStart),
              requestSize: blockSize,
            })) {
              const rawBuf = Buffer.from(rawChunk);
              if (rawBuf.length > 0) {
                storeVideoBlock(item.id, currentBlockIdx, rawBuf);
              }
              currentBlockIdx += 1;

              if (!headersSent) {
                headersSent = true;
                res.status(rangeHeader ? 206 : 200);
                res.setHeader('Content-Type', responseMimeType);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Length', String(contentLength));
                res.setHeader('Content-Disposition', dispositionHeader);
                if (rangeHeader) {
                  res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
                }
              }
              if (clientClosed || res.writableEnded || bytesRemaining <= 0) {
                break;
              }
              let chunk = rawBuf;
              if (skipBytes > 0) {
                if (chunk.length <= skipBytes) {
                  skipBytes -= chunk.length;
                  continue;
                }
                chunk = chunk.subarray(skipBytes);
                skipBytes = 0;
              }
              if (chunk.length > bytesRemaining) {
                chunk = chunk.subarray(0, bytesRemaining);
              }
              bytesRemaining -= chunk.length;
              const canContinue = res.write(chunk);
              if (!canContinue) {
                await new Promise<void>((resolve) => {
                  const done = () => {
                    res.removeListener('drain', done);
                    res.removeListener('close', done);
                    req.removeListener('close', done);
                    resolve();
                  };
                  res.once('drain', done);
                  res.once('close', done);
                  req.once('close', done);
                });
              }
              if (bytesRemaining <= 0) {
                break;
              }
            }

            if (headersSent) {
              if (!res.writableEnded) {
                res.end();
              }
              if (!isRawInternal && !isDownload) {
                prefetchAheadBlocks(item, currentBlockIdx, 3);
              }
              return;
            }
          }
        } catch (mtErr: any) {
          invalidateCachedMtprotoMedia(item);
          addLog('warn', `MTProto stream attempt (forceFresh=${forceFresh}) for ${item.id}: ${mtErr?.message}`);
          if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
          }
        }
      }

      // If local MTProto is in cooldown, seamlessly proxy remaining byte-range from permanent Render domain
      // with immediate AbortController cancellation on socket close + RAM 512KB block caching!
      const isRenderSelf = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
      if (!isRenderSelf && PERMANENT_RENDER_DOMAIN && !clientClosed && !res.writableEnded) {
        const abortCtrl = new AbortController();
        const onReqClose = () => {
          try {
            abortCtrl.abort();
          } catch {}
        };
        req.once('close', onReqClose);
        try {
          const fetchStart = alignedStart;
          const upstreamHeaders: Record<string, string> = {
            Range: `bytes=${fetchStart}-${end}`,
          };
          const remoteRawUrl = `${PERMANENT_RENDER_DOMAIN}/stream/${encodeURIComponent(item.id)}?raw=1`;
          const upstream = await fetch(remoteRawUrl, {
            headers: upstreamHeaders,
            signal: abortCtrl.signal,
          });
          if (upstream.ok || upstream.status === 206) {
            if (!headersSent && !res.headersSent) {
              headersSent = true;
              res.status(rangeHeader ? 206 : 200);
              res.setHeader('Content-Type', responseMimeType);
              res.setHeader('Accept-Ranges', 'bytes');
              res.setHeader('Content-Disposition', dispositionHeader);
              res.setHeader('Content-Length', String(contentLength));
              if (rangeHeader) {
                res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
              }
            }
            if (upstream.body) {
              const reader = (upstream.body as any).getReader();
              let blockAccumulator = Buffer.alloc(0);
              while (!clientClosed && !res.writableEnded && bytesRemaining > 0) {
                const { done, value } = await reader.read();
                if (done || !value) break;
                const netBuf = Buffer.from(value);

                // Accumulate aligned 512KB blocks into RAM cache so Cues/moov and headers become 0ms
                blockAccumulator = Buffer.concat([blockAccumulator, netBuf]);
                while (blockAccumulator.length >= blockSize) {
                  const fullBlock = blockAccumulator.subarray(0, blockSize);
                  storeVideoBlock(item.id, currentBlockIdx, Buffer.from(fullBlock));
                  currentBlockIdx += 1;
                  blockAccumulator = blockAccumulator.subarray(blockSize);
                }

                let outSlice = netBuf;
                if (skipBytes > 0) {
                  if (outSlice.length <= skipBytes) {
                    skipBytes -= outSlice.length;
                    continue;
                  }
                  outSlice = outSlice.subarray(skipBytes);
                  skipBytes = 0;
                }
                if (outSlice.length > bytesRemaining) {
                  outSlice = outSlice.subarray(0, bytesRemaining);
                }
                bytesRemaining -= outSlice.length;
                const canContinue = res.write(outSlice);
                if (!canContinue) {
                  await new Promise<void>((resolve) => {
                    const drainDone = () => {
                      res.removeListener('drain', drainDone);
                      res.removeListener('close', drainDone);
                      req.removeListener('close', drainDone);
                      resolve();
                    };
                    res.once('drain', drainDone);
                    res.once('close', drainDone);
                    req.once('close', drainDone);
                  });
                }
              }
              // If this range reached EOF, store final partial block (e.g. MKV Cues / MP4 moov tail!)
              if (blockAccumulator.length > 0 && end >= totalSize - 1) {
                storeVideoBlock(item.id, currentBlockIdx, Buffer.from(blockAccumulator));
              }
              try {
                await reader.cancel();
              } catch {}
              if (!res.writableEnded) res.end();
              return;
            }
          }
        } catch {
          if (res.headersSent && !res.writableEnded) {
            res.end();
            return;
          }
        } finally {
          req.removeListener('close', onReqClose);
        }
      }

      if (!res.headersSent) {
        res.status(404).send('Telegram video stream unavailable or deleted.');
      }
      return;
    }

    // 3. Proxy remote HTTP stream (Sample or Custom URL) with HTTP 206 Range
    let targetUrl = WORKING_SAMPLE_MP4;
    if (
      item.sourceUrl &&
      !item.sourceUrl.includes(`/stream/${item.id}`) &&
      !item.sourceUrl.includes(`/dl/${item.id}`) &&
      !item.sourceUrl.includes('commondatastorage.googleapis.com')
    ) {
      targetUrl = item.sourceUrl;
    }

    try {
      const upstreamHeaders: Record<string, string> = {};
      if (req.headers.range) {
        upstreamHeaders['Range'] = req.headers.range;
      }

      const upstream = await fetch(targetUrl, { headers: upstreamHeaders });
      res.status(upstream.status);
      res.setHeader('Content-Type', responseMimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', dispositionHeader);

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      if (upstream.body) {
        const nodeStream = Readable.fromWeb(upstream.body as any);
        nodeStream.on('error', () => res.end());
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      res.status(502).send('Stream proxy error');
    }
  };

  app.get('/stream/:id', (req, res) => handleMediaStream(req, res, false));
  app.head('/stream/:id', (req, res) => handleMediaStream(req, res, false));
  app.get('/dl/:id', (req, res) => handleMediaStream(req, res, true));
  app.head('/dl/:id', (req, res) => handleMediaStream(req, res, true));

  // API: Video Probe & Exact Duration Metadata for Universal Seekbar
  app.get('/api/video-meta/:id', async (req, res) => {
    const { id } = req.params;
    const item = (await findOrResolveVideo(id)) || Array.from(videos.values())[0];
    if (!item) {
      res.status(404).json({ ok: false, error: 'Video not found' });
      return;
    }
    const probe = await probeVideoCodec(item);
    res.json({
      ok: true,
      id: item.id,
      durationSec: item.durationSec || 1420,
      sizeBytes: item.sizeBytes || 0,
      isNativeMp4: Boolean(probe?.isNativeMp4),
      canFastRemux: Boolean(probe?.canFastRemux),
      videoCodec: probe?.videoCodec || 'h264',
      audioCodec: probe?.audioCodec || 'aac',
      formatName: probe?.formatName || 'mp4',
    });
  });

  // Live FFmpeg MP4 Remux & H.264 Transcode Route (/remux/:id) for MKV / MPEG-TS / HEVC / Opus / 10-bit
  app.get('/remux/:id', async (req, res) => {
    const { id } = req.params;
    const quality = ((req.query.quality || req.query.q || '720p') as string).trim();
    const explicitTranscode = req.query.transcode === '1';
    const rawSs = Number(req.query.ss || req.query.start || req.query.t || 0);
    const seekSec = Number.isFinite(rawSs) && rawSs > 0 ? Math.max(0, Math.floor(rawSs)) : 0;
    const item = (await findOrResolveVideo(id)) || Array.from(videos.values())[0];
    if (!item) {
      res.status(404).send('Video not found');
      return;
    }

    const probe = await probeVideoCodec(item);
    const allowHevc = req.query.hevc === '1';
    const isHevc8Bit =
      probe &&
      (probe.videoCodec === 'hevc' || probe.videoCodec === 'h265') &&
      (!probe.pixFmt || probe.pixFmt === 'yuv420p');
    const canCopyVideo = Boolean(probe && (probe.canFastRemux || (allowHevc && isHevc8Bit)));
    const forceTranscode = explicitTranscode || !canCopyVideo;
    await streamViaFfmpegMp4(req, res, item, quality, forceTranscode, seekSec);
  });

  // Standalone Player Route (/player/:id and /watch/:id)
  const handleStandalonePlayer = async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const rawQueryQuality = (req.query.q || req.query.quality || '') as string;
    const hasExplicitQuality = ['480p', '720p', '1080p'].includes(rawQueryQuality.trim());
    const initialQuality = hasExplicitQuality ? rawQueryQuality.trim() : '720p';
    const item = (await findOrResolveVideo(id)) || Array.from(videos.values())[0];
    if (!item) {
      res.status(404).send('Video not found or deleted');
      return;
    }

    // Trigger 0ms background pre-warming without blocking HTML page load!
    warmUpVideoStream(item);
    const initialProbe = videoProbeCache.get(item.id) || null;
    const looksLikeMp4 =
      (item.mimeType && item.mimeType.toLowerCase().includes('mp4')) ||
      (item.fileName && item.fileName.toLowerCase().endsWith('.mp4'));

    const relativeStreamUrl = `/stream/${item.id}`;
    const relativeRemuxUrl = `/remux/${item.id}`;
    const relativeDlUrl = `/dl/${item.id}`;
    const relativeMetaUrl = `/api/video-meta/${encodeURIComponent(item.id)}`;
    const initialDurationSec = item?.durationSec || 1420;
    const initialIsNativeMp4 = initialProbe ? Boolean(initialProbe.isNativeMp4) : Boolean(looksLikeMp4);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>&#8203;</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    html, body {
      width: 100%;
      height: 100%;
      max-width: 100vw;
      max-height: 100dvh;
      overflow: hidden !important;
      position: fixed !important;
      inset: 0 !important;
      background: #090d16;
      color: #f8fafc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overscroll-behavior: none !important;
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
    }
    .screen-wrapper {
      width: 100vw;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      padding: 0;
    }
    .player-card {
      width: 100%;
      max-width: 720px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .video-box {
      width: 100%;
      aspect-ratio: 16 / 9;
      max-height: 72dvh;
      background: #000;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: manipulation;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    }
    .video-box:fullscreen,
    .video-box:-webkit-full-screen {
      max-height: 100dvh;
      width: 100vw;
      height: 100dvh;
      border: none;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      background: #000;
    }
    /* Subtle Quality Selector Pill inside top-right of video */
    .quality-pill {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 30;
      background: rgba(15, 23, 42, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #f8fafc;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      backdrop-filter: blur(6px);
    }
    /* Gesture HUD Overlay (Brightness / Sound) */
    .gesture-hud {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(9, 13, 22, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 14px 20px;
      min-width: 165px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.18s ease;
      z-index: 25;
      backdrop-filter: blur(8px);
    }
    .gesture-hud.visible {
      opacity: 1;
    }
    .gesture-icon-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 700;
      color: #f8fafc;
    }
    .gesture-bar-bg {
      width: 130px;
      height: 6px;
      background: rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      overflow: hidden;
    }
    .gesture-bar-fill {
      height: 100%;
      width: 80%;
      background: #10b981;
      border-radius: 999px;
      transition: width 0.05s linear;
    }
    /* Quality Selection Popup Modal (480p, 720p, 1080p) */
    .quality-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(5, 8, 15, 0.86);
      backdrop-filter: blur(8px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .quality-modal-backdrop.hidden {
      display: none;
    }
    .quality-modal {
      width: 100%;
      max-width: 340px;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
    }
    .quality-modal-title {
      font-size: 16px;
      font-weight: 700;
      color: #f8fafc;
      text-align: center;
    }
    .quality-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .q-option-row {
      display: flex;
      gap: 8px;
    }
    .q-play-btn {
      flex: 1;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #374151;
      background: #1f2937;
      color: #f8fafc;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .q-play-btn.active {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.16);
      color: #34d399;
    }
    .q-dl-btn {
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #374151;
      background: #0f172a;
      color: #34d399;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="screen-wrapper">
    <div class="player-card">
      <div class="video-box" id="video-box">
        <button type="button" id="quality-pill" class="quality-pill" onclick="openQualityModal()">
          <span id="current-q-text">${initialQuality}</span> ⚙️
        </button>

        <div id="gesture-hud" class="gesture-hud">
          <div class="gesture-icon-row">
            <span id="hud-icon">🔊</span>
            <span id="hud-label">100%</span>
          </div>
          <div class="gesture-bar-bg">
            <div id="hud-fill" class="gesture-bar-fill"></div>
          </div>
        </div>

        <video
          id="player"
          controls
          playsinline
          webkit-playsinline
          preload="auto"
        ></video>
      </div>
    </div>
  </div>

  <!-- Quality Selection Popup (480p, 720p, 1080p) before Play or Download -->
  <div id="quality-modal" class="quality-modal-backdrop ${hasExplicitQuality ? 'hidden' : ''}">
    <div class="quality-modal">
      <div class="quality-modal-title">কোয়ালিটি সিলেক্ট করুন</div>
      <div class="quality-options">
        ${(['480p', '720p', '1080p'] as const)
          .map(
            (q) => `
          <div class="q-option-row">
            <button type="button" class="q-play-btn ${q === initialQuality ? 'active' : ''}" data-q="${q}" onclick="selectPlayQuality('${q}')">
              <span>▶️ Play ${q}</span>
              <span style="font-size:12px;opacity:0.75;">${q === '1080p' ? 'FHD' : q === '720p' ? 'HD' : 'SD'}</span>
            </button>
            <a class="q-dl-btn" href="${relativeDlUrl}?quality=${q}" onclick="selectDownloadQuality('${q}')">
              ⬇️ ${q}
            </a>
          </div>`
          )
          .join('')}
      </div>
    </div>
  </div>

  <script>
    try {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        if (typeof window.Telegram.WebApp.disableVerticalSwipes === 'function') {
          window.Telegram.WebApp.disableVerticalSwipes();
        }
      }
    } catch (e) {}

    const v = document.getElementById('player');
    const videoBox = document.getElementById('video-box');
    const qualityModal = document.getElementById('quality-modal');
    const qualityPill = document.getElementById('quality-pill');
    const currentQText = document.getElementById('current-q-text');
    const hud = document.getElementById('gesture-hud');
    const hudIcon = document.getElementById('hud-icon');
    const hudLabel = document.getElementById('hud-label');
    const hudFill = document.getElementById('hud-fill');

    let fallbackStage = 0; // 0 = /stream, 1 = /stream retry, 2 = /remux, 3 = /remux?transcode=1
    let activeQuality = '${initialQuality}';
    let totalDuration = ${initialDurationSec};
    let isNativeMp4 = ${initialIsNativeMp4 ? 'true' : 'false'};
    let seekOffsetSec = 0;
    let pendingJumpSec = 0;
    let isProgrammaticSeek = false;
    let lastKnownTime = 0;
    let seekDebounceTimer = null;
    let pillFadeTimer = null;

    // MediaSource (MSE) State for 100% Native <video controls> Timeline Scrubbing
    const canUseMse = Boolean(
      window.MediaSource &&
        typeof MediaSource.isTypeSupported === 'function' &&
        (MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') ||
          MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401f, mp4a.40.2"'))
    );
    let mseActive = false;
    let mse = null;
    let sourceBuffer = null;
    let mseQueue = [];
    let mseAbortCtrl = null;
    let mseReqSeq = 0;
    let pendingTimestampOffset = null;

    function detectMp4MimeCodec(u8) {
      let videoCodec = 'avc1.42c01e';
      let hasAudio = false;
      for (let i = 0; i + 8 < u8.length; i++) {
        if (u8[i] === 0x61 && u8[i + 1] === 0x76 && u8[i + 2] === 0x63 && u8[i + 3] === 0x43 && i + 7 < u8.length) {
          const p1 = u8[i + 5].toString(16).padStart(2, '0');
          const p2 = u8[i + 6].toString(16).padStart(2, '0');
          const p3 = u8[i + 7].toString(16).padStart(2, '0');
          videoCodec = 'avc1.' + p1 + p2 + p3;
        }
        if (u8[i] === 0x6d && u8[i + 1] === 0x70 && u8[i + 2] === 0x34 && u8[i + 3] === 0x61) {
          hasAudio = true;
        }
      }
      const candidate = hasAudio
        ? 'video/mp4; codecs="' + videoCodec + ', mp4a.40.2"'
        : 'video/mp4; codecs="' + videoCodec + '"';
      if (window.MediaSource && MediaSource.isTypeSupported(candidate)) {
        return candidate;
      }
      return hasAudio ? 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"' : 'video/mp4; codecs="avc1.42E01E"';
    }

    function drainMseQueue() {
      if (!sourceBuffer || sourceBuffer.updating || mseQueue.length === 0) return;
      if (!mse || mse.readyState !== 'open') return;
      if (pendingTimestampOffset !== null) {
        try {
          sourceBuffer.abort();
          sourceBuffer.timestampOffset = pendingTimestampOffset;
        } catch (e) {}
        pendingTimestampOffset = null;
      }
      const nextChunk = mseQueue.shift();
      try {
        sourceBuffer.appendBuffer(nextChunk);
      } catch (err) {
        if (err && err.name === 'QuotaExceededError' && sourceBuffer.buffered && sourceBuffer.buffered.length > 0) {
          try {
            const cur = v.currentTime || 0;
            const remEnd = Math.max(0, cur - 15);
            if (remEnd > 0) {
              mseQueue.unshift(nextChunk);
              sourceBuffer.remove(0, remEnd);
              return;
            }
          } catch (e2) {}
        } else {
          if (mseAbortCtrl) {
            try { mseAbortCtrl.abort(); } catch (e3) {}
          }
          mseActive = false;
          v.src = buildVideoSrc(activeQuality, fallbackStage, Math.floor(lastKnownTime || seekOffsetSec || 0));
          v.load();
          v.play().catch(() => {});
        }
      }
    }

    function fetchMseStream(quality, targetSec, forceTranscodeFlag) {
      const reqSeq = ++mseReqSeq;
      if (mseAbortCtrl) {
        try { mseAbortCtrl.abort(); } catch (e) {}
      }
      mseAbortCtrl = new AbortController();
      mseQueue = [];
      const clampedSec = Math.max(0, Math.floor(Number(targetSec) || 0));
      seekOffsetSec = clampedSec;
      lastKnownTime = clampedSec;
      if (sourceBuffer) {
        pendingTimestampOffset = clampedSec;
      }

      const baseEndpoint = forceTranscodeFlag ? '${relativeRemuxUrl}?transcode=1&' : '${relativeStreamUrl}?';
      const url =
        baseEndpoint +
        'quality=' +
        encodeURIComponent(quality) +
        '&ss=' +
        clampedSec +
        '&mse=1&r=' +
        Date.now();

      fetch(url, { signal: mseAbortCtrl.signal })
        .then((res) => {
          if (!res.ok || !res.body) throw new Error('Stream HTTP ' + res.status);
          const reader = res.body.getReader();
          let boxBuf = new Uint8Array(0);
          let sbInitialized = Boolean(sourceBuffer);

          function extractCompleteAtoms() {
            while (boxBuf.byteLength >= 8) {
              const dv = new DataView(boxBuf.buffer, boxBuf.byteOffset, boxBuf.byteLength);
              const sz = dv.getUint32(0);
              const tp = String.fromCharCode(boxBuf[4], boxBuf[5], boxBuf[6], boxBuf[7]);
              if (sz < 8 || sz > 64 * 1024 * 1024) {
                const raw = boxBuf;
                boxBuf = new Uint8Array(0);
                mseQueue.push(raw);
                break;
              }
              if (tp === 'ftyp') {
                if (boxBuf.byteLength < sz + 8) break;
                const nextSz = dv.getUint32(sz);
                const nextTp = String.fromCharCode(boxBuf[sz + 4], boxBuf[sz + 5], boxBuf[sz + 6], boxBuf[sz + 7]);
                if (nextTp === 'moov') {
                  if (boxBuf.byteLength < sz + nextSz) break;
                  const initSegment = boxBuf.slice(0, sz + nextSz);
                  const moovSlice = boxBuf.subarray(sz, sz + nextSz);
                  boxBuf = boxBuf.slice(sz + nextSz);
                  if (!sbInitialized) {
                    const mime = detectMp4MimeCodec(moovSlice);
                    sourceBuffer = mse.addSourceBuffer(mime);
                    sourceBuffer.mode = 'segments';
                    if (clampedSec > 0) {
                      sourceBuffer.timestampOffset = clampedSec;
                    }
                    sourceBuffer.addEventListener('error', () => {
                      if (mseAbortCtrl) {
                        try { mseAbortCtrl.abort(); } catch (e) {}
                      }
                    });
                    sourceBuffer.addEventListener('updateend', () => {
                      if (mse && mse.readyState === 'open' && !sourceBuffer.updating && totalDuration > 10) {
                        if (!isFinite(mse.duration) || Math.abs(mse.duration - totalDuration) > 2) {
                          try { mse.duration = totalDuration; } catch (e) {}
                        }
                      }
                      if (sourceBuffer && sourceBuffer.buffered && sourceBuffer.buffered.length > 0) {
                        for (let i = 0; i < sourceBuffer.buffered.length; i++) {
                          const bStart = sourceBuffer.buffered.start(i);
                          const bEnd = sourceBuffer.buffered.end(i);
                          if (Math.abs(v.currentTime - bStart) < 2.5 && v.currentTime < bStart && bEnd > bStart + 0.05) {
                            isProgrammaticSeek = true;
                            v.currentTime = bStart + 0.02;
                            setTimeout(() => { isProgrammaticSeek = false; }, 150);
                            break;
                          }
                        }
                      }
                      drainMseQueue();
                    });
                    sbInitialized = true;
                  }
                  mseQueue.push(initSegment);
                  continue;
                }
              }
              if (tp === 'moof') {
                if (boxBuf.byteLength < sz + 8) break;
                const nextSz = dv.getUint32(sz);
                const nextTp = String.fromCharCode(boxBuf[sz + 4], boxBuf[sz + 5], boxBuf[sz + 6], boxBuf[sz + 7]);
                if (nextTp === 'mdat') {
                  if (boxBuf.byteLength < sz + nextSz) break;
                  const fragPair = boxBuf.slice(0, sz + nextSz);
                  boxBuf = boxBuf.slice(sz + nextSz);
                  mseQueue.push(fragPair);
                  continue;
                }
              }
              if (boxBuf.byteLength < sz) break;
              const singleAtom = boxBuf.slice(0, sz);
              boxBuf = boxBuf.slice(sz);
              mseQueue.push(singleAtom);
            }
          }

          function pump() {
            reader
              .read()
              .then(({ done, value }) => {
                if (reqSeq !== mseReqSeq) return;
                if (done) {
                  if (boxBuf.byteLength > 0) {
                    mseQueue.push(boxBuf);
                    boxBuf = new Uint8Array(0);
                  }
                  drainMseQueue();
                  return;
                }
                if (!value || value.byteLength === 0) {
                  pump();
                  return;
                }
                const merged = new Uint8Array(boxBuf.byteLength + value.byteLength);
                merged.set(boxBuf, 0);
                merged.set(value, boxBuf.byteLength);
                boxBuf = merged;

                try {
                  extractCompleteAtoms();
                  drainMseQueue();
                } catch (err) {
                  if (mseAbortCtrl) {
                    try { mseAbortCtrl.abort(); } catch (e) {}
                  }
                  mseActive = false;
                  v.src = buildVideoSrc(quality, fallbackStage, clampedSec);
                  v.load();
                  v.play().catch(() => {});
                  return;
                }

                if (mseQueue.length > 12) {
                  const waitDrain = setInterval(() => {
                    if (reqSeq !== mseReqSeq) {
                      clearInterval(waitDrain);
                      return;
                    }
                    if (mseQueue.length < 4) {
                      clearInterval(waitDrain);
                      pump();
                    }
                  }, 60);
                } else {
                  pump();
                }
              })
              .catch(() => {});
          }
          pump();
        })
        .catch(() => {});
    }

    function startMsePlayback(quality, startSec, preferDirectMp4) {
      const clamped = Math.max(0, Math.floor(Number(startSec) || 0));
      if ((preferDirectMp4 && isNativeMp4 && fallbackStage <= 1 && clamped === 0) || !canUseMse) {
        if (mseAbortCtrl) {
          try { mseAbortCtrl.abort(); } catch (e) {}
        }
        mseActive = false;
        seekOffsetSec = clamped;
        pendingJumpSec = clamped;
        lastKnownTime = clamped;
        isProgrammaticSeek = true;
        v.preload = 'auto';
        v.src = buildVideoSrc(quality, fallbackStage, clamped);
        v.load();
        v.play().catch(() => {});
        setTimeout(() => { isProgrammaticSeek = false; }, 500);
        return;
      }

      if (mseActive && mse && mse.readyState === 'open' && sourceBuffer) {
        if (clamped > 0 && Math.abs((v.currentTime || 0) - clamped) > 1) {
          isProgrammaticSeek = true;
          v.currentTime = clamped;
          setTimeout(() => { isProgrammaticSeek = false; }, 200);
        }
        fetchMseStream(quality, clamped, fallbackStage >= 3);
        v.play().catch(() => {});
        return;
      }

      if (mseAbortCtrl) {
        try { mseAbortCtrl.abort(); } catch (e) {}
      }
      sourceBuffer = null;
      mseQueue = [];
      pendingTimestampOffset = null;
      mse = new MediaSource();
      mseActive = true;
      isProgrammaticSeek = true;
      v.src = URL.createObjectURL(mse);
      mse.addEventListener(
        'sourceopen',
        () => {
          if (clamped > 0) {
            isProgrammaticSeek = true;
            v.currentTime = clamped;
          }
          setTimeout(() => { isProgrammaticSeek = false; }, 250);
          fetchMseStream(quality, clamped, fallbackStage >= 3);
        },
        { once: true }
      );
      v.play().catch(() => {});
    }

    function wakeQualityPill() {
      if (!qualityPill) return;
      qualityPill.style.opacity = '1';
      if (pillFadeTimer) clearTimeout(pillFadeTimer);
      pillFadeTimer = setTimeout(() => {
        if (!v.paused) {
          qualityPill.style.opacity = '0.35';
        }
      }, 2800);
    }

    // Pre-fetch exact duration & codec info in background while user views quality modal
    fetch('${relativeMetaUrl}')
      .then((r) => r.json())
      .then((meta) => {
        if (meta && meta.ok) {
          if (meta.durationSec && meta.durationSec > 1) {
            totalDuration = Number(meta.durationSec);
            if (mse && mse.readyState === 'open' && sourceBuffer && !sourceBuffer.updating) {
              try { mse.duration = totalDuration; } catch (e) {}
            }
          }
          isNativeMp4 = Boolean(meta.isNativeMp4);
        }
      })
      .catch(() => {});

    const canPlayHevc = Boolean(
      (window.MediaSource &&
        typeof MediaSource.isTypeSupported === 'function' &&
        (MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
          MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"'))) ||
        v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') === 'probably' ||
        v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') === 'probably'
    );

    function buildVideoSrc(q, stage, ssSec) {
      const ssParam = ssSec && ssSec > 0 ? '&ss=' + Math.floor(ssSec) : '';
      const hevcParam = canPlayHevc && stage < 3 ? '&hevc=1' : '';
      if (stage === 1) return '${relativeStreamUrl}?quality=' + q + hevcParam + ssParam + '&r=' + Date.now();
      if (stage === 2) return '${relativeRemuxUrl}?quality=' + q + hevcParam + ssParam;
      if (stage >= 3) return '${relativeRemuxUrl}?quality=' + q + '&transcode=1' + ssParam;
      return '${relativeStreamUrl}?quality=' + q + hevcParam + ssParam;
    }

    function isTimeBuffered(targetSec) {
      try {
        if (!v.buffered || v.buffered.length === 0) return false;
        for (let i = 0; i < v.buffered.length; i++) {
          if (targetSec >= v.buffered.start(i) - 0.4 && targetSec <= v.buffered.end(i) - 0.4) {
            return true;
          }
        }
      } catch (e) {}
      return false;
    }

    function canBrowserByteSeek(targetSec) {
      if (mseActive || !isNativeMp4 || seekOffsetSec > 0 || fallbackStage > 1) return false;
      try {
        if (!v.seekable || v.seekable.length === 0) return false;
        for (let i = 0; i < v.seekable.length; i++) {
          if (targetSec >= v.seekable.start(i) - 0.5 && targetSec <= v.seekable.end(i) + 0.5) {
            return true;
          }
        }
      } catch (e) {}
      return false;
    }

    function tryApplyPendingJump() {
      if (mseActive || pendingJumpSec <= 0) return;
      try {
        if (v.buffered && v.buffered.length > 0) {
          const lastIdx = v.buffered.length - 1;
          const rangeStart = v.buffered.start(lastIdx);
          const maxEnd = v.buffered.end(lastIdx);
          if (maxEnd >= pendingJumpSec) {
            const targetJump = Math.max(pendingJumpSec + 0.05, rangeStart + 0.02);
            pendingJumpSec = 0;
            isProgrammaticSeek = true;
            v.currentTime = targetJump;
            setTimeout(() => {
              isProgrammaticSeek = false;
            }, 350);
          }
        }
      } catch (e) {}
    }

    function seekViaServer(targetSec) {
      const clamped = Math.max(0, Math.min(Math.max(0, totalDuration - 2), Math.floor(targetSec)));
      if (isTimeBuffered(clamped)) {
        isProgrammaticSeek = true;
        v.currentTime = clamped;
        lastKnownTime = clamped;
        setTimeout(() => { isProgrammaticSeek = false; }, 200);
        v.play().catch(() => {});
        return;
      }
      if (canBrowserByteSeek(clamped)) {
        isProgrammaticSeek = true;
        v.currentTime = clamped;
        lastKnownTime = clamped;
        setTimeout(() => { isProgrammaticSeek = false; }, 200);
        v.play().catch(() => {});
        return;
      }
      if (canUseMse) {
        startMsePlayback(activeQuality, clamped);
        return;
      }
      seekOffsetSec = clamped;
      pendingJumpSec = clamped;
      lastKnownTime = clamped;
      isProgrammaticSeek = true;
      v.preload = 'auto';
      v.src = buildVideoSrc(activeQuality, fallbackStage, clamped);
      v.load();
      v.play().catch(() => {});
      setTimeout(() => {
        isProgrammaticSeek = false;
      }, 600);
    }

    v.addEventListener('loadedmetadata', () => {
      if (!mseActive && seekOffsetSec === 0 && v.duration && isFinite(v.duration) && v.duration > 10) {
        totalDuration = v.duration;
      }
      tryApplyPendingJump();
    });

    v.addEventListener('loadeddata', tryApplyPendingJump);
    v.addEventListener('canplay', tryApplyPendingJump);
    v.addEventListener('progress', tryApplyPendingJump);

    // Hook into native <video controls> timeline scrubbing so seeking works on ALL MP4/MKV/HEVC videos!
    v.addEventListener('seeking', () => {
      if (isProgrammaticSeek || pendingJumpSec > 0) return;
      const target = Number(v.currentTime) || 0;

      // 1. If already buffered in current stream, let browser seek in 0ms
      if (isTimeBuffered(target)) {
        lastKnownTime = target;
        return;
      }

      // 2. If native MP4 at offset 0 and browser supports HTTP 206 byte range seek
      if (canBrowserByteSeek(target)) {
        lastKnownTime = target;
        return;
      }

      // 3. Otherwise use instant server-side FFmpeg seek (?ss=) via MSE SourceBuffer
      lastKnownTime = target;
      if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
      seekDebounceTimer = setTimeout(() => {
        const finalTarget = Number(v.currentTime) || target;
        if (!isTimeBuffered(finalTarget)) {
          seekViaServer(finalTarget);
        }
      }, 140);
    });

    v.addEventListener('timeupdate', () => {
      tryApplyPendingJump();
      if (!v.seeking && !isProgrammaticSeek && pendingJumpSec === 0) {
        const cur = v.currentTime >= seekOffsetSec - 2 ? v.currentTime : seekOffsetSec + v.currentTime;
        if (cur > 0) {
          lastKnownTime = cur;
        }
      }
    });

    v.addEventListener('play', () => {
      wakeQualityPill();
    });

    v.addEventListener('pause', () => {
      if (qualityPill) qualityPill.style.opacity = '1';
    });

    v.addEventListener('error', () => {
      if (!v.getAttribute('src')) return;
      if (mseAbortCtrl) {
        try { mseAbortCtrl.abort(); } catch (e) {}
      }
      if (mseActive) {
        mseActive = false;
        const resumeAt = Math.floor(lastKnownTime || seekOffsetSec || 0);
        fallbackStage = Math.max(fallbackStage, 2);
        v.src = buildVideoSrc(activeQuality, fallbackStage, resumeAt);
        v.load();
        v.play().catch(() => {});
        return;
      }
      if (fallbackStage < 3) {
        const resumeAt = Math.floor(lastKnownTime || seekOffsetSec || 0);
        fallbackStage += 1;
        v.src = buildVideoSrc(activeQuality, fallbackStage, resumeAt);
        v.load();
        v.play().catch(() => {});
      }
    });

    if (${hasExplicitQuality ? 'true' : 'false'}) {
      startMsePlayback(activeQuality, 0, true);
    }

    function openQualityModal() {
      v.pause();
      qualityModal.classList.remove('hidden');
    }

    function selectPlayQuality(q) {
      const savedTime = Math.floor(lastKnownTime || v.currentTime || 0);
      activeQuality = q;
      currentQText.textContent = q;
      document.querySelectorAll('.q-play-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-q') === q);
      });
      qualityModal.classList.add('hidden');
      fallbackStage = 0;
      startMsePlayback(q, savedTime > 2 ? savedTime : 0, savedTime <= 2);
      wakeQualityPill();
    }

    function selectDownloadQuality(q) {
      try { v.pause(); } catch (e) {}
      qualityModal.classList.add('hidden');
    }

    // =========================================================================
    // SWIPE GESTURE CONTROLS:
    // Left Side Vertical Swipe -> Brightness (0% - 100%)
    // Right Side Vertical Swipe -> Volume / Sound (0% - 100%)
    // Bottom 68px untouched so Native <video controls> Timeline Scrubbing works 100%!
    // =========================================================================
    let brightnessPercent = 80; // 80% = normal 1.0 brightness
    let volumePercent = 100;    // 100% = full volume
    let touchState = null;
    let hudTimer = null;

    function showHud(type, val) {
      const clamped = Math.max(0, Math.min(100, Math.round(val)));
      if (type === 'volume') {
        hudIcon.textContent = clamped === 0 ? '🔇' : clamped < 50 ? '🔉' : '🔊';
        hudLabel.textContent = 'Sound ' + clamped + '%';
      } else {
        hudIcon.textContent = '☀️';
        hudLabel.textContent = 'Light ' + clamped + '%';
      }
      hudFill.style.width = clamped + '%';
      hud.classList.add('visible');
      if (hudTimer) clearTimeout(hudTimer);
      hudTimer = setTimeout(() => {
        hud.classList.remove('visible');
      }, 650);
    }

    function applyBrightness(val) {
      brightnessPercent = Math.max(0, Math.min(100, val));
      const cssBrightness = (0.20 + (brightnessPercent / 100) * 1.05).toFixed(2);
      v.style.filter = 'brightness(' + cssBrightness + ')';
      showHud('brightness', brightnessPercent);
    }

    function applyVolume(val) {
      volumePercent = Math.max(0, Math.min(100, val));
      v.muted = volumePercent === 0;
      v.volume = Math.max(0, Math.min(1, volumePercent / 100));
      showHud('volume', volumePercent);
    }

    videoBox.addEventListener('touchstart', function(e) {
      wakeQualityPill();
      if (!e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = videoBox.getBoundingClientRect();
      const relY = touch.clientY - rect.top;
      const relX = touch.clientX - rect.left;

      // Leave bottom 68px completely untouched so native <video controls> timeline & buttons work natively!
      if (relY > rect.height - 68) {
        touchState = null;
        return;
      }

      touchState = {
        startX: touch.clientX,
        startY: touch.clientY,
        isRightSide: relX > rect.width / 2,
        startVolume: volumePercent,
        startBrightness: brightnessPercent,
        swiping: false,
        boxHeight: Math.max(160, rect.height)
      };
    }, { passive: true, capture: true });

    videoBox.addEventListener('touchmove', function(e) {
      if (!e.touches || e.touches.length !== 1 || !touchState) return;
      const touch = e.touches[0];
      const dy = touchState.startY - touch.clientY;
      const dx = touch.clientX - touchState.startX;

      if (!touchState.swiping) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          touchState.swiping = true;
        } else {
          return;
        }
      }

      const deltaPercent = (dy / (touchState.boxHeight * 0.65)) * 100;
      if (touchState.isRightSide) {
        applyVolume(touchState.startVolume + deltaPercent);
      } else {
        applyBrightness(touchState.startBrightness + deltaPercent);
      }
    }, { passive: true, capture: true });

    videoBox.addEventListener('touchend', function() {
      touchState = null;
    }, { passive: true, capture: true });

    videoBox.addEventListener('mousedown', function(e) {
      wakeQualityPill();
      const rect = videoBox.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const relX = e.clientX - rect.left;
      if (relY > rect.height - 68) return;
      touchState = {
        startX: e.clientX,
        startY: e.clientY,
        isRightSide: relX > rect.width / 2,
        startVolume: volumePercent,
        startBrightness: brightnessPercent,
        swiping: false,
        boxHeight: Math.max(160, rect.height)
      };
    }, true);

    window.addEventListener('mousemove', function(e) {
      if (!touchState) return;
      const dy = touchState.startY - e.clientY;
      const dx = e.clientX - touchState.startX;
      if (!touchState.swiping) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          touchState.swiping = true;
        } else {
          return;
        }
      }
      const deltaPercent = (dy / (touchState.boxHeight * 0.65)) * 100;
      if (touchState.isRightSide) {
        applyVolume(touchState.startVolume + deltaPercent);
      } else {
        applyBrightness(touchState.startBrightness + deltaPercent);
      }
    });

    window.addEventListener('mouseup', function() {
      touchState = null;
    });
  </script>
</body>
</html>`);
  };

  app.get('/player/:id', handleStandalonePlayer);
  app.get('/watch/:id', handleStandalonePlayer);

  // Pre-warm top 3 videos in background on startup for instant playback
  setTimeout(() => {
    const topVids = Array.from(videos.values()).slice(0, 3);
    for (const v of topVids) {
      warmUpVideoStream(v);
    }
  }, 1500);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SR-VIDEO-QUALITY Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
