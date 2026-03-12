import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  SharedGameState: a
    .model({
      teamId: a.string().required(),
      snapshot: a.json().required(),
      revision: a.integer().required().default(0),
      schemaVersion: a.integer().required().default(1),
      updatedAtClient: a.datetime().required(),
      updatedBy: a.string(),
      clientId: a.string(),
    })
    .identifier(["teamId"])
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});
