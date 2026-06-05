# Realtime (Socket.io)

## Setup

Socket.io runs on the same port as Next.js via a custom `server.ts`. It mounts at `/api/socket`.

## Room strategy

- `user:{userId}` — personal room, joined on connect when `socket.handshake.auth.userId` is present
- `admin:all` — joined by admin clients on the `join:admin` event

## Events (server → client)

| Event | Payload | Trigger |
|-------|---------|---------|
| `transaction:created` | `ITransaction` | POST /api/transactions |
| `transaction:updated` | `ITransaction` | PATCH /api/transactions/:id |
| `transaction:deleted` | `{ id }` | DELETE /api/transactions/:id |
| `account:balance_updated` | `IAccount` | Any balance-changing transaction |
| `budget:alert` | `{ category, percent, budgetId }` | Budget threshold crossed |
| `goal:progress` | `IGoal` | PATCH /api/goals/:id |
| `goal:reached` | `IGoal` | Goal savedAmount >= targetAmount |
| `notification:new` | `INotification` | Any new notification created |

## Emitting from a Route Handler

```typescript
import { getIO } from "@/lib/socket-server";

// After creating a transaction:
getIO()?.to(`user:${userId}`).emit("transaction:created", transaction);
```

## Client usage

```typescript
// Via hook
useSocket<ITransaction>("transaction:created", (txn) => {
  queryClient.setQueryData(["transactions"], ...)
});

// Direct socket access
const { socket, connected } = useSocketContext();
```

## Connection lifecycle

The `SocketProvider` creates/joins the socket when `session.user.id` becomes available and cleans up event listeners on unmount. The underlying socket singleton (`socket-client.ts`) is reused across mounts.
