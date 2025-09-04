import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRouter from "./api/chat.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// rota de teste
app.get("/", (req, res) => {
  res.send("✅ Server online no Railway!");
});

// monta suas rotas reais
app.use("/api/chat", chatRouter);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
