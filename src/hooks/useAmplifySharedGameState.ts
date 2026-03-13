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

function areSerializedSnapshotsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeScalarValue<T>(base: T, local: T, remote: T): T {
  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return local;
  }

  if (JSON.stringify(base) === JSON.stringify(local)) {
    return remote;
  }

  if (JSON.stringify(base) === JSON.stringify(remote)) {
    return local;
  }

  return local;
}

function mergeArrayById<
  T extends {
    [key: string]: unknown;
  },
>(
  idKey: keyof T,
  baseItems: T[],
  localItems: T[],
  remoteItems: T[],
): T[] {
  const baseMap = new Map(baseItems.map((item) => [String(item[idKey]), item]));
  const localMap = new Map(localItems.map((item) => [String(item[idKey]), item]));
  const remoteMap = new Map(remoteItems.map((item) => [String(item[idKey]), item]));
  const orderedIds = Array.from(
    new Set([
      ...remoteItems.map((item) => String(item[idKey])),
      ...localItems.map((item) => String(item[idKey])),
      ...baseItems.map((item) => String(item[idKey])),
    ]),
  );

  return orderedIds.flatMap((id) => {
    const baseItem = baseMap.get(id);
    const localItem = localMap.get(id);
    const remoteItem = remoteMap.get(id);

    if (!baseItem) {
      if (localItem && remoteItem) {
        return [mergeUnknown(baseItem, localItem, remoteItem) as T];
      }
      return localItem ? [localItem] : remoteItem ? [remoteItem] : [];
    }

    if (!localItem && !remoteItem) {
      return [];
    }

    if (!localItem) {
      return JSON.stringify(baseItem) === JSON.stringify(remoteItem)
        ? []
        : remoteItem
          ? [remoteItem]
          : [];
    }

    if (!remoteItem) {
      return JSON.stringify(baseItem) === JSON.stringify(localItem)
        ? []
        : [localItem];
    }

    return [mergeUnknown(baseItem, localItem, remoteItem) as T];
  });
}

function mergeUnknown(base: unknown, local: unknown, remote: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const localFirstItem = local[0];
    const remoteFirstItem = remote[0];
    const baseFirstItem = base[0];

    if (
      isPlainRecord(localFirstItem) &&
      isPlainRecord(remoteFirstItem) &&
      isPlainRecord(baseFirstItem)
    ) {
      if ("id" in localFirstItem && "id" in remoteFirstItem && "id" in baseFirstItem) {
        return mergeArrayById(
          "id",
          base as Array<Record<string, unknown>>,
          local as Array<Record<string, unknown>>,
          remote as Array<Record<string, unknown>>,
        );
      }

      if (
        "code" in localFirstItem &&
        "code" in remoteFirstItem &&
        "code" in baseFirstItem
      ) {
        return mergeArrayById(
          "code",
          base as Array<Record<string, unknown>>,
          local as Array<Record<string, unknown>>,
          remote as Array<Record<string, unknown>>,
        );
      }
    }

    return mergeScalarValue(base, local, remote);
  }

  if (isPlainRecord(base) && isPlainRecord(local) && isPlainRecord(remote)) {
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    const merged: Record<string, unknown> = {};

    keys.forEach((key) => {
      const baseValue = base[key];
      const localValue = local[key];
      const remoteValue = remote[key];

      if (
        baseValue !== undefined &&
        localValue !== undefined &&
        remoteValue !== undefined
      ) {
        merged[key] = mergeUnknown(baseValue, localValue, remoteValue);
        return;
      }

      if (baseValue === undefined) {
        merged[key] = localValue ?? remoteValue;
        return;
      }

      if (localValue === undefined && remoteValue === undefined) {
        return;
      }

      if (localValue === undefined) {
        if (JSON.stringify(baseValue) !== JSON.stringify(remoteValue)) {
          merged[key] = remoteValue;
        }
        return;
      }

      if (remoteValue === undefined) {
        if (JSON.stringify(baseValue) !== JSON.stringify(localValue)) {
          merged[key] = localValue;
        }
        return;
      }
    });

    return merged;
  }

  return mergeScalarValue(base, local, remote);
}

