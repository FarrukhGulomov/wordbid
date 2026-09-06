import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityFeed } from '@/components/ActivityFeed';

function render(entries: Parameters<typeof ActivityFeed>[0]['entries']) {
  return renderToStaticMarkup(createElement(ActivityFeed, { entries }));
}

const base = {
  id: '1',
  amountCents: 1000,
  createdAt: new Date(),
  word: { display: 'AI', normalized: 'ai' },
  owner: { name: 'Acme' },
};

describe('ActivityFeed', () => {
  it('renders nothing when there is no activity — never a fabricated placeholder', () => {
    expect(render([])).toBe('');
  });

  it('describes a CLAIMED entry as claiming, with no "from" clause', () => {
    const html = render([{ ...base, type: 'CLAIMED', previousOwnerName: null }]);
    expect(html).toContain('claimed');
    expect(html).not.toContain('from');
  });

  it('names the real previous owner on a TAKEOVER — data already stored, previously unused here', () => {
    const html = render([{ ...base, type: 'TAKEOVER', previousOwnerName: 'OldCo' }]);
    expect(html).toContain('took');
    expect(html).toContain('from OldCo');
  });

  it('describes a RECLAIM distinctly from a plain takeover', () => {
    const html = render([{ ...base, type: 'RECLAIM', previousOwnerName: 'OldCo' }]);
    expect(html).toContain('reclaimed');
    expect(html).not.toContain('took');
  });

  it('describes a BOOST as boosted, with a "+" prefix on the amount — never implying a takeover', () => {
    const html = render([{ ...base, type: 'BOOST', previousOwnerName: null, amountCents: 500 }]);
    expect(html).toContain('boosted');
    expect(html).toContain('+$5');
  });
});
