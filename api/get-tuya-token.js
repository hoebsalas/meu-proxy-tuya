// /api/get-tuya-token.js
// ETAPA 1: Obter o Access Token (Seu código)

import crypto from 'crypto';

export default async function handler(req, res) {

    const t = Date.now().toString();

    // 1. Pega os segredos das Variáveis de Ambiente da Vercel
    const clientId = process.env.TUYA_CLIENT_ID;
    const secretKey = process.env.TUYA_SECRET_KEY;

    // 2. O endpoint correto (como você pediu)
    const baseUrl = "https://openapi.tuyaus.com";
    const path = "/v1.0/token?grant_type=1";
    const url = baseUrl + path;

    // 3. A sua função de assinatura
    function signHMAC(message, secretKey) {
        const hmac = crypto.createHmac('sha256', secretKey);
        hmac.update(message);
        const signature = hmac.digest('hex');
        return signature;
    }

    // 4. A sua montagem da 'message'
    const httpMethod = "GET";
    const emptyBodyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const headersToSign = "";

    const message = clientId + t + httpMethod + "\n" +
                    emptyBodyHash + "\n" +
                    headersToSign + "\n" +
                    path;

    const signature = signHMAC(message, secretKey);
    const sign = signature.toString().toUpperCase();
    const signMethod = "HMAC-SHA256";

    // 5. Os seus cabeçalhos
    const headers = {
        "client_id": clientId,
        "sign": sign,
        "t": t,
        "sign_method": signMethod
    };

    // 6. Fazer a chamada e retornar a resposta
    try {
        const response = await fetch(url, {
            method: httpMethod,
            headers: headers
        });
        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ code: 500, msg: "Erro interno do servidor", error: error.message });
    }
}
