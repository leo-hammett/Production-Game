import { GameState, gameState } from './gameState';
import { StationManager } from './station';

// Types for network messages
interface SyncMessage {
  type: 'state_update' | 'full_sync' | 'request_sync' | 'connection' | 'heartbeat';
  teamId: string;
  timestamp: number;
  data?: Partial<SerializableGameState>;
  clientId?: string;
  changes?: StateChange[];
}

interface StateChange {
  path: string;
  value: any;
  timestamp: number;
}

// Serializable version of GameState (excludes class instances)
interface SerializableGameState {
  orders: any[];
  paperInventory: any;
  transactions: any[];
  cash: number;
  parameters: any;
  currentSchedule: any;
  teamId: string;
  occasions: string[];
  paperColors: any[];
  stationManagerData?: any; // Serialized station manager
}

// Configuration for sync behavior
interface SyncConfig {
  serverUrl: string;
  reconnectInterval: number;
  debounceDelay: number;
  heartbeatInterval: number;
  maxReconnectAttempts: number;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

class NetworkSyncManager {
  private static instance: NetworkSyncManager;
  private ws: WebSocket | null = null;
  private config: SyncConfig;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: StateChange[] = [];
  private clientId: string;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private isProcessingRemoteUpdate = false;
  private lastSyncTimestamp = 0;
  private unsubscribeGameState: (() => void) | null = null;

  private constructor() {
    // Generate unique client ID
    this.clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Default configuration
    this.config = {
      serverUrl: this.getServerUrl(),
      reconnectInterval: 3000,
      debounceDelay: 100, // 100ms debounce
      heartbeatInterval: 30000, // 30 seconds
      maxReconnectAttempts: 10
    };
  }

  static getInstance(): NetworkSyncManager {
    if (!NetworkSyncManager.instance) {
      NetworkSyncManager.instance = new NetworkSyncManager();
    }
    return NetworkSyncManager.instance;
  }

  // Get server URL from environment or use default
  private getServerUrl(): string {
    // Check if we're in development or production
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1';
    
    if (isDev) {
      return 'ws://localhost:8080';
    } else {
      // Production WebSocket server URL
      // This should be configured based on your backend deployment
      return `wss://${window.location.hostname}/ws`;
    }
  }

  // Initialize connection and start syncing
  connect(teamId?: string): void {
    if (teamId) {
      gameState.setTeamId(teamId);
    }

    // Subscribe to game state changes
    if (!this.unsubscribeGameState) {
      this.unsubscribeGameState = gameState.subscribe(() => {
        this.handleLocalStateChange();
      });
    }

    this.establishConnection();
  }

  // Establish WebSocket connection
  private establishConnection(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.setConnectionStatus('connecting');
    
    try {
      this.ws = new WebSocket(this.config.serverUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        
        // Send initial connection message
        this.sendMessage({
          type: 'connection',
          teamId: gameState.getTeamId(),
          clientId: this.clientId,
          timestamp: Date.now()
        });
        
        // Request full sync
        this.requestFullSync();
        
        // Start heartbeat
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: SyncMessage = JSON.parse(event.data);
          this.handleRemoteMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.setConnectionStatus('error');
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.setConnectionStatus('disconnected');
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.setConnectionStatus('error');
      this.scheduleReconnect();
    }
  }

  // Handle incoming messages from server
  private handleRemoteMessage(message: SyncMessage): void {
    // Ignore our own messages
    if (message.clientId === this.clientId) {
      return;
    }

    // Only process messages for our team
    if (message.teamId !== gameState.getTeamId()) {
      return;
    }

    this.isProcessingRemoteUpdate = true;

    switch (message.type) {
      case 'full_sync':
        if (message.data) {
          this.applyFullSync(message.data);
        }
        break;
      
      case 'state_update':
        if (message.changes) {
          this.applyStateChanges(message.changes);
        }
        break;
      
      case 'request_sync':
        // Another client is requesting full sync
        if (this.lastSyncTimestamp > message.timestamp) {
          this.sendFullState();
        }
        break;
      
      case 'heartbeat':
        // Server heartbeat response
        break;
    }

    this.isProcessingRemoteUpdate = false;
    this.lastSyncTimestamp = message.timestamp;
  }

  // Apply full state sync from server
  private applyFullSync(data: Partial<SerializableGameState>): void {
    if (data.orders !== undefined) {
      gameState.setOrders(data.orders);
    }
    if (data.paperInventory !== undefined) {
      gameState.setPaperInventory(data.paperInventory);
    }
    if (data.transactions !== undefined) {
      gameState.setTransactions(data.transactions);
    }
    if (data.cash !== undefined) {
      gameState.setCash(data.cash);
    }
    if (data.parameters !== undefined) {
      gameState.updateParameters(data.parameters);
    }
    if (data.currentSchedule !== undefined) {
      gameState.setCurrentSchedule(data.currentSchedule);
    }
    if (data.occasions !== undefined) {
      // Update occasions array
      const currentOccasions = gameState.getOccasions();
      currentOccasions.length = 0;
      currentOccasions.push(...data.occasions);
    }
    if (data.stationManagerData !== undefined) {
      // Reconstruct station manager from serialized data
      this.deserializeStationManager(data.stationManagerData);
    }
  }

  // Apply incremental state changes
  private applyStateChanges(changes: StateChange[]): void {
    changes.forEach(change => {
      const pathParts = change.path.split('.');
      this.applyChange(pathParts, change.value);
    });
  }

  // Apply a single change to the state
  private applyChange(path: string[], value: any): void {
    const [root, ...rest] = path;
    
    switch (root) {
      case 'orders':
        if (rest.length === 0) {
          gameState.setOrders(value);
        } else if (rest.length === 1) {
          const orders = gameState.getOrders();
          const index = parseInt(rest[0]);
          if (!isNaN(index) && index >= 0 && index < orders.length) {
            orders[index] = value;
            gameState.setOrders([...orders]);
          }
        }
        break;
      
      case 'paperInventory':
        if (rest.length === 0) {
          gameState.setPaperInventory(value);
        } else if (rest.length === 1) {
          gameState.updateInventory(rest[0], value);
        }
        break;
      
      case 'cash':
        gameState.setCash(value);
        break;
      
      case 'parameters':
        if (rest.length === 0) {
          gameState.updateParameters(value);
        } else {
          const param = { [rest[0]]: value };
          gameState.updateParameters(param);
        }
        break;
      
      case 'transactions':
        if (rest.length === 0) {
          gameState.setTransactions(value);
        }
        break;
    }
  }

  // Handle local state changes
  private handleLocalStateChange(): void {
    // Don't sync if we're processing a remote update
    if (this.isProcessingRemoteUpdate) {
      return;
    }

    // Debounce state changes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.syncLocalChanges();
    }, this.config.debounceDelay);
  }

