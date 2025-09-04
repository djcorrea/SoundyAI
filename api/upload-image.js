/**
 * Upload API para arquivos de imagem
 * Suporta JPG, PNG, WEBP até 10MB cada
 * Máximo 3 imagens por upload
 * Configurado para runtime Node.js
 * 
 * Implementação: Dezembro 2024
 */

import { auth } from './firebaseAdmin.js';
import cors from 'cors';

// Configuração via variável de ambiente (padrão: 10MB por imagem)
const MAX_IMAGE_MB = parseInt(process.env.MAX_IMAGE_MB || '10');
const MAX_IMAGE_SIZE = MAX_IMAGE_MB * 1024 * 1024; // Converte para bytes
const MAX_IMAGES_PER_UPLOAD = 3;

// Formatos aceitos
const ALLOWED_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

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
        localOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Origem bloqueada:', origin);
      callback(new Error('CORS policy violation'), false);
    }
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
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

/**
 * Valida o tipo de arquivo de imagem
 */
function validateImageType(contentType, filename) {
  // Verifica MIME type
  if (ALLOWED_FORMATS.includes(contentType)) {
    return true;
  }
  
  // Fallback: verifica extensão
  if (filename) {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return ALLOWED_EXTENSIONS.includes(ext);
  }
  
  return false;
}

/**
 * Valida se é uma imagem válida verificando header do arquivo
 */
function validateImageHeader(buffer) {
  if (buffer.length < 8) return false;
  
  // Verificar assinatura JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpeg';
  }
  
  // Verificar assinatura PNG
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return 'png';
  }
  
  // Verificar assinatura WebP
  if (buffer.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii')) && 
      buffer.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii'))) {
    return 'webp';
  }
  
  return false;
}

/**
 * Parse multipart/form-data manual para imagens
 */
function parseMultipartImages(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    
    console.log(`[IMAGE_UPLOAD] Content-Type recebido: "${contentType}"`);
    
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      console.log(`[IMAGE_UPLOAD] Erro: Content-Type inválido`);
      reject(new Error(`Content-Type deve ser multipart/form-data, recebido: ${contentType}`));
      return;
    }
    
    // Extrair boundary
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
      console.log(`[IMAGE_UPLOAD] Erro: Boundary não encontrado no Content-Type`);
      reject(new Error('Boundary não encontrado no Content-Type'));
      return;
    }
    
    const boundary = boundaryMatch[1].replace(/"/g, ''); // Remove aspas se houver
    console.log(`[IMAGE_UPLOAD] Boundary extraído: "${boundary}"`);
    
    let data = Buffer.alloc(0);
    let totalSize = 0;
    
    req.on('data', chunk => {
      totalSize += chunk.length;
      
      // Verificar limite de tamanho total (3 imagens * 10MB = 30MB max)
      if (totalSize > (MAX_IMAGE_SIZE * MAX_IMAGES_PER_UPLOAD)) {
        reject(new Error(`LIMITE_TOTAL_EXCEDIDO:${MAX_IMAGE_MB * MAX_IMAGES_PER_UPLOAD}`));
        return;
      }
      
      data = Buffer.concat([data, chunk]);
    });
    
    req.on('end', () => {
      try {
        // Parse manual do multipart
        const boundaryBuffer = Buffer.from(`--${boundary}`);
        const parts = [];
        let start = 0;
        
        while (true) {
          const boundaryIndex = data.indexOf(boundaryBuffer, start);
          if (boundaryIndex === -1) break;
          
          if (start > 0) {
            const part = data.slice(start, boundaryIndex);
            if (part.length > 4) {
              parts.push(part);
            }
          }
          
          start = boundaryIndex + boundaryBuffer.length;
        }
        
        // Processar cada parte
        const images = [];
        
        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          
          const headers = part.slice(0, headerEnd).toString();
          const content = part.slice(headerEnd + 4, part.length - 2); // Remove \r\n final
          
          // Parse Content-Disposition
          const dispositionMatch = headers.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/);
          if (!dispositionMatch) continue;
          
          const fieldName = dispositionMatch[1];
          const filename = dispositionMatch[2];
          
          if (filename && fieldName === 'images') {
            // É um arquivo de imagem
            const contentTypeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
            const contentType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';
            
            images.push({
              fieldName,
              filename,
              contentType,
              content,
              size: content.length
            });
          }
        }
        
        resolve({ images, totalSize });
      } catch (error) {
        reject(error);
      }
    });
    
    req.on('error', reject);
  });
}

/**
 * Gera mensagem de erro amigável
 */
function getErrorMessage(error) {
  if (error.message.startsWith('LIMITE_TOTAL_EXCEDIDO:')) {
    const maxTotal = error.message.split(':')[1];
    return {
      error: 'LIMITE_TOTAL_EXCEDIDO',
      message: `Total de imagens excede o limite de ${maxTotal}MB`,
      recommendation: 'Reduza o número de imagens ou comprima-as antes do upload',
      maxTotalMB: parseInt(maxTotal)
    };
  }
  
  if (error.message.startsWith('IMAGEM_MUITO_GRANDE:')) {
    const filename = error.message.split(':')[1];
    return {
      error: 'IMAGEM_MUITO_GRANDE',
      message: `Imagem "${filename}" excede o limite de ${MAX_IMAGE_MB}MB`,
      recommendation: 'Comprima a imagem ou reduza sua resolução',
      maxSizeMB: MAX_IMAGE_MB
    };
  }
  
  return {
    error: 'ERRO_UPLOAD',
    message: error.message || 'Erro interno no upload'
  };
}

