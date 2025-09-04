// 🚨 FORCE CACHE BUST - 1692582547
// ✅ CORREÇÃO CRÍTICA: decoded is not defined fixed!
import { auth, db } from './firebaseAdmin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import cors from 'cors';
import formidable from 'formidable';
import fs from 'fs';

// ✅ CORREÇÃO: Configuração para suporte a multipart
export const config = {
  api: {
    bodyParser: false,
  },
};

// ✅ Função para processar multipart/form-data (versão Vercel-friendly)
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB (Vercel limit friendly)
      maxFiles: 3,
      multiples: true,
      allowEmptyFiles: false,
      keepExtensions: true,
      filter: function ({ name, originalFilename, mimetype }) {
        console.log('🔍 Filtering file:', { name, originalFilename, mimetype });
        // Aceitar campos de texto e imagens
        if (name === 'message' || name === 'conversationHistory' || name === 'idToken') {
          return true;
        }
        // Aceitar apenas imagens válidas
        if (name === 'images' && mimetype && mimetype.startsWith('image/')) {
          return true;
        }
        console.log('❌ File rejected:', { name, mimetype });
        return false;
      }
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('❌ Erro no formidable:', {
          message: err.message,
          code: err.code,
          httpCode: err.httpCode
        });
        reject(new Error(`FORMIDABLE_ERROR: ${err.message}`));
        return;
      }

      console.log('📋 Campos recebidos:', Object.keys(fields));
      console.log('📁 Arquivos recebidos:', Object.keys(files));

      try {
        // ✅ Processar imagens de forma assíncrona e robusta
        const images = [];
        if (files.images) {
          const imageFiles = Array.isArray(files.images) ? files.images : [files.images];
          
          // ✅ CRÍTICO: Validar número máximo de imagens
          if (imageFiles.length > MAX_IMAGES_PER_MESSAGE) {
            throw new Error(`IMAGES_LIMIT_EXCEEDED: Máximo ${MAX_IMAGES_PER_MESSAGE} imagens por envio`);
          }
          
          let totalImageSize = 0;
          
          for (const [index, file] of imageFiles.entries()) {
            try {
              console.log(`📸 Processando imagem ${index + 1}:`, {
                name: file.originalFilename,
                size: file.size,
                type: file.mimetype,
                exists: fs.existsSync(file.filepath)
              });
              
              // ✅ CRÍTICO: Validar tamanho individual
              if (file.size > MAX_IMAGE_SIZE) {
                throw new Error(`IMAGE_TOO_LARGE: ${file.originalFilename} excede ${MAX_IMAGE_MB}MB`);
              }
              
              totalImageSize += file.size;
              
              // ✅ CRÍTICO: Validar payload total
              if (totalImageSize > MAX_TOTAL_PAYLOAD_SIZE) {
                throw new Error(`PAYLOAD_TOO_LARGE: Total excede ${MAX_TOTAL_PAYLOAD_MB}MB`);
              }
              
              // Verificar se arquivo existe e é válido
              if (!fs.existsSync(file.filepath)) {
                console.error(`❌ Arquivo não encontrado: ${file.filepath}`);
                continue;
              }

              if (file.size === 0) {
                console.error(`❌ Arquivo vazio: ${file.originalFilename}`);
                continue;
              }
              
              // Ler arquivo de forma segura
              const buffer = await fs.promises.readFile(file.filepath);
              
              // ✅ CRÍTICO: Validar magic bytes
              const imageFormat = validateImageMagicBytes(buffer);
              if (!imageFormat) {
                throw new Error(`INVALID_IMAGE_FORMAT: ${file.originalFilename} não é uma imagem válida (magic bytes)`);
              }
              
              const base64 = buffer.toString('base64');
              
              // Validar base64
              if (!base64 || base64.length < 100) { // Mínimo razoável para uma imagem
                console.error(`❌ Base64 inválido para: ${file.originalFilename}`);
                continue;
              }
              
              images.push({
                base64,
                filename: file.originalFilename || `image-${index + 1}.jpg`,
                type: file.mimetype || 'image/jpeg',
                size: file.size,
                format: imageFormat
              });
              
              console.log(`✅ Imagem ${index + 1} processada: ${(base64.length/1024).toFixed(1)}KB base64 - Formato: ${imageFormat}`);
              
            } catch (fileError) {
              console.error(`❌ Erro ao processar imagem ${index + 1}:`, fileError.message);
              // Re-throw erros críticos, continue outros
              if (fileError.message.includes('IMAGE_TOO_LARGE') || 
                  fileError.message.includes('PAYLOAD_TOO_LARGE') ||
                  fileError.message.includes('INVALID_IMAGE_FORMAT')) {
                throw fileError;
              }
              // Continuar processando outras imagens para erros menores
            } finally {
              // Sempre tentar limpar arquivo temporário
              try {
                if (fs.existsSync(file.filepath)) {
                  await fs.promises.unlink(file.filepath);
                }
              } catch (cleanupError) {
                console.warn(`⚠️ Erro ao limpar ${file.filepath}:`, cleanupError.message);
              }
            }
          }
          
          console.log(`✅ Payload validado: ${images.length} imagem(ns), ${(totalImageSize/1024/1024).toFixed(1)}MB total`);
        }

        console.log(`✅ Multipart processado: ${images.length} imagem(ns) válida(s)`);

        // Processar campos de texto
        const getFieldValue = (field) => {
          if (!field) return '';
          return Array.isArray(field) ? field[0] : field;
        };

        resolve({
          message: getFieldValue(fields.message) || '',
          conversationHistory: getFieldValue(fields.conversationHistory) || '[]',
          idToken: getFieldValue(fields.idToken) || '',
          images
        });

      } catch (processError) {
        console.error('❌ Erro ao processar dados do formulário:', processError);
        reject(new Error(`PROCESS_ERROR: ${processError.message}`));
      }
    });
  });
}

