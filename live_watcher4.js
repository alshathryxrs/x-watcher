const WebSocket = require('ws');

// ==================== PERMANENT AUTH CREDENTIALS ====================
const AUTH_TOKEN = '000109a238c22edaed3918aacb3d8c0a4360d480';
const CT0 = '6fd94ab6e318068f4e34c27c07d5b055541c8447ddc43e14d8ac0cedbe02a6efb5060c89092b47d6e071e61aca37496f44886a1c141abc20bb5aec817f214dcd2fbc7f22f39372ab5a8664ecb553f439';
const BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
// ====================================================================

// ==================== NTFY CONFIGURATION ====================
const NTFY_TOPIC = "JamilaActivatedHerXAccount"; // Change this if you want a private topic

async function sendNtfySafe(title, message) {
  try {
    await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title: title,
        message: message
      })
    });
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] ntfy failed:`, err.message);
  }
}
// ============================================================

let isReady = false;
let isTyping = false;
let stopTimer = null;

async function fetchWsUrl() {
  console.log(`[${new Date().toLocaleTimeString()}] 🔄 Requesting fresh WS token via GraphQL...`);

  const res = await fetch("https://api.x.com/graphql/Qh3fZRjPPtPoHYR_2sCZsA/GenerateXChatTokenMutation", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0",
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": CT0,
      "authorization": BEARER_TOKEN,
      "Cookie": `auth_token=${AUTH_TOKEN}; ct0=${CT0};`,
      "Origin": "https://x.com",
      "Referer": "https://x.com/"
    },
    body: JSON.stringify({ variables: {} }),
    method: "POST"
  });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  
  let token = null;
  if (json.data && json.data.user_get_x_chat_auth_token) {
    token = json.data.user_get_x_chat_auth_token.token;
  } else if (json.user_get_x_chat_auth_token) {
    token = json.user_get_x_chat_auth_token.token;
  }

  if (!token) {
    console.error("Unexpected JSON response:", json);
    throw new Error('Token key not found in GraphQL response.');
  }

  return `wss://chat-ws.x.com/ws?token=${token}`;
}

async function startMonitoring() {
  try {
    const wsUrl = await fetchWsUrl();
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Fresh WS Token acquired! Connecting...`);

    const ws = new WebSocket(wsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0',
        'Origin': 'https://x.com',
        'Cookie': `auth_token=${AUTH_TOKEN}; ct0=${CT0};`
      }
    });

    ws.on('open', () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🟢 ONLINE: Clearing backlog (3s)...`);
      setTimeout(() => {
        isReady = true;
        console.log('⚡ NOW LISTENING LIVE FOR TYPING INDICATORS!\n');
      }, 3000);
    });

    ws.on('message', (data) => {
      if (!isReady) return;

      const buffer = Buffer.from(data);
      if (buffer.toString('base64') === 'DAACDAACAAAA') return; // Skip keep-alives

      const text = buffer.toString('utf8').replace(/[^\x20-\x7E]+/g, ' ').trim();
      const isChatMessage = /^\d{18,20}/.test(text);

      if (!isChatMessage) {
        const now = new Date().toLocaleTimeString();

        if (!isTyping) {
          isTyping = true;
          console.log(`⌨️  [${now}] ALERT: Someone is TYPING!`);
          // --- NTFY NOTIFICATION TRIGGER ---
          sendNtfySafe("TYPING", "TYPING WATCHER: Someone is typing right now!");
        }

        clearTimeout(stopTimer);
        stopTimer = setTimeout(() => {
          isTyping = false;
          console.log(`⏹️  [${new Date().toLocaleTimeString()}] STOPPED TYPING.`);
          console.log('--------------------------------------------------');
        }, 4000);
      }
    });

    ws.on('close', () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🔴 WS Disconnected. Fetching new token...`);
      isReady = false;
      setTimeout(startMonitoring, 1000);
    });

    ws.on('error', (err) => {
      console.error('WS Error:', err.message);
      // --- NTFY ERROR TRIGGER ---
      sendNtfySafe("ERROR", `TYPING WATCHER: Connection Error - ${err.message}`);
    });

  } catch (err) {
    console.error('Auth Error:', err.message);
    // --- NTFY ERROR TRIGGER ---
    sendNtfySafe("ERROR", `TYPING WATCHER: Auth Error - ${err.message}`);
    
    console.log('Retrying in 5 seconds...\n');
    setTimeout(startMonitoring, 5000);
  }
}

startMonitoring();