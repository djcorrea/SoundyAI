import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRouter from "./api/chat.js"; // importa seu router

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// monta suas rotas
app.use("/api/chat", chatRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
app.get("/", (req, res) => {
  res.send("✅ SoundyAI está rodando no Railway!");
});
