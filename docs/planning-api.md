# Planning API (Code.gs)

The backend for **Planning**: one board per project, with the user's own statuses as columns, cards that are dragged between them, and milestones. Everything here is in `google-apps-script/Code.gs`, in the section headed "Planning". This file is the contract the frontend is built from.

## Transport

The same as every other action (see the top of `Code.gs`):

- **GET**: `?action=planProjects.list&token=…&projectId=…&includeArchived=true`
- **POST**: a `text/plain` body `{"action":"planItems.move","method":"POST","token":"…","query":{…},"body":{…}}`

Reads never take the script lock. Every write runs under it, and every write action refuses `GET` with `405 METHOD_NOT_ALLOWED`.

Fields are read from `body` first, then from `query`. So `id`, `baseUpdatedAt`, `force`, `projectId`, `moveToStatusId`, `statusId`, `afterId`, `beforeId`, `rank` and `archived` can go in either one. This lets the REST client put `id` in the path, so `/api/planItems/<id>/move` becomes `planItems.move` with `query.id`.

**Success:** `{ "ok": true, "data": … }`

**Failure:** `{ "ok": false, "status": 400, "code": "VALIDATION_ERROR", "error": "human readable" }`

A conflict also carries `current`; see [Conflicts](#conflicts-keep-mine--use-latest).

## Actions

| Action | Method | Purpose |
|---|---|---|
| `planProjects.list` | GET | Everything in one call: projects, statuses, milestones, cards |
| `planProjects.save` | POST/PUT | Create (also makes the 4 default statuses) or update a project |
| `planProjects.delete` | POST/DELETE | Delete a project and all its statuses, cards and milestones |
| `planStatuses.save` | POST/PUT | Create or update a status (column) |
| `planStatuses.reorder` | POST | Set the order of a project's statuses |
| `planStatuses.delete` | POST/DELETE | Delete a status, moving its cards first |
| `planItems.save` | POST/PUT | Create or update a card (all fields) |
| `planItems.move` | POST | Move a card to a column and position |
| `planItems.archive` | POST | Archive or unarchive a card |
| `planItems.delete` | POST/DELETE | Delete a card |
| `planMilestones.save` | POST/PUT | Create or update a milestone |
| `planMilestones.delete` | POST/DELETE | Delete a milestone; its cards stay, with no milestone |

"Save" means **create when there is no `id`, update when there is one.**

## Row shapes (as returned)

Every row has `id`, `createdAt` and `updatedAt` (ISO timestamps). The `userId` column is never returned.

```ts
type PlanProject = {
  id: string;
  name: string;                // ≤ 200, one line
  description: string;         // Markdown, ≤ 40,000, kept exactly as typed
  color: string;               // '' or '#rrggbb' (lower case)
  icon: string;                // ≤ 24
  state: 'active' | 'archived';
  startDate: string;           // '' or 'YYYY-MM-DD'
  dueDate: string;             // '' or 'YYYY-MM-DD', not before startDate
  linkedGoalId: string;        // '' or a goal ID (not checked on save)
  sortOrder: number;
  createdAt: string; updatedAt: string;
  linkedGoalMissing: boolean;  // a goal ID is set but no such goal of this user exists
};

type PlanStatus = {
  id: string; projectId: string;
  name: string;                // ≤ 60, one line
  color: string;               // '' or '#rrggbb'
  order: number;               // columns sort by this, ascending
  kind: 'todo' | 'doing' | 'done';
  createdAt: string; updatedAt: string;
};

type PlanItem = {
  id: string; projectId: string;
  statusId: string;
  milestoneId: string;         // '' = none
  title: string;               // ≤ 200, one line, required
  description: string;         // Markdown, ≤ 40,000
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  labels: string[];            // ≤ 20, each ≤ 30, trimmed, de-duplicated ignoring case, no commas
  startDate: string; dueDate: string;   // '' or 'YYYY-MM-DD'
  completedAt: string;         // set by the server only (see Rules)
  rank: number;                // order inside the column, ascending
  checklist: { id: string; text: string; done: boolean }[];  // ≤ 100, text ≤ 300, JSON ≤ 20,000
  budget: number | null;       // null = no budget; 0 is a real budget of 0
  linkedTxIds: string[];       // ≤ 50 transaction IDs
  linkedNoteId: string;        // '' or a note ID
  archivedAt: string;          // '' = on the board
  createdAt: string; updatedAt: string;
  spent: number;               // sum of the linked expense transactions (base currency, 2 dp)
  missingTxIds: string[];      // linked IDs with no such transaction of this user
  linkedNoteMissing: boolean;
};

type PlanMilestone = {
  id: string; projectId: string;
  title: string;               // ≤ 200, one line, required
  description: string;         // ≤ 40,000
  dueDate: string;             // '' or 'YYYY-MM-DD'
  state: 'open' | 'closed';
  order: number;
  createdAt: string; updatedAt: string;
};
```

Every `PlanItem` returned by any action carries `spent`, `missingTxIds` and `linkedNoteMissing`, not only those from `planProjects.list`. Every `PlanProject` carries `linkedGoalMissing`.

## planProjects.list (GET)

**Query:**

- `projectId?`: only that project and its rows;
- `includeArchived?`: `true` or `1` to include archived cards.

**Answers:**

```ts
{ projects: PlanProject[]; statuses: PlanStatus[]; milestones: PlanMilestone[]; items: PlanItem[] }
```

**Sort order:**

| List | Sorted by |
|---|---|
| `projects` | `sortOrder`, then `createdAt` |
| `statuses` | project, then `order` |
| `milestones` | project, then `order`, then `dueDate` |
| `items` | project, then status, then `rank` |

**Notes:**

- Archived cards are left out unless `includeArchived` is set.
- `projectId` that isn't the user's: `404 NOT_FOUND`.
- If a Planning sheet doesn't exist yet, the list is empty, not an error.
- `spent` and the missing flags are computed here. The Transactions, Goals and Notes sheets are each read at most once per call, and only if something links to them.

## planProjects.save

**Create** (no `id`):

```ts
body: {
  name: string;          // required
  description?, color?, icon?, state?, startDate?, dueDate?, linkedGoalId?, sortOrder?;
  statusNames?: string[];  // up to 4, localized names for the default statuses
}
→ { project: PlanProject; statuses: PlanStatus[] /* 4 */ }
```

The default statuses, in order (`order` 0–3):

| Default name | Kind |
|---|---|
| Planning | todo |
| Ready | todo |
| In progress | doing |
| Done | done |

A name missing or empty in `statusNames` falls back to the English name. `sortOrder` defaults to the highest existing value + 1. The limit is 200 projects per user; past it, `400 LIMIT_REACHED`.

**Update:**

```ts
body: { id; baseUpdatedAt | force: true; …any fields to change }  → { project: PlanProject }
```

Only the fields sent change. `statusNames` is ignored on update.

## planProjects.delete

```ts
body: { id; baseUpdatedAt | force: true }
→ { id: string; deleted: { items: number; milestones: number; statuses: number } }
```

Deletes the project's cards, milestones and statuses, then the project, in one locked call. The app should confirm first and suggest setting `state: 'archived'` instead.

## planStatuses.save

**Create:**

```ts
body: { projectId; name; color?; kind? /* default 'todo' */; order? /* default last */ }
→ { status: PlanStatus; items: [] }
```

The limit is 30 per project.

**Update:**

```ts
body: { id; baseUpdatedAt | force: true; name?; color?; kind?; order? }
→ { status: PlanStatus; items: PlanItem[] }
```

`items` lists the cards whose `completedAt` changed because `kind` changed. Each of them has a new `updatedAt`. A status can't move to another project.

## planStatuses.reorder

```ts
body: { projectId; statusIds: string[] }   // every status of the project, exactly once, in the new order
→ { statuses: PlanStatus[] }               // in the new order, order = 0, 1, 2…
```

Statuses whose `order` changed get a new `updatedAt`. If the list doesn't match the project's statuses exactly (one was added or deleted elsewhere), the server refuses with `409 CONFLICT` and `current: { statuses: PlanStatus[] }`.

## planStatuses.delete

```ts
body: { id; baseUpdatedAt | force: true; moveToStatusId? }
→ { id: string; items: PlanItem[] }   // the cards that were moved
```

- The status is the project's last one: `400 LAST_STATUS`.
- It still has cards (archived ones included) and no `moveToStatusId` was sent: `400 MOVE_TO_REQUIRED`.
- `moveToStatusId` is in another project: `400 WRONG_PROJECT`. It is the same status: `400 VALIDATION_ERROR`.
- Moved cards keep their relative order and go to the **end** of the target column.
- Each moved card gets the target's `completedAt` rule and a new `updatedAt`.

## planItems.save

**Create:**

```ts
body: {
  projectId; title;
  statusId?;             // default: the project's first status by order
  milestoneId?, description?, priority?, labels?, startDate?, dueDate?,
  checklist?, budget?, linkedTxIds?, linkedNoteId?;
}
→ { item: PlanItem }
```

The card goes to the end of its column. If that status's kind is `done`, `completedAt` is set. The limit is 2,000 cards per project, archived included.

**Update:**

```ts
body: { id; baseUpdatedAt | force: true; …any fields above }  → { item: PlanItem }
```

- Only the fields sent change.
- Sending a different `statusId` moves the card to the **end** of that column. To place it at a position, use `planItems.move`.
- `rank`, `completedAt` and `archivedAt` are ignored here.
- A card can't move to another project (`400 VALIDATION_ERROR`).

**Accepted input forms:**

- `labels` and `linkedTxIds`: an array, or one comma-separated string.
- `checklist`: an array, or its JSON string.
- Checklist entries without a valid `id` (1–40 characters of `A-Z a-z 0-9 _ -`), or with a duplicate one, get a new id.
- `budget`: `null` or `''` means "no budget".

## planItems.move

```ts
body: {
  id; baseUpdatedAt | force: true;
  statusId?;             // target column; default the card's current one
  afterId?;              // the card that will sit directly ABOVE the moved card
  beforeId?;             // the card that will sit directly BELOW it
  rank?;                 // only used when neither afterId nor beforeId is sent
}
→ { item: PlanItem; renumbered: { id: string; rank: number }[] }
```

- With neither `afterId` nor `beforeId`, the card goes to the end of the column, or exactly at `rank` if one is sent.
- `afterId` and `beforeId` must be cards in the target column. If both are sent, they must be next to each other; otherwise `400 VALIDATION_ERROR`.
- The new rank is the midpoint of the neighbours, so normally one row is written. If the gap is under `1e-6`, that one column is renumbered `1024, 2048, …` with the moved card in place.
- `renumbered` lists the other cards whose rank changed. Their `updatedAt` is **not** changed; just patch their `rank` in the cache.
- `item` is the full moved card: `statusId`, `rank`, `completedAt`, a new `updatedAt`, and so on.

## planItems.archive

```ts
body: { id; baseUpdatedAt | force: true; archived?: boolean /* default true */ }  → { item: PlanItem }
```

`archivedAt` is set (or kept if already set), or cleared when `archived: false`. An archived card keeps its status and rank, so unarchiving puts it back where it was.

## planItems.delete

```ts
body: { id; baseUpdatedAt | force: true }  → { id: string }
```

## planMilestones.save

**Create:**

```ts
body: { projectId; title; description?; dueDate?; state? /* 'open' */; order? /* last */ }
→ { milestone: PlanMilestone }
```

The limit is 100 per project.

**Update:**

```ts
body: { id; baseUpdatedAt | force: true; …fields }  → { milestone: PlanMilestone }
```

## planMilestones.delete

```ts
body: { id; baseUpdatedAt | force: true }
→ { id: string; items: PlanItem[] }   // cards whose milestoneId was cleared (new updatedAt)
```

## Rules

- **Ownership:** every row belongs to the signed-in user, through a `User ID` column, as in Notes. Another user's row answers `404 NOT_FOUND`, the same as a row that doesn't exist.
- **Same project:** a card's `statusId` and `milestoneId`, and a status delete's `moveToStatusId`, must be in the same project. Otherwise: `400 WRONG_PROJECT`.
- **completedAt** is only ever set by the server:
  - It is set when a card enters a status of kind `done`, whether by create, save, move, status delete or a Kind change. It keeps its old value when the card moves from one `done` status to another.
  - It is cleared when the card enters a status that isn't `done`.
  - A project is allowed to have no `done` status.
- **Ranks:** see `planItems.move`. Only pure renumbering skips the `updatedAt` bump. Every other change to a card bumps it and returns the card: a moved status, a recomputed `completedAt`, a cleared milestone.
- **All or nothing:** every field is validated before anything is written, so a refused request writes nothing.
- **Plain text:** every text column is stored as plain text (a leading-apostrophe write, as in Notes). `=1+1`, `+66812345678`, `-5`, `007` and `2026-01-01` come back exactly as sent, and so do Thai, emoji and newlines.
  - Names and titles are one line: newlines become spaces, and the ends are trimmed.
  - Descriptions are kept exactly, including leading and trailing spaces.
- **Dates:** `YYYY-MM-DD` and a real calendar date (`2026-02-30` is refused). No timezone shift and no Buddhist-year conversion. `dueDate` must not be before `startDate` (projects and cards).
- **Linked expenses:** `spent` is the sum of `amount` over the linked transactions that are this user's **expense** rows. Amounts are positive and in the base currency, as in the rest of the app.
  - Linked income or transfer rows add 0 and are not "missing".
  - Linked IDs that don't exist, or belong to another user, are listed in `missingTxIds`.

## Conflicts ("keep mine" / "use latest")

Every update, move, archive and delete must send `baseUpdatedAt`: the `updatedAt` of the row as the app last saw it. If it's missing and `force` isn't set: `400 VALIDATION_ERROR`.

If the stored row has changed since, the server writes nothing and answers:

```json
{
  "ok": false,
  "status": 409,
  "code": "CONFLICT",
  "error": "This card was changed somewhere else since you loaded it",
  "current": { "id": "…", "title": "…", "updatedAt": "…" }
}
```

`current` is the row as stored now, in the same shape the action returns: a `PlanItem` for item actions, a `PlanStatus`, `PlanMilestone` or `PlanProject` for those. For `planStatuses.reorder` it is `{ statuses: PlanStatus[] }`.

The app can then offer two choices:

- **Use latest:** replace the cached row with `current`.
- **Keep mine:** resend the same request with `force: true`, which skips the check. Alternatively, resend with `baseUpdatedAt: current.updatedAt`.

`updatedAt` always moves strictly forward, even for two saves in the same millisecond, so equal means unchanged.

## Error codes

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad enum, too-long text, bad date/colour/ID, bad checklist, negative budget, missing `baseUpdatedAt`, neighbours not in the column or not adjacent, a card/status/milestone moved to another project |
| 400 | `WRONG_PROJECT` | `statusId`, `milestoneId` or `moveToStatusId` belongs to a different project |
| 400 | `MOVE_TO_REQUIRED` | Deleting a status that still has cards, without `moveToStatusId` |
| 400 | `LAST_STATUS` | Deleting a project's only status |
| 400 | `LIMIT_REACHED` | 200 projects, 30 statuses, 100 milestones or 2,000 cards per project |
| 404 | `NOT_FOUND` | The row doesn't exist or isn't the user's |
| 405 | `METHOD_NOT_ALLOWED` | A write sent as GET |
| 409 | `CONFLICT` | Stale `baseUpdatedAt` (with `current`), or a reorder list that doesn't match |
| 503 | `BUSY` | The sheet lock wasn't free within 20 s (existing behaviour) |

## Limits

| What | Limit |
|---|---|
| Project name, card title, milestone title | 200 |
| Status name | 60 |
| Description (project, card, milestone) | 40,000 |
| Icon | 24 |
| Labels per card / per label | 20 / 30 |
| Checklist entries / text per entry / whole JSON | 100 / 300 / 20,000 |
| Linked transactions per card | 50 |
| Any linked ID | 80 characters of `A-Z a-z 0-9 _ . : -` |
| Budget | 0 – 1,000,000,000,000 |
| Projects per user | 200 |
| Statuses per project | 30 |
| Milestones per project | 100 |
| Cards per project (archived included) | 2,000 |

## Sheets

These are four sheets of their own. They are **not** in `SHEETS`, so `health`, `setup()` and the Settings row counts are unchanged.

Every value is read and written **by header name**:

- columns can be moved by hand;
- a column added by hand is never written, so it keeps its value;
- a missing sheet or header is created by the first write, by `createPlanningSheets()`, or by `createMissingSheets()`.

| Sheet | Columns |
|---|---|
| PlanProjects | ID, User ID, Name, Description, Color, Icon, State, Start Date, Due Date, Linked Goal ID, Sort Order, Created At, Updated At |
| PlanStatuses | ID, User ID, Project ID, Name, Color, Order, Kind, Created At, Updated At |
| PlanItems | ID, User ID, Project ID, Status ID, Milestone ID, Title, Description, Priority, Labels, Start Date, Due Date, Completed At, Rank, Checklist (JSON), Budget, Linked Tx IDs, Linked Note ID, Archived At, Created At, Updated At |
| PlanMilestones | ID, User ID, Project ID, Title, Description, Due Date, State, Order, Created At, Updated At |

**How values are stored:**

- Sort Order, Order and Rank are numbers.
- Budget is a number, or empty for "no budget".
- Everything else is plain text.
- Labels are stored as `a, b`, Linked Tx IDs as `id1,id2`, and Checklist as a JSON array.
