-- 156-print-queue.sql — the Prints queue (server/prints.ts, src/types/prints.ts):
-- the files still to print, in the order the team will print them.
--   print_files.priority: 'urgent', 'high', 'normal' (default) or 'low'.
--   print_files.due_date: the day it's needed by, "YYYY-MM-DD", or NULL.
--   print_files.queue_pos: where a person dragged it in the queue (1 is next),
--     or NULL when nobody has placed it. Unplaced files slot in by priority,
--     then due date (queueOrder()). Changing a file's priority or due date, or
--     marking it printed, clears its place.
-- New columns only; nothing existing changes.
BEGIN;

ALTER TABLE print_files ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE print_files ADD COLUMN due_date TEXT;
ALTER TABLE print_files ADD COLUMN queue_pos INTEGER;

COMMIT;
