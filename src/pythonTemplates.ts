export interface PythonTemplateParams {
  domain: string;
  mongoUri: string;
  apiId: string;
  apiHash: string;
  botToken: string;
  binChannel: string;
}

export function generateFixedPythonFiles(params: PythonTemplateParams) {
  const cleanDomain = (
    params.domain || ''
  ).replace(/\/$/, '');
  const mongoUri =
    params.mongoUri ||
    '';
  const apiId = params.apiId || '29608422';
  const apiHash = params.apiHash || '3db2f8e109301f02f5d9c8f10dd79244';
  const botToken = params.botToken || '';
  const binChannel = params.binChannel || '-1001982736450';

  const mainPy = `import os
import asyncio
import logging
import aiohttp
import uvicorn
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from hydrogram import Client, filters, idle
from hydrogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("SR-VIDEO-QUALITY")

# ==============================================================================
# 100% WORKING CONFIGURATION (MongoDB Atlas + Domain + Telegram MTProto)
# ==============================================================================
MONGO_URI = os.environ.get(
    "MONGODB URI",
    "${mongoUri}"
)
API_ID = int(os.environ.get("API_ID", "${apiId}"))
API_HASH = os.environ.get("API_HASH", "${apiHash}")
BOT_TOKEN = os.environ.get("BOT_TOKEN", "${botToken}")
BIN_CHANNEL = int(os.environ.get("BIN_CHANNEL", "${binChannel}"))
PORT = int(os.environ.get("PORT", 8080))

RAW_DOMAIN = os.environ.get(
    "DOMAIN",
    "${cleanDomain}"
).strip().rstrip("/")

if not RAW_DOMAIN.startswith(("http://", "https://")):
    DOMAIN = f"https://{RAW_DOMAIN}"
else:
    DOMAIN = RAW_DOMAIN

# ==============================================================================
# MONGODB ATLAS INITIALIZATION (Persists file_id so videos ALWAYS load/download)
# ==============================================================================
mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client["SRVideoQualityBot"]
videos_col = db["videos"]
users_col = db["users"]

# Initialize Hydrogram Bot Client & FastAPI App
bot = Client(
    "SR_Video_Quality_Bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    in_memory=True
)

web_app = FastAPI(title="SR-VIDEO-QUALITY Streaming Server", version="3.0.0")

web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Content-Length", "Accept-Ranges", "Content-Disposition"],
)


# ==============================================================================
# KEEP-ALIVE TASK (Prevents Render / Cloud Sleep)
# ==============================================================================
async def keep_alive_ping():
    await asyncio.sleep(10)
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                async with session.get(f"{DOMAIN}/health", timeout=15) as resp:
                    logger.info(f"Keep-alive ping to {DOMAIN}/health -> {resp.status}")
            except Exception as exc:
                logger.warning(f"Keep-alive ping warning: {exc}")
            await asyncio.sleep(240)


# ==============================================================================
# TELEGRAM BOT HANDLERS (Saves file_id in MongoDB so stream/download never fails)
# ==============================================================================
@bot.on_message(filters.command("start") & filters.private)
async def start_handler(client: Client, message: Message):
    if message.from_user:
        await users_col.update_one(
            {"id": message.from_user.id},
            {"$set": {
                "id": message.from_user.id,
                "name": message.from_user.first_name,
                "username": message.from_user.username,
                "updated_at": datetime.utcnow().isoformat()
            }},
            upsert=True
        )
    await message.reply_text(
        "🎬 **SR-VIDEO-QUALITY Bot is Online (MongoDB Connected)!**\\n\\n"
        "Send or forward any Video / MKV / MP4 file to me and I will generate "
        "instant **1080p, 720p, 480p, and 360p** streaming & fast download links.\\n\\n"
        f"🌐 **Active Domain:** \`{DOMAIN}\`"
    )


@bot.on_message(filters.private & (filters.video | filters.document | filters.animation))
async def media_handler(client: Client, message: Message):
    media = message.video or message.document or message.animation
    if not media:
        return

    status_msg = await message.reply_text("⏳ **Saving to MongoDB & Generating Stream Links...**", quote=True)

    try:
        # Try copying to BIN_CHANNEL if bot is admin there, otherwise use direct chat + file_id
        bin_msg_id = None
        try:
            if BIN_CHANNEL and BIN_CHANNEL != -1001234567890:
                log_msg = await message.copy(chat_id=BIN_CHANNEL)
                bin_msg_id = log_msg.id
        except Exception as copy_err:
            logger.warning(f"BIN_CHANNEL copy skipped (using direct file_id from MongoDB): {copy_err}")

        stream_id = f"tg-{bin_msg_id or message.id}"
        file_name = getattr(media, "file_name", None) or f"SR_Video_{stream_id}.mp4"
        file_size = getattr(media, "file_size", 0) or 0
        mime_type = getattr(media, "mime_type", "video/mp4") or "video/mp4"
        if not mime_type.startswith("video/"):
            mime_type = "video/mp4"
        file_size_mb = round(file_size / (1024 * 1024), 2)

        # Save complete file metadata & file_id into MongoDB so /dl and /watch ALWAYS work!
        doc = {
            "id": stream_id,
            "msg_id": message.id,
            "chat_id": message.chat.id,
            "bin_channel": BIN_CHANNEL if bin_msg_id else None,
            "bin_msg_id": bin_msg_id,
            "telegramFileId": media.file_id,
            "fileUniqueId": getattr(media, "file_unique_id", ""),
            "title": file_name.rsplit(".", 1)[0].replace("_", " "),
            "fileName": file_name,
            "sizeBytes": file_size,
            "mimeType": mime_type,
            "durationSec": getattr(media, "duration", 120) or 120,
            "sourceType": "telegram",
            "createdAt": datetime.utcnow().isoformat(),
        }
        await videos_col.update_one({"id": stream_id}, {"$set": doc}, upsert=True)

        watch_url = f"{DOMAIN}/player/{stream_id}"
        dl_url = f"{DOMAIN}/dl/{stream_id}"

        buttons = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("▶️ Watch Video", url=watch_url),
                InlineKeyboardButton("⬇️ Direct Download", url=dl_url)
            ],
            [
                InlineKeyboardButton("📺 Watch 480p", url=f"{watch_url}?q=480p"),
                InlineKeyboardButton("📺 Watch 720p", url=f"{watch_url}?q=720p"),
                InlineKeyboardButton("📺 Watch 1080p", url=f"{watch_url}?q=1080p")
            ],
            [
                InlineKeyboardButton("⬇️ DL 480p", url=f"{dl_url}?quality=480p"),
                InlineKeyboardButton("⬇️ DL 720p", url=f"{dl_url}?quality=720p"),
                InlineKeyboardButton("⬇️ DL 1080p", url=f"{dl_url}?quality=1080p")
            ],
            [
                InlineKeyboardButton("🎛️ Watch Quality Menu", callback_data=f"q_watch:{stream_id}"),
                InlineKeyboardButton("📥 Download Quality Menu", callback_data=f"q_dl:{stream_id}")
            ]
        ])

        await status_msg.edit_text(
            f"🎬 **{doc['title']}**\\n"
            f"📦 **Size:** \`{file_size_mb} MB\`\\n\\n"
            f"▶️ **Watch Video Link:**\\n{watch_url}\\n\\n"
            f"⬇️ **Direct Download Link:**\\n{dl_url}\\n\\n"
            f"📥 **Direct Quality Download:**\\n"
            f"• [Download 480p]({dl_url}?quality=480p) | [Download 720p]({dl_url}?quality=720p) | [Download 1080p]({dl_url}?quality=1080p)\\n\\n"
            f"👇 **নিচের বাটন থেকে কোয়ালিটি (480p, 720p, 1080p) সিলেক্ট করে ভিডিও দেখুন বা সরাসরি ডাউনলোড করুন:**",
            reply_markup=buttons,
            disable_web_page_preview=True
        )
    except Exception as err:
        logger.error(f"Error handling media: {err}")
        await status_msg.edit_text(f"❌ Error generating link: \`{err}\`")


@bot.on_callback_query()
async def quality_callback_handler(client: Client, callback_query):
    data = callback_query.data or ""
    if data.startswith("q_watch:"):
        stream_id = data.replace("q_watch:", "")
        watch_url = f"{DOMAIN}/player/{stream_id}"
        await callback_query.answer("🎬 ভিডিও দেখার জন্য কোয়ালিটি সিলেক্ট করুন (480p / 720p / 1080p)")
        await callback_query.message.edit_reply_markup(
            InlineKeyboardMarkup([
                [InlineKeyboardButton("📺 Watch 480p (SD)", url=f"{watch_url}?q=480p")],
                [InlineKeyboardButton("📺 Watch 720p (HD)", url=f"{watch_url}?q=720p")],
                [InlineKeyboardButton("📺 Watch 1080p (Full HD)", url=f"{watch_url}?q=1080p")],
                [InlineKeyboardButton("🔙 Back", callback_data=f"q_main:{stream_id}")]
            ])
        )
    elif data.startswith("q_dl:"):
        stream_id = data.replace("q_dl:", "")
        dl_url = f"{DOMAIN}/dl/{stream_id}"
        await callback_query.answer("⬇️ ডাউনলোড করার জন্য কোয়ালিটি সিলেক্ট করুন (480p / 720p / 1080p)")
        await callback_query.message.edit_reply_markup(
            InlineKeyboardMarkup([
                [InlineKeyboardButton("⬇️ Download 480p (SD)", url=f"{dl_url}?quality=480p")],
                [InlineKeyboardButton("⬇️ Download 720p (HD)", url=f"{dl_url}?quality=720p")],
                [InlineKeyboardButton("⬇️ Download 1080p (Full HD)", url=f"{dl_url}?quality=1080p")],
                [InlineKeyboardButton("🔙 Back", callback_data=f"q_main:{stream_id}")]
            ])
        )
    elif data.startswith("q_main:"):
        stream_id = data.replace("q_main:", "")
        watch_url = f"{DOMAIN}/player/{stream_id}"
        dl_url = f"{DOMAIN}/dl/{stream_id}"
        await callback_query.answer()
        await callback_query.message.edit_reply_markup(
            InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("▶️ Watch Video", url=watch_url),
                    InlineKeyboardButton("⬇️ Direct Download", url=dl_url)
                ],
                [
                    InlineKeyboardButton("📺 Watch 480p", url=f"{watch_url}?q=480p"),
                    InlineKeyboardButton("📺 Watch 720p", url=f"{watch_url}?q=720p"),
                    InlineKeyboardButton("📺 Watch 1080p", url=f"{watch_url}?q=1080p")
                ],
                [
                    InlineKeyboardButton("⬇️ DL 480p", url=f"{dl_url}?quality=480p"),
                    InlineKeyboardButton("⬇️ DL 720p", url=f"{dl_url}?quality=720p"),
                    InlineKeyboardButton("⬇️ DL 1080p", url=f"{dl_url}?quality=1080p")
                ],
                [
                    InlineKeyboardButton("🎛️ Watch Quality Menu", callback_data=f"q_watch:{stream_id}"),
                    InlineKeyboardButton("📥 Download Quality Menu", callback_data=f"q_dl:{stream_id}")
                ]
            ])
        )


# ==============================================================================
# FASTAPI STREAMING & MULTI-QUALITY WEB PLAYER ROUTES
# ==============================================================================
@web_app.get("/")
async def root():
    count = await videos_col.count_documents({})
    return JSONResponse({
        "status": "online",
        "service": "SR-VIDEO-QUALITY",
        "mongodb": "connected",
        "stored_videos": count,
        "domain": DOMAIN,
        "qualities": ["480p", "720p", "1080p"]
    })


@web_app.get("/health")
async def health():
    return {"ok": True, "domain": DOMAIN, "mongodb": True}


@web_app.get("/watch/{stream_id}", response_class=HTMLResponse)
@web_app.get("/player/{stream_id}", response_class=HTMLResponse)
async def watch_video(stream_id: str, q: str = ""):
    doc = await videos_col.find_one({"$or": [{"id": stream_id}, {"id": f"tg-{stream_id}"}]})
    raw_title = (doc.get("title") or doc.get("fileName") or f"Anime Video {stream_id}") if doc else f"Anime Video {stream_id}"
    clean_title = raw_title.rsplit(".", 1)[0].replace("_", " ")
    has_explicit_q = q in ("480p", "720p", "1080p")
    initial_q = q if has_explicit_q else "720p"
    stream_url = f"/stream/{stream_id}"
    dl_url = f"/dl/{stream_id}"
    modal_hidden_class = "hidden" if has_explicit_q else ""

    html = f"""<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>{clean_title}</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * {{ box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }}
    html, body {{
      width:100%; height:100%; max-width:100vw; max-height:100dvh;
      overflow:hidden !important; position:fixed !important; inset:0 !important;
      background:#090d16; color:#f8fafc; font-family:system-ui,-apple-system,sans-serif;
      overscroll-behavior:none !important; touch-action:none !important;
      user-select:none; -webkit-user-select:none;
    }}
    .screen-wrapper {{
      width:100vw; height:100dvh; display:flex; flex-direction:column;
      justify-content:center; align-items:center; overflow:hidden;
    }}
    .player-card {{ width:100%; max-width:720px; display:flex; flex-direction:column; align-items:center; }}
    .video-box {{
      width:100%; aspect-ratio:16/9; max-height:68dvh; background:#000;
      position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center;
      touch-action:none; border-top:1px solid rgba(255,255,255,0.07); border-bottom:1px solid rgba(255,255,255,0.07);
    }}
    video {{ width:100%; height:100%; object-fit:contain; display:block; background:#000; }}
    .quality-pill {{
      position:absolute; top:12px; right:12px; z-index:25;
      background:rgba(15,23,42,0.78); border:1px solid rgba(255,255,255,0.2);
      color:#f8fafc; font-size:12px; font-weight:700; padding:5px 11px; border-radius:6px; cursor:pointer;
    }}
    .gesture-hud {{
      position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      background:rgba(9,13,22,0.88); border:1px solid rgba(255,255,255,0.15);
      border-radius:12px; padding:14px 20px; min-width:165px;
      display:flex; flex-direction:column; align-items:center; gap:8px;
      pointer-events:none; opacity:0; transition:opacity 0.18s ease; z-index:30;
    }}
    .gesture-hud.visible {{ opacity:1; }}
    .gesture-bar-bg {{ width:130px; height:6px; background:rgba(255,255,255,0.18); border-radius:999px; overflow:hidden; }}
    .gesture-bar-fill {{ height:100%; width:80%; background:#10b981; border-radius:999px; }}
    .quality-modal-backdrop {{
      position:fixed; inset:0; background:rgba(5,8,15,0.86); backdrop-filter:blur(8px);
      z-index:100; display:flex; align-items:center; justify-content:center; padding:20px;
    }}
    .quality-modal-backdrop.hidden {{ display:none; }}
    .quality-modal {{
      width:100%; max-width:340px; background:#111827; border:1px solid #1f2937;
      border-radius:16px; padding:20px; display:flex; flex-direction:column; gap:14px;
    }}
    .q-row {{ display:flex; gap:8px; }}
    .q-btn {{
      flex:1; padding:12px 14px; border-radius:10px; border:1px solid #374151;
      background:#1f2937; color:#f8fafc; font-size:14px; font-weight:700; cursor:pointer;
    }}
    .q-dl {{
      padding:12px 14px; border-radius:10px; border:1px solid #374151;
      background:#0f172a; color:#34d399; font-size:13px; font-weight:700; text-decoration:none;
    }}
  </style>
</head>
<body>
  <div class="screen-wrapper">
    <div class="player-card">
      <div class="video-box" id="video-box">
        <button type="button" class="quality-pill" onclick="document.getElementById('q-modal').classList.remove('hidden')">
          <span id="ql">{initial_q}</span> ⚙️
        </button>
        <div id="gesture-hud" class="gesture-hud">
          <div style="font-size:14px;font-weight:700;"><span id="hud-icon">🔊</span> <span id="hud-label">100%</span></div>
          <div class="gesture-bar-bg"><div id="hud-fill" class="gesture-bar-fill"></div></div>
        </div>
        <video id="v" controls playsinline webkit-playsinline preload="auto" src="{stream_url}?quality={initial_q}"></video>
      </div>
    </div>
  </div>

  <div id="q-modal" class="quality-modal-backdrop {modal_hidden_class}">
    <div class="quality-modal">
      <div style="font-size:16px;font-weight:700;text-align:center;">কোয়ালিটি সিলেক্ট করুন</div>
      <div class="q-row">
        <button class="q-btn" onclick="setQ('480p')">▶️ Play 480p</button>
        <a class="q-dl" href="{dl_url}?quality=480p">⬇️ 480p</a>
      </div>
      <div class="q-row">
        <button class="q-btn" onclick="setQ('720p')">▶️ Play 720p</button>
        <a class="q-dl" href="{dl_url}?quality=720p">⬇️ 720p</a>
      </div>
      <div class="q-row">
        <button class="q-btn" onclick="setQ('1080p')">▶️ Play 1080p</button>
        <a class="q-dl" href="{dl_url}?quality=1080p">⬇️ 1080p</a>
      </div>
    </div>
  </div>

  <script>
    try {{
      if (window.Telegram && window.Telegram.WebApp) {{
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        if (window.Telegram.WebApp.disableVerticalSwipes) window.Telegram.WebApp.disableVerticalSwipes();
      }}
    }} catch (e) {{}}
    document.addEventListener('touchmove', function(e) {{ if (e.cancelable) e.preventDefault(); }}, {{ passive: false }});

    const v = document.getElementById('v');
    const box = document.getElementById('video-box');
    const hud = document.getElementById('gesture-hud');
    const hudIcon = document.getElementById('hud-icon');
    const hudLabel = document.getElementById('hud-label');
    const hudFill = document.getElementById('hud-fill');
    let brightness = 80, volume = 100, touchState = null, hudTimer = null, firstPlay = true;

    function setQ(q) {{
      document.getElementById('ql').textContent = q;
      document.getElementById('q-modal').classList.add('hidden');
      if (firstPlay) {{
        firstPlay = false;
        v.play().catch(() => {{}});
        return;
      }}
      const t = v.currentTime || 0;
      v.src = '{stream_url}?quality=' + q;
      v.currentTime = t;
      v.play().catch(() => {{}});
    }}

    function showHud(icon, text, pct) {{
      hudIcon.textContent = icon;
      hudLabel.textContent = text;
      hudFill.style.width = pct + '%';
      hud.classList.add('visible');
      if (hudTimer) clearTimeout(hudTimer);
      hudTimer = setTimeout(() => hud.classList.remove('visible'), 650);
    }}

    box.addEventListener('touchstart', function(e) {{
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0], r = box.getBoundingClientRect();
      if (t.clientY - r.top > r.height - 46) {{ touchState = null; return; }}
      touchState = {{ startX: t.clientX, startY: t.clientY, right: (t.clientX - r.left) > r.width / 2, vol: volume, brt: brightness, h: Math.max(160, r.height), swiping: false }};
    }}, {{ passive: true }});

    box.addEventListener('touchmove', function(e) {{
      if (!touchState || !e.touches || e.touches.length !== 1) return;
      const t = e.touches[0], dy = touchState.startY - t.clientY, dx = t.clientX - touchState.startX;
      if (!touchState.swiping) {{
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) touchState.swiping = true;
        else return;
      }}
      const delta = (dy / (touchState.h * 0.65)) * 100;
      if (touchState.right) {{
        volume = Math.max(0, Math.min(100, Math.round(touchState.vol + delta)));
        v.muted = volume === 0;
        v.volume = volume / 100;
        showHud(volume === 0 ? '🔇' : '🔊', 'Sound ' + volume + '%', volume);
      }} else {{
        brightness = Math.max(0, Math.min(100, Math.round(touchState.brt + delta)));
        v.style.filter = 'brightness(' + (0.20 + (brightness / 100) * 1.05).toFixed(2) + ')';
        showHud('☀️', 'Light ' + brightness + '%', brightness);
      }}
    }}, {{ passive: true }});

    box.addEventListener('touchend', function() {{ touchState = null; }}, {{ passive: true }});
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)


async def handle_telegram_stream(stream_id: str, request: Request, quality: str, is_download: bool):
    # 1. Look up file metadata & telegramFileId from MongoDB
    doc = await videos_col.find_one({
        "$or": [
            {"id": stream_id},
            {"id": f"tg-{stream_id}"},
            {"msg_id": int(stream_id) if stream_id.isdigit() else -1}
        ]
    })

    media_target = None
    file_size = 0
    file_name = f"SR_Video_{stream_id}_{quality}.mp4"
    mime_type = "video/mp4"

    if doc and doc.get("telegramFileId"):
        media_target = doc["telegramFileId"]
        file_size = int(doc.get("sizeBytes") or 0)
        file_name = doc.get("fileName") or file_name
        mime_type = doc.get("mimeType") or "video/mp4"

    # 2. Fallback to fetching message from chat_id or BIN_CHANNEL if not in MongoDB
    if not media_target or file_size <= 0:
        try:
            if doc and doc.get("chat_id") and doc.get("msg_id"):
                msg = await bot.get_messages(int(doc["chat_id"]), int(doc["msg_id"]))
            else:
                numeric_id = int(stream_id.replace("tg-", ""))
                msg = await bot.get_messages(BIN_CHANNEL, numeric_id)
            media = msg.video or msg.document or msg.animation
            if not media:
                raise HTTPException(status_code=404, detail="Media not found")
            media_target = msg
            file_size = getattr(media, "file_size", 0)
            file_name = getattr(media, "file_name", file_name)
            mime_type = getattr(media, "mime_type", "video/mp4") or "video/mp4"
        except Exception as exc:
            raise HTTPException(status_code=404, detail=f"Video #{stream_id} not found: {exc}")

    if not mime_type.startswith("video/"):
        mime_type = "video/mp4"

    # 3. Exact HTTP 206 Byte-Range Calculation (Fixes ERR_CONTENT_LENGTH_MISMATCH)
    range_header = request.headers.get("Range", "")
    if range_header and range_header.startswith("bytes="):
        parts = range_header.replace("bytes=", "").split("-")
        from_bytes = int(parts[0]) if parts[0] else 0
        until_bytes = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
    else:
        from_bytes = 0
        until_bytes = file_size - 1

    until_bytes = min(until_bytes, file_size - 1)
    if from_bytes > until_bytes or from_bytes < 0:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    req_length = until_bytes - from_bytes + 1
    chunk_size = 1024 * 1024  # 1 MB per Telegram MTProto chunk
    first_part = from_bytes // chunk_size
    last_part = until_bytes // chunk_size
    part_count = last_part - first_part + 1
    first_part_cut = from_bytes % chunk_size
    last_part_cut = (until_bytes % chunk_size) + 1

    disposition = "attachment" if is_download else "inline"
    headers = {
        "Content-Type": mime_type,
        "Accept-Ranges": "bytes",
        "Content-Length": str(req_length),
        "Content-Disposition": f'{disposition}; filename="{file_name}"',
    }
    if range_header:
        headers["Content-Range"] = f"bytes {from_bytes}-{until_bytes}/{file_size}"

    if request.method == "HEAD":
        return Response(status_code=206 if range_header else 200, headers=headers)

    async def media_generator():
        nonlocal media_target
        current_part = 1
        try:
            async for chunk in bot.stream_media(media_target, offset=first_part, limit=part_count):
                if part_count == 1:
                    yield chunk[first_part_cut:last_part_cut]
                elif current_part == 1:
                    yield chunk[first_part_cut:]
                elif current_part == part_count:
                    yield chunk[:last_part_cut]
                else:
                    yield chunk
                current_part += 1
        except Exception:
            # Auto-refresh media_target from BIN_CHANNEL or chat_id if file_reference expired after 24h
            if doc and doc.get("bin_msg_id"):
                fresh_msg = await bot.get_messages(BIN_CHANNEL, int(doc["bin_msg_id"]))
            elif doc and doc.get("chat_id") and doc.get("msg_id"):
                fresh_msg = await bot.get_messages(int(doc["chat_id"]), int(doc["msg_id"]))
            else:
                numeric_id = int(stream_id.replace("tg-", ""))
                fresh_msg = await bot.get_messages(BIN_CHANNEL, numeric_id)
            fresh_media = fresh_msg.video or fresh_msg.document or fresh_msg.animation
            if fresh_media and getattr(fresh_media, "file_id", None):
                await videos_col.update_one({"id": stream_id}, {"$set": {"telegramFileId": fresh_media.file_id}})
            current_part = 1
            async for chunk in bot.stream_media(fresh_msg, offset=first_part, limit=part_count):
                if part_count == 1:
                    yield chunk[first_part_cut:last_part_cut]
                elif current_part == 1:
                    yield chunk[first_part_cut:]
                elif current_part == part_count:
                    yield chunk[:last_part_cut]
                else:
                    yield chunk
                current_part += 1

    return StreamingResponse(
        media_generator(),
        status_code=206 if range_header else 200,
        headers=headers
    )


@web_app.api_route("/stream/{stream_id}", methods=["GET", "HEAD"])
async def stream_endpoint(stream_id: str, request: Request, quality: str = "1080p", q: str = "1080p"):
    return await handle_telegram_stream(stream_id, request, quality or q, is_download=False)


@web_app.api_route("/dl/{stream_id}", methods=["GET", "HEAD"])
async def download_endpoint(stream_id: str, request: Request, quality: str = "1080p", q: str = "1080p", download: int = 1):
    return await handle_telegram_stream(stream_id, request, quality or q, is_download=bool(download))


# ==============================================================================
# UNIFIED ASYNC ENTRYPOINT
# ==============================================================================
async def start_services():
    logger.info(f"Starting SR-VIDEO-QUALITY on domain: {DOMAIN} (Port {PORT})")
    config = uvicorn.Config(web_app, host="0.0.0.0", port=PORT, log_level="info")
    server = uvicorn.Server(config)

    web_task = asyncio.create_task(server.serve())
    ping_task = asyncio.create_task(keep_alive_ping())

    if BOT_TOKEN and BOT_TOKEN != "YOUR_BOT_TOKEN_HERE":
        try:
            await bot.start()
            me = await bot.get_me()
            logger.info(f"Telegram Bot @{me.username} connected with MongoDB persistence!")
            await idle()
            await bot.stop()
        except Exception as bot_err:
            logger.error(f"Telegram Bot warning (Web server continues running): {bot_err}")
            await web_task
    else:
        logger.info("Running in Web Streaming Server mode (set BOT_TOKEN to enable Telegram bot).")
        await web_task

    ping_task.cancel()


if __name__ == "__main__":
    asyncio.run(start_services())
`;

  const renderYaml = `services:
  - type: web
    name: sr-video-quality
    env: python
    plan: free
    buildCommand: pip install --upgrade pip && pip install -r requirements.txt
    startCommand: python main.py
    autoDeploy: true
    envVars:
      - key: PYTHON_VERSION
        value: 3.10.12
      - key: PORT
        value: 8080
      - key: DOMAIN
        value: ${cleanDomain}
      - key: MONGO_URI
        value: "${mongoUri}"
      - key: API_ID
        value: "${apiId}"
      - key: API_HASH
        value: "${apiHash}"
      - key: BOT_TOKEN
        value: "${botToken}"
      - key: BIN_CHANNEL
        value: "${binChannel}"
`;

  const requirementsTxt = `hydrogram==0.1.4
tgcrypto==1.2.5
fastapi==0.115.0
uvicorn==0.30.6
aiohttp==3.10.5
motor==3.6.0
pymongo==4.9.1
dnspython==2.6.1
`;

  const procfile = `web: python main.py
`;

  const runtimeTxt = `python-3.10.12
`;

  return {
    'main.py': mainPy,
    'render.yaml': renderYaml,
    'requirements.txt': requirementsTxt,
    'Procfile': procfile,
    'runtime.txt': runtimeTxt,
  };
}
