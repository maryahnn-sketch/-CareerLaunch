/**
 * CareerLaunch public configuration endpoint.
 * Exposes only browser-safe Supabase settings (URL + anon/publishable key).
 */

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'Supabase is not configured' },
        { status: 503 }
      );
    }

    return Response.json(
      { supabaseUrl, supabaseAnonKey },
      {
        headers: { 'cache-control': 'no-store' }
      }
    );
  }
};
