import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import chatRouter from "./api/chat.js";

dotenv.config();
const app = express();

// CORS e JSON
app.use(cors());
app.use(express.json());

// 🔥 Resolver diretório atual (porque está usando ESModules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, "public")));

// Rotas da API
app.use("/api/chat", chatRouter);

// 🔥 Rota fallback para o index.html (landing page)
app.get("/:path(*)", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
