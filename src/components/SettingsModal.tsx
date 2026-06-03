import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { X, Shield, Key, Check, Loader2, Eye, EyeOff, Palette } from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const [coindcxKey, setCoindcxKey] = useState("");
  const [coindcxSecret, setCoindcxSecret] = useState("");
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");

  const [showCoindcxSecret, setShowCoindcxSecret] = useState(false);
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);

  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Load existing credentials for userId = 1
  const { data: credentials, refetch } = trpc.trading.credentials.useQuery(
    { userId: 1 },
    { enabled: isOpen }
  );

  const saveCredentialsMutation = trpc.trading.saveCredentials.useMutation();

  useEffect(() => {
    if (credentials && credentials.length > 0) {
      const coindcx = credentials.find((c) => c.exchange === "coindcx");
      const binance = credentials.find((c) => c.exchange === "binance");

      if (coindcx) {
        setCoindcxKey(coindcx.apiKey || "");
        setCoindcxSecret(coindcx.apiSecret || "");
      }
      if (binance) {
        setBinanceKey(binance.apiKey || "");
        setBinanceSecret(binance.apiSecret || "");
      }
    }
  }, [credentials]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("idle");
    setErrorMessage("");

    try {
      // Save CoinDCX Credentials
      if (coindcxKey && coindcxSecret) {
        await saveCredentialsMutation.mutateAsync({
          userId: 1,
          exchange: "coindcx",
          apiKey: coindcxKey,
          apiSecret: coindcxSecret,
        });
      }

      // Save Binance Credentials
      if (binanceKey && binanceSecret) {
        await saveCredentialsMutation.mutateAsync({
          userId: 1,
          exchange: "binance",
          apiKey: binanceKey,
          apiSecret: binanceSecret,
        });
      }

      setSaveStatus("success");
      refetch();
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (err: any) {
      console.error(err);
      setSaveStatus("error");
      setErrorMessage(err.message || "Failed to save API credentials.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#18181b]">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[#3b82f6]" />
            <span className="text-xs font-semibold text-[#f4f4f5]">API Credentials Settings</span>
          </div>
          <button
            onClick={onClose}
            className="text-[#71717a] hover:text-[#f4f4f5] transition-colors rounded p-1 hover:bg-[#27272a]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Appearance */}
        <div className="px-4 py-3 border-b border-[#27272a]">
          <div className="flex items-center gap-2 mb-3">
            <Palette size={13} className="text-[#a855f7]" />
            <span className="text-[10px] font-semibold text-[#f4f4f5]">Appearance</span>
          </div>
          <ThemeSwitcher />
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="text-[10px] text-[#71717a] leading-normal bg-[#18181b] border border-[#27272a] rounded p-3 flex gap-2">
            <Key size={14} className="text-[#3b82f6] flex-shrink-0 mt-0.5" />
            <span>
              Credentials are encrypted and saved locally to access private REST endpoints and configure authenticated WebSocket connection streams.
            </span>
          </div>

          {/* CoinDCX Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#3b82f6] border-b border-[#27272a]/50 pb-1 flex items-center justify-between">
              <span>CoinDCX (Futures API)</span>
              {credentials?.some((c) => c.exchange === "coindcx") && (
                <span className="text-[9px] bg-[#22c55e]/15 text-[#22c55e] px-1.5 py-0.5 rounded font-normal">Active</span>
              )}
            </h3>
            
            <div className="space-y-1">
              <label className="text-[10px] text-[#71717a] block">API Key</label>
              <input
                type="text"
                value={coindcxKey}
                onChange={(e) => setCoindcxKey(e.target.value)}
                placeholder="Enter CoinDCX API Key"
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-[#3b82f6] placeholder-[#52525b]"
              />
            </div>

            <div className="space-y-1 relative">
              <label className="text-[10px] text-[#71717a] block">API Secret</label>
              <div className="relative">
                <input
                  type={showCoindcxSecret ? "text" : "password"}
                  value={coindcxSecret}
                  onChange={(e) => setCoindcxSecret(e.target.value)}
                  placeholder="Enter CoinDCX API Secret"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded pl-3 pr-10 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-[#3b82f6] placeholder-[#52525b]"
                />
                <button
                  type="button"
                  onClick={() => setShowCoindcxSecret(!showCoindcxSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#f4f4f5]"
                >
                  {showCoindcxSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Binance Section */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-semibold text-[#f59e0b] border-b border-[#27272a]/50 pb-1 flex items-center justify-between">
              <span>Binance (Execution Stream)</span>
              {credentials?.some((c) => c.exchange === "binance") && (
                <span className="text-[9px] bg-[#22c55e]/15 text-[#22c55e] px-1.5 py-0.5 rounded font-normal">Active</span>
              )}
            </h3>
            
            <div className="space-y-1">
              <label className="text-[10px] text-[#71717a] block">API Key</label>
              <input
                type="text"
                value={binanceKey}
                onChange={(e) => setBinanceKey(e.target.value)}
                placeholder="Enter Binance API Key"
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-[#f59e0b] placeholder-[#52525b]"
              />
            </div>

            <div className="space-y-1 relative">
              <label className="text-[10px] text-[#71717a] block">API Secret</label>
              <div className="relative">
                <input
                  type={showBinanceSecret ? "text" : "password"}
                  value={binanceSecret}
                  onChange={(e) => setBinanceSecret(e.target.value)}
                  placeholder="Enter Binance API Secret"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded pl-3 pr-10 py-1.5 text-xs text-[#f4f4f5] outline-none focus:border-[#f59e0b] placeholder-[#52525b]"
                />
                <button
                  type="button"
                  onClick={() => setShowBinanceSecret(!showBinanceSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#f4f4f5]"
                >
                  {showBinanceSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Status Alerts */}
        {saveStatus === "success" && (
          <div className="mx-4 mb-2 p-2 bg-[#22c55e]/15 border border-[#22c55e]/30 rounded text-[#22c55e] text-[10px] flex items-center gap-1.5">
            <Check size={12} /> API Credentials saved successfully!
          </div>
        )}
        {saveStatus === "error" && (
          <div className="mx-4 mb-2 p-2 bg-[#ef4444]/15 border border-[#ef4444]/30 rounded text-[#ef4444] text-[10px]">
            {errorMessage}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#27272a] bg-[#18181b] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-[#27272a] rounded text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#27272a] text-xs transition-colors"
          >
            Close
          </button>
          <button
            type="submit"
            onClick={handleSave}
            disabled={saveCredentialsMutation.isPending}
            className="px-3 py-1.5 bg-[#3b82f6] hover:bg-[#2563eb] text-white rounded text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveCredentialsMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
