import "server-only";
// Server action bodies for /ramp. src/app/ramp/actions.ts re-exports them.

import { dismissRampItem, undoRampDismissal } from "./ramp";
import { withAction } from "./request-context";

export const dismissRampItemAction = withAction("ramp.dismiss", async (input: { weekStart: string; refId: string }) => dismissRampItem(input));
export const undoRampDismissalAction = withAction("ramp.undo", async (input: { refId: string }) => undoRampDismissal(input));
