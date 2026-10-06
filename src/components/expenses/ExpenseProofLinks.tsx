import { useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getProofSignedUrls, splitProofPaths } from '@/lib/expense-proofs';

interface ExpenseProofLinksProps {
  /** Raw expenses.proof_url value (may be several comma-joined storage paths). */
  proofUrl: string | null | undefined;
  /** Only sign URLs while visible (e.g. dialog open). */
  enabled?: boolean;
}

/** Signs each attached proof file and renders one "View" link per file. */
export function ExpenseProofLinks({ proofUrl, enabled = true }: ExpenseProofLinksProps) {
  const [urls, setUrls] = useState<(string | null)[] | null>(null);
  const count = splitProofPaths(proofUrl).length;

  useEffect(() => {
    // Reset so a previous expense's links are never shown for this one
    setUrls(null);
    if (!enabled || !proofUrl) return;
    let cancelled = false;
    getProofSignedUrls(proofUrl).then((result) => {
      if (!cancelled) setUrls(result);
    });
    return () => {
      cancelled = true;
    };
  }, [proofUrl, enabled]);

  if (count === 0) return null;

  if (urls === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url, i) => {
        const label = count > 1 ? `Attachment ${i + 1}` : 'View Attachment';
        return url ? (
          <Button key={i} variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <FileText className="mr-2 h-4 w-4" />
              {label}
              <ExternalLink className="ml-2 h-3 w-3" />
            </a>
          </Button>
        ) : (
          <p key={i} className="text-sm text-muted-foreground">
            Unable to load {count > 1 ? `attachment ${i + 1}` : 'attachment'}
          </p>
        );
      })}
    </div>
  );
}
