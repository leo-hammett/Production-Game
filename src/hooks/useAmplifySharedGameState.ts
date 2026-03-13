import { useEffect, useEffectEvent, useRef, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { gameState, type Order, type PaperInventory, type Transaction } from "../utils/gameState";
import type { StationSpeedMultipliers } from "../utils/station";
import { configureAmplify } from "../utils/amplifyConfig";
import {
  SHARED_GAME_SCHEMA_VERSION,
  buildSharedGameSnapshot,
  createEmptySharedGameState,
  deserializeSharedGameSnapshot,
  type DeserializedSharedGameState,
  type SharedGameSnapshot,
} from "../utils/sharedGameState";

const SAVE_DEBOUNCE_MS = 500;
const PERSIST_FAILURE_BACKOFF_MS = 1_000;

export type SyncState =
  | "configuring"
  | "disabled"
  | "connecting"
  | "paused"
  | "syncing"
  | "synced"
  | "error";

export interface SyncStatus {
  state: SyncState;
  message: string;
}

interface AmplifySharedGameStateBindings {
  teamId: string;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  paperInventory: PaperInventory;
  setPaperInventory: React.Dispatch<React.SetStateAction<PaperInventory>>;
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  cash: number;
  setCash: React.Dispatch<React.SetStateAction<number>>;
  safetyStock: number;
  setSafetyStock: React.Dispatch<React.SetStateAction<number>>;
  workstationSpeed: number;
  setWorkstationSpeed: React.Dispatch<React.SetStateAction<number>>;
  buyingCooldown: number;
  setBuyingCooldown: React.Dispatch<React.SetStateAction<number>>;
  paperDeliverySeconds: number;
  setPaperDeliverySeconds: React.Dispatch<React.SetStateAction<number>>;
  sellMarkdown: number;
  setSellMarkdown: React.Dispatch<React.SetStateAction<number>>;
  failureFineRatio: number;
  setFailureFineRatio: React.Dispatch<React.SetStateAction<number>>;
  colourLoveMultiplier: number;
  setColourLoveMultiplier: React.Dispatch<React.SetStateAction<number>>;
  whiteLoveMultiplier: number;
  setWhiteLoveMultiplier: React.Dispatch<React.SetStateAction<number>>;
  standardTimeRatio: number;
  setStandardTimeRatio: React.Dispatch<React.SetStateAction<number>>;
  greedometer: number;
  setGreedometer: React.Dispatch<React.SetStateAction<number>>;
  forecastSpeed: number;
  setForecastSpeed: React.Dispatch<React.SetStateAction<number>>;
  stationSpeedMultipliers: StationSpeedMultipliers;
  setStationSpeedMultipliers: React.Dispatch<
    React.SetStateAction<StationSpeedMultipliers>
  >;
  shouldDeferIncomingSync?: boolean;
  isSyncPaused?: boolean;
  manualSyncNonce?: number;
}

export function useAmplifySharedGameState(
  bindings: AmplifySharedGameStateBindings,
): SyncStatus {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    state: "configuring",
    message: "Loading Amplify configuration",
  });
  const [isConfigured, setIsConfigured] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);

  const clientIdRef = useRef(crypto.randomUUID());
  const clientRef = useRef<ReturnType<typeof generateClient<Schema>> | null>(null);
  const initializedRef = useRef(false);
  const skipPersistRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistBlockedUntilRef = useRef(0);
  const lastFailedSerializedRef = useRef<string | null>(null);
  const deferredRemoteStateRef = useRef<{
    nextState: DeserializedSharedGameState;
    serialized: string | null;
  } | null>(null);
  const localChangesWhilePausedRef = useRef(false);
  const lastManualSyncNonceRef = useRef(0);
  const shouldDeferIncomingSyncRef = useRef(Boolean(bindings.shouldDeferIncomingSync));
  const isSyncPausedRef = useRef(Boolean(bindings.isSyncPaused));

  useEffect(() => {
    shouldDeferIncomingSyncRef.current = Boolean(bindings.shouldDeferIncomingSync);
    isSyncPausedRef.current = Boolean(bindings.isSyncPaused);
  }, [bindings.isSyncPaused, bindings.shouldDeferIncomingSync]);

  useEffect(() => {
    let cancelled = false;

    void configureAmplify().then((configured) => {
      if (cancelled) {
        return;
      }

      if (!configured) {
        setSyncStatus({
          state: "disabled",
          message: "Sync disabled until amplify_outputs.json exists",
        });
        return;
      }

      clientRef.current = generateClient<Schema>();
      setIsConfigured(true);
      setSyncStatus({
        state: "connecting",
        message: `Connecting to ${bindings.teamId}`,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [bindings.teamId]);

  useEffect(() => gameState.subscribe(() => setSyncVersion((value) => value + 1)), []);

  const applyLocalState = useEffectEvent(
    (
      nextState: DeserializedSharedGameState,
      options: { skipNextPersist: boolean; serialized: string | null },
    ) => {
      if (options.skipNextPersist) {
        skipPersistRef.current = options.serialized;
        lastSavedRef.current = options.serialized;
      } else {
        skipPersistRef.current = null;
        lastSavedRef.current = null;
      }

      gameState.setTeamId(nextState.teamId);
      gameState.setPaperColors(nextState.paperColors);
      gameState.setOccasions(nextState.occasions);
      gameState.setCurrentSchedule(nextState.currentSchedule);
      gameState.updateParameters(nextState.parameters);
      bindings.setOrders(nextState.orders);
      bindings.setPaperInventory(nextState.paperInventory);
      bindings.setTransactions(nextState.transactions);
      bindings.setCash(nextState.cash);
      bindings.setSafetyStock(nextState.parameters.safetyStock);
      bindings.setWorkstationSpeed(nextState.parameters.workstationSpeed);
      bindings.setBuyingCooldown(nextState.parameters.buyingCooldown);
      bindings.setPaperDeliverySeconds(nextState.parameters.paperDeliverySeconds);
      bindings.setSellMarkdown(nextState.parameters.sellMarkdown);
      bindings.setFailureFineRatio(nextState.parameters.failureFineRatio);
      bindings.setColourLoveMultiplier(nextState.parameters.colourLoveMultiplier);
      bindings.setWhiteLoveMultiplier(nextState.parameters.whiteLoveMultiplier);
      bindings.setStandardTimeRatio(nextState.parameters.standardTimeRatio);
      bindings.setGreedometer(nextState.parameters.greedometer);
      bindings.setForecastSpeed(nextState.parameters.forecastSpeed);
      bindings.setStationSpeedMultipliers(
        nextState.parameters.stationSpeedMultipliers,
      );

      initializedRef.current = true;
      setSyncStatus({
        state: "synced",
        message: `Connected to ${nextState.teamId}`,
      });
    },
  );

  const persistSnapshot = useEffectEvent(
    async (snapshot: SharedGameSnapshot, serialized: string) => {
      const sharedGameStateModel = clientRef.current?.models?.SharedGameState;
      if (!sharedGameStateModel) {
        setSyncStatus({
          state: "disabled",
          message: "Sync disabled: SharedGameState model unavailable",
        });
        return;
      }

      setSyncStatus({
        state: "syncing",
        message: `Syncing ${snapshot.teamId}`,
      });

      const existing = await sharedGameStateModel.get({
        teamId: snapshot.teamId,
      });

      const revision = (existing.data?.revision ?? 0) + 1;
      const payload = {
        teamId: snapshot.teamId,
        snapshot: JSON.stringify(snapshot),
        revision,
        schemaVersion: SHARED_GAME_SCHEMA_VERSION,
        updatedAtClient: new Date().toISOString(),
        updatedBy: navigator.userAgent,
        clientId: clientIdRef.current,
      };

      const result = existing.data
        ? await sharedGameStateModel.update(payload)
        : await sharedGameStateModel.create(payload);

      if (result.errors?.length) {
        throw new Error(result.errors.map((error) => error.message).join("; "));
      }

      lastSavedRef.current = serialized;
      persistBlockedUntilRef.current = 0;
      lastFailedSerializedRef.current = null;
      setSyncStatus({
        state: "synced",
        message: `Connected to ${snapshot.teamId}`,
      });
    },
  );

  const buildCurrentSnapshot = useEffectEvent(() => {
    const snapshot = buildSharedGameSnapshot({
      teamId: bindings.teamId,
      orders: bindings.orders,
      paperInventory: bindings.paperInventory,
      transactions: bindings.transactions,
      cash: bindings.cash,
      parameters: gameState.getParameters(),
      currentSchedule: gameState.getCurrentSchedule(),
      occasions: gameState.getOccasions(),
      paperColors: gameState.getPaperColors(),
    });

    return {
      snapshot,
      serialized: JSON.stringify(snapshot),
    };
  });

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const sharedGameStateModel = clientRef.current?.models?.SharedGameState;
    if (!sharedGameStateModel) {
      setSyncStatus({
        state: "disabled",
        message: "Sync disabled: SharedGameState model unavailable",
      });
      return;
    }

    initializedRef.current = false;
    skipPersistRef.current = null;
    lastSavedRef.current = null;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    let cancelled = false;

    const subscription = sharedGameStateModel.observeQuery({
      filter: {
        teamId: {
          eq: bindings.teamId,
        },
      },
    }).subscribe({
      next: ({ items, isSynced }) => {
        if (cancelled || !isSynced) {
          return;
        }

        const record = items[0];
        if (!record?.snapshot) {
          applyLocalState(createEmptySharedGameState(bindings.teamId), {
            skipNextPersist: false,
            serialized: null,
          });
          return;
        }

        const snapshot =
          typeof record.snapshot === "string"
            ? (JSON.parse(record.snapshot) as SharedGameSnapshot)
            : (record.snapshot as SharedGameSnapshot);
        const nextState = deserializeSharedGameSnapshot(snapshot);
        const serialized = JSON.stringify(
          buildSharedGameSnapshot({
            ...nextState,
            currentSchedule: nextState.currentSchedule,
          }),
        );

        if (shouldDeferIncomingSyncRef.current || isSyncPausedRef.current) {
          deferredRemoteStateRef.current = {
            nextState,
            serialized,
          };
          return;
        }

        applyLocalState(nextState, {
          skipNextPersist: true,
          serialized,
        });
      },
      error: (error) => {
        if (cancelled) {
          return;
        }

        console.error("Amplify live sync failed", error);
        setSyncStatus({
          state: "error",
          message: "Amplify live sync failed",
        });
      },
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [bindings.teamId, isConfigured]);

  useEffect(() => {
    if (bindings.shouldDeferIncomingSync || bindings.isSyncPaused) {
      return;
    }

    if (!deferredRemoteStateRef.current) {
      return;
    }

    const deferredState = deferredRemoteStateRef.current;
    deferredRemoteStateRef.current = null;

    if (localChangesWhilePausedRef.current) {
      localChangesWhilePausedRef.current = false;
      return;
    }

    applyLocalState(deferredState.nextState, {
      skipNextPersist: true,
      serialized: deferredState.serialized,
    });
  }, [applyLocalState, bindings.isSyncPaused, bindings.shouldDeferIncomingSync]);

  useEffect(() => {
    if (!bindings.isSyncPaused || !isConfigured) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    setSyncStatus({
      state: "paused",
      message: `Sync paused for ${bindings.teamId}`,
    });
  }, [bindings.isSyncPaused, bindings.teamId, isConfigured]);

  useEffect(() => {
    if (
      !bindings.isSyncPaused ||
      !isConfigured ||
      !initializedRef.current ||
      !bindings.manualSyncNonce ||
      bindings.manualSyncNonce === lastManualSyncNonceRef.current
    ) {
      return;
    }

    lastManualSyncNonceRef.current = bindings.manualSyncNonce;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    deferredRemoteStateRef.current = null;
    setSyncStatus({
      state: "syncing",
      message: `Forcing outbound changes for ${bindings.teamId}`,
    });

    const { snapshot, serialized } = buildCurrentSnapshot();

    void persistSnapshot(snapshot, serialized)
      .then(() => {
        skipPersistRef.current = serialized;
        lastSavedRef.current = serialized;
        localChangesWhilePausedRef.current = false;
        deferredRemoteStateRef.current = null;
        if (bindings.isSyncPaused) {
          const syncedAt = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          setSyncStatus({
            state: "paused",
            message: `Outbound changes synced at ${syncedAt}. Sync still paused for ${bindings.teamId}`,
          });
        }
      })
      .catch((error) => {
        console.error("Amplify manual sync failed", error);
        persistBlockedUntilRef.current = Date.now() + PERSIST_FAILURE_BACKOFF_MS;
        lastFailedSerializedRef.current = serialized;
        setSyncStatus({
          state: "error",
          message: "Manual sync failed",
        });
      });
  }, [
    bindings.isSyncPaused,
    bindings.manualSyncNonce,
    bindings.teamId,
    buildCurrentSnapshot,
    isConfigured,
    persistSnapshot,
  ]);

  useEffect(() => {
    if (!isConfigured || !initializedRef.current) {
      return;
    }

    const { snapshot, serialized } = buildCurrentSnapshot();

    if (bindings.isSyncPaused) {
      if (lastSavedRef.current !== serialized) {
        localChangesWhilePausedRef.current = true;
      }
      return;
    }

    if (skipPersistRef.current === serialized) {
      skipPersistRef.current = null;
      lastSavedRef.current = serialized;
      localChangesWhilePausedRef.current = false;
      return;
    }

    if (lastSavedRef.current === serialized) {
      localChangesWhilePausedRef.current = false;
      return;
    }

    const now = Date.now();
    if (
      persistBlockedUntilRef.current > now &&
      lastFailedSerializedRef.current === serialized
    ) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void persistSnapshot(snapshot, serialized).catch((error) => {
        console.error("Amplify sync save failed", error);
        persistBlockedUntilRef.current = Date.now() + PERSIST_FAILURE_BACKOFF_MS;
        lastFailedSerializedRef.current = serialized;
        setSyncStatus({
          state: "error",
          message: "Amplify sync save failed; retrying later",
        });
      });
      localChangesWhilePausedRef.current = false;
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    bindings.cash,
    bindings.buyingCooldown,
    bindings.colourLoveMultiplier,
    bindings.failureFineRatio,
    bindings.forecastSpeed,
    bindings.greedometer,
    bindings.isSyncPaused,
    bindings.orders,
    bindings.paperInventory,
    bindings.paperDeliverySeconds,
    bindings.safetyStock,
    bindings.sellMarkdown,
    bindings.stationSpeedMultipliers,
    bindings.standardTimeRatio,
    bindings.teamId,
    bindings.transactions,
    bindings.whiteLoveMultiplier,
    bindings.workstationSpeed,
    buildCurrentSnapshot,
    isConfigured,
    syncVersion,
  ]);

  return syncStatus;
}
