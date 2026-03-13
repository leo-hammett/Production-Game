import { useState, useEffect } from "react";
import {
  PAPER_SIZES,
  centerTitle,
  formatPosition,
  generateRulerPositions,
  type PaperSize,
  type CenteringResult,
} from "../utils/titleCentering";
import type { Order } from "../utils/gameState";

interface TitleCenteringToolProps {
  currentOrder?: Order | null;
}

export function TitleCenteringTool({ currentOrder }: TitleCenteringToolProps) {
  const [result, setResult] = useState<CenteringResult | null>(null);

  // Map order sizes to paper sizes
  const mapOrderSizeToPaperSize = (orderSize?: string): PaperSize => {
    if (!orderSize) return PAPER_SIZES[0];
    
    // Map order sizes to paper sizes (adjust mapping as needed)
    switch (orderSize) {
      case "A5":
        return PAPER_SIZES.find(p => p.name === "A5") || PAPER_SIZES[0];
      case "A6":
      case "A6 (large)":
        return PAPER_SIZES.find(p => p.name === "A6 (large)") || PAPER_SIZES[1];
      case "A6 (small)":
        return PAPER_SIZES.find(p => p.name === "A6 (small)") || PAPER_SIZES[2];
      case "A7":
        return PAPER_SIZES.find(p => p.name === "A7") || PAPER_SIZES[3];
      default:
        return PAPER_SIZES[0];
    }
  };

  const selectedPaperSize = mapOrderSizeToPaperSize(currentOrder?.size);
  const title = currentOrder?.title || "";

  useEffect(() => {
    if (title.trim() && selectedPaperSize) {
      const centeringResult = centerTitle(title, selectedPaperSize);
      setResult(centeringResult);
    } else {
      setResult(null);
    }
  }, [title, selectedPaperSize]);

  const rulerPositions = generateRulerPositions();
  const maxCapacity = title.length % 2 === 0 
    ? selectedPaperSize.evenLetterCapacity 
    : selectedPaperSize.oddLetterCapacity;

  if (!currentOrder || !currentOrder.title) {
    return (
      <div className="p-4 bg-gray-50 rounded">
        <p className="text-sm text-gray-600">
          No title set for current order. Add a title in the orders table to see centering instructions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Order Info */}
      <div className="bg-white p-3 rounded border">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-600">Paper:</span>
            <span className="ml-1 font-medium">{selectedPaperSize.name}</span>
          </div>
          <div>
            <span className="text-gray-600">Title:</span>
            <span className="ml-1 font-medium">{title}</span>
          </div>
          <div>
            <span className="text-gray-600">Capacity:</span>
            <span className="ml-1 font-medium">
              {title.length % 2 === 0 ? "even" : "odd"} ({maxCapacity} max)
            </span>
          </div>
          <div>
            <span className="text-gray-600">Length:</span>
            <span className="ml-1 font-medium">{title.length} chars</span>
          </div>
        </div>
      </div>

      {/* Placement Instructions */}
      {result && result.lines.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3">
          <div className="space-y-2">
            {result.lines.map((line) => (
              <div key={line.lineNumber} className="bg-white p-2 rounded border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">Line {line.lineNumber}</span>
                  <span className="text-sm font-mono font-bold">{line.text}</span>
                </div>
                
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600">Start at:</span>
                  <span className="text-base font-bold text-blue-600">
                    {formatPosition(line.startPosition)}
                  </span>
                  <span className="text-gray-500">
                    (place "{line.text[0]}" here)
                  </span>
                </div>

                {/* Compact visual representation */}
                <div className="mt-2 bg-gray-50 p-1 rounded overflow-x-auto">
                  <div className="flex items-center text-[10px] font-mono">
                    {Array.from({ length: Math.min(maxCapacity, 15) }, (_, i) => {
                      const position = i + 1;
                      const letterIndex = position - line.startPosition;
                      const letter = letterIndex >= 0 && letterIndex < line.text.length 
                        ? line.text[letterIndex] 
                        : "";
                      
                      return (
                        <div 
                          key={position} 
                          className={`w-4 h-4 flex items-center justify-center border text-[8px] ${
                            letter ? 'bg-blue-100 border-blue-300 font-bold' : 'bg-white border-gray-200'
                          }`}
                        >
                          {letter || position}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {result.totalLines > 1 && (
            <div className="mt-2 p-2 bg-blue-100 rounded">
              <p className="text-[10px] text-blue-800">
                <strong>Multi-line:</strong> {result.totalLines} lines total
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}