import { useState, useEffect, useRef } from "react";
import { ProductionSchedule } from "./ProductionSchedule";
import type { Order } from "../utils/gameState";
import { getVerseText } from "../utils/verses";
import { getScheduledProductionOrders } from "../utils/orders";
import type { StationSpeedMultipliers } from "../utils/station";

interface StationViewProps {
  stationNumber: number;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  updateOrderField: (id: string, field: keyof Order, value: any) => void;
  scheduleOrderIds: string[];
  currentTime: number;
  stationSpeedMultipliers: StationSpeedMultipliers;
  updateStationSpeedMultiplier: (
    stationKey: keyof StationSpeedMultipliers,
    nextValue: number,
  ) => void;
}

export function StationView({ 
  stationNumber, 
  orders, 
  setOrders, 
  updateOrderField,
  scheduleOrderIds,
  currentTime,
  stationSpeedMultipliers,
  updateStationSpeedMultiplier,
}: StationViewProps) {
  const stationKey = `station${stationNumber}` as keyof StationSpeedMultipliers;
  const requiredProgress = stationNumber;
  // Current order being worked on by this station
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const scheduledOrders = getScheduledProductionOrders(orders, scheduleOrderIds);
  const stationQueue = scheduledOrders.filter(
    (order) =>
      order.progress === requiredProgress &&
      order.status !== "pending_inventory" &&
      order.status !== "sent" &&
      order.status !== "approved" &&
      order.status !== "failed",
  );
  const stationQueueKey = stationQueue.map((order) => order.id).join("|");

  useEffect(() => {
    setCurrentOrderId((currentSelection) => {
      if (!stationQueue.length) {
        return null;
      }

      if (
        currentSelection &&
        stationQueue.some((order) => order.id === currentSelection)
      ) {
        return currentSelection;
      }

      return stationQueue[0].id;
    });
  }, [stationQueueKey]);

  const currentOrder = orders.find(o => o.id === currentOrderId);
  const stationSpeed = stationSpeedMultipliers[stationKey] ?? 1;
  const displayedVerse = currentOrder
    ? currentOrder.selectedVerse ||
      getVerseText(currentOrder.occasion, currentOrder.verseSize)
    : undefined;
  const progressPercent =
    currentOrder && currentOrder.progress > 0
      ? Math.min((currentOrder.progress / 3) * 100, 100)
      : 0;

  const handleStartJob = () => {
    if (!currentOrder) {
      return;
    }

    if (currentOrder.status !== "WIP") {
      updateOrderField(currentOrder.id, "status", "WIP");
    }
  };

  const handleCompleteStage = () => {
    if (!currentOrder) {
      return;
    }

    if (stationNumber === 3) {
      updateOrderField(currentOrder.id, "status", "sent");
      updateOrderField(currentOrder.id, "progress", 3);
      return;
    }

    updateOrderField(currentOrder.id, "progress", currentOrder.progress + 1);
    updateOrderField(currentOrder.id, "status", "ordered");
  };
  
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
            <h2 className={`text-xl font-bold ${
              stationNumber === 1 ? "text-blue-800" :
              stationNumber === 2 ? "text-green-800" :
              "text-purple-800"
            }`}>
              Station {stationNumber}
            </h2>
            <div className="flex gap-2">
              <span className={`px-2 py-1 rounded text-sm font-medium ${
                stationNumber === 1 ? "bg-blue-100 text-blue-700" :
                stationNumber === 2 ? "bg-green-100 text-green-700" :
                "bg-purple-100 text-purple-700"
              }`}>
                Online
              </span>
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                Speed: {stationSpeed.toFixed(2)}x
              </span>
            </div>
          </div>

          {/* Station Status Section */}
          <div className="mb-6">
            <h3 className="text-lg font-bold text-gray-700 mb-3">Current Job</h3>
            <div className="bg-gray-50 rounded p-4 space-y-3">
              {currentOrder ? (
                <>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Order ID:</span>
                    <span className="font-bold text-lg">#{currentOrder.id.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Quantity:</span>
                    <span className="font-bold text-lg">{currentOrder.quantity} cards</span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Sheet Size:</span>
                    <span className="font-bold text-lg">{currentOrder.size}</span>
                  </div>
                  <div className="flex justify-between text-base items-center">
                    <span className="text-gray-600 font-medium">Paper Color:</span>
                    <span className={`font-bold px-3 py-1 rounded text-base ${
                      currentOrder.paperColor.cssClass
                    }`}>
                      {currentOrder.paperColor.name}
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Occasion:</span>
                    <span className="font-bold text-lg">{currentOrder.occasion}</span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Team ID:</span>
                    <span className="font-bold text-lg">{(window as any).gameState?.getTeamId?.() || "TEAM-001"}</span>
                  </div>
                  <div className="rounded-xl border-2 border-gray-200 bg-white px-6 py-5 shadow-sm">
                    <div className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
                      Verse
                    </div>
                    <p className="min-h-[20vh] whitespace-pre-line text-[clamp(2.75rem,6vw,6rem)] font-black leading-[0.88] tracking-[-0.03em] text-gray-900">
                      {displayedVerse || `No verse for ${currentOrder.occasion}`}
                    </p>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-lg text-gray-500 font-medium">No job selected</p>
                  <p className="text-base text-gray-400 mt-2">The top priority scheduled job will appear here automatically</p>
                </div>
              )}
            </div>
          </div>

          {/* Queue Section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Job Queue</h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {stationQueue
                  .slice(0, 5)
                  .map((order, index) => (
                    <div
                      key={order.id}
                      onClick={() => setCurrentOrderId(order.id)}
                      className={`flex justify-between items-center p-2 bg-white rounded border hover:border-blue-400 cursor-pointer ${
                        currentOrderId === order.id ? "border-blue-500 ring-1 ring-blue-300" : ""
                      }`}
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
                {stationQueue.length === 0 && (
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
              <button
                onClick={handleStartJob}
                disabled={!currentOrder}
                className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium disabled:cursor-not-allowed disabled:bg-green-300"
              >
                Start Job
              </button>
              <button className="px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm font-medium">
                Pause Station
              </button>
              <button
                onClick={handleCompleteStage}
                disabled={!currentOrder}
                className="col-span-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {stationNumber === 3 ? "Mark Pending Approval" : "Mark Stage Complete"}
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
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={stationSpeed}
                  onChange={(e) =>
                    updateStationSpeedMultiplier(
                      stationKey,
                      parseFloat(e.target.value),
                    )
                  }
                  className="flex-1"
                />
                <span className="text-sm font-mono w-12">{stationSpeed.toFixed(2)}x</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.0x</span>
                <span>Normal</span>
                <span>1.5x</span>
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
              updateOrderField={updateOrderField}
              scheduleOrderIds={scheduleOrderIds}
              currentTime={currentTime}
              isStationMode={true}
              onOrderClick={setCurrentOrderId}
              currentOrderId={currentOrderId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