function mergeSharedSnapshots(
  baseSnapshot: SharedGameSnapshot | null,
  localSnapshot: SharedGameSnapshot,
  remoteSnapshot: SharedGameSnapshot | null,
): SharedGameSnapshot {
  if (!baseSnapshot) {
    return remoteSnapshot ?? localSnapshot;
  }

  if (!remoteSnapshot) {
    return localSnapshot;
  }

  return JSON.parse(
    JSON.stringify(mergeUnknown(baseSnapshot, localSnapshot, remoteSnapshot)),
  ) as SharedGameSnapshot;
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
  const lastObservedRemoteRevisionRef = useRef(0);
  const lastObservedRemoteSerializedRef = useRef<string | null>(null);
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
      const existingSerialized =
        typeof existing.data?.snapshot === "string"
          ? existing.data.snapshot
          : existing.data?.snapshot
            ? JSON.stringify(existing.data.snapshot)
            : null;
      const existingRevision = existing.data?.revision ?? 0;
      const baseSnapshot = lastSavedRef.current
        ? (JSON.parse(lastSavedRef.current) as SharedGameSnapshot)
        : null;
      const remoteSnapshot = existingSerialized
        ? (JSON.parse(existingSerialized) as SharedGameSnapshot)
        : null;

      if (existingSerialized === serialized) {
        lastSavedRef.current = serialized;
        lastObservedRemoteRevisionRef.current = existingRevision;
        lastObservedRemoteSerializedRef.current = serialized;
        persistBlockedUntilRef.current = 0;
        lastFailedSerializedRef.current = null;
        setSyncStatus({
          state: bindings.isSyncPaused ? "paused" : "synced",
          message: bindings.isSyncPaused
            ? `Outbound changes already synced for ${snapshot.teamId}`
            : `Connected to ${snapshot.teamId}`,
        });
        return;
      }

      if (existingRevision !== lastObservedRemoteRevisionRef.current) {
        if (!remoteSnapshot) {
          throw new Error("Remote state changed since last sync.");
        }

        const mergedSnapshot = mergeSharedSnapshots(
          baseSnapshot,
          snapshot,
          remoteSnapshot,
        );
        const mergedSerialized = JSON.stringify(mergedSnapshot);

        if (existingSerialized === mergedSerialized) {
          lastSavedRef.current = mergedSerialized;
          lastObservedRemoteRevisionRef.current = existingRevision;
          lastObservedRemoteSerializedRef.current = mergedSerialized;
          if (!areSerializedSnapshotsEqual(serialized, mergedSerialized)) {
            applyLocalState(deserializeSharedGameSnapshot(mergedSnapshot), {
              skipNextPersist: true,
              serialized: mergedSerialized,
            });
          }
          return;
        }

        if (!areSerializedSnapshotsEqual(serialized, mergedSerialized)) {
          applyLocalState(deserializeSharedGameSnapshot(mergedSnapshot), {
            skipNextPersist: false,
            serialized: null,
          });
          return;
        }
      }

      const revision = existingRevision + 1;
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
      lastObservedRemoteRevisionRef.current = revision;
      lastObservedRemoteSerializedRef.current = serialized;
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

  const applyMergedSnapshot = useEffectEvent(
    (
      baseSerialized: string | null,
      localSnapshot: SharedGameSnapshot,
      remoteSnapshot: SharedGameSnapshot,
    ) => {
      const mergedSnapshot = mergeSharedSnapshots(
        baseSerialized ? (JSON.parse(baseSerialized) as SharedGameSnapshot) : null,
        localSnapshot,
        remoteSnapshot,
      );
      const mergedSerialized = JSON.stringify(mergedSnapshot);
      const remoteSerialized = JSON.stringify(remoteSnapshot);

      applyLocalState(deserializeSharedGameSnapshot(mergedSnapshot), {
        skipNextPersist: areSerializedSnapshotsEqual(
          mergedSerialized,
          remoteSerialized,
        ),
        serialized: areSerializedSnapshotsEqual(mergedSerialized, remoteSerialized)
          ? mergedSerialized
          : null,
      });
    },
  );

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
          lastObservedRemoteRevisionRef.current = 0;
          lastObservedRemoteSerializedRef.current = null;
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
        lastObservedRemoteRevisionRef.current = record.revision ?? 0;
        lastObservedRemoteSerializedRef.current = serialized;

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
      const { snapshot: localSnapshot } = buildCurrentSnapshot();
      const remoteSnapshot = deferredState.serialized
        ? (JSON.parse(deferredState.serialized) as SharedGameSnapshot)
        : null;
      localChangesWhilePausedRef.current = false;
      if (remoteSnapshot) {
        applyMergedSnapshot(lastSavedRef.current, localSnapshot, remoteSnapshot);
      }
      return;
    }

    applyLocalState(deferredState.nextState, {
      skipNextPersist: true,
      serialized: deferredState.serialized,
    });
  }, [
    applyLocalState,
    applyMergedSnapshot,
    bindings.isSyncPaused,
    bindings.shouldDeferIncomingSync,
    buildCurrentSnapshot,
  ]);

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
    const { snapshot, serialized } = buildCurrentSnapshot();

    if (lastSavedRef.current === serialized) {
      localChangesWhilePausedRef.current = false;
      setSyncStatus({
        state: "paused",
        message: `No local changes to send. Sync still paused for ${bindings.teamId}`,
      });
      return;
    }

    setSyncStatus({
      state: "syncing",
      message: `Forcing outbound changes for ${bindings.teamId}`,
    });

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
          state: bindings.isSyncPaused ? "paused" : "error",
          message:
            error instanceof Error ? error.message : "Manual sync failed",
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
          message:
            error instanceof Error
              ? error.message
              : "Amplify sync save failed; retrying later",
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
