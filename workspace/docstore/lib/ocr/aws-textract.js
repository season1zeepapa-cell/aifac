// AWS Textract OCR 플러그인
// 문서 내 표(Table)/양식(Form) 구조 추출에 특화
const https = require('https');
const crypto = require('crypto');

module.exports = {
  id: 'aws-textract',
  name: 'AWS Textract',
  provider: 'aws',
  envKey: 'AWS_ACCESS_KEY_ID',
  free: false,
  bestFor: ['table', 'document', 'form'],
  description: '표/양식 구조 유지, 문서 OCR 최강',

  isAvailable() {
    return !!(process.env.AWS_ACCESS_KEY_ID || '').trim() &&
           !!(process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  },

  async execute(base64, mediaType, prompt) {
    const region = process.env.AWS_REGION || 'ap-northeast-2';
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;

    const host = `textract.${region}.amazonaws.com`;
    const body = JSON.stringify({
      Document: { Bytes: base64 },
    });

    // AWS Signature V4 서명
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const service = 'textract';
    const target = 'Textract.DetectDocumentText';

    function hmac(key, data) {
      return crypto.createHmac('sha256', key).update(data).digest();
    }
    function sha256(data) {
      return crypto.createHash('sha256').update(data).digest('hex');
    }

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const headers = {
      'Content-Type': 'application/x-amz-json-1.1',
      'Host': host,
      'X-Amz-Date': amzDate,
      'X-Amz-Target': target,
    };

    const signedHeaders = Object.keys(headers).sort().map(k => k.toLowerCase()).join(';');
    const canonicalHeaders = Object.keys(headers).sort().map(k => `${k.toLowerCase()}:${headers[k]}\n`).join('');
    const payloadHash = sha256(body);

    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;

    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host,
        path: '/',
        method: 'POST',
        headers,
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(parsed.Message || `Textract ${res.statusCode}`));
              return;
            }
            // Textract 블록에서 LINE 타입 텍스트 추출
            const blocks = parsed.Blocks || [];
            const lines = blocks
              .filter(b => b.BlockType === 'LINE')
              .map(b => b.Text)
              .filter(Boolean);
            resolve(lines.join('\n').trim());
          } catch {
            reject(new Error('Textract 응답 파싱 실패'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Textract 타임아웃')); });
      req.write(body);
      req.end();
    });
  },
};