// ✅ Função para processar request body (JSON ou multipart) com error handling
async function parseRequestBody(req) {
  const contentType = req.headers['content-type'] || '';
  
  try {
    if (contentType.includes('multipart/form-data')) {
      console.log('📦 Processando multipart/form-data...');
      const result = await parseMultipart(req);
      console.log('✅ Multipart processado com sucesso');
      return result;
    } else {
      console.log('📝 Processando application/json...');
      // Vercel já faz parse do JSON por padrão se bodyParser não for false
      const body = req.body || {};
      console.log('✅ JSON processado:', { hasMessage: !!body.message, hasImages: !!(body.images && body.images.length) });
      return body;
    }
  } catch (error) {
    console.error('❌ Erro ao processar request body:', error);
    throw new Error(`BODY_PARSE_ERROR: ${error.message}`);
  }
}

// ✅ CRÍTICO: Configuração centralizada de limites
const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_TOTAL_PAYLOAD_MB = 30;
const MAX_IMAGE_MB = 10;
const MAX_IMAGE_SIZE = MAX_IMAGE_MB * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_SIZE = MAX_TOTAL_PAYLOAD_MB * 1024 * 1024;
const MAX_IMAGE_ANALYSIS_TOKENS = 1500;

// ✅ CRÍTICO: Validação robusta de magic bytes
function validateImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 8) return false;
  
  const arr = new Uint8Array(buffer);
  
  // JPEG: FF D8 FF
  if (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) {
    return 'jpeg';
  }
  
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47) {
    return 'png';
  }
  
  // WebP: 52 49 46 46 (RIFF) + WebP signature at offset 8
  if (arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46 &&
      arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50) {
    return 'webp';
  }
  
  return false;
}

// ✅ Rate limiting melhorado - Fase 1 (compatível com Redis futuro)
const userRequestCount = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const MAX_REQUESTS_PER_MINUTE = 10;

// Métricas de rate limiting
const rateLimitMetrics = {
  totalRequests: 0,
  blockedRequests: 0,
  lastCleanup: Date.now()
};

// Cache para respostas frequentes (Fase 2)
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function checkRateLimit(uid) {
  const now = Date.now();
  rateLimitMetrics.totalRequests++;
  
  const userRequests = userRequestCount.get(uid) || [];
  
  // Remover requests antigos (fora da janela de tempo)
  const validRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  // Verificar se excedeu o limite
  if (validRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    rateLimitMetrics.blockedRequests++;
    console.warn(`🚫 Rate limit excedido para usuário: ${uid} (${validRequests.length}/${MAX_REQUESTS_PER_MINUTE})`);
    return false;
  }
  
  // Adicionar request atual e atualizar
  validRequests.push(now);
  userRequestCount.set(uid, validRequests);
  
  // Cleanup periódico (a cada 100 requests)
  if (rateLimitMetrics.totalRequests % 100 === 0) {
    cleanupRateLimit();
    cleanupResponseCache();
  }
  
  return true;
}

// Função de limpeza de memória
function cleanupRateLimit() {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW;
  const beforeSize = userRequestCount.size;
  
  for (const [uid, timestamps] of userRequestCount.entries()) {
    const valid = timestamps.filter(t => t > cutoff);
    if (valid.length === 0) {
      userRequestCount.delete(uid);
    } else if (valid.length !== timestamps.length) {
      userRequestCount.set(uid, valid);
    }
  }
  
  const cleaned = beforeSize - userRequestCount.size;
  if (cleaned > 0) {
    console.log(`🧹 Rate limit cleanup: ${cleaned} usuários inativos removidos`);
  }
  rateLimitMetrics.lastCleanup = now;
}

// Cache inteligente para respostas (Fase 2)
function getCachedResponse(messageHash) {
  const cached = responseCache.get(messageHash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`💾 Cache hit para mensagem: ${messageHash.substring(0, 8)}`);
    return cached.response;
  }
  if (cached) {
    responseCache.delete(messageHash);
  }
  return null;
}

function setCachedResponse(messageHash, response) {
  // Limitar cache a 100 entradas
  if (responseCache.size >= 100) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  
  responseCache.set(messageHash, {
    response,
    timestamp: Date.now()
  });
  console.log(`💾 Cache set para mensagem: ${messageHash.substring(0, 8)}`);
}

