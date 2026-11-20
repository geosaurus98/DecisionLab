import type { Category } from '@/domain/types';

export const testCategories: Category[] = [
  { id: 'income', name: 'Income', kind: 'income', essential: false, color: '#000', sortOrder: 0 },
  { id: 'groceries', name: 'Groceries', kind: 'expense', essential: true, color: '#000', sortOrder: 1 },
  { id: 'eating', name: 'Eating out', kind: 'expense', essential: false, color: '#000', sortOrder: 2 },
  { id: 'rent', name: 'Accommodation', kind: 'expense', essential: true, color: '#000', sortOrder: 3 },
  { id: 'subs', name: 'Subscriptions', kind: 'expense', essential: false, color: '#000', sortOrder: 4 },
  { id: 'transfer', name: 'Transfers', kind: 'transfer', essential: false, color: '#000', sortOrder: 5 },
  { id: 'savings', name: 'Investments and savings', kind: 'savings', essential: false, color: '#000', sortOrder: 6 },
];

export const categoryMap = new Map(testCategories.map((c) => [c.id, c]));
