import { auth, db } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  // Adicionar headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Responder a preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  console.log('🚀 API cancel-subscription chamada');
  console.log('📋 Método:', req.method);
  console.log('📋 Headers:', req.headers);
  
  // Permitir apenas POST
  if (req.method !== 'POST') {
    console.log('❌ Método não permitido:', req.method);
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // Verificar token de autenticação
    const authHeader = req.headers.authorization || '';
    console.log('🔐 Auth header presente:', !!authHeader);
    
    if (!authHeader.startsWith('Bearer ')) {
      console.log('❌ Token Bearer não encontrado');
      return res.status(401).json({ error: 'Token de autorização não fornecido' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;
    
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
      console.error('❌ Token inválido:', error);
      return res.status(401).json({ error: 'Token inválido' });
    }

    const userId = decodedToken.uid;
    
    // Validação adicional de segurança
    if (!userId || typeof userId !== 'string' || userId.length === 0) {
      console.error('❌ UID inválido no token:', userId);
      return res.status(401).json({ error: 'Token não contém UID válido' });
    }
    
    console.log('🔧 Iniciando cancelamento de assinatura para usuário:', userId);

    // Buscar dados do usuário no Firestore
    const userDoc = await db.collection('usuarios').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log('❌ Usuário não encontrado no Firestore');
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userData = userDoc.data();
    
    // Proteção contra dados ausentes ou corrompidos
    if (!userData || typeof userData !== 'object') {
      console.log('❌ Dados do usuário ausentes ou inválidos');
      return res.status(404).json({ error: 'Dados do usuário não encontrados' });
    }
    
    console.log('👤 Dados do usuário encontrados:', {
      plano: userData.plano,
      isPlus: userData.isPlus,
      subscriptionStatus: userData.subscriptionStatus,
      planExpiresAt: userData.planExpiresAt,
      upgradedAt: userData.upgradedAt,
      shouldRenew: userData.shouldRenew
    });
    
    // Verificar se o usuário tem plano Plus REAL
    const hasValidPlusPlan = (userData.plano === 'plus' || userData.isPlus === true);
    
    if (!hasValidPlusPlan) {
      console.log('❌ Usuário não possui plano Plus');
      return res.status(400).json({ error: 'Usuário não possui assinatura ativa para cancelar' });
    }
    
    // VALIDAÇÃO ESPECÍFICA PARA CONTAS REAIS
    // Para contas que pagaram via Mercado Pago, devem ter planExpiresAt
    const isRealAccount = userData.planExpiresAt && userData.upgradedAt;
    const isTestAccount = !userData.planExpiresAt && hasValidPlusPlan;
    
    if (isRealAccount) {
      console.log('✅ Conta real detectada com data de expiração:', userData.planExpiresAt);
      
      // Verificar se o plano ainda está ativo (não expirou)
      const now = new Date();
      const expirationDate = userData.planExpiresAt instanceof Date ? 
        userData.planExpiresAt : 
        userData.planExpiresAt.toDate ? userData.planExpiresAt.toDate() : new Date(userData.planExpiresAt);
      
      if (expirationDate <= now) {
        console.log('❌ Plano já expirou em:', expirationDate);
        return res.status(400).json({ 
          error: 'Não é possível cancelar uma assinatura já expirada.',
          message: 'Seu plano já expirou. Não há assinatura ativa para cancelar.' 
        });
      }
      
      console.log('✅ Plano ativo até:', expirationDate);
    } else if (isTestAccount) {
      console.log('⚠️ Conta de teste detectada (Plus sem data de expiração)');
    } else {
      console.log('❌ Conta inválida - nem real nem teste válido');
      return res.status(400).json({ error: 'Usuário não possui assinatura ativa para cancelar' });
    }

    // Verificar se já foi cancelado
    if (userData.subscriptionStatus === 'cancelled') {
      console.log('⚠️ Assinatura já estava cancelada');
      return res.status(400).json({ 
        error: 'Assinatura já foi cancelada.',
        message: 'Esta assinatura já foi cancelada anteriormente.' 
      });
    }

    // NOTA: Este projeto usa pagamentos únicos (preferences), não assinaturas recorrentes
    // Portanto, não há subscription_id real do Mercado Pago para cancelar
    // O cancelamento é feito apenas no sistema interno
    
    console.log('ℹ️ Cancelando assinatura (pagamento único) - apenas no sistema interno');
    
    // Atualizar status no Firestore
    // IMPORTANTE: NUNCA remover o plano Plus ou planExpiresAt imediatamente
    // Apenas marcar como cancelado e parar renovações futuras
    const updateData = {
      subscriptionStatus: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      shouldRenew: false
    };
    
    // Para contas de teste que não têm planExpiresAt, adicionar uma data
    // Para contas reais, PRESERVAR a data existente
    if (!userData.planExpiresAt) {
      console.log('📅 Adicionando data de expiração para conta sem data prévia');
      updateData.planExpiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 dias
    } else {
      console.log('📅 Preservando data de expiração existente:', userData.planExpiresAt);
      // NÃO adicionar planExpiresAt ao updateData para preservar o valor existente
    }

    console.log('📝 Dados a serem atualizados:', updateData);
    await db.collection('usuarios').doc(userId).update(updateData);

    console.log('✅ Assinatura cancelada com sucesso para usuário:', userId);

    return res.status(200).json({ 
      success: true, 
      message: 'Sua assinatura foi cancelada com sucesso. Você continuará com acesso ao Plus até o fim do período atual.' 
    });

  } catch (error) {
    console.error('❌ Erro completo ao cancelar assinatura:', error);
    console.error('❌ Stack trace:', error.stack);
    return res.status(500).json({ 
      error: 'Erro interno do servidor ao cancelar assinatura',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
