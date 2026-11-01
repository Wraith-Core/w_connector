import type { AdminPlayer, Result } from '../../../types';
import type { PlayerAction } from '../shared';

/** What every drawer section gets from the drawer (one busy state for the whole file) */
export interface TabProps {
  p: AdminPlayer;
  run(key: string, action: PlayerAction, args?: Record<string, unknown>): Promise<Result>;
  /** the key of the action running now */
  busy: string | null;
  /** the selected player is the admin himself */
  isMe: boolean;
}
