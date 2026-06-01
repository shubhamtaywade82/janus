import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Janus Error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#09090b",
          color: "#f4f4f5",
          fontFamily: "monospace",
          padding: "20px",
          textAlign: "center",
        }}>
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #22c55e, #16a34a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            fontWeight: "bold",
            marginBottom: "16px",
          }}>J</div>
          <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>JANUS</h2>
          <p style={{ fontSize: "12px", color: "#ef4444", marginBottom: "16px" }}>
            Something went wrong
          </p>
          <pre style={{
            fontSize: "10px",
            color: "#71717a",
            background: "#18181b",
            padding: "12px",
            borderRadius: "8px",
            maxWidth: "500px",
            overflow: "auto",
            textAlign: "left",
            border: "1px solid #27272a",
          }}>
            {this.state.error?.message || "Unknown error"}
            {"\n"}
            {this.state.error?.stack?.split("\n").slice(0, 4).join("\n")}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "16px",
              padding: "8px 16px",
              background: "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
