const WebSocket = require('ws');

// ==================== PERMANENT AUTH CREDENTIALS ====================
const AUTH_TOKEN = '000109a238c22edaed3918aacb3d8c0a4360d480';
const CT0 = '6fd94ab6e318068f4e34c27c07d5b055541c8447ddc43e14d8ac0cedbe02a6efb5060c89092b47d6e071e61aca37496f44886a1c141abc20bb5aec817f214dcd2fbc7f22f39372ab5a8664ecb553f439';
const BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
// ====================================================================

// ==================== USER ID FILTERS ====================
const MY_USER_ID     = '704772337';
const TARGET_USER_ID = '1885488902670000129';
const REEM_USER_ID   = '954222428791681025';
const NOORA_USER_ID  = '2082060317358743552';
// =========================================================

// ==================== BARK CONFIGURATION ====================
const BARK_KEY    = 'aAQmJDszVrdbc9braKD8am';
const BARK_SERVER = 'https://api.day.app';

async function sendBarkSafe(title, message) {
  try {
    await fetch(`${BARK_SERVER}/${BARK_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        title:   title,
        body:    message,
        sound:   'gotosleep',
        level:   'critical',
      })
    });
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Bark failed:`, err.message);
  }
}
// ============================================================

// ==================== NTFY CONFIGURATION ====================
const NTFY_TOPIC = 'JamilaActivatedHerXAccount';

async function sendNtfySafe(title, message) {
  try {
    await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message })
    });
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] ntfy failed:`, err.message);
  }
}
// ============================================================

let isReady = false;

let isTargetTyping  = false; let targetStopTimer  = null;
let isReemTyping    = false; let reemStopTimer    = null;
let isNooraTyping   = false; let nooraStopTimer   = null;
let isSomeoneTyping = false; let someoneStopTimer = null;

async function fetchWsUrl() {
  console.log(`[${new Date().toLocaleTimeString()}] 🔄 Requesting fresh WS token via GraphQL...`);

  const res = await fetch('https://api.x.com/graphql/Qh3fZRjPPtPoHYR_2sCZsA/GenerateXChatTokenMutation', {
    method: 'POST',
    headers: {
      'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0',
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      'x-csrf-token':  CT0,
      'authorization': BEARER_TOKEN,
      'Cookie':        `auth_token=${AUTH_TOKEN}; ct0=${CT0};`,
      'Origin':        'https://x.com',
      'Referer':       'https://x.com/'
    },
    body: JSON.stringify({ variables: {} })
  });

  if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);

  const json = await res.json();
  const token = json?.data?.user_get_x_chat_auth_token?.token || json?.user_get_x_chat_auth_token?.token || null;
  if (!token) throw new Error('Token key not found in GraphQL response.');
  return `wss://chat-ws.x.com/ws?token=${token}`;
}

async function startMonitoring() {
  try {
    const wsUrl = await fetchWsUrl();
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Fresh WS Token acquired! Connecting...`);

    const ws = new WebSocket(wsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0',
        'Origin':     'https://x.com',
        'Cookie':     `auth_token=${AUTH_TOKEN}; ct0=${CT0};`
      }
    });

    ws.on('open', () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🟢 ONLINE: Clearing backlog (3s)...`);
      setTimeout(() => {
        isReady = true;
        console.log('⚡ NOW LISTENING — TARGET + REEM + NOORA + ANYONE (except me)\n');
      }, 3000);
    });

    ws.on('message', (data) => {
      if (!isReady) return;

      const buffer = Buffer.from(data);
      if (buffer.toString('base64') === 'DAACDAACAAAA') return;

      const rawText = buffer.toString('utf8');
      const cleaned = rawText.replace(/[^\x20-\x7E]+/g, ' ').trim();

      // Frame structure: $<uuid> <TYPER_ID> <MY_ID>:<PARTNER_ID> ...
      const typerID = cleaned.split(' ')[1];

      if (!typerID || !/^\d{6,20}$/.test(typerID)) return;
      if (typerID === MY_USER_ID) return;

      const now = new Date().toLocaleTimeString();

      // ── TARGET ──
      if (typerID === TARGET_USER_ID) {
        if (!isTargetTyping) {
          isTargetTyping = true;
          console.log(`⌨️  [${now}] ALERT: Target is TYPING!`);
          sendNtfySafe('TYPING', 'TYPING WATCHER: Target is typing right now!');
        }
        clearTimeout(targetStopTimer);
        targetStopTimer = setTimeout(() => {
          isTargetTyping = false;
          console.log(`⏹️  [${new Date().toLocaleTimeString()}] Target STOPPED TYPING.\n${'--'.repeat(25)}`);
        }, 4000);
        return;
      }

      // ── REEM ── ntfy + Bark
      if (typerID === REEM_USER_ID) {
        if (!isReemTyping) {
          isReemTyping = true;
          console.log(`⌨️  [${now}] ALERT: REEM is TYPING!`);
          sendNtfySafe('REEM', 'TYPING WATCHER: REEM is typing right now!');
          sendBarkSafe('REEM', 'REEM is typing right now!');
        }
        clearTimeout(reemStopTimer);
        reemStopTimer = setTimeout(() => {
          isReemTyping = false;
          console.log(`⏹️  [${new Date().toLocaleTimeString()}] REEM STOPPED TYPING.\n${'--'.repeat(25)}`);
        }, 4000);
        return;
      }

      // ── NOORA ── ntfy + Bark
      if (typerID === NOORA_USER_ID) {
        if (!isNooraTyping) {
          isNooraTyping = true;
          console.log(`⌨️  [${now}] ALERT: NOORA is TYPING!`);
          sendNtfySafe('NOORA', 'TYPING WATCHER: NOORA is typing right now!');
          sendBarkSafe('NOORA', 'NOORA is typing right now!');
        }
        clearTimeout(nooraStopTimer);
        nooraStopTimer = setTimeout(() => {
          isNooraTyping = false;
          console.log(`⏹️  [${new Date().toLocaleTimeString()}] NOORA STOPPED TYPING.\n${'--'.repeat(25)}`);
        }, 4000);
        return;
      }

      // ── SOMEONE ELSE ──
      if (!isSomeoneTyping) {
        isSomeoneTyping = true;
        console.log(`👤 [${now}] ALERT: Someone is TYPING! (ID: ${typerID})`);
        sendNtfySafe('SOMEONE', 'TYPING WATCHER: Someone is typing right now!');
      }
      clearTimeout(someoneStopTimer);
      someoneStopTimer = setTimeout(() => {
        isSomeoneTyping = false;
        console.log(`⏹️  [${new Date().toLocaleTimeString()}] Someone STOPPED TYPING.\n${'--'.repeat(25)}`);
      }, 4000);
    });

    ws.on('close', () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🔴 WS Disconnected. Fetching new token...`);
      isReady = false;
      setTimeout(startMonitoring, 1000);
    });

    ws.on('error', (err) => {
      console.error('WS Error:', err.message);
      sendNtfySafe('ERROR', `TYPING WATCHER: Connection Error - ${err.message}`);
    });

  } catch (err) {
    console.error('Auth Error:', err.message);
    sendNtfySafe('ERROR', `TYPING WATCHER: Auth Error - ${err.message}`);
    console.log('Retrying in 5 seconds...\n');
    setTimeout(startMonitoring, 5000);
  }
}

startMonitoring();
