# Notifications

Finance OS supports two notification channels: **in-app** (MongoDB + Socket.io) and **web push** (VAPID).

## In-app notifications

Stored in the `notifications` collection with a 90-day TTL. Types:

| Type | Trigger |
|------|---------|
| `budget_alert` | Transaction expense causes spend ≥ `alertAt`% of monthly budget |
| `goal_reached` | `savedAmount` reaches `targetAmount` on PATCH /api/goals/:id |
| `loan_due` | Daily cron job (server.ts) — loans due within 3 days |
| `system` | Admin broadcast |
| `transaction` | High-value transaction (configurable) |

After creating a notification, emit `notification:new` via Socket.io so the bell badge updates instantly.

## Web push (VAPID)

### Setup

Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

Add to `.env.local`:
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_CONTACT_EMAIL=admin@example.com
```

### Subscription flow

1. Client calls `Notification.requestPermission()`
2. Client gets push subscription from service worker: `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
3. POST `/api/push/subscribe` stores the subscription
4. Server calls `sendPushToSubscription(sub, { title, body, icon, url })` from `src/lib/push.ts`
5. If the endpoint returns 404/410, `push.ts` marks the subscription as inactive

### Triggers

- Budget alert: fired in `checkBudgetAlert()` inside POST /api/transactions
- Goal reached: fired in PATCH /api/goals/:id
- Loan due: fired by a daily setInterval in server.ts
