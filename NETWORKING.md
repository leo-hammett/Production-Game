# Production Management System - Network Architecture

## Stack
- **AWS Amplify DataStore** for sync (handles offline, real-time subscriptions, conflict resolution)
- **DynamoDB** backend (via AppSync)
- **React** frontend with single UI for all users
- **AWS Cognito** for authentication

## Setup

**1. Initialize Amplify**
```bash
amplify init
amplify add api  # Choose GraphQL, enable DataStore
amplify add auth # Choose: Default configuration, Username sign-in
amplify push
```

## Data Schema
```graphql
type Order @model @auth(rules: [{allow: private}]) {
  id: ID!
  name: String!
  status: OrderStatus! # PENDING, IN_PROGRESS, COMPLETE
  estimatedMinutes: Int
  actualMinutes: Int
  assignedWorker: String
  startedAt: AWSDateTime
  completedAt: AWSDateTime
}

type TimeRecord @model @auth(rules: [{allow: private}]) {
  id: ID!
  orderId: ID!
  worker: String!
  minutes: Int!
  timestamp: AWSDateTime!
}

enum OrderStatus {
  PENDING
  IN_PROGRESS
  COMPLETE
}
```

## Implementation

**1. App Wrapper with Auth**
```javascript
// App.js
import { Authenticator } from '@aws-amplify/ui-react';

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div>
          <OrdersDashboard user={user} />
          <button onClick={signOut}>Sign Out</button>
        </div>
      )}
    </Authenticator>
  );
}
```

**2. Real-time Sync**
```javascript
// OrdersDashboard.js
useEffect(() => {
  const subscription = DataStore.observeQuery(Order)
    .subscribe(snapshot => {
      setOrders(snapshot.items);
    });
  return () => subscription.unsubscribe();
}, []);
```

**3. Worker Claims Task**
```javascript
const claimOrder = async (orderId, user) => {
  const order = await DataStore.query(Order, orderId);
  await DataStore.save(
    Order.copyOf(order, updated => {
      updated.assignedWorker = user.username;
      updated.status = 'IN_PROGRESS';
      updated.startedAt = new Date().toISOString();
    })
  );
};
```

**4. Submit Time Record**
```javascript
const completeOrder = async (orderId, user, minutes) => {
  // Save time record
  await DataStore.save(new TimeRecord({
    orderId,
    worker: user.username,
    minutes,
    timestamp: new Date().toISOString()
  }));
  
  // Update order
  const order = await DataStore.query(Order, orderId);
  await DataStore.save(
    Order.copyOf(order, updated => {
      updated.status = 'COMPLETE';
      updated.actualMinutes = minutes;
      updated.completedAt = new Date().toISOString();
    })
  );
};
```

## User Management

**Option 1: Shared account** (simplest)
- One username/password for all workers

**Option 2: Individual accounts**
Create users via AWS Console or CLI:
```bash
aws cognito-idp admin-create-user \
  --user-pool-id xxx \
  --username worker1 \
  --temporary-password TempPass123!
```

## Development Approach

### Build locally first:
```javascript
// Just use regular React state initially
const [orders, setOrders] = useState([]);

const claimOrder = (orderId) => {
  setOrders(orders.map(order => 
    order.id === orderId 
      ? {...order, status: 'IN_PROGRESS', assignedWorker: 'John'}
      : order
  ));
};
```

### Then swap in DataStore:
```javascript
// Same UI logic, just change data layer
const claimOrder = async (orderId) => {
  const order = await DataStore.query(Order, orderId);
  await DataStore.save(
    Order.copyOf(order, updated => {
      updated.status = 'IN_PROGRESS';
      updated.assignedWorker = 'John';
    })
  );
};

// Orders auto-update via subscription
useEffect(() => {
  DataStore.observeQuery(Order).subscribe(snapshot => {
    setOrders(snapshot.items);
  });
}, []);
```

## Why this works:
- **DataStore API looks like normal state management** - query, save, delete
- **Subscriptions auto-update your React state** - no manual sync logic needed
- **All sync/conflict/offline handling is automatic** - happens behind the scenes

## Suggested development path:
1. Build complete UI with mock data
2. Get all interactions working locally
3. Add Amplify (`amplify init`, `amplify add api`)
4. Replace setState calls with DataStore.save
5. Replace local arrays with DataStore.query
6. Add subscriptions for real-time updates

The actual "networking" code is like 10 lines total. DataStore abstracts all the complexity.

## Offline Fallback
DataStore automatically:
- Caches all data locally in IndexedDB
- Queues changes when offline
- Syncs when connection restored

## Manager Laptop Failure Recovery
Any laptop can act as manager by accessing the same URL. All data is in cloud, nothing stored exclusively on manager device.

## Performance
- Initial sync: ~500ms for full dataset
- Updates propagate: 200-300ms typical
- Offline mode: Instant (local cache)

## Conflict Resolution
Using default "Auto Merge" - last write wins at field level. Good enough for 6 users with verbal communication.