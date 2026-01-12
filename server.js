import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import TelegramBot from "node-telegram-bot-api";
import { DateTime } from "luxon";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ВРЕМЕННОЕ хранилище в памяти (на старте норм)
// Структура: { userId: [ { id, sphere, difficulty, importance, text, status, dueDate, dueTime, projectId } ] }
const db = {};
// храним куда слать сообщения: { userId: chatId }
const chats = {};

// чтобы не отправлять одно и то же напоминание много раз
// ключ: `${userId}:${taskId}:${dueDate}:${dueTime}`
const reminded = new Set();

// токен бота берём из переменной окружения на Render
const BOT_TOKEN = process.env.BOT_TOKEN || "";

// запускаем бота, если токен задан
let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN);
  
// webhook endpoint (Express будет принимать апдейты)
app.post("/telegram/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// установить webhook (PUBLIC_URL зададим на Render)
const publicUrl = process.env.PUBLIC_URL || "";
if (publicUrl) {
  bot.setWebHook(`${publicUrl.replace(/\/$/, "")}/telegram/webhook`);
} else {
  console.log("PUBLIC_URL is empty. Webhook not set.");
}

  bot.onText(/\/start/, (msg) => {
    const userId = String(msg.from.id);
    const chatId = String(msg.chat.id);

    chats[userId] = chatId;

    bot.sendMessage(
      chatId,
      "Я на связи ✅\nТеперь я смогу присылать напоминания за час до задач с временем."
    );
  });
}
function getNowMoscow() {
  // Москва = UTC+3 (в Luxon так надёжнее)
  return DateTime.utc().plus({ hours: 3 });
}

function parseDueMoscow(dueDate, dueTime) {
  // dueDate: "YYYY-MM-DD"
  // dueTime: "HH:MM"
  const [y, m, d] = dueDate.split("-").map(Number);
  const [hh, mm] = dueTime.split(":").map(Number);
  // создаём "московское" время как UTC+3
  return DateTime.utc(y, m, d, hh, mm).minus({ hours: 3 }).plus({ hours: 3 });
}

// раз в минуту смотрим задачи и шлём напоминание за 60 минут
setInterval(async () => {
  if (!bot) return;

  const now = getNowMoscow();

  for (const userId of Object.keys(db)) {
    const chatId = chats[userId];
    if (!chatId) continue;

    const tasks = db[userId] || [];
    for (const t of tasks) {
      if (t.status !== "in_work") continue;
      if (!t.dueDate || !t.dueTime) continue; // напоминания только когда есть время

      const due = parseDueMoscow(t.dueDate, t.dueTime);
      const diffMinutes = Math.round(due.diff(now, "minutes").minutes);

      // нужно ровно за 60 минут (попадём в окно 60..59 минут)
      if (diffMinutes <= 60 && diffMinutes >= 59) {
        const key = `${userId}:${t.id}:${t.dueDate}:${t.dueTime}`;
        if (reminded.has(key)) continue;

        reminded.add(key);

        const text =
          `⏰ Через час:\n` +
          `${t.importance} | ${t.sphere} | сложн.${t.difficulty}\n` +
          `${t.text}`;

        bot.sendMessage(chatId, text);
      }
    }
  }
}, 60 * 1000);

// утреннее сообщение со списком задач (09:00 МСК)
const morningSent = new Set();

setInterval(async () => {
  if (!bot) return;

  const now = getNowMoscow();
  const hhmm = now.toFormat("HH:mm");
const minutesNow = now.hour * 60 + now.minute;
const morningFrom = minutesNow;
const morningTo = minutesNow + 2;
  // отправляем ровно в 09:00
if (minutesNow < morningFrom || minutesNow > morningTo) return;

  for (const userId of Object.keys(db)) {
    const chatId = chats[userId];
    if (!chatId) continue;

    const key = `${userId}:${now.toISODate()}`;
    if (morningSent.has(key)) continue;

    morningSent.add(key);

    const tasks = (db[userId] || []).filter(t => t.status === "in_work");

    if (!tasks.length) {
      bot.sendMessage(chatId, "Доброе утро ☀️\nСегодня задач в работе нет.");
      continue;
    }

    // сортировка: просроченные сверху, затем по времени
    const today = now.toISODate();

    tasks.sort((a, b) => {
      if (a.dueDate && a.dueDate < today && (!b.dueDate || b.dueDate >= today)) return -1;
      if (b.dueDate && b.dueDate < today && (!a.dueDate || a.dueDate >= today)) return 1;
      return (a.dueTime || "").localeCompare(b.dueTime || "");
    });

    let text = "Доброе утро ☀️\nВот задачи в работе на сегодня:\n\n";
    for (const t of tasks) {
      if (t.dueDate && t.dueTime) {
        text += `⏰ ${t.dueTime} — ${t.text}\n`;
      } else if (t.dueDate) {
        text += `📅 ${t.text}\n`;
      } else {
        text += `• ${t.text}\n`;
      }
    }

    bot.sendMessage(chatId, text.trim());
  }
}, 60 * 1000);


// Получить задачи "в работе"
app.get("/api/tasks", (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "userId required" });

  const status = String(req.query.status || "in_work"); // in_work | recorded
  const tasks = db[userId] || [];
  const filtered = tasks.filter(t => t.status === status);

  res.json({ tasks: filtered });
});
;

// Создать задачу (по умолчанию "записана")
app.post("/api/tasks", (req, res) => {
  const { userId, sphere, difficulty, importance, text } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });
  if (!sphere || !difficulty || !importance || !text) {
    return res.status(400).json({ error: "sphere, difficulty, importance, text required" });
  }

  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    sphere,
    difficulty,      // 1..6
    importance,      // 1..4
    text,
    status: "recorded", // recorded | in_work
    dueDate: null,
    dueTime: null,
    projectId: null
  };

  db[userId] = db[userId] || [];
  db[userId].push(item);

  res.json({ task: item });
});

// Взять задачу в работу + задать дату/время (опционально)
app.post("/api/tasks/:id/take", (req, res) => {
  const taskId = req.params.id;
  const { userId, dueDate = null, dueTime = null } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });

  const tasks = db[userId] || [];
  const t = tasks.find(x => x.id === taskId);
  if (!t) return res.status(404).json({ error: "task not found" });

  t.status = "in_work";
  t.dueDate = dueDate;
  t.dueTime = dueTime;

  res.json({ task: t });
});

// Выполнить задачу (и удалить — как ты захотел)
app.post("/api/tasks/:id/done", (req, res) => {
  const taskId = req.params.id;
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });

  db[userId] = (db[userId] || []).filter(t => t.id !== taskId);
  res.json({ ok: true });
});

// Удалить задачу (без похвалы)
app.delete("/api/tasks/:id", (req, res) => {
  const taskId = req.params.id;
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "userId required" });

  db[userId] = (db[userId] || []).filter(t => t.id !== taskId);
  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Pavel Planner is running on port ${PORT}`);
});
