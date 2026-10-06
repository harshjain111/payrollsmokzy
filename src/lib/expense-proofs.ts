import { supabase } from '@/integrations/supabase/client';

/**
 * expenses.proof_url may hold several storage paths joined with commas
 * (one per uploaded file). Split them back into individual paths.
 */
export function splitProofPaths(proofUrl: string | null | undefined): string[] {
  if (!proofUrl) return [];
  return proofUrl
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Get a short-lived signed URL for each proof file in the private bucket.
 * Entries that fail to sign come back as null so the caller can show a per-file error.
 * Legacy rows that already store a full http(s) URL are returned unchanged.
 */
export async function getProofSignedUrls(
  proofUrl: string | null | undefined,
  expiresIn = 3600,
): Promise<(string | null)[]> {
  const paths = splitProofPaths(proofUrl);
  return Promise.all(
    paths.map(async (path) => {
      if (/^https?:\/\//i.test(path)) return path;
      try {
        const { data, error } = await supabase.storage
          .from('expense-proofs')
          .createSignedUrl(path, expiresIn);
        if (error || !data?.signedUrl) {
          console.error('Error getting signed URL:', error);
          return null;
        }
        return data.signedUrl;
      } catch (error) {
        console.error('Error fetching proof URL:', error);
        return null;
      }
    }),
  );
}
