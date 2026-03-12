import React, { useEffect, useState } from 'react';
import type { Order } from '../utils/gameState';

interface ProductionScheduleProps {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  updateOrderField: (id: string, field: keyof Order, value: any) => void;
  currentTime?: number;
  isStationMode?: boolean;
  onOrderClick?: (orderId: string) => void;
  currentOrderId?: string | null;
}

interface OrderTimers {
  timeUntilDue: number;
  estimatedProgress: number;
  panicLevel: number;
  isLate: boolean;
  isOverdue: boolean;
}

export function ProductionSchedule({ 
  orders, 
  setOrders, 
  updateOrderField, 
  currentTime = Date.now(),
  isStationMode = false,
  onOrderClick,
  currentOrderId
}: ProductionScheduleProps) {
  const [now, setNow] = useState(currentTime);
  
  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Filter orders that are in production pipeline (not passive, deleted, or other)
  const productionOrders = orders.filter(order => 
    ['ordered', 'pending_inventory', 'WIP', 'sent', 'approved', 'failed'].includes(order.status)
  );

  const calculateTimers = (order: Order): OrderTimers => {
    const startTime = order.startTime || order.orderTime;
    const dueTime = order.dueTime || (order.orderTime + (order.leadTime * 60 * 1000)); // leadTime in minutes to ms
    
    const timeUntilDue = dueTime - now;
    const totalTime = dueTime - startTime;
    const elapsedTime = now - startTime;
    const estimatedProgress = totalTime > 0 ? (elapsedTime / totalTime) * 100 : 0;
    
    // Panic level calculation based on how early/late the order started
    // If we started late (less time than leadTime), panic increases
    const idealStartTime = order.orderTime; // Ideal is to start immediately when order placed
    const startDelay = startTime - idealStartTime;
    const panicLevel = startDelay > 0 ? Math.min((startDelay / (24 * 60 * 60 * 1000)) * 20, 100) : 0;
    
    const isLate = estimatedProgress > 100 && order.status === 'WIP';
    const isOverdue = timeUntilDue < 0;
    
    return {
      timeUntilDue,
      estimatedProgress: Math.min(estimatedProgress, 100),
      panicLevel,
      isLate,
      isOverdue
    };
  };

  const getStatusColor = (order: Order, timers: OrderTimers): string => {
    if (order.status === 'failed' || order.status === 'deleted') {
      return 'bg-black text-white';
    }
    
    if (order.status === 'approved') {
      return 'bg-green-100 text-green-800';
    }
    
    if (order.status === 'sent') {
      return 'bg-blue-100 text-blue-800';
    }
    
    if (timers.isLate || timers.isOverdue) {
      return 'bg-red-100 text-red-800 animate-pulse';
    }
    
    if (order.status === 'WIP') {
      return 'bg-yellow-100 text-yellow-800';
    }
    
    if (order.status === 'pending_inventory') {
      return 'bg-orange-100 text-orange-800';
    }
    
    // Not started yet (ordered)
    return 'bg-gray-100 text-gray-600';
  };

  const formatTime = (ms: number): string => {
    const absMs = Math.abs(ms);
    const hours = Math.floor(absMs / (1000 * 60 * 60));
    const minutes = Math.floor((absMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((absMs % (1000 * 60)) / 1000);
    
    const prefix = ms < 0 ? '-' : '';
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${prefix}${days}d ${remainingHours}h`;
    }
    
    return `${prefix}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const getPanicEmoji = (level: number): string => {
    if (level > 80) return '🚨';
    if (level > 60) return '😰';
    if (level > 40) return '😟';
    if (level > 20) return '😐';
    return '😌';
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-700">Production Schedule</h3>
      
      {productionOrders.length === 0 ? (
        <div className="text-gray-500 italic p-2 bg-gray-50 rounded text-xs">
          No orders in production pipeline
        </div>
      ) : (
        <div className="space-y-1">
          {productionOrders.map(order => {
            const timers = calculateTimers(order);
            const statusColor = getStatusColor(order, timers);
            
            const isCurrentOrder = currentOrderId === order.id;
            
            return (
              <div
                key={order.id}
                className={`p-2 rounded border ${statusColor} transition-all duration-300 ${
                  isStationMode ? 'cursor-pointer hover:shadow-lg' : ''
                } ${isCurrentOrder ? 'ring-2 ring-blue-500 shadow-lg' : ''}`}
                onClick={() => isStationMode && onOrderClick && onOrderClick(order.id)}
              >
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <span className="font-mono text-xs opacity-60">{order.id.slice(-6)}</span>
                    <div className="text-xs font-semibold">
                      {order.quantity}x {order.occasion || 'Cards'}
                    </div>
                    <div className="text-xs">
                      {order.status} • {order.size}
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="text-xs font-bold">
                      £{(order.price * order.quantity).toFixed(2)}
                    </div>
                    <div className={`text-xs ${order.paperColor.cssClass} px-1 py-0.5 rounded inline-block`}>
                      {order.paperColor.name}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1 mt-1 pt-1 border-t border-current border-opacity-20">
                  <div>
                    <div className="text-xs opacity-60">Start</div>
                    <input
                      type="datetime-local"
                      value={order.startTime ? new Date(order.startTime).toISOString().slice(0, 16) : ''}
                      onChange={(e) => {
                        const newStartTime = new Date(e.target.value).getTime();
                        updateOrderField(order.id, 'startTime', newStartTime);
                        if (order.leadTime > 0) {
                          updateOrderField(order.id, 'dueTime', order.orderTime + (order.leadTime * 60 * 1000)); // Due time based on original order time
                        }
                      }}
                      className="text-xs px-1 py-0.5 border rounded bg-white bg-opacity-50 w-full"
                    />
                  </div>
                  
                  <div>
                    <div className="text-xs opacity-60">Due</div>
                    <div className={`font-mono text-xs ${timers.isOverdue ? 'text-red-600 font-bold' : ''}`}>
                      {formatTime(timers.timeUntilDue)}
                      {timers.isOverdue && ' OVR'}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs opacity-60">Progress</div>
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-gray-200 rounded-full h-1">
                        <div 
                          className={`h-1 rounded-full transition-all duration-500 ${
                            timers.isLate ? 'bg-red-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${Math.min(timers.estimatedProgress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono">
                        {timers.estimatedProgress.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs opacity-60">Panic</div>
                    <div className="flex items-center gap-0.5">
                      <span className="text-sm">{getPanicEmoji(timers.panicLevel)}</span>
                      <span className="text-xs font-mono">{timers.panicLevel.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>

                {timers.isLate && order.status === 'WIP' && (
                  <div className="mt-1 p-1 bg-red-200 text-red-800 rounded text-xs font-medium animate-pulse">
                    ⚠️ Behind schedule!
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}