  // Sync local changes to server
  private syncLocalChanges(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    // For now, send full state on every change
    // In a production system, you'd want to track specific changes
    this.sendFullState();
  }

  // Send full state to server
  private sendFullState(): void {
    const state = this.serializeGameState();
    
    this.sendMessage({
      type: 'full_sync',
      teamId: gameState.getTeamId(),
      clientId: this.clientId,
      timestamp: Date.now(),
      data: state
    });
  }

  // Request full sync from server
  private requestFullSync(): void {
    this.sendMessage({
      type: 'request_sync',
      teamId: gameState.getTeamId(),
      clientId: this.clientId,
      timestamp: Date.now()
    });
  }

  // Serialize game state for network transmission
  private serializeGameState(): SerializableGameState {
    const state = gameState.getState();
    
    return {
      orders: state.orders,
      paperInventory: state.paperInventory,
      transactions: state.transactions,
      cash: state.cash,
      parameters: state.parameters,
      currentSchedule: {
        name: state.currentSchedule.name,
        orderIds: state.currentSchedule.orderIds
      },
      teamId: state.teamId,
      occasions: state.occasions,
      paperColors: state.paperColors.map(color => ({
        code: color.code,
        name: color.name,
        cssClass: color.cssClass,
        basePrice: color.basePrice
      })),
      stationManagerData: this.serializeStationManager(state.stationManager)
    };
  }

  // Serialize StationManager
  private serializeStationManager(manager: StationManager): any {
    // This needs to be implemented based on StationManager structure
    // For now, return a placeholder
    return {
      stations: []
    };
  }

  // Deserialize StationManager
  private deserializeStationManager(data: any): void {
    // This needs to be implemented based on StationManager structure
    // For now, just create a new instance
    // gameState.getStationManager().loadFromData(data);
  }

  // Send message to server
  private sendMessage(message: SyncMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // Connection status management
  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.statusListeners.forEach(listener => listener(status));
  }

  // Subscribe to connection status changes
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  // Get current connection status
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  // Heartbeat management
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage({
        type: 'heartbeat',
        teamId: gameState.getTeamId(),
        clientId: this.clientId,
        timestamp: Date.now()
      });
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Reconnection logic
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnect attempt ${this.reconnectAttempts}`);
      this.establishConnection();
    }, delay);
  }

  // Disconnect and cleanup
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.unsubscribeGameState) {
      this.unsubscribeGameState();
      this.unsubscribeGameState = null;
    }

    this.setConnectionStatus('disconnected');
  }

  // Update configuration
  updateConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Force sync now (bypasses debouncing)
  forceSyncNow(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.syncLocalChanges();
  }
}

// Export singleton instance
export const networkSync = NetworkSyncManager.getInstance();

// React hook for connection status
export function useConnectionStatus() {
  // This would be implemented with React state management
  // For now, just return the current status
  return networkSync.getConnectionStatus();
}