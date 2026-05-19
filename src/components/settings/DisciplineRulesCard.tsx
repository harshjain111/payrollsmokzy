import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Trash2, Plus, Shield, Loader2, Save, PowerOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DisciplineRules, Slab, fetchDisciplineRules } from '@/lib/discipline';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

function SlabEditor({
  title,
  slabs,
  onChange,
}: {
  title: string;
  slabs: Slab[];
  onChange: (s: Slab[]) => void;
}) {
  const update = (i: number, key: keyof Slab, val: number) => {
    const copy = [...slabs];
    copy[i] = { ...copy[i], [key]: val };
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{title}</Label>
      <div className="space-y-2">
        {slabs.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="number"
              value={s.from_min}
              onChange={(e) => update(i, 'from_min', Number(e.target.value))}
              className="h-9 w-20"
              placeholder="From"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="number"
              value={s.to_min}
              onChange={(e) => update(i, 'to_min', Number(e.target.value))}
              className="h-9 w-20"
              placeholder="To"
            />
            <span className="text-xs text-muted-foreground">min → ₹</span>
            <Input
              type="number"
              value={s.amount}
              onChange={(e) => update(i, 'amount', Number(e.target.value))}
              className="h-9 w-24"
              placeholder="Fine"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onChange(slabs.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...slabs, { from_min: 0, to_min: 15, amount: 50 }])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add slab
        </Button>
      </div>
    </div>
  );
}

export function DisciplineRulesCard() {
  const { isOwner } = useAuth();
  const [rules, setRules] = useState<DisciplineRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDisciplineRules().then((r) => {
      setRules(r);
      setLoading(false);
    });
  }, []);

  if (!isOwner) return null;
  if (loading) {
    return (
      <Card className="md:col-span-2">
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }
  if (!rules) return null;

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('discipline_rules' as never)
        .update({
          grace_minutes_in: rules.grace_minutes_in,
          late_in_slabs: rules.late_in_slabs,
          late_in_half_day_after_min: rules.late_in_half_day_after_min,
          late_in_full_day_after_min: rules.late_in_full_day_after_min,
          grace_minutes_out: rules.grace_minutes_out,
          early_out_slabs: rules.early_out_slabs,
          early_out_half_day_after_min: rules.early_out_half_day_after_min,
          early_out_full_day_after_min: rules.early_out_full_day_after_min,
          absent_no_checkin_deduction: rules.absent_no_checkin_deduction,
          absent_no_checkout_deduction: rules.absent_no_checkout_deduction,
        } as never)
        .eq('id', rules.id);
      if (error) throw error;
      toast.success('Discipline rules saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof DisciplineRules>(k: K, v: DisciplineRules[K]) =>
    setRules({ ...rules, [k]: v });

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
          Discipline & Fines
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Late-in / early-out penalties applied automatically at salary settlement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Late-in */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm">Late check-in</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Grace (minutes)</Label>
              <Input
                type="number"
                value={rules.grace_minutes_in}
                onChange={(e) => set('grace_minutes_in', Number(e.target.value))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Half-day after (min)</Label>
              <Input
                type="number"
                value={rules.late_in_half_day_after_min}
                onChange={(e) =>
                  set('late_in_half_day_after_min', Number(e.target.value))
                }
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Full-day after (min)</Label>
              <Input
                type="number"
                value={rules.late_in_full_day_after_min}
                onChange={(e) =>
                  set('late_in_full_day_after_min', Number(e.target.value))
                }
                className="h-9"
              />
            </div>
          </div>
          <SlabEditor
            title="Slab fines (minutes after grace → fixed ₹)"
            slabs={rules.late_in_slabs}
            onChange={(s) => set('late_in_slabs', s)}
          />
        </div>

        <Separator />

        {/* Early-out */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm">Early check-out</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Grace (minutes)</Label>
              <Input
                type="number"
                value={rules.grace_minutes_out}
                onChange={(e) => set('grace_minutes_out', Number(e.target.value))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Half-day after (min)</Label>
              <Input
                type="number"
                value={rules.early_out_half_day_after_min}
                onChange={(e) =>
                  set('early_out_half_day_after_min', Number(e.target.value))
                }
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Full-day after (min)</Label>
              <Input
                type="number"
                value={rules.early_out_full_day_after_min}
                onChange={(e) =>
                  set('early_out_full_day_after_min', Number(e.target.value))
                }
                className="h-9"
              />
            </div>
          </div>
          <SlabEditor
            title="Slab fines (minutes before scheduled out → fixed ₹)"
            slabs={rules.early_out_slabs}
            onChange={(s) => set('early_out_slabs', s)}
          />
        </div>

        <Separator />

        <p className="text-xs text-muted-foreground">
          Combined daily fine is capped at one full day's salary. Approved leave on a
          date skips fines entirely.
        </p>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
