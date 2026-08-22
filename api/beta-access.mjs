/**
 * iFindWorth private beta access validator.
 *
 * Raw invite codes are never shipped to the browser. Only SHA-256 hashes live here.
 * This endpoint validates codes; per-tester completion is tracked in the browser/
 * anonymous Supabase user metadata until a dedicated invite table is added.
 */

const INVITES = {
  '5a50f1d66be34adbc8781191a16a6e2a595a8fc42946982ab40ba4669c73f1bb': { inviteId: 'BETA-001', reusable: false },
  'f3dd25e1d32a33511a03e06664fb814065be7e28c12289155b3a84acb7eeea73': { inviteId: 'BETA-002', reusable: false },
  'e51a5cee6392e14cf146155db8cb6a9cd7c75a6deaa6f5c3fa9fa888fd3e41f0': { inviteId: 'BETA-003', reusable: false },
  '78ba7000a7754735a3ba14b3d8f15fc0a7019066dc8e5ff508d47eafb3e786af': { inviteId: 'BETA-004', reusable: false },
  'b420d7864c1c9824b7cdc882f593e4beff9d3b93f9a0e423b399b4f4dd5241a0': { inviteId: 'BETA-005', reusable: false },
  '7f64af0e2b4ef634540ea117e3c0f327618d795ed36072a11c243be6c3ffda65': { inviteId: 'BETA-006', reusable: false },
  '5c124be4c7508cf7df3c8f1e717df56f6a7e65edb1cd876d848e50f72357849e': { inviteId: 'BETA-007', reusable: false },
  '9784b7beca2f6b08cba16e46ae2724f2112a23f6ce41fd17c018d43213142505': { inviteId: 'BETA-008', reusable: false },
  'aa6c70141471b99b6373e43deee9f785df040b07600211a28fa0890ee6eeee0b': { inviteId: 'BETA-009', reusable: false },
  'bb3fb1ca2ee83867169b2d05a3fc7cf1e3fcd1114f05a9f10cd3c9ce31349ee9': { inviteId: 'BETA-010', reusable: false },
  'f4f091a6b15eba9bf0095bfa474117e19cb6926119f5293a971ab1dff0ee728b': { inviteId: 'BETA-011', reusable: false },
  'ce7257a515a77bd6371dfc248b0540b5379101af7bf3f315d8a4c4f8f6486e47': { inviteId: 'BETA-012', reusable: false },
  '7f376900cb9eb5852ea7aa5b90b54791757a8c3cce9273f20e26322ca80f9c84': { inviteId: 'BETA-013', reusable: false },
  '01701554d1359f707612eb3b1450b59d783b8009eba5e74b277c815b560646fa': { inviteId: 'BETA-014', reusable: false },
  'e3a8f7228075743174bc761d5bc7b709eab291b9129f74582494036ee4f0c49a': { inviteId: 'BETA-015', reusable: false },
  '46716fe83d8bdf8aabebcf7e39be7ee77e0daf15b33a9a014152cfe2ea040725': { inviteId: 'BETA-016', reusable: false },
  'c0a151947ad79bcbada7cdfa96e88c8b9df43e9ac54d49585bdeee04b59d2865': { inviteId: 'BETA-017', reusable: false },
  'd683aae44dcbc4fa20664b4ec0545f4f14d72758f73831c53e9c708a4c2e91ff': { inviteId: 'BETA-018', reusable: false },
  '955e9c49cce65dd35c94f5ca72cb505e3f1c8ffd208987f42046c4b5fbeb313d': { inviteId: 'BETA-019', reusable: false },
  '38cb2009afb8c25159a17f920257cf6bd52b3324c0e9a29730aa4bd951204d0f': { inviteId: 'BETA-020', reusable: false },
  '80e236b206ca2cb029cc300cace0fa4b91a8bca0807171d7bf8eebb526e59dfc': { inviteId: 'BETA-021', reusable: false },
  '24fd08942a35c98a1e538539ff98d91631c84d0d0d6587364706c8d9fe56680b': { inviteId: 'BETA-022', reusable: false },
  'b0aba8e8a981c1c7683cb4156674d1560cb7f23783ac4f6d095683b4219ddf36': { inviteId: 'BETA-023', reusable: false },
  '904581294dcc0d855d04d289c7d0c1950c96146a570ef63738bd20029abf78a6': { inviteId: 'BETA-024', reusable: false },
  '631cf47175e131ddcb3af48383ffbf2824e262bce869e3012337102b4d34ba23': { inviteId: 'BETA-025', reusable: false },
  'fb8824971a848e16922eb80b74bfefeb30bb65a528555ef9a531ba75c3c41ace': { inviteId: 'OWNER', reusable: true },
};

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ valid: false, error: 'Invalid request' }, { status: 400 });
    }

    const code = normalizeCode(payload?.code);
    if (!code || code.length < 8 || code.length > 40) {
      return Response.json({ valid: false }, {
        status: 403,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const hash = await sha256Hex(code);
    const invite = INVITES[hash];

    if (!invite) {
      // Keep invalid responses intentionally vague.
      return Response.json({ valid: false }, {
        status: 403,
        headers: { 'cache-control': 'no-store' }
      });
    }

    return Response.json(
      {
        valid: true,
        inviteId: invite.inviteId,
        reusable: invite.reusable === true
      },
      {
        headers: { 'cache-control': 'no-store' }
      }
    );
  }
};