import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ВРЕМЕННОЕ хранилище в памяти (на старте норм)
// Структура: { userId: [ { id, sphere, difficulty, importance, text, status, dueDate, dueTime, projectId } ] }
const db = {};

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
