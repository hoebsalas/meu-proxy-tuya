// /api/proxy.js
// *** CÓDIGO ATUALIZADO PARA LIDAR COM O CORS (OPTIONS) ***

import crypto from 'crypto';

// Esta é a função que a Vercel executará
export default async function handler(req, res) {

    // --- ETAPA 1: Lidar com a "Pergunta de Permissão" (Preflight OPTIONS) ---
    // O navegador envia um 'OPTIONS' antes de enviar o 'POST'
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tuya-Path, X-Tuya-Method');
        return res.status(200).end(); // Responde "OK, eu permito"
    }

    // --- ETAPA 2: Se não for OPTIONS, é o seu código normal do proxy ---

    // Define os cabeçalhos de permissão para a resposta REAL
    res.setHeader('Access-Control-Allow-Origin', '*');

    // --- 1. Ler dados do seu frontend ---
    const accessToken = req.headers.authorization?.split(' ')[1]; 
    const tuyaPath = req.headers['x-tuya-path'];
    const tuyaMethod = req.headers['x-tuya-method'] || 'GET';
    const body = req.body;

    // --- 2. Ler segredos do servidor Vercel ---
    const clientId = process.env.TUYA_CLIENT_ID;
    const secretKey = process.env.TUYA_SECRET_KEY;

    // --- 3. Validação ---
    if (!accessToken || !tuyaPath || !clientId || !secretKey) {
        return res.status(400).json({ 
            code: 400, 
            msg: 'Faltando cabeçalhos (Authorization, X-Tuya-Path) ou configuração do servidor.' 
        });
    }

    // --- 4. Recalcular a Assinatura (para comandos) ---
    const t = Date.now().toString();
    const bodyString = Object.keys(body).length === 0 ? '' : JSON.stringify(body);
    const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');

    const headersToSign = "";
    const stringToSign =
        clientId + accessToken + t + tuyaMethod + '\n' +
        bodyHash + '\n' +
        headersToSign + '\n' +
        tuyaPath;

    const sign = crypto.createHmac('sha256', secretKey)
                       .update(stringToSign)
                       .digest('hex')
                       .toUpperCase();

    // --- 5. Montar a chamada real para a Tuya ---
    const url = `https://openapi.tuyaus.com${tuyaPath}`;

    const tuyaHeaders = {
        'client_id': clientId,
        'access_token': accessToken,
        'sign': sign,
        't': t,
        'sign_method': 'HMAC-SHA256',
        'Content-Type': 'application/json'
    };

    // --- 6. Fazer a chamada e retornar ---
    try {
        const response = await fetch(url, {
            method: tuyaMethod,
            headers: tuyaHeaders,
            body: bodyString === '' ? null : bodyString
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ code: 500, msg: 'Erro interno do proxy', error: error.message });
    }
}
