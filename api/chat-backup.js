import { auth, db } from './firebaseAdmin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import cors from 'cors';

// Middleware CORS dinâmico
const corsMiddleware = cors({
  origin: (origin, callback) => {
    const fixedOrigin = 'https://prod-ai-teste.vercel.app';
    const prodFrontend = 'https://ai-synth.vercel.app';
    const apiPreviewRegex = /^https:\/\/prod-ai-teste-[a-z0-9\-]+\.vercel\.app$/;
    const frontendPreviewRegex = /^https:\/\/ai-synth(?:-[a-z0-9\-]+)?\.vercel\.app$/;
    
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
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

// Função para validar e sanitizar dados de entrada
function validateAndSanitizeInput(req) {
  const { message, conversationHistory = [], idToken } = req.body;
  
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('TOKEN_MISSING');
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('MESSAGE_INVALID');
  }
  
  let validHistory = [];
  if (Array.isArray(conversationHistory)) {
    validHistory = conversationHistory
      .filter(msg => {
        return msg && 
          typeof msg === 'object' && 
          msg.role && 
          msg.content &&
          typeof msg.content === 'string' &&
          msg.content.trim().length > 0 &&
          ['user', 'assistant', 'system'].includes(msg.role);
      })
      .slice(-10);
  }
  
  return {
    message: message.trim().substring(0, 2000),
    conversationHistory: validHistory,
    idToken: idToken.trim()
  };
}

// Função para gerenciar limites de usuário
async function handleUserLimits(db, uid, email) {
  const userRef = db.collection('usuarios').doc(uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const now = Timestamp.now();
      const today = now.toDate().toDateString();

      let userData;

      if (!snap.exists) {
        userData = {
          uid,
          plano: 'gratis',
          mensagensRestantes: 9,
          dataUltimoReset: now,
          createdAt: now,
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
              dataUltimoReset: now
            };
            
            // Atualizar no Firestore
            tx.update(userRef, expiredPlanData);
            
            // Atualizar userData local para refletir as mudanças
            userData = { ...userData, ...expiredPlanData };
            
            console.log('✅ Usuário convertido de Plus expirado para gratuito:', uid);
          }
        }

        if (lastReset !== today) {
          userData.mensagensRestantes = 10;
          tx.update(userRef, {
            mensagensRestantes: 10,
            dataUltimoReset: now,
          });
        }

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

// Função para gerar system prompt personalizado para usuários Plus
function generatePersonalizedSystemPrompt(perfil) {
  if (!perfil) {
    // Prompt técnico padrão para usuarios Plus sem entrevista
    return `Você é o PROD.AI 🎵, um especialista master em produção musical com conhecimento técnico avançado. 

INSTRUÇÕES PRINCIPAIS:
- Seja direto, técnico e preciso em todas as respostas
- Use valores específicos, frequências exatas (Hz), faixas dinâmicas (dB), tempos (ms)
- Mencione equipamentos, plugins e técnicas por nome
- Forneça parâmetros exatos quando relevante
- Seja conciso mas completo - evite respostas genéricas
- Dê conselhos práticos e aplicáveis imediatamente

ESPECIALIDADES TÉCNICAS:
- Mixagem: EQ preciso, compressão dinâmica, reverb/delay, automação
- Mastering: Limiters, maximizers, análise espectral, LUFS, headroom
- Sound Design: Síntese, sampling, modulação, efeitos
- Arranjo: Teoria musical aplicada, harmonias, progressões
- Acústica: Tratamento de sala, posicionamento de monitores
- Workflow: Técnicas de produção rápida e eficiente
`;
  }

  // Adaptar linguagem baseada no nível técnico
  let linguagemStyle = '';
  switch(perfil.nivelTecnico?.toLowerCase()) {
    case 'iniciante':
      linguagemStyle = 'Use linguagem acessível mas ainda técnica. Explique termos específicos quando necessário. Foque em conceitos fundamentais com valores práticos.';
      break;
    case 'intermediario':
    case 'intermediário':
      linguagemStyle = 'Misture explicações didáticas com terminologia técnica avançada. Use valores específicos e recomendações diretas.';
      break;
    case 'avancado':
    case 'avançado':
    case 'profissional':
      linguagemStyle = 'Use linguagem totalmente técnica e profissional. Seja direto com parâmetros exatos, frequências específicas e técnicas avançadas.';
      break;
    default:
      linguagemStyle = 'Adapte a linguagem conforme a complexidade da pergunta, sempre mantendo precisão técnica.';
  }

  // Informações específicas da DAW
  let dawInfo = '';
  switch(perfil.daw?.toLowerCase()) {
    case 'fl-studio':
    case 'fl studio':
      dawInfo = 'Quando relevante, mencione atalhos do FL Studio (Ctrl+Shift+E para export, F9 para mixer), plugins nativos (Harmor, Serum, Parametric EQ 2), e workflows específicos do FL.';
      break;
    case 'ableton':
    case 'ableton live':
      dawInfo = 'Quando relevante, mencione recursos do Ableton Live (Session View, Operator, Simpler, Max for Live), atalhos específicos e técnicas de performance ao vivo.';
      break;
    case 'logic':
    case 'logic pro':
      dawInfo = 'Quando relevante, mencione plugins nativos do Logic (Alchemy, Sculpture, Space Designer), atalhos e bibliotecas incluídas.';
      break;
    case 'reaper':
      dawInfo = 'Quando relevante, mencione a flexibilidade do REAPER, ReaPlugs, customização de interface e scripts personalizados.';
      break;
    default:
      dawInfo = 'Adapte recomendações para diferentes DAWs quando necessário.';
  }

  // Contexto do estilo musical
  const estiloContext = perfil.estilo ? `Foque suas respostas no estilo ${perfil.estilo}, incluindo técnicas específicas, faixas de frequência características, e referências do gênero.` : '';

  // Área de dificuldade como prioridade
  const dificuldadeContext = perfil.dificuldade ? `O usuário tem maior dificuldade com: ${perfil.dificuldade}. Priorize dicas e técnicas relacionadas a esta área.` : '';

  // Nome personalizado
  const nomeContext = perfil.nomeArtistico ? `Chame o usuário de ${perfil.nomeArtistico}.` : '';

  // Contexto pessoal
  const sobreContext = perfil.sobre ? `Contexto pessoal do usuário: ${perfil.sobre}` : '';

  return `Você é o PROD.AI 🎵, especialista master em produção musical. ${nomeContext}

PERFIL DO USUÁRIO:
- Nível: ${perfil.nivelTecnico || 'Não informado'}
- DAW Principal: ${perfil.daw || 'Não informado'}
- Estilo Musical: ${perfil.estilo || 'Variado'}
- Maior Dificuldade: ${perfil.dificuldade || 'Não informado'}
${sobreContext ? `- Sobre: ${sobreContext}` : ''}

INSTRUÇÕES DE RESPOSTA:
${linguagemStyle}
${dawInfo}
${estiloContext}
${dificuldadeContext}

QUALIDADE TÉCNICA OBRIGATÓRIA:
- Use valores específicos: frequências exatas (Hz), níveis (dB), tempos (ms)
- Mencione equipamentos e plugins por nome quando relevante
- Forneça parâmetros técnicos precisos
- Seja direto e prático - evite respostas genéricas
- Dê conselhos aplicáveis imediatamente
íficos quando possível (Hz, dB, ms)

Responda sempre com excelência técnica e conhecimento profissional aplicado ao perfil específico do usuário.`;
}

// Função para chamar a API da OpenAI
async function callOpenAI(messages, userData) {
  let systemPrompt;
  
  if (userData.plano === 'plus') {
    // Para usuários Plus, usar prompt personalizado baseado no perfil
    systemPrompt = generatePersonalizedSystemPrompt(userData.perfil);
  } else {
    // Para usuários gratuitos, usar prompt básico existente
  systemPrompt = `Você é o Prod.AI 🎵, especialista em produção musical. Ajude com dúvidas sobre produção, mixagem e masterização de forma técnica e direta.

INSTRUÇÕES:
- Baseie 100% das recomendações nos dados fornecidos pelo usuário (incluindo JSONs técnicos quando presentes).
- Sempre utilize e cite explicitamente valores exatos (Hz, dB, LUFS, ms, porcentagens) nas recomendações.
- Explique o motivo de cada ajuste com base nesses números (por exemplo: cortes/boosts de EQ, thresholds/ratios de compressão, ceiling/attack/release de limiters).
- Foque em soluções aplicáveis imediatamente, citando plugins e parâmetros práticos quando fizer sentido.
- Evite generalidades. Conecte cada sugestão aos dados apresentados na pergunta.

Se houver uma análise técnica de áudio anexada, trate como autoridade: use obrigatoriamente todos os valores relevantes (Peak, RMS, Dinâmica e Frequências Dominantes) ao construir a resposta.`;
  }
  const requestBody = {
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    max_tokens: 1000,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      ...messages,
    ],
  };

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!openaiRes.ok) {
      throw new Error(`OpenAI API erro: ${openaiRes.status} ${openaiRes.statusText}`);
    }

    const data = await openaiRes.json();

    if (!data.choices || !data.choices[0]?.message) {
      throw new Error('Resposta inválida da OpenAI');
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    throw new Error('Falha na comunicação com OpenAI');
  }
}

export default async function handler(req, res) {
  console.log('🔄 Nova requisição recebida:', {
    method: req.method,
    timestamp: new Date().toISOString(),
    hasBody: !!req.body
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
    let validatedData;
    try {
      validatedData = validateAndSanitizeInput(req);
    } catch (error) {
      if (error.message === 'TOKEN_MISSING') {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
      }
      if (error.message === 'MESSAGE_INVALID') {
        return res.status(400).json({ error: 'Mensagem inválida ou vazia' });
      }
      throw error;
    }

    const { message, conversationHistory, idToken } = validatedData;

    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }

    const uid = decoded.uid;
    const email = decoded.email;

    let userData;
    try {
      userData = await handleUserLimits(db, uid, email);
    } catch (error) {
      if (error.message === 'LIMIT_EXCEEDED') {
        return res.status(403).json({ error: 'Limite diário de mensagens atingido' });
      }
      throw error;
    }

    const messages = [
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    // Chamar OpenAI com dados completos do usuário para personalização
    const reply = await callOpenAI(messages, userData);

    if (userData.plano === 'gratis') {
      console.log('✅ Mensagens restantes para', email, ':', userData.mensagensRestantes);
    } else {
      console.log('✅ Resposta personalizada gerada para usuário Plus:', email);
    }

    return res.status(200).json({ 
      reply,
      mensagensRestantes: userData.plano === 'gratis' ? userData.mensagensRestantes : null
    });

  } catch (error) {
    console.error('💥 ERRO NO SERVIDOR:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Erro interno do servidor', 
      details: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
}
