import type { NavItem } from '@/lib/types';

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', section: 'primary' },
  { id: 'chat', label: 'Chat', icon: 'chat', section: 'primary' },
  { id: 'agents', label: 'Agents', icon: 'agents', section: 'primary' },
  { id: 'knowledge', label: 'Knowledge', icon: 'knowledge', section: 'primary' },
  { id: 'projects', label: 'Projects', icon: 'projects', section: 'primary' },
  { id: 'workflows', label: 'Workflows', icon: 'workflows', section: 'primary' },
  { id: 'plugins', label: 'Plugins', icon: 'plugins', section: 'bottom' },
  { id: 'settings', label: 'Settings', icon: 'settings', section: 'bottom' },
];

export const PRIMARY_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.section === 'primary');

export const BOTTOM_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.section === 'bottom');
