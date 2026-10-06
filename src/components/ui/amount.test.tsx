import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmountInput, Amount, sanitizeAmountText } from './amount';

function Harness({ onValue }: { onValue: (n: number) => void }) {
  const [value, setValue] = useState(0);
  return (
    <>
      <label htmlFor="amt">Amount</label>
      <AmountInput
        id="amt"
        value={value}
        onChange={(n) => {
          setValue(n);
          onValue(n);
        }}
      />
      <button onClick={() => setValue(0)}>reset</button>
    </>
  );
}

describe('sanitizeAmountText', () => {
  it('keeps one decimal point and max two decimals', () => {
    expect(sanitizeAmountText('12.')).toBe('12.');
    expect(sanitizeAmountText('12.5.0')).toBe('12.50');
    expect(sanitizeAmountText('1,250.789')).toBe('1250.78');
    expect(sanitizeAmountText('abc')).toBe('');
  });
});

describe('AmountInput', () => {
  it('lets the user type a decimal point and keeps the typed text', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '12' } });
    expect(input.value).toBe('12');
    fireEvent.change(input, { target: { value: '12.' } });
    expect(input.value).toBe('12.');
    expect(onValue).toHaveBeenLastCalledWith(12);
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.change(input, { target: { value: '12.50' } });
    expect(input.value).toBe('12.50');
    expect(onValue).toHaveBeenLastCalledWith(12.5);
  });

  it('clears when the parent resets the value', () => {
    render(<Harness onValue={() => {}} />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99.9' } });
    fireEvent.click(screen.getByText('reset'));
    expect(input.value).toBe('');
  });
});

describe('Amount', () => {
  it('drops sign colours when neutral', () => {
    const { container } = render(<Amount value={100} neutral className="text-warning" />);
    const span = container.querySelector('span')!;
    expect(span.className).not.toContain('text-success');
    expect(span.className).toContain('text-warning');
  });
});
