import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  // Main game state for a team
  GameState: a
    .model({
      teamId: a.string().required(),
      cash: a.float().required().default(0),
      lastUpdated: a.datetime().required(),
      updatedBy: a.string(),
    })
    .identifier(['teamId'])
    .authorization((allow) => [allow.authenticated()]),

  // Orders in the system
  Order: a
    .model({
      teamId: a.string().required(),
      orderId: a.string().required(),
      orderTime: a.float().required(),
      quantity: a.integer().required(),
      leadTime: a.float().required(),
      paperColorCode: a.string().required(),
      paperColorName: a.string(),
      size: a.string().required(),
      verseSize: a.integer().required(),
      occasion: a.string().required(),
      price: a.float().required(),
      available: a.boolean().required().default(true),
      status: a.enum(['passive', 'ordered', 'pending_inventory', 'WIP', 'sent', 'approved', 'failed', 'deleted', 'other']),
      startTime: a.float(),
      dueTime: a.float(),
      selectedVerse: a.string(),
    })
    .identifier(['teamId', 'orderId'])
    .authorization((allow) => [allow.authenticated()]),

  // Paper inventory levels
  PaperInventory: a
    .model({
      teamId: a.string().required(),
      colorCode: a.string().required(),
      quantity: a.integer().required().default(0),
      lastUpdated: a.datetime().required(),
    })
    .identifier(['teamId', 'colorCode'])
    .authorization((allow) => [allow.authenticated()]),

  // Financial transactions
  Transaction: a
    .model({
      teamId: a.string().required(),
      transactionId: a.string().required(),
      timestamp: a.datetime().required(),
      amount: a.float().required(),
      type: a.enum(['cash', 'paper', 'inventory']),
      paperColor: a.string(),
      paperQuantity: a.integer(),
      reason: a.string(),
      orderId: a.string(),
      pending: a.boolean().default(false),
      deliveryTime: a.float(),
      arrivalTime: a.float(),
    })
    .identifier(['teamId', 'transactionId'])
    .authorization((allow) => [allow.authenticated()]),

  // Game parameters/settings
  GameParameters: a
    .model({
      teamId: a.string().required(),
      workstationSpeed: a.float().required().default(1.0),
      safetyStock: a.integer().required().default(12),
      buyingCooldown: a.integer().required().default(0),
      buyingCooldownEndTime: a.float(),
      sellMarkdown: a.float().required().default(0.7),
      failureFineRatio: a.float().required().default(0.3),
      colourLoveMultiplier: a.float().required().default(1.0),
      whiteLoveMultiplier: a.float().required().default(1.0),
      standardTimeRatio: a.float().required().default(1.23),
      lastUpdated: a.datetime().required(),
    })
    .identifier(['teamId'])
    .authorization((allow) => [allow.authenticated()]),

  // Station configurations
  Station: a
    .model({
      teamId: a.string().required(),
      stationId: a.string().required(),
      name: a.string().required(),
      speedMultiplier: a.float().required().default(1.0),
      processingTimeMean: a.float(),
      processingTimeStdDev: a.float(),
      rawTaskTimes: a.json(),
      sizeDistributions: a.json(),
    })
    .identifier(['teamId', 'stationId'])
    .authorization((allow) => [allow.authenticated()]),

  // Production schedules
  Schedule: a
    .model({
      teamId: a.string().required(),
      scheduleName: a.string().required(),
      orderIds: a.json().array(),
      isActive: a.boolean().required().default(false),
      lastUpdated: a.datetime().required(),
    })
    .identifier(['teamId', 'scheduleName'])
    .authorization((allow) => [allow.authenticated()]),

  // Paper colors configuration
  PaperColor: a
    .model({
      teamId: a.string().required(),
      code: a.string().required(),
      name: a.string().required(),
      cssClass: a.string().required(),
      basePrice: a.float().required(),
    })
    .identifier(['teamId', 'code'])
    .authorization((allow) => [allow.authenticated()]),

  // Occasions configuration
  Occasion: a
    .model({
      teamId: a.string().required(),
      name: a.string().required(),
    })
    .identifier(['teamId', 'name'])
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server 
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
