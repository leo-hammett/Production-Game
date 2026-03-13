import { useState } from "react";
import {
  PAPER_SIZES,
  centerTitle,
  formatPosition,
  generateRulerPositions,
  type PaperSize,
  type CenteringResult,
} from "../utils/titleCentering";

export function TitleCenteringTool() {
  const [selectedPaperSize, setSelectedPaperSize] = useState<PaperSize>(PAPER_SIZES[0]);
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<CenteringResult | null>(null);

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (newTitle.trim()) {
      const centeringResult = centerTitle(newTitle, selectedPaperSize);
      setResult(centeringResult);
    } else {
      setResult(null);
    }
  };

  const handlePaperSizeChange = (paperSizeName: string) => {
    const paperSize = PAPER_SIZES.find(p => p.name === paperSizeName);
    if (paperSize) {
      setSelectedPaperSize(paperSize);
      if (title.trim()) {
        const centeringResult = centerTitle(title, paperSize);
        setResult(centeringResult);
      }
    }
  };

  const rulerPositions = generateRulerPositions();
  const maxCapacity = title.length % 2 === 0 
    ? selectedPaperSize.evenLetterCapacity 
    : selectedPaperSize.oddLetterCapacity;

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Stationer Title Centering Tool
        </h1>
        <p className="text-gray-600">
          Calculate the exact starting position for centering titles on folded paper.
        </p>
      </div>

      {/* Input Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Paper Size Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Paper Size
          </label>
          <select
            value={selectedPaperSize.name}
            onChange={(e) => handlePaperSizeChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {PAPER_SIZES.map((paperSize) => (
              <option key={paperSize.name} value={paperSize.name}>
                {paperSize.name} ({paperSize.oddLetterCapacity}/{paperSize.evenLetterCapacity} letters)
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Numbers show odd/even letter capacity per line
          </p>
        </div>

        {/* Title Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Title Text
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="CHRISTMAS"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            {title.length} characters
            {title.length > 0 && (
              <span className="ml-2">
                → Using {title.length % 2 === 0 ? "even" : "odd"} letter capacity ({maxCapacity} max)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Ruler Display */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Position Ruler</h3>
        <div className="bg-gray-50 p-4 rounded-lg overflow-x-auto">
          <div className="flex items-center space-x-1 text-xs font-mono">
            {rulerPositions.slice(0, maxCapacity + 2).map((pos) => (
              <div key={pos} className="flex flex-col items-center min-w-[24px]">
                <div className="h-2 border-l border-gray-400"></div>
                <span className="text-gray-600">{formatPosition(pos)}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Showing positions 1 to {maxCapacity + 1} for current paper size and letter count
        </p>
      </div>

      {/* Results Section */}
      {result && result.lines.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-4">
            Placement Instructions
          </h3>
          
          <div className="space-y-4">
            {result.lines.map((line) => (
              <div key={line.lineNumber} className="bg-white p-4 rounded border">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                  <div>
                    <span className="text-sm font-medium text-gray-600">Line {line.lineNumber}</span>
                    <div className="text-lg font-mono font-bold text-gray-900">
                      {line.text}
                    </div>
                  </div>
                  
                  <div className="md:col-span-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">Start position:</span>
                      <span className="text-xl font-bold text-blue-600">
                        {formatPosition(line.startPosition)}
                      </span>
                      <span className="text-sm text-gray-500">
                        (place "{line.text[0]}" at position {formatPosition(line.startPosition)})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Visual representation */}
                <div className="mt-3 bg-gray-50 p-2 rounded">
                  <div className="flex items-center space-x-1 text-xs font-mono">
                    {Array.from({ length: maxCapacity }, (_, i) => {
                      const position = i + 1;
                      const letterIndex = position - line.startPosition;
                      const letter = letterIndex >= 0 && letterIndex < line.text.length 
                        ? line.text[letterIndex] 
                        : "";
                      
                      return (
                        <div 
                          key={position} 
                          className={`w-6 h-6 flex items-center justify-center border ${
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
            <div className="mt-4 p-3 bg-blue-100 rounded">
              <p className="text-sm text-blue-800">
                <strong>Multi-line title:</strong> This title requires {result.totalLines} lines. 
                Place each line according to its individual start position for proper centering.
              </p>
            </div>
          )}
        </div>
      )}

      {title && (!result || result.lines.length === 0) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">
            Enter a title to see placement instructions.
          </p>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 bg-gray-50 p-6 rounded-lg">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">How to Use</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>Select your paper size from the dropdown menu</li>
          <li>Enter the title text you want to center</li>
          <li>Note the start position for each line</li>
          <li>Place the first letter of each line at the indicated position on your ruler</li>
          <li>Continue placing letters sequentially from that starting point</li>
        </ol>
        
        <div className="mt-4">
          <h4 className="font-medium text-gray-900 mb-2">Paper Size Guide:</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            {PAPER_SIZES.map((paperSize) => (
              <li key={paperSize.name}>
                <strong>{paperSize.name}:</strong> {paperSize.oddLetterCapacity} letters (odd length) / {paperSize.evenLetterCapacity} letters (even length)
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}