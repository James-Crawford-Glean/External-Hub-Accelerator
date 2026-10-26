// The domain seam for the web app: what the example domain adds to the shell.
// The shell imports only this file. To replace the example, delete the items
// files (views/Item*, views/ItemsHome.tsx, components/items/, lib/api/items.ts)
// and rewrite this registration, or export EMPTY_DOMAIN from ./lib/domain.
import { Boxes } from 'lucide-react';
import type { DomainRegistration } from './lib/domain';
import { ItemsView } from './views/ItemsView';
import { ItemDetailView } from './views/ItemDetailView';
import { ItemsHomeMetrics, ItemsHomePanel } from './views/ItemsHome';

export const DOMAIN: DomainRegistration = {
  routes: [
    { path: '/items', element: <ItemsView /> },
    { path: '/items/:id', element: <ItemDetailView />, entity: 'item' },
  ],
  nav: [{ to: '/items', label: 'Items', icon: <Boxes size={16} /> }],
  crumbLabels: { items: 'Items' },
  crumbLabelForId: (segment) => (segment.startsWith('itm_') ? 'Item' : undefined),
  HomeMetrics: ItemsHomeMetrics,
  HomePanel: ItemsHomePanel,
};
