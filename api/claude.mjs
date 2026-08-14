export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return Response.json(
        { error: 'AI service is not configured' },
        { status: 500 }
      );
    }

    try {
      const body = await request.text();

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body
      });

      const result = await response.text();

      return new Response(result, {
        status: response.status,
        headers: {
          'content-type':
            response.headers.get('content-type') || 'application/json',
          'cache-control': 'no-store'
        }
      });
    } catch (error) {
      console.error('[CareerLaunch API] Claude request failed', error);

      return Response.json(
        { error: 'Unable to reach AI service' },
        { status: 502 }
      );
    }
  }
};
