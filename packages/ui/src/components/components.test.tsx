import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, formatMoney, formatTime } from '../lib/format.js';
import { BOOKING_STATUS_STYLES } from '../status.js';
import { StatusBadge } from './badge.js';
import { Button } from './button.js';
import { Combobox, type ComboboxOption } from './combobox.js';
import { Field, Input } from './field.js';
import { LabResultCard } from './lab-result-card.js';
import { MapView } from './map-view.js';
import { Modal, Tabs, TabsContent, TabsList, TabsTrigger } from './overlays.js';
import { Alert, Chip, StatePanel } from './surface.js';

describe('formatting primitives', () => {
  it('shows money in rupees, Indian grouping, always two decimals (DP2-11)', () => {
    expect(formatMoney({ amountPaise: 120_000 })).toBe('₹1,200.00');
    expect(formatMoney({ amountPaise: 12_345_678 })).toBe('₹1,23,456.78');
  });

  it('shows dates as DD MMM YYYY and times in IST with "IST" (DR-23, DP2-12)', () => {
    expect(formatDate('2026-11-27')).toBe('27 Nov 2026');
    expect(formatDate('2026-11-27', { weekday: true })).toBe('Fri 27 Nov 2026');
    expect(formatTime('2026-11-27T04:30:00Z')).toBe('10:00 AM IST');
    expect(formatDateTime('2026-11-27T11:45:00Z')).toBe('27 Nov 2026, 5:15 PM IST');
  });
});

describe('Button', () => {
  it('is busy and disabled while loading', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a link with the button look (asChild)', () => {
    render(
      <Button asChild>
        <a href="/labs/1">Book</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/labs/1');
  });
});

describe('Field', () => {
  it('ties the label, help and error to the control', () => {
    render(
      <Field
        label="Email"
        help="We only use it for this request"
        error="Give an email address"
        required
      >
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription(
      'We only use it for this request Give an email address',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Give an email address');
  });
});

describe('StatusBadge and states', () => {
  it('shows the label with a hidden icon, never colour alone', () => {
    const { container } = render(
      <StatusBadge status={BOOKING_STATUS_STYLES.ON_HOLD} label="On hold" />,
    );
    expect(screen.getByText('On hold')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces errors but not empty states', () => {
    render(
      <>
        <StatePanel kind="empty" title="No lab matches" />
        <StatePanel kind="error" title="Search is not available" />
        <Alert tone="info">Saved</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Search is not available');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('marks a toggle chip as pressed', () => {
    render(<Chip pressed>Testing labs</Chip>);
    expect(screen.getByRole('button', { name: 'Testing labs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

const OPTIONS: ComboboxOption[] = [
  { id: 'p1', label: 'Tensile strength', hint: 'Test' },
  { id: 'l1', label: 'Example Testing Noida', hint: 'Lab' },
];

function ComboboxHarness({
  onPick,
  onSubmit,
}: {
  onPick: (o: ComboboxOption) => void;
  onSubmit: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Combobox
        label="Test or lab"
        value={value}
        onValueChange={setValue}
        options={value.length > 1 ? OPTIONS : []}
        onOptionSelect={onPick}
        listLabel="Suggestions"
      />
    </form>
  );
}

describe('Combobox', () => {
  it('moves with the arrow keys and chooses with Enter', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onSubmit = vi.fn();
    render(<ComboboxHarness onPick={onPick} onSubmit={onSubmit} />);
    const box = screen.getByRole('combobox', { name: 'Test or lab' });
    await user.type(box, 'te');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(box.getAttribute('aria-activedescendant')).toMatch(/l1$/);
    expect(screen.getByRole('option', { name: /Example Testing Noida/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(OPTIONS[1]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lets Enter submit the form when no option is highlighted, and Escape closes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ComboboxHarness onPick={vi.fn()} onSubmit={onSubmit} />);
    const box = screen.getByRole('combobox');
    await user.type(box, 'te');
    await user.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('Tabs and Modal (Radix)', () => {
  it('switches tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="scope">
        <TabsList aria-label="Lab sections">
          <TabsTrigger value="scope">Tests offered</TabsTrigger>
          <TabsTrigger value="prices">Prices</TabsTrigger>
        </TabsList>
        <TabsContent value="scope">Scope list</TabsContent>
        <TabsContent value="prices">Price list</TabsContent>
      </Tabs>,
    );
    await user.click(screen.getByRole('tab', { name: 'Tests offered' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Prices' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Price list');
  });

  it('opens a sheet from its trigger, labels the close button and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Modal
        trigger={<Button>Filters</Button>}
        title="Filters"
        closeLabel="Close filters"
        placement="bottom"
      >
        <p>Filter body</p>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close filters' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('LabResultCard', () => {
  it('shows at most three matched tests and the "more" line', () => {
    render(
      <LabResultCard
        name="Example Testing Noida"
        href="/labs/1"
        matchedHeading="Why this lab matched"
        matched={['a', 'b', 'c', 'd'].map((id) => ({
          id,
          name: `Test ${id}`,
          detail: '₹800.00 · 3 days',
        }))}
        moreMatched="+ 1 more test"
        action={<Button>Book</Button>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Example Testing Noida' })).toHaveAttribute(
      'href',
      '/labs/1',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('+ 1 more test')).toBeInTheDocument();
  });
});

describe('MapView', () => {
  it('shows the text alternative when the browser has no WebGL (jsdom)', async () => {
    await act(async () => {
      render(
        <MapView
          points={[{ id: '1', lat: 28.6, lng: 77.2, label: 'Lab', kind: 'bookable' }]}
          tileUrl="https://tiles.example.test/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
          label="Map of labs"
          unavailableText="The map is not available. Use the list."
        />,
      );
      await Promise.resolve();
    });
    expect(screen.getByRole('note')).toHaveTextContent('The map is not available. Use the list.');
  });
});
