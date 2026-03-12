import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ProductionSchedule } from "./ProductionSchedule";
import type { Order, OrderStatus, PaperInventory, Transaction } from "../utils/gameState";
import {
  gameState,
  PaperColor,
  PAPER_COLORS,
  PAPER_COLOR_MAP,
  OCCASIONS,
  getColorName,
  getColorPrice,
} from "../utils/gameState";
import {
  addOrder,
  deleteRecentOrder,
  getProductionScheduleOrderIds,
  reorderOrders,
  updateOrder,
} from "../utils/orders";
import {
  fuzzySearch,
  getColorClass,
  getRowColorClass,
  formatOrderTime,
  getStatusColor,
  formatTime,
  startCooldownTimer,
  stopCooldownTimer,
  resetCooldownTimer,
  updateCooldownTime,
} from "../utils/ui";

interface OperationsManagementViewProps {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  updateOrderField: (id: string, field: keyof Order, value: any) => void;
  currentTime: number;
  paperInventory: PaperInventory;
  setPaperInventory: React.Dispatch<React.SetStateAction<PaperInventory>>;
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  cash: number;
  setCash: React.Dispatch<React.SetStateAction<number>>;
  safetyStock: number;
  setSafetyStock: React.Dispatch<React.SetStateAction<number>>;
  buyingCooldown: number;
  setBuyingCooldown: React.Dispatch<React.SetStateAction<number>>;
  cooldownTimer: number | null;
  setCooldownTimer: React.Dispatch<React.SetStateAction<number | null>>;
  workstationSpeed: number;
  setWorkstationSpeed: React.Dispatch<React.SetStateAction<number>>;
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
}

type DragDropPosition = "before" | "after";

