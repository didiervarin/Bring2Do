// Vérifie que le chiffrement Web Push est déchiffrable par une implémentation
// de référence (http_ece) et que la signature VAPID est valide.
import nodeCrypto from 'node:crypto';
import assert from 'node:assert/strict';
import ece from 'http_ece';
import { encryptPayload, generateVapidKeys, vapidAuthorization, b64uDecode, b64uEncode } from '../src/push.js';

// Côté "téléphone" : clés de l'abonnement
const ua = nodeCrypto.createECDH('prime256v1');
ua.generateKeys();
const auth = nodeCrypto.randomBytes(16);
const p256dh = b64uEncode(ua.getPublicKey());

const message = JSON.stringify({ title: '⏰ Appeler le plombier', body: 'Échéance : lun. 12 oct., 18:00', badge: 3 });
const body = await encryptPayload(message, p256dh, b64uEncode(auth));
const clear = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: b64uEncode(auth) });
assert.equal(clear.toString('utf8'), message);
console.log('✓ chiffrement aes128gcm déchiffré par http_ece');

// VAPID
const vapid = await generateVapidKeys();
const header = await vapidAuthorization('https://web.push.apple.com/abc', vapid, 'mailto:test@example.com');
const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
assert.ok(m, 'format en-tête');
const claims = JSON.parse(Buffer.from(b64uDecode(m[2])).toString());
assert.equal(claims.aud, 'https://web.push.apple.com');
const pub = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256',
  x: JSON.parse(vapid.privateJwk).x, y: JSON.parse(vapid.privateJwk).y }, format: 'jwk' });
const ok = nodeCrypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64uDecode(m[3])));
assert.ok(ok, 'signature JWT');
assert.equal(b64uDecode(m[4]).length, 65);
console.log('✓ JWT VAPID ES256 valide, clé publique 65 octets');
