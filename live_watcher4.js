const WebSocket = require('ws');
const https = require('https');

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

  try {
    await fetch(`${BARK_SERVER}/${BARK_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        title: title,
        body:  message,
        sound: 'chime',
        level: 'critical',
      })
    });
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Bark failed:`, err.message);
  }
}
// ============================================================

// ==================== NTFY CONFIGURATION ====================
const NTFY_TOPIC = 'JamilaActivatedHerXAccount';

function sendNtfySafe(title, message) {
  // RFC 2047 base64 encodes the title so emoji survive HTTP header ASCII restriction
  // ntfy explicitly supports this: https://docs.ntfy.sh/publish/#message-title
  const rfc2047Title = '=?UTF-8?B?' + Buffer.from(title, 'utf8').toString('base64') + '?=';
  const body = Buffer.from(message, 'utf8');

  return new Promise((resolve) => {
    const options = {
      hostname: 'ntfy.sh',
      port: 443,
      path: `/${NTFY_TOPIC}`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Title': rfc2047Title,
      },
    };

    const req = https.request(options, (res) => { res.resume(); resolve(); });
    req.on('error', (err) => {
      console.error(`[${new Date().toLocaleTimeString()}] ntfy failed:`, err.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}
// ============================================================

// ==================== THRIFT BINARY PARSER ====================
// Parses X's binary Thrift frames to extract read-receipt data.
// Frame layout (relevant fields under outer struct field 1):
//   .field3  = reader's user ID (string)
//   .field4  = conversation ID  ("MY_ID:READER_ID")
//   .field7 → .field12 → .field1 = seen message ID (string)
//   .field7 → .field12 → .field2 = seen-at timestamp ms (i64)
function parseThrift(buf, offset) {
  const fields = {};
  while (offset < buf.length) {
    if (offset + 3 > buf.length) break;
    const type  = buf[offset];
    const field = buf.readUInt16BE(offset + 1);
    offset += 3;
    if (type === 0) break; // STOP

    if (type === 11) { // STRING
      const len = buf.readUInt32BE(offset); offset += 4;
      fields[field] = buf.slice(offset, offset + len).toString('utf8');
      offset += len;
    } else if (type === 12) { // STRUCT
      const inner = parseThrift(buf, offset);
      fields[field] = inner.fields;
      offset = inner.offset;
    } else if (type === 15) { // LIST
      const elemType = buf[offset]; offset++;
      const count    = buf.readUInt32BE(offset); offset += 4;
      const list = [];
      for (let i = 0; i < count; i++) {
        if (elemType === 12) {
          const inner = parseThrift(buf, offset);
          list.push(inner.fields);
          offset = inner.offset;
        } else if (elemType === 11) {
          const len = buf.readUInt32BE(offset); offset += 4;
          list.push(buf.slice(offset, offset + len).toString('utf8'));
          offset += len;
        } else break;
      }
      fields[field] = list;
    } else if (type === 10) { // I64 — read as two u32 and combine
      const hi = buf.readUInt32BE(offset);
      const lo = buf.readUInt32BE(offset + 4);
      fields[field] = hi * 4294967296 + lo;
      offset += 8;
    } else if (type === 8) { // I32
      fields[field] = buf.readInt32BE(offset); offset += 4;
    } else if (type === 2) { // BOOL
      fields[field] = buf[offset]; offset++;
    } else {
      break; // unknown type — stop parsing
    }
  }
  return { fields, offset };
}

// Returns { readerID, conversationID, seenMessageID, seenAt }
// or null if the frame is not a read-receipt.
function tryParseSeenFrame(buffer) {
  try {
    const { fields: root } = parseThrift(buffer, 0);
    const outer = root[1]; // outer struct
    if (!outer) return null;

    const readerID = outer[3]; // field 3 = reader user ID
    if (!readerID || !/^\d{6,20}$/.test(readerID)) return null;

    const conversationID = outer[4]; // e.g. "704772337:2082060317358743552"
    if (!conversationID || !conversationID.includes(':')) return null;

    // field 7 → struct → field 12 → struct contains the seen info
    const f7   = outer[7];
    if (!f7) return null;
    const f12  = f7[12];
    if (!f12) return null;

    const seenMessageID = f12[1]; // message ID that was seen
    const seenAt        = f12[2]; // timestamp in ms (i64)

    if (!seenMessageID || !seenAt) return null;

    return { readerID, conversationID, seenMessageID, seenAt };
  } catch {
    return null;
  }
}
// =============================================================

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
      console.log(`[${new Date().toLocaleTimeString()}] 🟢 ONLINE: Clearing backlog (1s)...`);
      setTimeout(() => {
        isReady = true;
        console.log('⚡ NOW LISTENING — TARGET + REEM + NOORA + ANYONE (except me)\n');
      }, 1000);
    });

    ws.on('message', (data) => {
      if (!isReady) return;

      const buffer = Buffer.from(data);
      if (buffer.toString('base64') === 'DAACDAACAAAA') return;

      const now = new Date().toLocaleTimeString();

      // ── CHECK FOR READ RECEIPT (binary Thrift parse) ──────────────
      const seen = tryParseSeenFrame(buffer);
      if (seen && seen.readerID !== MY_USER_ID) {
        const seenTime = new Date(seen.seenAt).toLocaleTimeString();

        if (seen.readerID === TARGET_USER_ID) {
          console.log(`👁️  [${now}] Target SEEN your message! (at ${seenTime})`);
          sendNtfySafe('Target 👁️', 'Target has seen your message!');

        } else if (seen.readerID === REEM_USER_ID) {
          console.log(`👁️  [${now}] REEM SEEN your message! (at ${seenTime})`);
          sendNtfySafe('Reem 👁️', 'Reem has seen your message!');

        } else if (seen.readerID === NOORA_USER_ID) {
          console.log(`👁️  [${now}] NOORA SEEN your message! (at ${seenTime})`);
          sendNtfySafe('Noora 👁️', 'Noora has seen your message!');

        } else {
          console.log(`👁️  [${now}] Someone (ID: ${seen.readerID}) SEEN your message! (at ${seenTime})`);
          sendNtfySafe("Someone 👁️", `User ${seen.readerID} has seen your message!`);
        }

        console.log(`${'--'.repeat(25)}`);
        return; // read-receipt handled — skip typing logic below
      }

      // ── TYPING DETECTION (existing text-based parsing) ────────────
      const rawText = buffer.toString('utf8');
      const cleaned = rawText.replace(/[^\x20-\x7E]+/g, ' ').trim();

      // Frame structure: $<uuid> <TYPER_ID> <MY_ID>:<PARTNER_ID> ...
      const typerID = cleaned.split(' ')[1];

      if (!typerID || !/^\d{6,20}$/.test(typerID)) return;
      if (typerID === MY_USER_ID) return;

      // ── TARGET ──
      if (typerID === TARGET_USER_ID) {
        if (!isTargetTyping) {
          isTargetTyping = true;
          console.log(`⌨️  [${now}] Target is TYPING...`);
          sendNtfySafe('Target ⌨️', 'Target is typing...');
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
          console.log(`⌨️  [${now}] REEM is TYPING...`);
          sendNtfySafe('Reem ⌨️', 'Reem is typing...');
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
          console.log(`⌨️  [${now}] NOORA is TYPING...`);
          sendNtfySafe('Noora ⌨️', 'Noora is typing...');
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
        console.log(`⌨️  [${now}] Someone is TYPING... (ID: ${typerID})`);
        sendNtfySafe('Someone ⌨️', 'Someone is typing...');
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
