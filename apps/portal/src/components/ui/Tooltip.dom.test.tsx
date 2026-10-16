// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip, TipList } from './Tooltip';

// The Accounts filter bar wraps toggle BUTTONS in Tooltip (as="span"), which the
// component was not previously used for — SavedViewsMenu only wraps static text. Two
// things have to hold for that to be a safe pattern: the wrapper must not swallow the
// button's click, and the tip must open from hovering the child rather than only the
// wrapper's own padding. Both are silent failures in a browser, hence a test.

afterEach(cleanup);

const TIP = 'A private-equity firm owns this account.';

function Harness() {
  const [clicks, setClicks] = useState(0);
  const [on, setOn] = useState(false);
  return (
    <Tooltip as="span" className="filter-popover" content={TIP}>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => {
          setClicks((c) => c + 1);
          setOn((v) => !v);
        }}
      >
        Portfolio account {clicks}
      </button>
    </Tooltip>
  );
}

const trigger = () => screen.getByRole('button', { name: /Portfolio account/ });

describe('Tooltip wrapping an interactive button', () => {
  it('shows the tip when the pointer enters the button inside the wrapper', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.hover(trigger());
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(TIP));
  });

  it('still toggles the button — the wrapper does not swallow the click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    expect(trigger().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Portfolio account 1/ })).toBeTruthy();

    await user.click(trigger());
    expect(trigger().getAttribute('aria-pressed')).toBe('false');
  });

  it('opens on keyboard focus, so the tip is not mouse-only', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(document.activeElement).toBe(trigger());
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(TIP));
  });

  it('hides again once the pointer leaves', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());

    await user.unhover(trigger());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});

// The PE chip tooltips grew into a paragraph that wrapped to five lines in a 260px box.
// tipList renders a title + bullets instead, so the content stays scannable.
describe('TipList', () => {
  function Bullets() {
    return (
      <Tooltip
        as="span"
        content={
          <TipList
            title="Patient Square Capital"
            lines={['8 related records', 'No special terms', 'Opens the upstream record']}
          />
        }
      >
        <button type="button">chip</button>
      </Tooltip>
    );
  }

  it('renders the title and one list item per line', async () => {
    const user = userEvent.setup();
    render(<Bullets />);

    await user.hover(screen.getByRole('button', { name: 'chip' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['8 related records', 'No special terms', 'Opens the upstream record']);
    expect(screen.getByRole('tooltip').textContent).toContain('Patient Square Capital');
  });
});
