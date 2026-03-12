# Network Sync Setup

This app now syncs through a single Amplify model called `SharedGameState`.

What is shared:
- Orders
- Paper inventory
- Transactions / cash
- Global parameters
- Current schedule
- Custom paper colours
- Occasion list

How it works:
- Each browser joins a `teamId` such as `TEAM-001`
- The whole team state is saved as one JSON snapshot in Amplify
- Browsers subscribe to that record and update in near real time
- Writes are debounced in the client, then saved back to Amplify
- Conflict behaviour is effectively last write wins for the whole snapshot

## Why this design

The app is still mostly local React state with some singleton game state on the side. A per-entity schema looked cleaner on paper, but it would have required rewriting most of the app. A single shared snapshot is the shortest reliable path to:

- Every machine seeing the same board
- No custom websocket server
- Minimal changes to the existing UI logic

## Backend model

Amplify backend file:
[amplify/data/resource.ts](/Volumes/makingthings/git-repos/Production-Game/amplify/data/resource.ts)

Current model:
- `SharedGameState`
  - identifier: `teamId`
  - `snapshot`: full game state JSON
  - `revision`: client-side revision counter
  - `updatedAtClient`
  - `updatedBy`
  - `clientId`

Authorization:
- Default auth mode is `apiKey`
- Model auth is `allow.publicApiKey()`

That is convenient for a shared factory/game floor setup, but it is not appropriate for sensitive production data. If you want logins later, switch this to Cognito and keep the same snapshot approach.

## Frontend files

Main sync code:
- [src/hooks/useAmplifySharedGameState.ts](/Volumes/makingthings/git-repos/Production-Game/src/hooks/useAmplifySharedGameState.ts)
- [src/utils/sharedGameState.ts](/Volumes/makingthings/git-repos/Production-Game/src/utils/sharedGameState.ts)
- [src/utils/amplifyConfig.ts](/Volumes/makingthings/git-repos/Production-Game/src/utils/amplifyConfig.ts)
- [src/App.tsx](/Volumes/makingthings/git-repos/Production-Game/src/App.tsx)

Important behavior:
- The app loads `amplify_outputs.json` at runtime
- If that file is missing, the UI stays usable but sync is disabled
- Team ID is stored locally in browser storage so each machine can rejoin the same board
- New teams start blank instead of cloning the previous team’s local state

## First deploy

1. Configure AWS credentials locally.
2. Start an Amplify sandbox and write outputs into the project root:

```bash
npx ampx sandbox --once --outputs-format json --outputs-out-dir .
```

That should create `amplify_outputs.json` in the repo root.

If you are deploying to a hosted Amplify backend instead of sandbox, generate outputs after deploy:

```bash
npx ampx generate outputs --stack <your-stack-name> --format json --out-dir .
```

or:

```bash
npx ampx generate outputs --app-id <your-app-id> --branch <your-branch> --format json --out-dir .
```

## Running locally

After `amplify_outputs.json` exists:

```bash
npm run dev
```

Open the app on multiple machines, point them at the same deployed frontend, and set the same `teamId` in the header.

## Operational notes

- Snapshot sync is fine for the current data size.
- Very rapid concurrent edits can overwrite each other because the whole state is one document.
- If that becomes a real problem, the next step is not a websocket server. The next step is splitting only the hot data paths, probably:
  - `Order`
  - `Inventory`
  - `Transaction`
  - `Schedule`

## Current limitations

- Linting still fails in unrelated pre-existing files; build passes.
- Sync depends on `amplify_outputs.json` being present at runtime.
- Auth is intentionally simple right now and should be tightened before any sensitive use.
