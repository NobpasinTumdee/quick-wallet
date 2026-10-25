import { HandCoins, PiggyBank, Receipt, Repeat2, Wallet, type LucideIcon } from 'lucide-react';

import { NoteRefType } from '../../types';

/** The same icon each section wears in the sidebar, so a chip reads at a glance. */
export const NOTE_REF_ICON: Record<NoteRefType, LucideIcon> = {
  transaction: Receipt,
  wallet: Wallet,
  goal: PiggyBank,
  subscription: Repeat2,
  split: HandCoins,
};
