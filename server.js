import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRouter from "./api/chat.js"; // suas rotas de API

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// rota da API
app.use("/api/chat", chatRouter);


// rota raiz só para o Railway não dar 502
app.get("/", (req, res) => {
  res.send("✅ SoundyAI rodando no Railway!");
});

// porta dinâmica do Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
process.on("uncaughtException", err => {
  console.error("💥 Uncaught Exception:", err);
});

process.on("unhandledRejection", reason => {
  console.error("💥 Unhandled Rejection:", reason);
});
