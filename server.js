import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// отдаём статические файлы мини-аппа
app.use(express.static(path.join(__dirname, "public")));

// на всякий случай: любой путь ведёт на главную страницу
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Pavel Planner is running on port ${PORT}`);
});
