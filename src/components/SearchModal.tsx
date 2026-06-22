import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { 
  CommandDialog, 
  CommandInput, 
  CommandList, 
  CommandEmpty, 
  CommandGroup, 
  CommandItem, 
  CommandSeparator 
} from "@/components/ui/command";
import { 
  TrendingUp, 
  Signal, 
  LineChart, 
  Brain, 
  Zap, 
  Wallet, 
  Shield, 
  ScrollText, 
  Activity,
  Coins,
  ChevronLeft,
  ShoppingCart
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<"search" | "options-buy">("search");
  const [searchQuery, setSearchQuery] = useState("");

  // Options form state
  const [underlying, setUnderlying] = useState<"BTC" | "ETH" | "SOL">("BTC");
  const [optionType, setOptionType] = useState<"CE" | "PE">("CE");
  const [strike, setStrike] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("2026-06-26"); // Default next Friday
  const [qty, setQty] = useState<string>("0.1");

  // Fetch live mark/ticker price for strike calculation
  const querySymbol = `${underlying}USDT`;
  
  const { data: klines } = trpc.market.klines.useQuery(
    { symbol: querySymbol, interval: "1m" },
    { enabled: isOpen && view === "options-buy" }
  );

  const currentPrice = useMemo(() => {
    if (klines && klines.length > 0) {
      return parseFloat(klines[klines.length - 1].close);
    }
    // Static fallbacks
    if (underlying === "ETH") return 3500;
    if (underlying === "SOL") return 150;
    return 65000; // BTC
  }, [klines, underlying]);

  // Set initial strike price based on current underlying price
  useEffect(() => {
    if (view === "options-buy" && currentPrice) {
      const multiplier = underlying === "BTC" ? 500 : underlying === "ETH" ? 50 : 5;
      const nearestStrike = Math.round(currentPrice / multiplier) * multiplier;
      setStrike(String(nearestStrike));
    }
  }, [view, underlying, currentPrice]);

  // Calculate simulated option premium price
  const premium = useMemo(() => {
    const strikeNum = parseFloat(strike) || currentPrice;
    const distancePct = Math.abs(strikeNum - currentPrice) / currentPrice;
    
    // Simple black-scholes approximation for UI
    let baseVol = underlying === "BTC" ? 0.02 : underlying === "ETH" ? 0.03 : 0.05;
    let timeDecay = 0.85; // 85% of standard premium
    
    let intrinsicValue = 0;
    if (optionType === "CE") {
      intrinsicValue = Math.max(0, currentPrice - strikeNum);
    } else {
      intrinsicValue = Math.max(0, strikeNum - currentPrice);
    }
    
    let timeValue = currentPrice * baseVol * Math.exp(-distancePct * 15) * timeDecay;
    const calculated = intrinsicValue + timeValue;
    
    return calculated > 0.01 ? calculated : 0.01;
  }, [underlying, optionType, strike, currentPrice]);

  // Handle placing a simulated option trade
  const handlePlaceOptionOrder = () => {
    const qtyVal = parseFloat(qty);
    if (isNaN(qtyVal) || qtyVal <= 0) {
      toast.error("Please enter a valid quantity.");
      return;
    }

    const totalCost = premium * qtyVal;
    
    toast.success(`Option Order Placed! 🎉`, {
      description: `Bought ${qty} x ${underlying}-${expiry}-${strike}-${optionType} @ $${premium.toFixed(2)} (Total: $${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT)`,
      duration: 5000,
    });
    
    onClose();
    setView("search");
    setSearchQuery("");
  };

  // Switch pages or symbols and close
  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
    setSearchQuery("");
  };

  const handleSelectSymbol = (sym: string) => {
    localStorage.setItem("janus_selected_symbol", sym);
    toast.info(`Active pair switched to ${sym}`);
    onClose();
    setSearchQuery("");
    // Trigger layout reload if needed
    window.location.reload();
  };

  // Keyboard controls inside the modal
  useEffect(() => {
    if (!isOpen) {
      setView("search");
      setSearchQuery("");
    }
  }, [isOpen]);

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Global Command Center">
      {view === "search" ? (
        <>
          <CommandInput 
            placeholder="Type to search pages, assets, or type 'options'..." 
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="scrollbar-thin">
            <CommandEmpty>No results found.</CommandEmpty>
            
            {/* Quick Access Actions */}
            <CommandGroup heading="Quick Terminals">
              <CommandItem 
                onSelect={() => setView("options-buy")}
                className="cursor-pointer hover:bg-zinc-800/50 flex items-center justify-between text-zinc-100 font-medium"
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-j-up" />
                  <span>Buy Option Contracts (Options Buying Terminal)</span>
                </div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold font-mono">Options</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Navigation links */}
            <CommandGroup heading="System Navigation">
              <CommandItem onSelect={() => handleNavigate("/")} className="cursor-pointer">
                <TrendingUp className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Dashboard</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/signals")} className="cursor-pointer">
                <Signal className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Signals</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/surveillance")} className="cursor-pointer">
                <Activity className="mr-2 h-4 w-4 text-[#22c55e]" />
                <span className="font-bold text-[#22c55e]">Active Surveillance Dashboard</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/adaptive-st")} className="cursor-pointer">
                <LineChart className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Adaptive ST</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/ai-analysis")} className="cursor-pointer">
                <Brain className="mr-2 h-4 w-4 text-zinc-400" />
                <span>AI Analysis</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/brain")} className="cursor-pointer">
                <Zap className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Brain Governance</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/portfolio")} className="cursor-pointer">
                <Wallet className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Portfolio</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/risk")} className="cursor-pointer">
                <Shield className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Risk & Cooldowns</span>
              </CommandItem>
              <CommandItem onSelect={() => handleNavigate("/logs")} className="cursor-pointer">
                <ScrollText className="mr-2 h-4 w-4 text-zinc-400" />
                <span>Execution Logs</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Swap Active Pair */}
            <CommandGroup heading="Swap Trading Pair Context">
              <CommandItem onSelect={() => handleSelectSymbol("BTCUSDT")} className="cursor-pointer">
                <Coins className="mr-2 h-4 w-4 text-j-warn" />
                <span>BTC/USDT Futures</span>
              </CommandItem>
              <CommandItem onSelect={() => handleSelectSymbol("ETHUSDT")} className="cursor-pointer">
                <Coins className="mr-2 h-4 w-4 text-zinc-400" />
                <span>ETH/USDT Futures</span>
              </CommandItem>
              <CommandItem onSelect={() => handleSelectSymbol("SOLUSDT")} className="cursor-pointer">
                <Coins className="mr-2 h-4 w-4 text-j-purple" />
                <span>SOL/USDT Futures</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </>
      ) : (
        /* Options Buying Terminal Form View */
        <div className="p-4 bg-[#0a0b0e] text-[#f4f4f5] font-mono flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <button 
              onClick={() => setView("search")}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-all text-xs"
            >
              <ChevronLeft size={16} />
              <span>Back to search</span>
            </button>
            <span className="text-xs font-bold text-j-up flex items-center gap-1">
              <ShoppingCart size={14} />
              OPTIONS BUYING TERMINAL
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            
            {/* Left Options settings Column */}
            <div className="flex flex-col gap-3">
              
              {/* Underlying Selector */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 uppercase font-black">Underlying Asset</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["BTC", "ETH", "SOL"] as const).map((asset) => (
                    <button
                      key={asset}
                      onClick={() => setUnderlying(asset)}
                      className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${
                        underlying === asset
                          ? "bg-j-up/20 border-j-up text-j-up"
                          : "border-zinc-800 hover:border-zinc-600 text-zinc-400"
                      }`}
                    >
                      {asset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Option Type Selector */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 uppercase font-black">Option Contract Type</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setOptionType("CE")}
                    className={`px-2 py-1.5 rounded text-[10px] font-black border transition-all ${
                      optionType === "CE"
                        ? "bg-[#0ecb81]/25 border-[#0ecb81] text-[#0ecb81] shadow-[0_0_8px_rgba(14,203,129,0.1)]"
                        : "border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Call Option (CE)
                  </button>
                  <button
                    onClick={() => setOptionType("PE")}
                    className={`px-2 py-1.5 rounded text-[10px] font-black border transition-all ${
                      optionType === "PE"
                        ? "bg-[#f6465d]/25 border-[#f6465d] text-[#f6465d] shadow-[0_0_8px_rgba(246,70,93,0.1)]"
                        : "border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Put Option (PE)
                  </button>
                </div>
              </div>

              {/* Strike Price Input */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 uppercase font-black">Strike Price (USD)</span>
                <input
                  type="number"
                  value={strike}
                  onChange={(e) => setStrike(e.target.value)}
                  className="w-full bg-[#121318] border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-j-up"
                  placeholder="Strike Price"
                />
                <span className="text-[8px] text-zinc-600 font-mono mt-0.5">
                  Nearest spot price: ${Math.round(currentPrice).toLocaleString()}
                </span>
              </div>

            </div>

            {/* Right Options Details Column */}
            <div className="flex flex-col gap-3">
              
              {/* Expiry Selector */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 uppercase font-black">Expiry Date</span>
                <select
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="w-full bg-[#121318] border border-zinc-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-j-up"
                >
                  <option value="2026-06-26">2026-06-26 (Weekly)</option>
                  <option value="2026-07-03">2026-07-03 (Next Weekly)</option>
                  <option value="2026-07-31">2026-07-31 (Monthly)</option>
                </select>
              </div>

              {/* Quantity Input */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 uppercase font-black">Order Size ({underlying})</span>
                <input
                  type="text"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full bg-[#121318] border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-j-up"
                  placeholder="Qty"
                />
              </div>

              {/* Premium calculations and pricing display box */}
              <div className="bg-[#12141a] p-2 rounded border border-white/[0.03] mt-1 flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-500">Spot Price:</span>
                  <span className="text-white font-bold">${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-500">Option Premium:</span>
                  <span className={`${optionType === "CE" ? "text-[#0ecb81]" : "text-[#f6465d]"} font-black`}>
                    ${premium.toFixed(2)} USDT
                  </span>
                </div>
                <div className="h-px bg-white/[0.04] my-1" />
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-400 font-bold">Total Premium Cost:</span>
                  <span className="text-white font-black">
                    ${(premium * (parseFloat(qty) || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
              </div>

            </div>

          </div>

          {/* Place Option Order Button */}
          <button
            onClick={handlePlaceOptionOrder}
            className="w-full py-2 bg-j-up hover:bg-j-up/85 font-black text-xs text-black rounded mt-2 uppercase transition-all shadow-[0_0_12px_rgba(34,197,94,0.15)] flex items-center justify-center gap-1.5"
          >
            <ShoppingCart size={14} />
            BUY {underlying} {strike} {optionType} CONTRACT
          </button>

        </div>
      )}
    </CommandDialog>
  );
}
