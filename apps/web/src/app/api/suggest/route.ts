import { NextResponse } from 'next/server';
import { api } from '@/lib/api';

/**
 * Typeahead for the search box, through this server (the browser never calls the API directly).
 * Short or empty text answers an empty list without asking the API.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2 || q.length > 200) return NextResponse.json({ suggestions: [] });
  const { data } = await api().GET('/public/search/suggest', { params: { query: { q } } });
  return NextResponse.json({ suggestions: data?.suggestions ?? [] });
}
