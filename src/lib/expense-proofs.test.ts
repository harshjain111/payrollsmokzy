import { describe, it, expect, vi } from 'vitest';

const createSignedUrl = vi.fn(async (path: string) =>
  path === 'bad' ? { data: null, error: new Error('nope') } : { data: { signedUrl: `signed:${path}` }, error: null },
);
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl }) } },
}));

import { splitProofPaths, getProofSignedUrls } from './expense-proofs';

describe('expense proofs', () => {
  it('splits comma-joined storage paths', () => {
    expect(splitProofPaths('u/1.jpg,u/2.pdf')).toEqual(['u/1.jpg', 'u/2.pdf']);
    expect(splitProofPaths(' u/1.jpg , ')).toEqual(['u/1.jpg']);
    expect(splitProofPaths(null)).toEqual([]);
  });

  it('signs each file separately and keeps failures per file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getProofSignedUrls('u/1.jpg,bad,https://x/y.png')).toEqual([
      'signed:u/1.jpg',
      null,
      'https://x/y.png',
    ]);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
});
