import React, { useEffect, useState } from 'react';
import type { Order } from '../utils/gameState';

interface ProductionScheduleProps {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  updateOrderField: (id: string, field: keyof Order, value: any) => void;
  currentTime?: number;
}

interface OrderTimers {
  timeUntilDue: number;
  estimatedProgress: number;
  panicLevel: number;
  isLate: boolean;
  isOverdue: boolean;
}

export function ProductionSchedule({ orders, setOrders, updateOrderField, currentTime = Date.now() }: ProductionScheduleProps) {
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
    const dueTime = order.dueTime || (startTime + (order.leadTime * 24 * 60 * 60 * 1000)); // Convert days to ms
    
    const timeUntilDue = dueTime - now;
    const totalTime = dueTime - startTime;
    const elapsedTime = now - startTime;
    const estimatedProgress = totalTime > 0 ? (elapsedTime / totalTime) * 100 : 0;
    
    // Panic level calculation based on how early/late the order started
    // If we started late (less time than leadTime), panic increases
    const idealStartTime = dueTime - (order.leadTime * 24 * 60 * 60 * 1000);
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
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-800">Production Schedule</h2>
      
      {productionOrders.length === 0 ? (
        <div className="text-gray-500 italic p-4 bg-gray-50 rounded">
          No orders in production pipeline
        </div>
      ) : (
        <div className="space-y-2">
          {productionOrders.map(order => {
            const timers = calculateTimers(order);
            const statusColor = getStatusColor(order, timers);
            
            return (
              <div
                key={order.id}
                className={`p-4 rounded-lg border ${statusColor} transition-all duration-300`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-mono text-xs opacity-60">ID: {order.id}</span>
                    <h3 className="font-semibold">
                      {order.quantity}x {order.occasion || 'Cards'} - {order.size}
                    </h3>
                    <div className="text-sm">
                      Status: <span className="font-medium">{order.status}</span>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="text-lg font-bold">
                      £{(order.price * order.quantity).toFixed(2)}
                    </div>
                    <div className={`text-sm ${order.paperColor.cssClass} px-2 py-1 rounded inline-block`}>
                      {order.paperColor.name}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-3 border-t border-current border-opacity-20">
                  <div>
                    <div className="text-xs opacity-60">Start Time</div>
                    <input
                      type="datetime-local"
                      value={order.startTime ? new Date(order.startTime).toISOString().slice(0, 16) : ''}
                      onChange={(e) => {
                        const newStartTime = new Date(e.target.value).getTime();
                        updateOrderField(order.id, 'startTime', newStartTime);
                        if (order.leadTime > 0) {
                          updateOrderField(order.id, 'dueTime', newStartTime + (order.leadTime * 24 * 60 * 60 * 1000));
                        }
                      }}
                      className="text-xs px-1 py-0.5 border rounded bg-white bg-opacity-50"
                    />
                  </div>
                  
                  <div>
                    <div className="text-xs opacity-60">Time Until Due</div>
                    <div className={`font-mono text-sm ${timers.isOverdue ? 'text-red-600 font-bold' : ''}`}>
                      {formatTime(timers.timeUntilDue)}
                      {timers.isOverdue && ' OVERDUE'}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs opacity-60">Progress</div>
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
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
                    <div className="text-xs opacity-60">Panic Level</div>
                    <div className="flex items-center gap-1">
                      <span className="text-lg">{getPanicEmoji(timers.panicLevel)}</span>
                      <span className="text-sm font-mono">{timers.panicLevel.toFixed(0)}%</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs opacity-60">Lead Time</div>
                    <div className="text-sm">
                      {order.leadTime === -1 ? '∞' : `${order.leadTime} days`}
                    </div>
                  </div>
                </div>

                {timers.isLate && order.status === 'WIP' && (
                  <div className="mt-2 p-2 bg-red-200 text-red-800 rounded text-sm font-medium animate-pulse">
                    ⚠️ Order is behind schedule - Expected completion passed!
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