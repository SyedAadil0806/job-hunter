// Finds your Telegram chat id and sends a test message.
// 1. Put TELEGRAM_BOT_TOKEN in apps/api/.env  2. Send your bot any message  3. npm run telegram:setup
import { readFileSync } from 'node:fs';

const env = readFileSync('apps/api/.env', 'utf8');
const botToken = env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)?.[1]?.trim();
if (!botToken) {
  console.error('Add TELEGRAM_BOT_TOKEN to apps/api/.env first.');
  process.exit(1);
}

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram said no (HTTP ${res.status}): ${data.description ?? 'unknown error'}`);
    process.exit(1);
  }
  return data.result;
};

const updates = await api('getUpdates');
const chat = updates.map((u) => u.message?.chat).filter(Boolean).at(-1);
if (!chat) {
  console.error('No messages found. Open your bot in Telegram, send it "hi", and run this again.');
  process.exit(1);
}

await api('sendMessage', { chat_id: chat.id, text: '✅ Job Hunter is connected.' });
console.log('Test message sent. Check Telegram.');
console.log(`Your chat id: ${chat.id}`);
