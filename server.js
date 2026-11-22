// LINE Messaging API Webhook bot — minimal command bot for ちぱ^._.^
// Node.js built-ins only (no npm install needed).
//
// Commands:
//   /help -> returns help text
//   /id   -> returns the sender's LINE user ID
// Other text messages: no reply (the existing watch keeps handling talks).
//
// Required environment variables (never hardcode secrets):
//   LINE_CHANNEL_SECRET        channel secret (for signature verification)
//   LINE_CHANNEL_ACCESS_TOKEN  channel access token (for Reply API)
// Optional:
//   PORT     listen port (default 3000)
//   DRY_RUN  "1" = log replies instead of calling the LINE API (for tests)

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const PORT = Number(process.env.PORT || 3000);
const DRY_RUN = process.env.DRY_RUN === '1';

const HELP_TEXT = [
  'ちぱ^._.^ コマンド一覧',
  '/help : このヘルプを表示します',
  '/id : あなたのユーザーIDを表示します',
].join('\n');

// Verify the x-line-signature header: HMAC-SHA256 of the raw body,
// keyed with the channel secret, base64-encoded (LINE official method).
function verifySignature(rawBody, signature) {
  if (!CHANNEL_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Send a Reply API message. Returns a Promise.
function reply(replyToken, text) {
  if (DRY_RUN) {
    console.log('[DRY_RUN] reply:', JSON.stringify({ replyToken, text }));
    return Promise.resolve();
  }
  const payload = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: '/v2/bot/message/reply',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`LINE Reply API status ${res.statusCode}`));
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Handle one webhook event. Only text messages with commands are answered.
// Every event is logged with its webhookEventId (used for duplicate checks).
async function handleEvent(event) {
  if (!event) return;
  console.log(`[event] type=${event.type} id=${event.webhookEventId || '-'}`);
  if (event.type !== 'message') return;
  const message = event.message || {};
  if (message.type !== 'text') return;
  const text = (message.text || '').trim();
  const userId = (event.source && event.source.userId) || '';
  if (text === '/help') {
    await reply(event.replyToken, HELP_TEXT);
  } else if (text === '/id') {
    await reply(event.replyToken, userId ? `あなたのユーザーIDは ${userId} です` : 'ユーザーIDが取得できませんでした');
  }
  // Any other text: stay silent on purpose.
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    if (!verifySignature(rawBody, req.headers['x-line-signature'])) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end();
    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      console.error('invalid JSON body');
      return;
    }
    for (const event of body.events || []) {
      try {
        await handleEvent(event);
      } catch (e) {
        console.error('event handling failed:', e.message);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`webhook bot listening on port ${PORT}${DRY_RUN ? ' (DRY_RUN)' : ''}`);
});