function cleanupResponseCache() {
  const now = Date.now();
  const beforeSize = responseCache.size;
  
  for (const [hash, data] of responseCache.entries()) {
    if (now - data.timestamp > CACHE_TTL) {
      responseCache.delete(hash);
    }
  }
  
  const cleaned = beforeSize - responseCache.size;
  if (cleaned > 0) {
    console.log(`🧹 Response cache cleanup: ${cleaned} entradas expiradas removidas`);
  }
}

// Hash simples para mensagens (para cache)
function hashMessage(message) {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Middleware CORS dinâmico
const corsMiddleware = cors({
  origin: (origin, callback) => {
    const fixedOrigin = 'https://prod-ai-teste.vercel.app';
    const prodFrontend = 'https://ai-synth.vercel.app';
    const newDeployment = 'https://ai-synth-dj-correas-projects.vercel.app';
    const directUrl = 'https://ai-synth-czzxlraox-dj-correas-projects.vercel.app';
    const apiPreviewRegex = /^https:\/\/prod-ai-teste-[a-z0-9\-]+\.vercel\.app$/;
    const frontendPreviewRegex = /^https:\/\/ai-synth(?:-[a-z0-9\-]+)?\.vercel\.app$/;
    const newDeploymentRegex = /^https:\/\/ai-synth-[a-z0-9\-]+\.vercel\.app$/;

    // Adicionar suporte para desenvolvimento local
    const localOrigins = [
      'http://localhost:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://127.0.0.1:3000',
    ];

    // Permitir origens locais, Vercel e file://
    if (!origin ||
        origin === fixedOrigin ||
        origin === prodFrontend ||
        origin === newDeployment ||
        origin === directUrl ||
        apiPreviewRegex.test(origin) ||
        frontendPreviewRegex.test(origin) ||
        newDeploymentRegex.test(origin) ||
        localOrigins.includes(origin) ||
        origin.startsWith('file://')) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

// Função para validar e sanitizar dados de entrada - ATUALIZADA COM SUPORTE A IMAGENS
function validateAndSanitizeInput(requestData) {
  const { message, conversationHistory, idToken, images = [] } = requestData;
  
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('TOKEN_MISSING');
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('MESSAGE_INVALID');
  }
  
  // ✅ Processar conversationHistory (pode vir como string do FormData)
  let validHistory = [];
  let historyData = conversationHistory;
  
  if (typeof conversationHistory === 'string') {
    try {
      historyData = JSON.parse(conversationHistory);
    } catch (error) {
      console.warn('⚠️ Erro ao parsear conversationHistory:', error);
      historyData = [];
    }
  }
  
  if (Array.isArray(historyData)) {
    validHistory = historyData
      .filter(msg => {
        return msg && 
          typeof msg === 'object' && 
          msg.role && 
          msg.content &&
          typeof msg.content === 'string' &&
          msg.content.trim().length > 0 &&
          ['user', 'assistant', 'system'].includes(msg.role);
      })
      .slice(-5); // Histórico reduzido para performance
  }
  
  // ✅ Validar imagens se presentes
  let validImages = [];
  if (Array.isArray(images) && images.length > 0) {
    if (images.length > 3) {
      throw new Error('IMAGES_LIMIT_EXCEEDED');
    }
    
    validImages = images.filter(img => {
      return img && 
        typeof img === 'object' && 
        img.base64 && 
        typeof img.base64 === 'string' &&
        img.filename && 
        typeof img.filename === 'string';
    }).slice(0, 3); // Garantir máximo de 3 imagens
    
    console.log(`✅ ${validImages.length} imagem(ns) válida(s) processada(s)`);
  }
  
  return {
    message: message.trim().substring(0, 2000),
    conversationHistory: validHistory,
    idToken: idToken.trim(),
    images: validImages,
    // 🎤 Detectar se é voice message (GRATUITO)
    isVoiceMessage: message.startsWith('[VOICE MESSAGE]'),
    // 🖼️ Detectar se tem imagens (requer GPT-4 Vision)
    hasImages: validImages.length > 0
  };
}

// Função para gerenciar limites de usuário e cota de imagens - ATUALIZADA
async function handleUserLimits(db, uid, email) {
  const userRef = db.collection('usuarios').doc(uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const now = Timestamp.now();
      const today = now.toDate().toDateString();
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      let userData;

      if (!snap.exists) {
        userData = {
          uid,
          plano: 'gratis',
          mensagensRestantes: 9,
          dataUltimoReset: now,
          createdAt: now,
          // Cota de análise de imagens
          imagemAnalises: {
            usadas: 0,
            limite: 5, // Grátis: 5/mês
            mesAtual: currentMonth,
            anoAtual: currentYear,
            resetEm: now
          }
        };
        if (email) {
          userData.email = email;
        }
        tx.set(userRef, userData);
      } else {
        userData = snap.data();
        const lastReset = userData.dataUltimoReset?.toDate().toDateString();

        // VERIFICAÇÃO AUTOMÁTICA DE EXPIRAÇÃO DO PLANO PLUS
        if (userData.plano === 'plus' && userData.planExpiresAt) {
          const currentDate = new Date();
          const expirationDate = userData.planExpiresAt instanceof Date ? 
            userData.planExpiresAt : 
            userData.planExpiresAt.toDate ? userData.planExpiresAt.toDate() : new Date(userData.planExpiresAt);
          
          if (expirationDate <= currentDate) {
            console.log('⏰ Plano Plus expirado, convertendo para gratuito:', uid);
            
            // Dados para converter plano expirado
            const expiredPlanData = {
              plano: 'gratis',
              isPlus: false,
              mensagensRestantes: 10,
              planExpiredAt: now,
              previousPlan: 'plus',
              dataUltimoReset: now,
              // Reset cota de imagens para plano gratuito
              imagemAnalises: {
                usadas: 0,
                limite: 5,
                mesAtual: currentMonth,
                anoAtual: currentYear,
                resetEm: now
              }
            };
            
            // Atualizar no Firestore
            tx.update(userRef, expiredPlanData);
            
            // Atualizar userData local para refletir as mudanças
            userData = { ...userData, ...expiredPlanData };
            
            console.log('✅ Usuário convertido de Plus expirado para gratuito:', uid);
          }
        }

        // Verificar reset diário das mensagens
        if (lastReset !== today) {
          userData.mensagensRestantes = 10;
          tx.update(userRef, {
            mensagensRestantes: 10,
            dataUltimoReset: now,
          });
        }

        // Verificar reset mensal da cota de imagens
        if (!userData.imagemAnalises || 
            userData.imagemAnalises.mesAtual !== currentMonth || 
            userData.imagemAnalises.anoAtual !== currentYear) {
          
          const limiteImagens = userData.plano === 'plus' ? 20 : 5;
          userData.imagemAnalises = {
            usadas: 0,
            limite: limiteImagens,
            mesAtual: currentMonth,
            anoAtual: currentYear,
            resetEm: now
          };
          
          tx.update(userRef, {
            imagemAnalises: userData.imagemAnalises
          });
          
          console.log(`🔄 Reset mensal da cota de imagens: ${limiteImagens} análises disponíveis para usuário ${userData.plano}`);
        }

        // Verificar limite de mensagens diárias (apenas plano gratuito)
        if (userData.plano === 'gratis') {
          if (userData.mensagensRestantes <= 0) {
            throw new Error('LIMIT_EXCEEDED');
          }
          tx.update(userRef, {
            mensagensRestantes: FieldValue.increment(-1),
          });
          userData.mensagensRestantes =
            (userData.mensagensRestantes || 10) - 1;
        }
      }

      return userData;
    });

    const finalSnap = await userRef.get();
    return { ...result, perfil: finalSnap.data().perfil };
  } catch (error) {
    if (error.message === 'LIMIT_EXCEEDED') {
      console.warn('🚫 Limite de mensagens atingido para:', email);
      throw error;
    }
    console.error('❌ Erro na transação do usuário:', error);
    throw new Error('Erro ao processar limites do usuário');
  }
}

// Função para consumir cota de análise de imagens - NOVA
async function consumeImageAnalysisQuota(db, uid, email, userData) {
  const userRef = db.collection('usuarios').doc(uid);
  
  try {
    const result = await db.runTransaction(async (tx) => {
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      // Usar userData já carregado ou buscar novamente
      let currentUserData = userData;
      if (!currentUserData.imagemAnalises) {
        const snap = await tx.get(userRef);
        currentUserData = snap.data();
      }
      
      // Verificar se precisa resetar cota mensal
      if (!currentUserData.imagemAnalises || 
          currentUserData.imagemAnalises.mesAtual !== currentMonth || 
          currentUserData.imagemAnalises.anoAtual !== currentYear) {
        
        const limiteImagens = currentUserData.plano === 'plus' ? 20 : 5;
        currentUserData.imagemAnalises = {
          usadas: 0,
          limite: limiteImagens,
          mesAtual: currentMonth,
          anoAtual: currentYear,
          resetEm: Timestamp.now()
        };
      }
      
      // Verificar se ainda tem cota disponível
      if (currentUserData.imagemAnalises.usadas >= currentUserData.imagemAnalises.limite) {
        throw new Error('IMAGE_QUOTA_EXCEEDED');
      }
      
      // Consumir uma unidade da cota
      const novaQuantidade = currentUserData.imagemAnalises.usadas + 1;
      tx.update(userRef, {
        'imagemAnalises.usadas': novaQuantidade,
        'imagemAnalises.ultimoUso': Timestamp.now()
      });
      
      console.log(`🖼️ Cota de imagem consumida: ${novaQuantidade}/${currentUserData.imagemAnalises.limite} para usuário ${currentUserData.plano}`);
      
      return {
        ...currentUserData.imagemAnalises,
        usadas: novaQuantidade
      };
    });
    
    return result;
  } catch (error) {
    if (error.message === 'IMAGE_QUOTA_EXCEEDED') {
      console.warn('🚫 Cota de análise de imagens esgotada para:', email);
      throw error;
    }
    console.error('❌ Erro ao consumir cota de imagens:', error);
    throw error;
  }
}

// ✅ OTIMIZAÇÃO: Seleção inteligente de modelo para economizar tokens
function selectOptimalModel(hasImages, conversationHistory, currentMessage) {
  try {
    // ✅ DEBUG: Log entrada da função
    console.log('🎯 selectOptimalModel chamada com:', { hasImages, messageLength: currentMessage.length });
    
    // ✅ REGRA CRÍTICA: Imagens sempre usam GPT-4o
    if (hasImages) {
      console.log('🎯 GPT-4o selecionado: análise de imagem detectada');
      return {
        model: 'gpt-4o',
        reason: 'REQUIRED_FOR_IMAGES',
        maxTokens: MAX_IMAGE_ANALYSIS_TOKENS,
        temperature: 0.7
      };
    }
    
    // ✅ Análise de complexidade do texto
    const messageLength = currentMessage.length;
    const wordCount = currentMessage.split(/\s+/).length;
    const hasComplexTerms = /(?:analis|interpreta|desenvol|implement|algorit|arquitet|complex|detail|profund|técnic)/i.test(currentMessage);
    const hasCode = /(?:```|`|function|class|import|export|const|let|var|if|for|while)/i.test(currentMessage);
    const isQuestion = /(?:\?|como|qual|onde|quando|por que|explique|descreva)/i.test(currentMessage);
    
    // ✅ Verificar se é follow-up de análise de imagem recente
    const recentMessages = conversationHistory.slice(-2);
    const hasRecentImageAnalysis = recentMessages.some(msg => 
      msg.role === 'assistant' && 
      (msg.content.includes('imagem') || msg.content.includes('vejo') || msg.content.includes('analise'))
    );
    
    // ✅ Cálculo de score de complexidade
    let complexityScore = 0;
    
    // Tamanho e densidade
    if (messageLength > 500) complexityScore += 2;
    else if (messageLength > 200) complexityScore += 1;
    
    if (wordCount > 100) complexityScore += 2;
    else if (wordCount > 50) complexityScore += 1;
    
    // Conteúdo técnico
    if (hasComplexTerms) complexityScore += 3;
    if (hasCode) complexityScore += 2;
    if (isQuestion && messageLength > 100) complexityScore += 1;
    
    // Follow-up de imagem com pergunta específica
    if (hasRecentImageAnalysis && isImageRelatedFollowUp(currentMessage)) {
      complexityScore += 4; // Força usar GPT-4o
    }
    
    // ✅ DECISÃO FINAL baseada no threshold
    const useGPT4 = complexityScore >= GPT4_COMPLEXITY_THRESHOLD;
    const selectedModel = useGPT4 ? 'gpt-4o' : 'gpt-3.5-turbo';
    const maxTokens = useGPT4 ? MAX_TEXT_RESPONSE_TOKENS : Math.min(MAX_TEXT_RESPONSE_TOKENS, 1000);
    
    const reason = useGPT4 
      ? `COMPLEX_ANALYSIS: Score ${complexityScore}/${GPT4_COMPLEXITY_THRESHOLD}`
      : `SIMPLE_RESPONSE: Score ${complexityScore}/${GPT4_COMPLEXITY_THRESHOLD} (economia)`;
    
    console.log(`🎯 ${selectedModel} selecionado:`, {
      complexityScore,
      threshold: GPT4_COMPLEXITY_THRESHOLD,
      messageLength,
      hasComplexTerms,
      hasRecentImageAnalysis,
      reason
    });
    
    return {
      model: selectedModel,
      reason,
      maxTokens,
      temperature: useGPT4 ? 0.7 : 0.8
    };
    
  } catch (error) {
    console.warn('⚠️ Erro na seleção de modelo, usando padrão:', error.message);
    // ✅ FALLBACK SEGURO
    return {
      model: 'gpt-3.5-turbo',
      reason: 'FALLBACK_ERROR',
      maxTokens: 1000,
      temperature: 0.8
    };
  }
}

// ✅ Detectar se é pergunta relacionada à imagem analisada
function isImageRelatedFollowUp(message) {
  const imageKeywords = [
    'imagem', 'foto', 'vejo', 'viu', 'mostrei', 'anexei',
    'screenshot', 'captura', 'interface', 'tela', 'plugin',
    'waveform', 'espectro', 'eq', 'compressor', 'daw'
  ];
  
  const messageLower = message.toLowerCase();
  return imageKeywords.some(keyword => messageLower.includes(keyword));
}

// System prompts para diferentes cenários
const SYSTEM_PROMPTS = {
  // ✅ MELHORIA: Prompt otimizado para análise de imagens com GPT-4 Vision
  imageAnalysis: `Você é o PROD.AI 🎵, um especialista master EXCLUSIVAMENTE em produção musical e análise visual técnica.

🎯 REGRAS FUNDAMENTAIS:
- ANALISE APENAS imagens relacionadas à música: DAWs, plugins, waveforms, espectrogramas, mixers, equipamentos musicais
- Se a imagem não for relacionada à música/áudio, responda: "🎵 Analiso apenas imagens relacionadas à produção musical! Envie screenshots de DAWs, plugins, waveforms ou equipamentos de áudio."
- SEMPRE mantenha foco exclusivo em contexto musical

🔍 INSTRUÇÕES PARA ANÁLISE DE IMAGENS MUSICAIS:
- Analise detalhadamente todas as imagens com foco técnico e prático
- Identifique: interfaces de DAW, plugins, waveforms, espectrogramas, mixers, equipamentos
- Forneça feedback específico sobre configurações visíveis (valores exatos em Hz, dB, ms)
- Sugira melhorias concretas baseadas no que você vê
- Explique problemas identificados e suas causas
- Dê conselhos imediatamente aplicáveis
- Se vir múltiplas imagens, analise cada uma separadamente

🔍 ESPECIALIDADES DE ANÁLISE VISUAL:
- Waveforms: dinâmica, clipping, headroom, fases
- Espectrogramas: frequências dominantes, vazios espectrais, mascaramento
- Plugins EQ: curvas problemáticas, frequências de corte/boost
- Compressores: ratios, attack/release, threshold settings
- DAWs: organização, routing, problemas de workflow
- Master chain: ordem de plugins, configurações de limiting

📊 FORMATO DE RESPOSTA (apenas para imagens musicais):
- Comece identificando o que vê na(s) imagem(ns)
- Aponte problemas específicos com valores técnicos
- Sugira correções práticas e imediatas
- Finalize com dica pro aplicar agora

🚫 IMAGENS PROIBIDAS: Qualquer imagem não relacionada à música/áudio/produção.

Seja direto, técnico e focado exclusivamente em soluções musicais.`,

  // Prompt padrão para conversas sem imagens  
  default: `Você é o PROD.AI 🎵, um especialista master EXCLUSIVAMENTE em produção musical e áudio.

🎯 REGRAS FUNDAMENTAIS:
- RESPONDA APENAS sobre música, produção musical, áudio, instrumentos e temas relacionados
- Se perguntarem sobre qualquer outro assunto (café, receitas, programação, etc.), responda: "🎵 Sou especializado apenas em produção musical! Como posso ajudar com sua música hoje? Quer dicas de mixagem, mastering, ou algum desafio específico na sua produção?"
- SEMPRE redirecione conversas não-musicais para o contexto musical
- Seja direto, técnico e preciso em todas as respostas musicais
- Use valores específicos: frequências exatas (Hz), faixas dinâmicas (dB), tempos (ms)
- Mencione equipamentos, plugins e técnicas por nome
- Forneça parâmetros exatos quando relevante

🛠️ ESPECIALIDADES TÉCNICAS EXCLUSIVAS:
- Mixagem: EQ preciso, compressão dinâmica, reverb/delay, automação
- Mastering: Limiters, maximizers, análise espectral, LUFS, headroom
- Sound Design: Síntese, sampling, modulação, efeitos
- Arranjo: Teoria musical aplicada, harmonias, progressões
- Acústica: Tratamento de sala, posicionamento de monitores
- Workflow: Técnicas de produção rápida e eficiente
- Géneros: Funk, trap, sertanejo, eletrônica, rock, etc.

📋 FORMATO OBRIGATÓRIO (apenas para temas musicais):
- Use emojis relevantes no início de cada parágrafo
- Apresente valores técnicos quando aplicável
- Finalize sempre com uma dica prática

🚫 TEMAS PROIBIDOS: Qualquer assunto não relacionado à música/áudio.

Seja um especialista musical absoluto e exclusivo.`
};

// Função principal do handler
export default async function handler(req, res) {
  // ✅ CRÍTICO: Declarar todas as variáveis no início do escopo para evitar ReferenceError
  let hasImages = false;
  let modelSelection = null;
  let requestTimeout = 60000;
  let requestData = null;
  let decoded = null;
  
  const requestId = Math.random().toString(36).substring(7);
  console.log(`🔄 [${requestId}] Nova requisição recebida:`, {
    method: req.method,
    timestamp: new Date().toISOString(),
    hasBody: !!req.body,
    contentType: req.headers['content-type'],
    origin: req.headers.origin
  });

  // Prevenir múltiplas respostas
  let responseSent = false;
  const sendResponse = (status, data) => {
    if (responseSent) {
      console.warn(`⚠️ [${requestId}] Tentativa de enviar resposta duplicada ignorada`);
      return;
    }
    responseSent = true;
    return res.status(status).json(data);
  };

  try {
    await runMiddleware(req, res, corsMiddleware);
  } catch (err) {
    console.error(`❌ [${requestId}] CORS error:`, err);
    return sendResponse(403, { error: 'CORS_ERROR', message: 'Not allowed by CORS policy' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendResponse(405, { error: 'METHOD_NOT_ALLOWED', message: 'Método não permitido' });
  }

  try {
    // ✅ CORREÇÃO: Processar body dinamicamente (JSON ou multipart) com error handling
    try {
      requestData = await parseRequestBody(req);
      console.log('📨 Request data processado:', {
        hasMessage: !!requestData.message,
        hasImages: !!(requestData.images && requestData.images.length > 0),
        imageCount: requestData.images?.length || 0,
        contentType: req.headers['content-type']
      });
    } catch (parseError) {
      console.error('❌ Erro ao processar request body:', parseError);
      if (parseError.message.includes('BODY_PARSE_ERROR')) {
        return res.status(400).json({ 
          error: 'INVALID_REQUEST_FORMAT', 
          message: 'Formato de requisição inválido. Verifique se as imagens são válidas.' 
        });
      }
      throw parseError;
    }

    let validatedData;
    try {
      validatedData = validateAndSanitizeInput(requestData);
    } catch (error) {
      console.error('❌ Erro na validação:', error.message);
      if (error.message === 'TOKEN_MISSING') {
        return res.status(401).json({ error: 'AUTH_TOKEN_MISSING', message: 'Token de autenticação necessário' });
      }
      if (error.message === 'MESSAGE_INVALID') {
        return res.status(422).json({ error: 'MESSAGE_INVALID', message: 'Mensagem inválida ou vazia' });
      }
      if (error.message === 'IMAGES_LIMIT_EXCEEDED') {
        return res.status(422).json({ error: 'IMAGES_LIMIT_EXCEEDED', message: 'Máximo de 3 imagens por envio' });
      }
      throw error;
    }

    const { message, conversationHistory, idToken, images } = validatedData;
    hasImages = validatedData.hasImages;
    
    // ✅ DEBUG: Log critical para diagnosticar seleção de modelo
    console.log(`🔍 [${requestId}] Estado antes da seleção de modelo:`, {
      hasImages,
      imageCount: images ? images.length : 0,
      validatedDataHasImages: validatedData.hasImages
    });

    // Verificar autenticação
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      console.error(`❌ [${requestId}] Token verification failed:`, err.message);
      return sendResponse(401, { error: 'AUTH_ERROR', message: 'Token inválido ou expirado' });
    }

    const uid = decoded.uid;
    const email = decoded.email;

    // ✅ SEGURANÇA: Verificar rate limiting
    if (!checkRateLimit(uid)) {
      return sendResponse(429, { 
        error: 'RATE_LIMIT_EXCEEDED', 
        message: 'Muitas solicitações. Aguarde um momento antes de tentar novamente.',
        retryAfter: 60
      });
    }

    // Gerenciar limites de usuário
    let userData;
    try {
      userData = await handleUserLimits(db, uid, email);
    } catch (error) {
      if (error.message === 'LIMIT_EXCEEDED') {
        return res.status(403).json({ error: 'Limite diário de mensagens atingido' });
      }
      throw error;
    }

    // Se tem imagens, verificar e consumir cota de análise
    let imageQuotaInfo = null;
    if (hasImages) {
      try {
        imageQuotaInfo = await consumeImageAnalysisQuota(db, uid, email, userData);
        console.log(`✅ Cota de imagem consumida para análise visual`);
      } catch (error) {
        if (error.message === 'IMAGE_QUOTA_EXCEEDED') {
          const limite = userData.plano === 'plus' ? 20 : 5;
          return res.status(403).json({ 
            error: 'Cota de análise de imagens esgotada',
            message: `Você atingiu o limite de ${limite} análises de imagem deste mês.`,
            plano: userData.plano,
            limite: limite,
            proximoReset: 'Início do próximo mês'
          });
        }
        throw error;
      }
    }

    // Preparar mensagens para a IA
    const messages = [];
    
    // System prompt baseado no tipo de análise
    if (hasImages) {
      messages.push({
        role: 'system',
        content: SYSTEM_PROMPTS.imageAnalysis
      });
    } else {
      messages.push({
        role: 'system', 
        content: SYSTEM_PROMPTS.default
      });
    }

    // Adicionar histórico de conversa
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }

    // Preparar mensagem do usuário
    const userMessage = {
      role: 'user',
      content: hasImages ? [
        { type: 'text', text: message },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${img.base64}`,
            detail: 'high'
          }
        }))
      ] : message
    };

    messages.push(userMessage);

    // ✅ OTIMIZAÇÃO: Seleção inteligente de modelo para reduzir gastos de tokens
    modelSelection = selectOptimalModel(hasImages, conversationHistory, message);
    
    // ✅ SEGURANÇA CRÍTICA: Garantir GPT-4o para imagens (double-check)
    if (hasImages && modelSelection.model !== 'gpt-4o') {
      console.warn('🚨 CORREÇÃO CRÍTICA: Forçando GPT-4o para imagens!');
      modelSelection = {
        model: 'gpt-4o',
        reason: 'FORCED_FOR_IMAGES_SAFETY',
        maxTokens: MAX_IMAGE_ANALYSIS_TOKENS,
        temperature: 0.7
      };
    }
    
    console.log(`🤖 Usando modelo: ${modelSelection.model}`, {
      reason: modelSelection.reason,
      maxTokens: modelSelection.maxTokens,
      hasImages: hasImages
    });

    // ✅ TIMEOUT CONFIGURÁVEL baseado na complexidade
    requestTimeout = hasImages ? 180000 : (modelSelection.model === 'gpt-4o' ? 120000 : 60000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

    // Chamar API da OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelSelection.model,
        messages: messages,
        max_tokens: modelSelection.maxTokens,
        temperature: modelSelection.temperature,
      }),
    });

    // ✅ Limpar timeout após resposta
    clearTimeout(timeoutId);

    // ✅ MELHORIA: Tratamento de erro mais específico e retry em casos específicos
    if (!response.ok) {
      let errorDetails = 'Unknown error';
      try {
        errorDetails = await response.text();
      } catch (parseErr) {
        console.error('❌ Failed to parse OpenAI error response:', parseErr);
      }
      console.error('❌ OpenAI API Error:', {
        status: response.status,
        statusText: response.statusText,
        details: errorDetails,
        model: modelSelection.model,
        hasImages: hasImages
      });
      
      // Mapear erros específicos da OpenAI
      if (response.status === 401) {
        throw new Error('OpenAI API key invalid or expired');
      } else if (response.status === 429) {
        // Rate limit - sugerir retry
        throw new Error('OpenAI API rate limit exceeded. Please try again in a moment.');
      } else if (response.status === 400 && errorDetails.includes('image')) {
        // Erro específico de imagem
        throw new Error('Image format not supported or corrupted. Please try a different image.');
      } else if (response.status >= 500) {
        throw new Error('OpenAI service temporarily unavailable');
      } else {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    console.log(`✅ [${requestId}] Resposta da IA gerada com sucesso`, {
      model: modelSelection ? modelSelection.model : 'unknown',
      hasImages: hasImages,
      responseLength: reply.length,
      tokenEstimate: Math.ceil(reply.length / 4), // Estimativa aproximada
      imageQuotaUsed: imageQuotaInfo?.usadas || null,
      userPlan: userData.plano
    });

    // Preparar resposta final
    const responseData = {
      reply,
      mensagensRestantes: userData.plano === 'gratis' ? userData.mensagensRestantes : null,
      model: modelSelection ? modelSelection.model : 'unknown'
    };

    // Incluir informações de cota de imagem se aplicável
    if (hasImages && imageQuotaInfo) {
      responseData.imageAnalysis = {
        quotaUsed: imageQuotaInfo.usadas,
        quotaLimit: imageQuotaInfo.limite,
        quotaRemaining: imageQuotaInfo.limite - imageQuotaInfo.usadas,
        planType: userData.plano
      };
    }

    return sendResponse(200, responseData);

  } catch (error) {
    // ✅ Limpar timeout em caso de erro
    if (typeof timeoutId !== 'undefined') {
      clearTimeout(timeoutId);
    }
    
    console.error(`💥 [${requestId}] ERRO NO SERVIDOR:`, {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      userId: 'unknown',
      hasImages: typeof hasImages !== 'undefined' ? !!hasImages : false,
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin,
      contentType: req.headers['content-type']
    });
    
    // ✅ Tratamento específico para AbortError (timeout)
    if (error.name === 'AbortError') {
      console.error('⏰ Timeout na requisição para OpenAI:', {
        timeout: typeof requestTimeout !== 'undefined' ? requestTimeout : 60000,
        model: modelSelection ? modelSelection.model : 'unknown',
        hasImages: typeof hasImages !== 'undefined' ? hasImages : false
      });
      return sendResponse(408, { 
        error: 'REQUEST_TIMEOUT', 
        message: 'A análise demorou mais que o esperado. Tente novamente ou reduza a complexidade da mensagem.'
      });
    }
    
    // ✅ Categorizar erros específicos para melhor debugging
    if (error.message.includes('IMAGES_LIMIT_EXCEEDED')) {
      return sendResponse(422, { 
        error: 'IMAGES_LIMIT_EXCEEDED', 
        message: `Máximo ${MAX_IMAGES_PER_MESSAGE} imagens por envio.`
      });
    }
    
    if (error.message.includes('IMAGE_TOO_LARGE')) {
      return sendResponse(413, { 
        error: 'IMAGE_TOO_LARGE', 
        message: `Imagem muito grande. Máximo ${MAX_IMAGE_MB}MB por imagem.`
      });
    }
    
    if (error.message.includes('PAYLOAD_TOO_LARGE')) {
      return sendResponse(413, { 
        error: 'PAYLOAD_TOO_LARGE', 
        message: `Payload total muito grande. Máximo ${MAX_TOTAL_PAYLOAD_MB}MB no total.`
      });
    }
    
    if (error.message.includes('INVALID_IMAGE_FORMAT')) {
      return sendResponse(415, { 
        error: 'INVALID_IMAGE_FORMAT', 
        message: 'Formato de imagem inválido. Use JPEG, PNG ou WebP.'
      });
    }
    
    if (error.message.includes('FORMIDABLE_ERROR')) {
      return sendResponse(400, { 
        error: 'FILE_UPLOAD_ERROR', 
        message: 'Erro ao processar upload de arquivo. Verifique se as imagens são válidas.'
      });
    }
    
    if (error.message.includes('BODY_PARSE_ERROR')) {
      return sendResponse(400, { 
        error: 'REQUEST_FORMAT_ERROR', 
        message: 'Formato de requisição inválido.'
      });
    }
    
    if (error.message.includes('PROCESS_ERROR')) {
      return sendResponse(422, { 
        error: 'DATA_PROCESSING_ERROR', 
        message: 'Erro ao processar dados enviados.'
      });
    }
    
    if (error.message.includes('OpenAI')) {
      return sendResponse(503, { 
        error: 'AI_SERVICE_ERROR', 
        message: 'Serviço de IA temporariamente indisponível. Tente novamente.'
      });
    }
    
    if (error.message.includes('Firebase') || error.message.includes('auth')) {
      return sendResponse(401, { 
        error: 'AUTH_ERROR', 
        message: 'Erro de autenticação. Faça login novamente.'
      });
    }
    
    // Erro genérico
    return sendResponse(500, { 
      error: 'SERVER_ERROR', 
      message: 'Erro interno do servidor. Nossa equipe foi notificada.',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
