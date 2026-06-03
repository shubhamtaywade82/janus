import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import {
  X,
  Shield,
  Key,
  Check,
  Loader2,
  Eye,
  EyeOff,
  Palette,
  Brain,
  Trash2,
  Play,
  Plus,
  CheckCircle,
  XCircle,
  ToggleLeft,
  ToggleRight
} from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<"api" | "llm">("api");

  // --- Exchange API Credentials State ---
  const [coindcxKey, setCoindcxKey] = useState("");
  const [coindcxSecret, setCoindcxSecret] = useState("");
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");

  const [showCoindcxSecret, setShowCoindcxSecret] = useState(false);
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);

  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // --- LLM API Keys State ---
  const [llmLabel, setLlmLabel] = useState("");
  const [llmProvider, setLlmProvider] = useState<"ollama" | "openai" | "anthropic">("ollama");
  const [llmEndpoint, setLlmEndpoint] = useState("http://localhost:11434");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("llama3.2");
  const [llmPriority, setLlmPriority] = useState(1);
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);

  // Connection test results (keyId -> results)
  const [testResults, setTestResults] = useState<
    Record<
      number,
      {
        loading: boolean;
        success?: boolean;
        latencyMs?: number;
        decision?: string;
        reasoning?: string;
        error?: string;
      }
    >
  >({});

  // --- Queries & Mutations ---
  // Credentials
  const { data: credentials, refetch: refetchCredentials } = trpc.trading.credentials.useQuery(
    { userId: 1 },
    { enabled: isOpen }
  );
  const saveCredentialsMutation = trpc.trading.saveCredentials.useMutation();

  // LLM Keys
  const { data: llmKeys, refetch: refetchLlmKeys } = trpc.llm.listKeys.useQuery(
    { userId: 1 },
    { enabled: isOpen }
  );

  const addLlmKeyMutation = trpc.llm.addKey.useMutation({
    onSuccess: () => {
      toast.success("LLM key added to rotation pool");
      refetchLlmKeys();
      resetLlmForm();
    },
    onError: (err) => {
      toast.error(`Failed to add LLM key: ${err.message}`);
    },
  });

  const deleteLlmKeyMutation = trpc.llm.deleteKey.useMutation({
    onSuccess: () => {
      toast.success("LLM key deleted");
      refetchLlmKeys();
    },
    onError: (err) => {
      toast.error(`Failed to delete key: ${err.message}`);
    },
  });

  const toggleLlmKeyMutation = trpc.llm.toggleKey.useMutation({
    onSuccess: () => {
      refetchLlmKeys();
    },
    onError: (err) => {
      toast.error(`Failed to toggle key: ${err.message}`);
    },
  });

  const testLlmKeyMutation = trpc.llm.testKey.useMutation();

  // Sync credentials form
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

  // Handle provider changes to fill sensible defaults
  useEffect(() => {
    if (llmProvider === "ollama") {
      setLlmEndpoint("http://localhost:11434");
      setLlmModel("llama3.2");
    } else if (llmProvider === "openai") {
      setLlmEndpoint("https://api.openai.com");
      setLlmModel("gpt-4o-mini");
    } else if (llmProvider === "anthropic") {
      setLlmEndpoint("https://api.anthropic.com");
      setLlmModel("claude-3-5-sonnet-latest");
    }
  }, [llmProvider]);

  if (!isOpen) return null;

  const resetLlmForm = () => {
    setLlmLabel("");
    setLlmApiKey("");
    setLlmPriority(llmKeys ? llmKeys.length + 1 : 1);
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("idle");
    setErrorMessage("");

    try {
      if (coindcxKey && coindcxSecret) {
        await saveCredentialsMutation.mutateAsync({
          userId: 1,
          exchange: "coindcx",
          apiKey: coindcxKey,
          apiSecret: coindcxSecret,
        });
      }

      if (binanceKey && binanceSecret) {
        await saveCredentialsMutation.mutateAsync({
          userId: 1,
          exchange: "binance",
          apiKey: binanceKey,
          apiSecret: binanceSecret,
        });
      }

      setSaveStatus("success");
      refetchCredentials();
      toast.success("API Credentials saved successfully!");
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (err: any) {
      console.error(err);
      setSaveStatus("error");
      setErrorMessage(err.message || "Failed to save API credentials.");
      toast.error("Credentials save failed");
    }
  };

  const handleAddLlmKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!llmLabel.trim()) {
      toast.error("Please enter a label");
      return;
    }
    if (!llmEndpoint.trim()) {
      toast.error("Please enter an endpoint URL");
      return;
    }

    addLlmKeyMutation.mutate({
      userId: 1,
      label: llmLabel.trim(),
      provider: llmProvider,
      endpoint: llmEndpoint.trim(),
      apiKey: llmApiKey.trim(),
      model: llmModel.trim(),
      priority: llmPriority,
    });
  };

  const handleToggleLlmKey = async (id: number, currentActive: boolean) => {
    toggleLlmKeyMutation.mutate({ id, isActive: !currentActive });
  };

  const handleDeleteLlmKey = async (id: number) => {
    if (confirm("Are you sure you want to delete this LLM key?")) {
      deleteLlmKeyMutation.mutate({ id });
    }
  };

  const handleTestLlmKey = async (id: number) => {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await testLlmKeyMutation.mutateAsync({ id });
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          success: res.success,
          latencyMs: res.latencyMs,
          decision: res.decision,
          reasoning: res.reasoning,
          error: res.error,
        },
      }));
      if (res.success) {
        toast.success(`Connection success! Latency: ${res.latencyMs}ms. Decision: ${res.decision?.toUpperCase()}`);
      } else {
        toast.error(`Key test failed: ${res.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          success: false,
          error: err.message,
        },
      }));
      toast.error(`Test failed: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-[#09090b] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#18181b]">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[#3b82f6]" />
            <span className="text-xs font-semibold text-[#f4f4f5]">Trading Engine Settings</span>
          </div>
          <button
            onClick={onClose}
            className="text-[#71717a] hover:text-[#f4f4f5] transition-colors rounded p-1 hover:bg-[#27272a]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-[#27272a] bg-[#0c0c0e] px-2">
          <button
            type="button"
            onClick={() => setActiveTab("api")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold border-b-2 transition-all outline-none",
              activeTab === "api"
                ? "border-[#3b82f6] text-[#3b82f6]"
                : "border-transparent text-[#71717a] hover:text-[#f4f4f5]"
            )}
          >
            <Key size={12} />
            Exchange API Credentials
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("llm")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold border-b-2 transition-all outline-none",
              activeTab === "llm"
                ? "border-[#a855f7] text-[#a855f7]"
                : "border-transparent text-[#71717a] hover:text-[#f4f4f5]"
            )}
          >
            <Brain size={12} />
            AI/LLM Key Rotation
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* TAB 1: Exchange API Credentials */}
          {activeTab === "api" && (
            <form onSubmit={handleSaveCredentials} className="space-y-4">
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

              {/* Status Alerts */}
              {saveStatus === "success" && (
                <div className="p-2 bg-[#22c55e]/15 border border-[#22c55e]/30 rounded text-[#22c55e] text-[10px] flex items-center gap-1.5">
                  <Check size={12} /> API Credentials saved successfully!
                </div>
              )}
              {saveStatus === "error" && (
                <div className="p-2 bg-[#ef4444]/15 border border-[#ef4444]/30 rounded text-[#ef4444] text-[10px]">
                  {errorMessage}
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saveCredentialsMutation.isPending}
                  className="px-4 py-1.5 bg-[#3b82f6] hover:bg-[#2563eb] text-white rounded text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saveCredentialsMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  Save API Keys
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: AI/LLM Key Rotation */}
          {activeTab === "llm" && (
            <div className="space-y-4">
              <div className="text-[10px] text-[#71717a] leading-normal bg-[#18181b] border border-[#27272a] rounded p-3 flex gap-2">
                <Brain size={14} className="text-[#a855f7] flex-shrink-0 mt-0.5" />
                <span>
                  Configure multiple LLM endpoints. The trading system automatically rotates keys starting from Priority 1. On error (429/503), it backsoff and switches to the next fallback key in order.
                </span>
              </div>

              {/* Key List Table */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#a855f7] border-b border-[#27272a]/50 pb-1">
                  Active Rotation Pool
                </h3>

                {llmKeys === undefined ? (
                  <div className="flex items-center justify-center py-6 text-xs text-[#71717a] gap-2">
                    <Loader2 size={14} className="animate-spin" /> Loading key rotation pool...
                  </div>
                ) : llmKeys.length === 0 ? (
                  <div className="text-center py-6 bg-[#18181b]/50 border border-[#27272a] border-dashed rounded text-xs text-[#52525b]">
                    No keys in the database pool. Falling back to `.env` config.
                  </div>
                ) : (
                  <div className="border border-[#27272a] rounded-lg overflow-hidden bg-[#0c0c0e]">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead>
                        <tr className="bg-[#18181b] text-[#71717a] border-b border-[#27272a] font-semibold">
                          <th className="p-2 w-16">Priority</th>
                          <th className="p-2">Name & Provider</th>
                          <th className="p-2">Model</th>
                          <th className="p-2 w-16 text-center">Status</th>
                          <th className="p-2 w-32 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#18181b]">
                        {llmKeys.map((k) => {
                          const test = testResults[k.id];
                          return (
                            <tr key={k.id} className="hover:bg-[#18181b]/30 transition-colors">
                              <td className="p-2">
                                <span className="px-1.5 py-0.5 bg-[#27272a] text-[#f4f4f5] rounded text-[8px] font-bold">
                                  Prio {k.priority}
                                </span>
                              </td>
                              <td className="p-2">
                                <div className="font-semibold text-[#f4f4f5]">{k.label}</div>
                                <div className="text-[8px] text-[#71717a] capitalize">{k.provider}</div>
                              </td>
                              <td className="p-2 text-[#a1a1aa] truncate max-w-[80px]">
                                {k.model}
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleLlmKey(k.id, k.isActive)}
                                  disabled={toggleLlmKeyMutation.isPending}
                                  className="text-[#71717a] hover:text-[#f4f4f5] transition-colors outline-none inline-flex items-center"
                                >
                                  {k.isActive ? (
                                    <ToggleRight className="text-[#22c55e]" size={20} />
                                  ) : (
                                    <ToggleLeft className="text-[#3f3f46]" size={20} />
                                  )}
                                </button>
                              </td>
                              <td className="p-2 text-right space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleTestLlmKey(k.id)}
                                  disabled={test?.loading}
                                  title="Test connection"
                                  className="p-1.5 bg-[#a855f7]/10 border border-[#a855f7]/20 hover:bg-[#a855f7]/20 text-[#a855f7] rounded hover:text-white transition-all inline-flex items-center gap-1"
                                >
                                  {test?.loading ? (
                                    <Loader2 size={10} className="animate-spin" />
                                  ) : (
                                    <Play size={10} />
                                  )}
                                  <span>Test</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLlmKey(k.id)}
                                  title="Delete key"
                                  className="p-1.5 bg-[#ef4444]/10 border border-[#ef4444]/20 hover:bg-[#ef4444]/20 text-[#ef4444] rounded transition-all inline-flex"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Show Test Results Inline */}
                {Object.entries(testResults).map(([keyId, res]) => {
                  const keyItem = llmKeys?.find((k) => k.id === parseInt(keyId));
                  if (!keyItem || (!res.success && !res.error && !res.loading)) return null;
                  return (
                    <div
                      key={keyId}
                      className={cn(
                        "p-2.5 rounded border text-[9px] leading-relaxed flex flex-col gap-1 transition-all",
                        res.loading
                          ? "bg-[#18181b]/40 border-[#27272a]"
                          : res.success
                          ? "bg-[#22c55e]/10 border-[#22c55e]/25 text-[#22c55e]"
                          : "bg-[#ef4444]/10 border-[#ef4444]/25 text-[#ef4444]"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        {res.loading ? (
                          <Loader2 size={11} className="animate-spin text-[#71717a]" />
                        ) : res.success ? (
                          <CheckCircle size={11} className="text-[#22c55e]" />
                        ) : (
                          <XCircle size={11} className="text-[#ef4444]" />
                        )}
                        <span>Testing Key "{keyItem.label}" :</span>
                        {res.loading && <span className="text-[#71717a] font-normal">Contacting API endpoint...</span>}
                        {res.success && <span className="text-[#22c55e] font-bold">Success ({res.latencyMs}ms)</span>}
                        {res.error && <span className="text-[#ef4444] font-bold">Failed</span>}
                      </div>

                      {res.success && (
                        <div className="text-[#a1a1aa] pl-4">
                          <span className="font-semibold text-[#e4e4e7]">Decision: </span>
                          <span className="text-[#22c55e] font-bold mr-3">{res.decision?.toUpperCase()}</span>
                          <span className="font-semibold text-[#e4e4e7]">Reasoning: </span>
                          <span>"{res.reasoning}"</span>
                        </div>
                      )}

                      {res.error && (
                        <div className="text-[#fca5a5] pl-4 font-mono truncate max-w-full">
                          Error: {res.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Key Form */}
              <form onSubmit={handleAddLlmKey} className="space-y-3 bg-[#18181b]/30 border border-[#27272a] rounded-lg p-3">
                <h4 className="text-[10px] font-semibold text-[#f4f4f5] flex items-center gap-1 pb-1 border-b border-[#27272a]/50">
                  <Plus size={12} className="text-[#a855f7]" /> Add New LLM Key Configuration
                </h4>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-[#71717a] block">Key Label / Name</label>
                    <input
                      type="text"
                      value={llmLabel}
                      onChange={(e) => setLlmLabel(e.target.value)}
                      placeholder="e.g. My OpenAI Key"
                      className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#a855f7] placeholder-[#52525b]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-[#71717a] block">Provider</label>
                    <select
                      value={llmProvider}
                      onChange={(e) => setLlmProvider(e.target.value as any)}
                      className="w-full bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#a855f7] cursor-pointer"
                    >
                      <option value="ollama">Ollama (Local/Cloud)</option>
                      <option value="openai">OpenAI (ChatGPT)</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] text-[#71717a] block">API Endpoint URL</label>
                  <input
                    type="text"
                    value={llmEndpoint}
                    onChange={(e) => setLlmEndpoint(e.target.value)}
                    placeholder="Enter API Endpoint"
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#a855f7] placeholder-[#52525b]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1 relative">
                    <label className="text-[9px] text-[#71717a] block">
                      API Key {llmProvider === "ollama" && "(Optional)"}
                    </label>
                    <div className="relative">
                      <input
                        type={showLlmApiKey ? "text" : "password"}
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                        placeholder={llmProvider === "ollama" ? "None (keyless)" : "sk-..."}
                        className="w-full bg-[#18181b] border border-[#27272a] rounded pl-2.5 pr-8 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#a855f7] placeholder-[#52525b]"
                      />
                      {llmApiKey && (
                        <button
                          type="button"
                          onClick={() => setShowLlmApiKey(!showLlmApiKey)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#f4f4f5]"
                        >
                          {showLlmApiKey ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-[#71717a] block">Model</label>
                    <input
                      type="text"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      placeholder="e.g. gpt-4o-mini"
                      className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1 text-[10px] text-[#f4f4f5] outline-none focus:border-[#a855f7] placeholder-[#52525b]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#27272a]/50">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-[#71717a]">Rotation Priority</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={llmPriority}
                      onChange={(e) => setLlmPriority(parseInt(e.target.value) || 1)}
                      className="w-12 bg-[#18181b] border border-[#27272a] rounded px-1.5 py-0.5 text-[10px] text-[#f4f4f5] text-center outline-none focus:border-[#a855f7] tabular-nums"
                    />
                    <span className="text-[8px] text-[#52525b]">(1 = Primary, 2 = Fallback...)</span>
                  </div>

                  <button
                    type="submit"
                    disabled={addLlmKeyMutation.isPending}
                    className="px-3 py-1 bg-[#a855f7] hover:bg-[#9333ea] text-white rounded text-[10px] font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    {addLlmKeyMutation.isPending ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Plus size={10} />
                    )}
                    Add to Pool
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Appearance (Theme) - Always displayed at bottom for convenience */}
        <div className="px-4 py-3 border-t border-[#27272a] bg-[#18181b] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Palette size={12} className="text-[#a855f7]" />
            <span className="text-[9px] font-semibold text-[#f4f4f5]">Theme Selector</span>
          </div>
          <div className="scale-90 origin-right">
            <ThemeSwitcher />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#27272a] bg-[#0c0c0e] flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-[#27272a] rounded text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b] text-xs font-semibold transition-colors"
          >
            Close Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
