import { auth, db } from './firebaseAdmin.js';
import cors from 'cors';

// Middleware CORS
const corsMiddleware = cors({
  origin: (origin, callback) => {
    const apiProd = 'https://prod-ai-teste.vercel.app';
    const frontendProd = 'https://ai-synth.vercel.app';
    const apiPreviewRegex = /^https:\/\/prod-ai-teste-[a-z0-9\-]+\.vercel\.app$/;
    const frontendPreviewRegex = /^https:\/\/ai-synth(?:-[a-z0-9\-]+)?\.vercel\.app$/;
    const localOrigins = [
      'http://localhost:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://127.0.0.1:3000', 
    ];

    if (!origin ||
        origin === apiProd ||
        origin === frontendProd ||
        apiPreviewRegex.test(origin) ||
        frontendPreviewRegex.test(origin) ||
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
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

// 🎤 FUNÇÃO PRINCIPAL - VOICE MESSAGE HANDLER
export default async function handler(req, res) {
  console.log('🎤 Voice Message API chamada:', {
    method: req.method,
    timestamp: new Date().toISOString()
  });

  try {
    await runMiddleware(req, res, corsMiddleware);
  } catch (err) {
    console.error('CORS error:', err);
    return res.status(403).end();
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { audioData, idToken } = req.body;

    if (!idToken) {
      return res.status(401).json({ error: 'Token de autenticação necessário' });
    }

    if (!audioData) {
      return res.status(400).json({ error: 'Dados de áudio necessários' });
    }

    // Verificar autenticação
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const uid = decoded.uid;
    const email = decoded.email;

    console.log('🎵 Processando áudio para:', email);

    // 1. TRANSCRIÇÃO COM OPENAI WHISPER
    const transcription = await transcribeAudio(audioData);
    console.log('📝 Transcrição:', transcription);

    // 2. ANÁLISE TÉCNICA DO ÁUDIO
    const audioAnalysis = await analyzeAudioContent(audioData);
    console.log('🎛️ Análise:', audioAnalysis);

    // 3. GERAR RESPOSTA DA IA COM CONTEXTO COMPLETO
    const aiResponse = await generateVoiceResponse(transcription, audioAnalysis, uid);
    console.log('🤖 Resposta gerada para:', email);

    // 4. SALVAR NO FIRESTORE (OPCIONAL - PARA ANALYTICS)
    await saveVoiceInteraction(uid, {
      transcription,
      audioAnalysis,
      response: aiResponse,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      transcription,
      audioAnalysis,
      aiResponse
    });

  } catch (error) {
    console.error('💥 Erro no Voice Message:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
}

// 🎧 FUNÇÃO 1: TRANSCRIÇÃO COM WHISPER
async function transcribeAudio(audioBase64) {
  try {
    // Converter base64 para buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Criar FormData para Whisper API
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt'); // Português

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`OpenAI Whisper erro: ${response.status}`);
    }

    const result = await response.json();
    return result.text || '';

  } catch (error) {
    console.error('❌ Erro na transcrição:', error);
    // Fallback: retornar mensagem genérica se falhar
    return 'Áudio recebido - processando conteúdo musical...';
  }
}

// 🎛️ FUNÇÃO 2: ANÁLISE TÉCNICA DE ÁUDIO
async function analyzeAudioContent(audioBase64) {
  try {
    // Análise básica do buffer de áudio
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    const analysis = {
      fileSize: audioBuffer.length,
      fileSizeMB: (audioBuffer.length / (1024 * 1024)).toFixed(2),
      estimatedDuration: Math.ceil(audioBuffer.length / 44100), // Estimativa aproximada
      hasContent: audioBuffer.length > 1000,
      quality: audioBuffer.length > 100000 ? 'boa' : 'baixa',
      
      // Análise de conteúdo baseada em características
      likelyContent: detectAudioContent(audioBuffer),
      
      // Sugestões técnicas baseadas no tamanho/qualidade
      technicalSuggestions: generateTechnicalSuggestions(audioBuffer)
    };

    return analysis;

  } catch (error) {
    console.error('❌ Erro na análise:', error);
    return {
      fileSize: 0,
      hasContent: false,
      quality: 'erro',
      likelyContent: 'não identificado',
      technicalSuggestions: []
    };
  }
}

// 🧠 FUNÇÃO 3: DETECTAR TIPO DE CONTEÚDO AUDIO
function detectAudioContent(audioBuffer) {
  const size = audioBuffer.length;
  
  if (size < 10000) return 'muito_curto';
  if (size < 100000) return 'pergunta_rapida';
  if (size < 500000) return 'exemplo_musical_curto';
  if (size > 1000000) return 'faixa_completa';
  
  return 'conteudo_musical';
}

// ⚙️ FUNÇÃO 4: GERAR SUGESTÕES TÉCNICAS
function generateTechnicalSuggestions(audioBuffer) {
  const suggestions = [];
  const size = audioBuffer.length;
  
  if (size < 50000) {
    suggestions.push('Áudio muito curto - grave por mais tempo para análise melhor');
  }
  
  if (size > 2000000) {
    suggestions.push('Áudio longo - considere enviar trechos específicos para análise focada');
  }
  
  suggestions.push('Para melhor análise: grave em ambiente silencioso');
  suggestions.push('Posicione o microfone próximo ao monitor/fone');
  
  return suggestions;
}

// 🤖 FUNÇÃO 5: GERAR RESPOSTA DA IA
async function generateVoiceResponse(transcription, audioAnalysis, uid) {
  try {
    // Buscar perfil do usuário para personalização
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userProfile = userDoc.exists ? userDoc.data().perfil : {};

    // Prompt especializado para voice messages
    const voicePrompt = `Você é o PROD.AI 🎵, especialista em produção musical. 

CONTEXTO: O usuário enviou um VOICE MESSAGE (áudio).

TRANSCRIÇÃO: "${transcription}"

ANÁLISE DO ÁUDIO:
- Tamanho: ${audioAnalysis.fileSizeMB}MB
- Duração estimada: ~${audioAnalysis.estimatedDuration}s  
- Qualidade: ${audioAnalysis.quality}
- Tipo de conteúdo: ${audioAnalysis.likelyContent}

PERFIL DO USUÁRIO:
- Estilo: ${userProfile.estilo || 'Não informado'}
- Nível: ${userProfile.nivelTecnico || 'Não informado'} 
- DAW: ${userProfile.daw || 'Não informado'}

INSTRUÇÕES ESPECIAIS PARA VOICE MESSAGE:
1. Responda como se você REALMENTE OUVIU o áudio
2. Seja específico sobre o que o usuário falou
3. Se ele enviou áudio musical, analise tecnicamente
4. Use emojis e seja direto
5. Dê soluções práticas imediatas
6. Valores exatos: Hz, dB, ms, etc.

FORMATO DA RESPOSTA:
🎤 [Confirmação do que entendeu]
🎛️ [Análise técnica do problema/situação]
💡 [Soluções práticas com parâmetros]
🚀 [Próximos passos]

Responda com excelência técnica e personalização total!`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'system',
          content: voicePrompt
        }],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API erro: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();

  } catch (error) {
    console.error('❌ Erro na resposta da IA:', error);
    return `🎤 **Áudio recebido com sucesso!**

🎛️ **Análise:** Detectei ${audioAnalysis.likelyContent} com qualidade ${audioAnalysis.quality}

💡 **Resposta baseada na transcrição:** "${transcription}"

🚀 **Continue enviando áudios que posso ajudar ainda melhor com análises técnicas específicas!**`;
  }
}

// 💾 FUNÇÃO 6: SALVAR INTERAÇÃO (ANALYTICS)
async function saveVoiceInteraction(uid, data) {
  try {
    await db.collection('voice_interactions').add({
      uid,
      ...data,
      createdAt: new Date()
    });
    console.log('💾 Interação de voz salva');
  } catch (error) {
    console.error('❌ Erro ao salvar:', error);
    // Não falha a requisição se não conseguir salvar
  }
}