export function OperationsManagementView({
  orders,
  setOrders,
  updateOrderField,
  currentTime,
  paperInventory,
  setPaperInventory,
  transactions,
  setTransactions,
  cash,
  setCash,
  safetyStock,
  setSafetyStock,
  buyingCooldown,
  setBuyingCooldown,
  cooldownTimer,
  setCooldownTimer,
  workstationSpeed,
  setWorkstationSpeed,
}: OperationsManagementViewProps) {
  // Resizable panes state
  const [leftPaneWidth, setLeftPaneWidth] = useState(70); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  const [showUndo, setShowUndo] = useState(false);
  const [previousOrders, setPreviousOrders] = useState<Order[]>([]);
  const [occasionSearch, setOccasionSearch] = useState("");
  const [filteredOccasions, setFilteredOccasions] = useState<string[]>([]);
  const [activeRowIndex, setActiveRowIndex] = useState(-1);
  const [activeField, setActiveField] = useState<'color' | 'occasion' | null>(null);
  const occasionInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const colorInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const [colorSearch, setColorSearch] = useState("");
  const [filteredColors, setFilteredColors] = useState<string[]>([]);
  const [showNewColorDialog, setShowNewColorDialog] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorPrice, setNewColorPrice] = useState(20);
  const [pendingColorOrderId, setPendingColorOrderId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] =
    useState<DropdownPosition | null>(null);
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{
    orderId: string;
    position: DragDropPosition;
  } | null>(null);

  // Accept suggestions
  const acceptSuggestions = () => {
    setPreviousOrders(orders);
    // Backend integration would go here
    // For now, just simulate accepting suggestions
    setShowUndo(true);
    setTimeout(() => setShowUndo(false), 5000);
  };

  // Undo last action
  const undoLastAction = () => {
    if (previousOrders.length > 0) {
      setOrders(previousOrders);
      setPreviousOrders([]);
      setShowUndo(false);
    }
  };

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

  useEffect(() => {
    const activeOrder = orders[activeRowIndex];
    const isColorMenuOpen =
      activeField === "color" && filteredColors.length > 0;
    const isOccasionMenuOpen =
      activeField === "occasion" && filteredOccasions.length > 0;

    if (!activeOrder || (!isColorMenuOpen && !isOccasionMenuOpen)) {
      setDropdownPosition(null);
      return;
    }

    const input =
      activeField === "color"
        ? colorInputRefs.current[activeOrder.id]
        : occasionInputRefs.current[activeOrder.id];

    if (!input) {
      setDropdownPosition(null);
      return;
    }

    const updateDropdownPosition = () => {
      const rect = input.getBoundingClientRect();
      const viewportPadding = 8;
      const gutter = 4;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;

      setDropdownPosition({
        left: Math.max(viewportPadding, rect.left),
        top: openUpward ? rect.top - gutter : rect.bottom + gutter,
        width: rect.width,
        maxHeight: Math.max(
          96,
          Math.min(240, (openUpward ? spaceAbove : spaceBelow) - gutter),
        ),
        openUpward,
      });
    };

    updateDropdownPosition();

    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [
    activeField,
    activeRowIndex,
    filteredColors.length,
    filteredOccasions.length,
    orders,
  ]);

  // Statistics calculations (skeleton for backend)
  const stats = {
    current: {
      prodTime: "48h", // TODO: Calculate from backend
      timeMargin: "12h", // TODO: Calculate from backend
      profit: "£450", // TODO: Calculate from backend
      riskOfFailure: "15%", // TODO: Calculate from backend
      costOfFailure: "£150", // TODO: Calculate from backend
      rewardRisk: "3.0", // TODO: Calculate from backend
    },
    suggested: {
      prodTime: "45h", // TODO: Calculate from backend
      timeMargin: "18h", // TODO: Calculate from backend
      profit: "£520", // TODO: Calculate from backend
      riskOfFailure: "12%", // TODO: Calculate from backend
      costOfFailure: "£130", // TODO: Calculate from backend
      rewardRisk: "4.0", // TODO: Calculate from backend
    },
  };

  // Add new transaction
  const addTransaction = (
    amount: number,
    reason: string,
    type: "cash" | "paper" | "inventory" = "cash",
    paperColor?: string,
    paperQuantity?: number,
    orderId?: string,
    pending?: boolean,
    deliveryTime?: number,
  ) => {
    const newTransaction = gameState.createTransaction(
      amount,
      reason,
      type,
      paperColor,
      paperQuantity,
      orderId,
      pending,
      deliveryTime
    );

    setTransactions([...transactions, newTransaction]);
    setCash((prev) => prev + amount);

    // Update paper inventory if it's a paper transaction and not pending
    // Negative quantities are allowed (for returns/corrections)
    if (paperColor && paperQuantity !== undefined && !pending) {
      setPaperInventory((prev) => ({
        ...prev,
        [paperColor]: (prev[paperColor] || 0) + paperQuantity,
      }));
    }
  };

  // Edit transaction
  const editTransaction = (id: string, updates: Partial<Transaction>) => {
    const transIndex = transactions.findIndex(t => t.id === id);
    if (transIndex === -1) return;
    
    const oldTrans = transactions[transIndex];
    const newTrans = { ...oldTrans, ...updates };
    
    // Update transactions array
    const newTransactions = [...transactions];
    newTransactions[transIndex] = newTrans;
    setTransactions(newTransactions);
    
    // Update cash if amount changed
    if (updates.amount !== undefined) {
      const amountDiff = newTrans.amount - oldTrans.amount;
      setCash((prev) => prev + amountDiff);
    }
    
    // Update inventory if paper transaction changed
    if (oldTrans.paperColor && oldTrans.paperQuantity) {
      // Reverse old transaction
      setPaperInventory((prev) => ({
        ...prev,
        [oldTrans.paperColor!]: (prev[oldTrans.paperColor!] || 0) - oldTrans.paperQuantity!,
      }));
    }
    if (newTrans.paperColor && newTrans.paperQuantity) {
      // Apply new transaction
      setPaperInventory((prev) => ({
        ...prev,
        [newTrans.paperColor!]: (prev[newTrans.paperColor!] || 0) + newTrans.paperQuantity!,
      }));
    }
  };

  // Delete transaction
  const deleteTransaction = (id: string) => {
    const trans = transactions.find(t => t.id === id);
    if (!trans) return;
    
    // Remove from transactions
    setTransactions(transactions.filter(t => t.id !== id));
    
    // Reverse the cash effect
    setCash((prev) => prev - trans.amount);
    
    // Reverse inventory effect if it's a paper transaction (and not pending)
    if (trans.paperColor && trans.paperQuantity && !trans.pending) {
      setPaperInventory((prev) => ({
        ...prev,
        [trans.paperColor!]: (prev[trans.paperColor!] || 0) - trans.paperQuantity!,
      }));
    }
  };

  // Complete a pending transaction
  const completePendingTransaction = (id: string) => {
    const transIndex = transactions.findIndex(t => t.id === id);
    if (transIndex === -1) return;
    
    const trans = transactions[transIndex];
    if (!trans.pending) return;
    
    // Update transaction to no longer be pending
    const updatedTrans = { ...trans, pending: false };
    const newTransactions = [...transactions];
    newTransactions[transIndex] = updatedTrans;
    setTransactions(newTransactions);
    
    // Now add to inventory
    if (trans.paperColor && trans.paperQuantity !== undefined) {
      setPaperInventory((prev) => ({
        ...prev,
        [trans.paperColor!]: (prev[trans.paperColor!] || 0) + trans.paperQuantity!,
      }));
    }
  };

  const activeOrder = orders[activeRowIndex];
  const productionOrderIds = getProductionScheduleOrderIds(orders);
  const productionOrderPositions = productionOrderIds.reduce<Record<string, number>>(
    (positions, orderId, index) => {
      positions[orderId] = index + 1;
      return positions;
    },
    {},
  );
  const dropdownStyle = dropdownPosition
    ? {
        left: dropdownPosition.left,
        top: dropdownPosition.top,
        width: dropdownPosition.width,
        maxHeight: dropdownPosition.maxHeight,
        transform: dropdownPosition.openUpward
          ? "translateY(calc(-100% - 4px))"
          : undefined,
      }
    : null;

  const activeDropdown =
    typeof document !== "undefined" &&
    activeOrder &&
    dropdownStyle &&
    ((activeField === "color" && filteredColors.length > 0) ||
      (activeField === "occasion" && filteredOccasions.length > 0))
      ? createPortal(
          <div
            className="fixed z-[60] overflow-y-auto rounded border bg-white shadow-lg"
            style={dropdownStyle}
          >
            {activeField === "color"
              ? filteredColors.map((colorName) => {
                  const color = PAPER_COLORS.find((c) => c.name === colorName);

                  return (
                    <button
                      key={colorName}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (color) {
                          updateOrderField(activeOrder.id, "paperColor", color);
                        }
                        setFilteredColors([]);
                        setActiveRowIndex(-1);
                        setActiveField(null);
                        setColorSearch("");
                      }}
                      className={`flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-blue-50 ${color?.cssClass}`}
                    >
                      <span>{colorName}</span>
                      <span className="text-gray-500">
                        £{color?.basePrice}/sheet
                      </span>
                    </button>
                  );
                })
              : filteredOccasions.map((occasion) => (
                  <button
                    key={occasion}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      updateOrderField(activeOrder.id, "occasion", occasion);
                      setFilteredOccasions([]);
                      setActiveRowIndex(-1);
                      setActiveField(null);
                      setOccasionSearch("");
                    }}
                    className="block w-full px-2 py-1 text-left text-xs hover:bg-blue-50"
                  >
                    {occasion}
                  </button>
                ))}
          </div>,
          document.body,
        )
      : null;

  const handleRowDragStart = (
    e: React.DragEvent<HTMLElement>,
    orderId: string,
  ) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", orderId);
    setDraggedOrderId(orderId);
    setDragTarget(null);
  };

  const getDragPosition = (
    e: React.DragEvent<HTMLTableRowElement>,
  ): DragDropPosition => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return e.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
  };

  const handleRowDragOver = (
    e: React.DragEvent<HTMLTableRowElement>,
    orderId: string,
  ) => {
    if (!draggedOrderId || draggedOrderId === orderId) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragTarget({
      orderId,
      position: getDragPosition(e),
    });
  };

  const handleRowDrop = (
    e: React.DragEvent<HTMLTableRowElement>,
    orderId: string,
  ) => {
    e.preventDefault();

    if (!draggedOrderId || draggedOrderId === orderId) {
      setDraggedOrderId(null);
      setDragTarget(null);
      return;
    }

    const position = getDragPosition(e);
    setOrders((currentOrders) =>
      reorderOrders(currentOrders, draggedOrderId, orderId, position),
    );
    setDraggedOrderId(null);
    setDragTarget(null);
  };

  const clearDragState = () => {
    setDraggedOrderId(null);
    setDragTarget(null);
  };

  return (
    <>
      {/* Two-pane section */}
      <div className="flex relative h-full">
        {/* Left Pane - Order Management */}
        <div
          className="bg-white border-r border-gray-300"
          style={{ width: `${leftPaneWidth}%` }}
        >
          <div className="p-2">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-base font-bold text-gray-800">
                Order Management
              </h2>
            </div>

            {/* Orders Table */}
            <div className="mb-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Queue
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      ID
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Time
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Qty
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Color
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Size
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Verse
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Occasion
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Price
                    </th>
                    <th className="px-2 py-1 text-center text-xs whitespace-nowrap">
                      Avail
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr
                      key={order.id}
                      onDragOver={(e) => handleRowDragOver(e, order.id)}
                      onDrop={(e) => handleRowDrop(e, order.id)}
                      className={`border-b hover:bg-gray-50 ${getRowColorClass(order)} ${
                        draggedOrderId === order.id ? "opacity-50" : ""
                      } ${
                        dragTarget?.orderId === order.id &&
                        dragTarget.position === "before"
                          ? "border-t-4 border-t-blue-500"
                          : ""
                      } ${
                        dragTarget?.orderId === order.id &&
                        dragTarget.position === "after"
                          ? "border-b-4 border-b-blue-500"
                          : ""
                      }`}
                    >
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-2">
                          <span
                            draggable
                            onDragStart={(e) => handleRowDragStart(e, order.id)}
                            onDragEnd={clearDragState}
                            className="cursor-grab select-none rounded border border-gray-300 bg-white px-1.5 py-1 text-[10px] text-gray-500 active:cursor-grabbing"
                            title="Drag to reschedule"
                          >
                            ::
                          </span>
                          <span className="min-w-6 text-center text-[10px] font-semibold text-gray-500">
                            {productionOrderPositions[order.id] ?? "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className="font-mono text-xs text-gray-500">
                          {order.id.slice(-6)}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={formatOrderTime(order.orderTime)}
                          onChange={(e) => {
                            const timeStr = e.target.value;
                            const [hours, minutes] = timeStr
                              .split(":")
                              .map(Number);
                            if (!isNaN(hours) && !isNaN(minutes)) {
                              const newDate = new Date(order.orderTime);
                              newDate.setHours(hours, minutes);
                              updateOrderField(
                                order.id,
                                "orderTime",
                                newDate.getTime(),
                              );
                            }
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="HH:MM"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.quantity}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "quantity",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.leadTime}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "leadTime",
                              parseInt(e.target.value) || -1,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="∞"
                        />
                      </td>
                      <td className="px-2 py-1 relative">
                        <input
                          ref={(el) => {colorInputRefs.current[order.id] = el}}
                          type="text"
                          value={
                            activeRowIndex === index && activeField === "color"
                              ? colorSearch
                              : order.paperColor.name
                          }
                          onChange={(e) => {
                            const value = e.target.value;
                            setColorSearch(value);
                            setFilteredColors(
                              fuzzySearch(
                                value,
                                PAPER_COLORS.map((c) => c.name),
                              ),
                            );
                            // Try to match color immediately if exact match
                            const exactMatch = PAPER_COLORS.find(
                              (c) =>
                                c.name.toLowerCase() === value.toLowerCase(),
                            );
                            if (exactMatch) {
                              updateOrderField(
                                order.id,
                                "paperColor",
                                exactMatch,
                              );
                            }
                          }}
                          onFocus={(e) => {
                            setColorSearch(e.target.value);
                            setFilteredColors(
                              fuzzySearch(
                                e.target.value,
                                PAPER_COLORS.map((c) => c.name),
                              ),
                            );
                            setActiveRowIndex(index);
                            setActiveField('color');
                          }}
                          onBlur={() => {
                            // Check if user typed something that doesn't exist
                            if (colorSearch && colorSearch !== order.paperColor.name) {
                              const exactMatch = PAPER_COLORS.find(
                                (c) => c.name.toLowerCase() === colorSearch.toLowerCase()
                              );
                              if (!exactMatch && filteredColors.length === 0) {
                                // No matches at all - prompt to create new color
                                setNewColorName(colorSearch);
                                setPendingColorOrderId(order.id);
                                setShowNewColorDialog(true);
                              }
                            }
                            setTimeout(() => {
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredColors([]);
                              setColorSearch("");
                            }, 200);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && filteredColors.length > 0) {
                              // Auto-populate with top match on Tab
                              const topMatch = PAPER_COLORS.find(c => c.name === filteredColors[0]);
                              if (topMatch) {
                                updateOrderField(order.id, "paperColor", topMatch);
                              }
                            } else if (e.key === 'Enter' && colorSearch && filteredColors.length === 0) {
                              // Enter with no matches - prompt to create new color
                              e.preventDefault();
                              const exactMatch = PAPER_COLORS.find(
                                (c) => c.name.toLowerCase() === colorSearch.toLowerCase()
                              );
                              if (!exactMatch) {
                                setNewColorName(colorSearch);
                                setPendingColorOrderId(order.id);
                                setShowNewColorDialog(true);
                              }
                            }
                          }}
                          className={`w-full px-1 py-1.5 border rounded text-xs h-8 ${getColorClass(order.paperColor)}`}
                          placeholder="Color..."
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.size}
                          onChange={(e) =>
                            updateOrderField(order.id, "size", e.target.value)
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="Size"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.verseSize}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "verseSize",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                        />
                      </td>
                      <td className="px-2 py-1 relative">
                        <input
                          ref={(el) => {
                            occasionInputRefs.current[order.id] = el
                          }}
                          type="text"
                          value={order.occasion}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateOrderField(order.id, "occasion", value);
                            setOccasionSearch(value);
                            setFilteredOccasions(fuzzySearch(value, OCCASIONS));
                            setActiveRowIndex(index);
                            setActiveField('occasion');
                          }}
                          onFocus={(e) => {
                            setOccasionSearch(e.target.value);
                            setFilteredOccasions(
                              fuzzySearch(e.target.value, OCCASIONS),
                            );
                            setActiveRowIndex(index);
                            setActiveField('occasion');
                          }}
                          onBlur={() => {
                            setTimeout(() => {
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredOccasions([]);
                              setOccasionSearch("");
                            }, 200);
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="Occasion..."
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center">
                          <span className="mr-0.5 text-gray-500">£</span>
                          <input
                            type="text"
                            value={order.price}
                            onChange={(e) =>
                              updateOrderField(
                                order.id,
                                "price",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={order.available}
                            onChange={(e) =>
                              updateOrderField(
                                order.id,
                                "available",
                                e.target.checked,
                              )
                            }
                            className="sr-only peer"
                          />
                          <div className="w-6 h-3 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-2 after:w-2.5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={order.status}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "status",
                              e.target.value as OrderStatus,
                            )
                          }
                          className={`w-full px-1 py-1.5 rounded text-xs font-medium h-8 ${getStatusColor(order.status)}`}
                        >
                          <option value="passive">Passive</option>
                          <option value="ordered">Ordered</option>
                          <option value="pending_inventory">Pending</option>
                          <option value="WIP">WIP</option>
                          <option value="sent">Sent</option>
                          <option value="approved">Approved</option>
                          <option value="failed">Failed</option>
                          <option value="deleted">Deleted</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Queue
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      ID
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Time
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Qty
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Color
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Size
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Verse
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Occasion
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Price
                    </th>
                    <th className="px-2 py-1 text-center text-xs whitespace-nowrap">
                      Avail
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Action buttons below table */}
            <div className="flex justify-between items-center mb-2 px-1">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const newOrder = addOrder();
                    setOrders([...orders, newOrder]);
                  }}
                  className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-medium"
                  title="Add Order (Ctrl+N)"
                >
                  + Add Order
                </button>
                <button
                  onClick={() => setOrders(deleteRecentOrder(orders))}
                  className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 text-xs font-medium"
                  title="Delete newest passive order (Ctrl+Z)"
                >
                  Delete New Order
                </button>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <span className="px-1 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                  Drag rows to reschedule
                </span>
                <span className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+N: New
                </span>
                <span className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+Z: Delete New
                </span>
              </div>
            </div>

            {/* Suggested Orders Section */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Suggested Orders
              </h3>
              <div className="bg-blue-50 border border-blue-200 rounded p-1">
                <p className="text-xs text-blue-800 mb-1">
                  {/* TODO: Backend integration for suggestions */}
                  Based on current inventory and demand patterns:
                </p>
                <ul className="space-y-0.5 text-xs text-blue-700">
                  <li>• Add 200x Birthday A5 cards (high demand next week)</li>
                  <li>
                    • Consider Valentine's Day inventory (3 weeks lead time)
                  </li>
                  <li>• Low stock on pink paper - reorder recommended</li>
                </ul>
              </div>
            </div>

            {/* Statistics Comparison Table */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Performance Metrics
              </h3>
              <div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-1 py-0.5 text-left text-xs"></th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Prod Time
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Margin
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Profit
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Risk %
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Risk Cost
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        R/R Ratio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b bg-green-50">
                      <td className="px-1 py-0.5 font-medium text-green-700 text-xs">
                        Suggested
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.prodTime}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.timeMargin}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.suggested.profit}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.riskOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.costOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.suggested.rewardRisk}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="px-1 py-0.5 font-medium text-gray-700 text-xs">
                        Current
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.prodTime}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.timeMargin}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.current.profit}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.riskOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.costOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.current.rewardRisk}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Accept/Undo Button */}
            <div className="flex justify-center pb-2">
              {showUndo ? (
                <button
                  onClick={undoLastAction}
                  className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors text-xs font-medium"
                >
                  ↶ Undo Last Action (Ctrl+Z)
                </button>
              ) : (
                <button
                  onClick={acceptSuggestions}
                  className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-xs font-medium"
                >
                  ✓ Accept Suggestions
                </button>
              )}
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
                scheduleOrderIds={productionOrderIds}
                currentTime={currentTime}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Full-width sections below the two panes */}
      <div className="bg-white border-t border-gray-300">
        <div className="p-2">
          <h2 className="text-base font-bold text-gray-800 mb-2">
            Inventory Management System
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Paper Tracked Inventory
              </h3>
              <table className="w-full text-xs">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="px-1 py-0.5 text-left">Color</th>
                    <th className="px-1 py-0.5 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(paperInventory).map(([color, quantity]) => (
                    <tr key={color} className="border-b">
                      <td className="px-1 py-0.5">
                        <div className="flex items-center gap-1">
                          <div
                            className={`w-3 h-3 rounded ${getColorClass(color)}`}
                          />
                          <span className="font-medium">
                            {getColorName(color)}
                          </span>
                          <span className="text-gray-500 text-xs">
                            (£{getColorPrice(color)})
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-0.5 text-right font-mono">
                        {quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-bold">
                  <tr>
                    <td className="px-1 py-0.5">Total</td>
                    <td className="px-1 py-0.5 text-right font-mono">
                      {Object.values(paperInventory).reduce(
                        (sum, qty) => sum + qty,
                        0,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Cash Transactions Ledger
              </h3>
              <div className="max-h-32 overflow-y-auto mb-2">
                <table className="w-full text-xs">
                  <thead className="bg-gray-200 sticky top-0">
                    <tr>
                      <th className="px-1 py-0.5 text-left">Revenue</th>
                      <th className="px-1 py-0.5 text-left">Type</th>
                      <th className="px-1 py-0.5 text-left">Reason</th>
                      <th className="px-1 py-0.5 text-left">Status</th>
                      <th className="px-1 py-0.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .slice(-10)
                      .reverse()
                      .map((trans) => (
                        <tr key={trans.id} className="border-b">
                          <td
                            className={`px-1 py-0.5 font-mono ${trans.amount >= 0 ? "text-green-600" : "text-red-600"}`}
                          >
                            {editingTransactionId === trans.id ? (
                              <input
                                type="number"
                                step="0.01"
                                value={trans.amount}
                                onChange={(e) => editTransaction(trans.id, { amount: parseFloat(e.target.value) || 0 })}
                                className="w-20 px-1 border rounded text-xs"
                              />
                            ) : (
                              <span onClick={() => setEditingTransactionId(trans.id)} className="cursor-pointer">
                                £{trans.amount.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5">
                            {trans.type === "paper" && trans.paperColor ? (
                              editingTransactionId === trans.id ? (
                                <div className="flex gap-1">
                                  <select
                                    value={trans.paperColor}
                                    onChange={(e) => editTransaction(trans.id, { paperColor: e.target.value })}
                                    className="w-12 px-1 border rounded text-xs"
                                  >
                                    {PAPER_COLORS.map(color => (
                                      <option key={color.code} value={color.code}>{color.code}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    value={trans.paperQuantity || 0}
                                    onChange={(e) => editTransaction(trans.id, { paperQuantity: parseInt(e.target.value) || 0 })}
                                    className="w-12 px-1 border rounded text-xs"
                                  />
                                </div>
                              ) : (
                                <span onClick={() => setEditingTransactionId(trans.id)} className="cursor-pointer">
                                  {trans.paperColor}:{trans.paperQuantity}
                                </span>
                              )
                            ) : editingTransactionId === trans.id ? (
                              <select
                                value={trans.type}
                                onChange={(e) => editTransaction(trans.id, { 
                                  type: e.target.value as "cash" | "paper" | "inventory",
                                  paperColor: e.target.value === "paper" ? trans.paperColor : undefined,
                                  paperQuantity: e.target.value === "paper" ? trans.paperQuantity : undefined
                                })}
                                className="w-20 px-1 border rounded text-xs"
                              >
                                <option value="cash">Cash</option>
                                <option value="inventory">Inventory</option>
                                <option value="paper">Paper</option>
                              </select>
                            ) : (
                              <span 
                                onClick={() => setEditingTransactionId(trans.id)} 
                                className="cursor-pointer"
                              >
                                {trans.type === "inventory" ? "Inventory" : trans.type === "paper" ? "Paper" : "Cash"}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            {editingTransactionId === trans.id ? (
                              <input
                                type="text"
                                value={trans.reason || ""}
                                onChange={(e) => editTransaction(trans.id, { reason: e.target.value })}
                                className="w-full px-1 border rounded text-xs"
                              />
                            ) : (
                              <span onClick={() => setEditingTransactionId(trans.id)} className="cursor-pointer">
                                {trans.reason || ""}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            {trans.pending ? (
                              <span 
                                onClick={() => completePendingTransaction(trans.id)}
                                className="cursor-pointer text-yellow-600 hover:text-yellow-800"
                              >
                                {trans.arrivalTime ? (
                                  <>
                                    Pending ({Math.max(0, Math.ceil((trans.arrivalTime - currentTime) / 1000))}s)
                                  </>
                                ) : "Pending"}
                              </span>
                            ) : (
                              <span className="text-green-600">✓</span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            {editingTransactionId === trans.id ? (
                              <button
                                onClick={() => setEditingTransactionId(null)}
                                className="px-1 py-0.5 bg-green-500 text-white rounded text-xs"
                              >
                                ✓
                              </button>
                            ) : (
                              <button
                                onClick={() => deleteTransaction(trans.id)}
                                className="px-1 py-0.5 text-gray-500 hover:text-gray-700 text-xs"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Add Transaction Forms */}
              <div className="space-y-1">
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Revenue"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashAmount"
                  />
                  <input
                    type="text"
                    placeholder="Reason"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashReason"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      id="affectsInventory"
                      className="rounded"
                    />
                    <span>Inventory</span>
                  </label>
                  <button
                    onClick={() => {
                      const amount = parseFloat(
                        (
                          document.getElementById(
                            "cashAmount",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const reason =
                        (
                          document.getElementById(
                            "cashReason",
                          ) as HTMLInputElement
                        ).value || "Cash transaction";
                      const isInventory = (
                        document.getElementById(
                          "affectsInventory",
                        ) as HTMLInputElement
                      ).checked;
                      if (amount) {
                        addTransaction(
                          amount,
                          reason,
                          isInventory ? "inventory" : "cash",
                        );
                        (
                          document.getElementById(
                            "cashAmount",
                          ) as HTMLInputElement
                        ).value = "";
                        (
                          document.getElementById(
                            "cashReason",
                          ) as HTMLInputElement
                        ).value = "";
                        (
                          document.getElementById(
                            "affectsInventory",
                          ) as HTMLInputElement
                        ).checked = false;
                      }
                    }}
                    className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs"
                  >
                    Add Cash
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  <input
                    type="number"
                    placeholder="Qty"
                    className="w-16 px-1 py-0.5 border rounded text-xs"
                    id="paperQty"
                    onChange={() => {
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                              "paperQty",
                            ) as HTMLInputElement
                          ).value,
                        ) || 0;
                      const colorInput = document.getElementById(
                        "paperColorInput",
                      ) as HTMLInputElement;
                      const colorName = colorInput?.value;
                      const color = PAPER_COLORS.find(
                        (c) =>
                          c.name.toLowerCase() === colorName?.toLowerCase(),
                      );
                      if (color && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * color.basePrice).toFixed(2);
                      }
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Color"
                    className="w-24 px-1 py-0.5 border rounded text-xs"
                    id="paperColorInput"
                    list="paperColorsList"
                    onChange={(e) => {
                      const colorName = e.target.value;
                      const color = PAPER_COLORS.find(
                        (c) => c.name.toLowerCase() === colorName.toLowerCase(),
                      );
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                              "paperQty",
                            ) as HTMLInputElement
                          ).value,
                        ) || 0;
                      if (color && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * color.basePrice).toFixed(2);
                      }
                    }}
                  />
                  <datalist id="paperColorsList">
                    {PAPER_COLORS.map((color) => (
                      <option key={color.code} value={color.name} />
                    ))}
                  </datalist>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Cost"
                    className="w-20 px-1 py-0.5 border rounded text-xs"
                    id="paperCost"
                  />
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="paperReason"
                  />
                  <input
                    type="number"
                    placeholder="Mins"
                    defaultValue="10"
                    className="w-16 px-1 py-0.5 border rounded text-xs"
                    id="paperDeliveryMins"
                    title="Delivery time in minutes"
                  />
                  <button
                    onClick={() => {
                      const qty = parseInt(
                        (
                          document.getElementById(
                            "paperQty",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const colorName = (
                        document.getElementById(
                          "paperColorInput",
                        ) as HTMLInputElement
                      ).value;
                      const colorMatch = PAPER_COLORS.find(
                        (c) => c.name.toLowerCase() === colorName.toLowerCase(),
                      );

                      if (!colorMatch) {
                        alert("Please select a valid color");
                        return;
                      }

                      // Allow any quantity including 0 (for theft) or negative (for returns)

                      const costInput = parseFloat(
                        (document.getElementById("paperCost") as HTMLInputElement).value
                      );
                      const cost = costInput ? -Math.abs(costInput) : -Math.abs(qty * colorMatch.basePrice);
                      const reason =
                        (
                          document.getElementById(
                            "paperReason",
                          ) as HTMLInputElement
                        ).value || `Bought ${qty} sheets of ${colorMatch.name}`;
                      
                      // Get delivery time in minutes and convert to milliseconds
                      const deliveryMins = parseFloat(
                        (document.getElementById("paperDeliveryMins") as HTMLInputElement).value
                      ) || 10;
                      const deliveryMs = deliveryMins * 60 * 1000;

                      // Create pending transaction for paper purchases
                      addTransaction(cost, reason, "paper", colorMatch.code, qty, undefined, true, deliveryMs);
                      startCooldownTimer(cooldownTimer, buyingCooldown, setBuyingCooldown, setCooldownTimer);

                      // Clear form
                      (
                        document.getElementById("paperQty") as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById(
                          "paperColorInput",
                        ) as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById("paperCost") as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById(
                          "paperReason",
                        ) as HTMLInputElement
                      ).value = "";
                    }}
                    className="px-2 py-0.5 bg-green-600 text-white rounded text-xs"
                  >
                    Buy Paper
                  </button>
                </div>
              </div>

              {/* Overrides Section */}
              <div className="mt-2 pt-2 border-t">
                <h4 className="text-xs font-semibold mb-1">Overrides</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Cooldown:</span>
                    <button
                      onClick={() => {
                        if (cooldownTimer) {
                          stopCooldownTimer(cooldownTimer, setCooldownTimer);
                        } else {
                          startCooldownTimer(cooldownTimer, buyingCooldown, setBuyingCooldown, setCooldownTimer);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        cooldownTimer
                          ? "bg-red-500 hover:bg-red-600 text-white"
                          : "bg-green-500 hover:bg-green-600 text-white"
                      }`}
                    >
                      {cooldownTimer ? "Stop" : "Start"}
                    </button>
                    <button
                      onClick={() => resetCooldownTimer(cooldownTimer, setCooldownTimer, setBuyingCooldown)}
                      className="px-2 py-0.5 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs"
                    >
                      Reset
                    </button>
                    {!cooldownTimer ? (
                      <input
                        type="text"
                        value={formatTime(buyingCooldown)}
                        onChange={(e) => {
                          const parts = e.target.value.split(":");
                          if (parts.length === 2) {
                            const mins = parseInt(parts[0]) || 0;
                            const secs = parseInt(parts[1]) || 0;
                            updateCooldownTime(mins * 60 + secs, cooldownTimer, setBuyingCooldown);
                          }
                        }}
                        className="w-12 px-1 py-0.5 border rounded text-xs font-mono text-center"
                        placeholder="0:00"
                      />
                    ) : (
                      <span className="text-xs font-mono w-12 text-center">
                        {formatTime(buyingCooldown)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Safety Stock:</span>
                    <input
                      type="number"
                      value={safetyStock}
                      onChange={(e) => setSafetyStock(parseInt(e.target.value))}
                      className="w-16 px-1 py-0.5 border rounded text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Workstation Controls
              </h3>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium">Speed Override</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={workstationSpeed}
                      onChange={(e) =>
                        setWorkstationSpeed(parseFloat(e.target.value))
                      }
                      className="flex-1"
                    />
                    <span className="text-xs font-mono w-8">
                      {workstationSpeed.toFixed(1)}x
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 1
                  </button>
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 2
                  </button>
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 3
                  </button>
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 4
                  </button>
                </div>
                <div className="text-xs text-gray-600">
                  <p>Additional workstation overrides will be added here.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Color Creation Dialog */}
      {showNewColorDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 max-w-md w-full">
            <h3 className="text-lg font-bold mb-3">Create New Paper Color</h3>
            <p className="text-sm text-gray-600 mb-4">
              The color "{newColorName}" doesn't exist. Would you like to create it?
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Color Name</label>
                <input
                  type="text"
                  value={newColorName}
                  onChange={(e) => setNewColorName(e.target.value)}
                  className="w-full px-2 py-1 border rounded text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Price per Sheet (£)</label>
                <input
                  type="number"
                  value={newColorPrice}
                  onChange={(e) => setNewColorPrice(parseFloat(e.target.value) || 20)}
                  min="0"
                  step="0.5"
                  className="w-full px-2 py-1 border rounded text-sm"
                />
              </div>
              <div className="text-xs text-gray-500">
                CSS class will be auto-generated as: bg-gray-100
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  // Create the new color
                  const colorCode = newColorName.substring(0, 2).toLowerCase();
                  const newColor = new PaperColor(
                    colorCode,
                    newColorName,
                    "bg-gray-100", // Default CSS class for new colors
                    newColorPrice
                  );
                  
                  // Add to PAPER_COLORS array
                  PAPER_COLORS.push(newColor);
                  PAPER_COLOR_MAP.set(colorCode, newColor);
                  
                  // Update the pending order with the new color
                  if (pendingColorOrderId) {
                    updateOrderField(pendingColorOrderId, "paperColor", newColor);
                  }
                  
                  // Close dialog and reset
                  setShowNewColorDialog(false);
                  setNewColorName("");
                  setNewColorPrice(20);
                  setPendingColorOrderId(null);
                }}
                className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
              >
                Create Color
              </button>
              <button
                onClick={() => {
                  setShowNewColorDialog(false);
                  setNewColorName("");
                  setNewColorPrice(20);
                  setPendingColorOrderId(null);
                }}
                className="flex-1 px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {activeDropdown}
    </>
  );
}