/**
 * Handler principal da API
 */
export default async function handler(req, res) {
  console.log('🖼️ Nova requisição de upload de imagem:', {
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
    return res.status(405).json({
      error: 'METODO_NAO_PERMITIDO',
      message: 'Apenas POST é aceito',
      allowedMethods: ['POST']
    });
  }

  try {
    // Verificar autenticação
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'TOKEN_MISSING',
        message: 'Token de autenticação necessário'
      });
    }

    const idToken = authHeader.substring(7);
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({
        error: 'TOKEN_INVALID',
        message: 'Token inválido ou expirado'
      });
    }

    console.log(`[IMAGE_UPLOAD] Usuário autenticado: ${decoded.uid}`);
    console.log(`[IMAGE_UPLOAD] Iniciando upload - Content-Length: ${req.headers['content-length']} bytes`);
    
    // Parse dos dados multipart
    const { images, totalSize } = await parseMultipartImages(req);
    
    console.log(`[IMAGE_UPLOAD] Dados recebidos - Total: ${totalSize} bytes, Imagens: ${images.length}`);
    
    if (images.length === 0) {
      return res.status(400).json({
        error: 'NENHUMA_IMAGEM',
        message: 'Nenhuma imagem foi enviada'
      });
    }

    if (images.length > MAX_IMAGES_PER_UPLOAD) {
      return res.status(400).json({
        error: 'MUITAS_IMAGENS',
        message: `Máximo de ${MAX_IMAGES_PER_UPLOAD} imagens por envio`,
        maxImages: MAX_IMAGES_PER_UPLOAD,
        receivedImages: images.length
      });
    }

    // Validar cada imagem
    const processedImages = [];
    for (const image of images) {
      // Verificar tamanho individual
      if (image.size > MAX_IMAGE_SIZE) {
        throw new Error(`IMAGEM_MUITO_GRANDE:${image.filename}`);
      }

      // Validar tipo de arquivo
      if (!validateImageType(image.contentType, image.filename)) {
        return res.status(400).json({
          error: 'FORMATO_NAO_SUPORTADO',
          message: `Formato de imagem não suportado: ${image.filename}`,
          supportedFormats: ['JPEG', 'PNG', 'WebP'],
          receivedType: image.contentType,
          filename: image.filename
        });
      }

      // Validar header da imagem
      const imageFormat = validateImageHeader(image.content);
      if (!imageFormat) {
        return res.status(400).json({
          error: 'IMAGEM_CORROMPIDA',
          message: `Arquivo não é uma imagem válida: ${image.filename}`,
          filename: image.filename
        });
      }

      processedImages.push({
        filename: image.filename,
        contentType: image.contentType,
        size: image.size,
        sizeFormatted: `${(image.size / 1024 / 1024).toFixed(2)}MB`,
        format: imageFormat,
        // Base64 para uso no chat com GPT-4 Vision
        base64: image.content.toString('base64'),
        // Data URL para preview no frontend
        dataUrl: `data:${image.contentType};base64,${image.content.toString('base64')}`
      });

      console.log(`[IMAGE_UPLOAD] Imagem processada:`, {
        filename: image.filename,
        format: imageFormat,
        size: `${(image.size / 1024 / 1024).toFixed(2)}MB`
      });
    }

    // Resposta de sucesso
    res.status(200).json({
      success: true,
      message: `${processedImages.length} imagem(ns) processada(s) com sucesso`,
      images: processedImages,
      metadata: {
        totalImages: processedImages.length,
        totalSize: totalSize,
        totalSizeFormatted: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
        uploadTime: new Date().toISOString(),
        userId: decoded.uid
      },
      limits: {
        maxImagesPerUpload: MAX_IMAGES_PER_UPLOAD,
        maxSizeMB: MAX_IMAGE_MB,
        supportedFormats: ['JPEG', 'PNG', 'WebP']
      }
    });

    console.log(`[IMAGE_UPLOAD] Upload concluído com sucesso - ${processedImages.length} imagens processadas para usuário ${decoded.uid}`);
    
  } catch (error) {
    console.error('[IMAGE_UPLOAD] Erro no upload:', error);
    console.error('[IMAGE_UPLOAD] Stack:', error.stack);
    
    const errorResponse = getErrorMessage(error);
    let statusCode = 400;
    
    if (error.message.startsWith('LIMITE_TOTAL_EXCEDIDO:') || error.message.startsWith('IMAGEM_MUITO_GRANDE:')) {
      statusCode = 413; // Payload Too Large
    }
    
    console.log(`[IMAGE_UPLOAD] Enviando resposta de erro: ${statusCode}`, errorResponse);
    
    res.status(statusCode).json(errorResponse);
  }
}

// Configuração do runtime para Node.js
export const config = {
  runtime: 'nodejs',
  api: {
    bodyParser: false, // Desabilita parser padrão para controle manual
    responseLimit: false // Remove limite de resposta
  }
};
