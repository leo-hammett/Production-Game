import { useState, useEffect, useRef } from "react";
import { ProductionSchedule } from "./ProductionSchedule";
import type { Order } from "../utils/gameState";

interface StationViewProps {
  stationNumber: number;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  updateOrderField: (id: string, field: keyof Order, value: any) => void;
  currentTime: number;
}

export function StationView({ 
  stationNumber, 
  orders, 
  setOrders, 
  updateOrderField,
  currentTime 
}: StationViewProps) {
  // Resizable panes state
  const [leftPaneWidth, setLeftPaneWidth] = useState(70); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  // Handle pane resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = (e.clientX / window.innerWidth) * 100;
      if (newWidth >= 20 && newWidth <= 80) {
        setLeftPaneWidth(newWidth);
      }
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  return (
    <div className="flex relative h-full">
      {/* Left Pane - Station Controls */}
      <div
        className="bg-white border-r border-gray-300"
        style={{ width: `${leftPaneWidth}%` }}
      >
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">
              Station {stationNumber}
            </h2>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">
                Online
              </span>
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                Speed: 1.0x
              </span>
            </div>
          </div>

          {/* Station Status Section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Station Status</h3>
            <div className="bg-gray-50 rounded p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Current Job:</span>
                <span className="font-medium">Order #4567</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Progress:</span>
                <span className="font-medium">45%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Time Remaining:</span>
                <span className="font-medium">2:34</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '45%' }}></div>
              </div>
            </div>
          </div>

          {/* Queue Section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Job Queue</h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {orders
                  .filter(order => order.status === "WIP" || order.status === "pending_inventory")
                  .slice(0, 5)
                  .map((order, index) => (
                    <div
                      key={order.id}
                      className="flex justify-between items-center p-2 bg-white rounded border hover:border-blue-400 cursor-pointer"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium">Order #{order.id.slice(-6)}</div>
                        <div className="text-xs text-gray-500">
                          {order.quantity}x {order.size} - {order.occasion}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Priority</div>
                        <div className="text-sm font-medium">{index + 1}</div>
                      </div>
                    </div>
                  ))}
                {orders.filter(order => order.status === "WIP" || order.status === "pending_inventory").length === 0 && (
                  <div className="text-sm text-gray-500 text-center py-4">
                    No jobs in queue
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls Section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Station Controls</h3>
            <div className="grid grid-cols-2 gap-2">
              <button className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium">
                Start Job
              </button>
              <button className="px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm font-medium">
                Pause Station
              </button>
              <button className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium">
                Priority Override
              </button>
              <button className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium">
                Emergency Stop
              </button>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Performance Metrics</h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Uptime:</span>
                  <span className="ml-2 font-medium">98.5%</span>
                </div>
                <div>
                  <span className="text-gray-600">Efficiency:</span>
                  <span className="ml-2 font-medium">87%</span>
                </div>
                <div>
                  <span className="text-gray-600">Jobs/Hour:</span>
                  <span className="ml-2 font-medium">12</span>
                </div>
                <div>
                  <span className="text-gray-600">Errors:</span>
                  <span className="ml-2 font-medium text-red-600">2</span>
                </div>
              </div>
            </div>
          </div>

          {/* Speed Control */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Speed Override</h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  defaultValue="1"
                  className="flex-1"
                />
                <span className="text-sm font-mono w-12">1.0x</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.1x</span>
                <span>Normal</span>
                <span>3.0x</span>
              </div>
            </div>
          </div>

          {/* Material Status */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Material Status</h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Paper Stock:</span>
                  <span className="font-medium text-green-600">Sufficient</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Ink Levels:</span>
                  <span className="font-medium text-yellow-600">Low</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Maintenance Due:</span>
                  <span className="font-medium">In 24 hrs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Draggable Divider */}
      <div
        ref={dividerRef}
        className="w-1 bg-gray-400 hover:bg-gray-500 cursor-col-resize transition-colors"
        onMouseDown={() => setIsDragging(true)}
      />

      {/* Right Pane - Production Schedule */}
      <div
        className="bg-gray-50 flex-1 relative overflow-y-auto"
        style={{ width: `${100 - leftPaneWidth}%` }}
      >
        <div className="p-2">
          <div className="max-w-2xl mx-auto">
            <ProductionSchedule 
              orders={orders} 
              setOrders={setOrders}
              updateOrderField={updateOrderField}
              currentTime={currentTime}
            />
          </div>
        </div>
      </div>
    </div>
  );
}