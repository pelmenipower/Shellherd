import { useEffect, useState } from 'react';
import type { TerminalTab } from '../terminal-tabs';
import { emptyLayout, panes, syncLayout } from '../terminal-layout';
import type { LiveLayout } from '../terminal-layout';

export function useTerminalLayout(tabs: TerminalTab[], selected: string | null) {
  const [layout, setLayout] = useState<LiveLayout>(emptyLayout);
  const [focused, setFocused] = useState('root');
  useEffect(() => {
    setLayout(current => syncLayout(current, tabs, selected, focused));
    // Focus changes alone must not reactivate a tab in another pane.
  }, [tabs, selected]);
  useEffect(() => {
    if (selected) {
      const owner = panes(layout).find(pane => pane.tabIds.includes(selected));
      if (owner) setFocused(owner.id);
    }
  }, [selected]);
  const replace = (next: LiveLayout) => { setLayout(next); setFocused(panes(next)[0].id); };
  return { layout, setLayout, focused, setFocused, replace, reset: () => replace(emptyLayout()) };
}
