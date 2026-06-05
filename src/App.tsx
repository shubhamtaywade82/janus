import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Signals from "./pages/Signals";
import Portfolio from "./pages/Portfolio";
import Logs from "./pages/Logs";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import RiskMetrics from "./pages/RiskMetrics";
import AiAnalysis from "./pages/AiAnalysis";
import { Toaster } from "./components/ui/sonner";

const App = () => {
  return (
    <>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Layout>
            <Dashboard />
          </Layout>
        }
      />
      <Route
        path="/signals"
        element={
          <Layout>
            <Signals />
          </Layout>
        }
      />
      <Route
        path="/ai-analysis"
        element={
          <Layout>
            <AiAnalysis />
          </Layout>
        }
      />
      <Route
        path="/portfolio"
        element={
          <Layout>
            <Portfolio />
          </Layout>
        }
      />
      <Route
        path="/logs"
        element={
          <Layout>
            <Logs />
          </Layout>
        }
      />
      <Route
        path="/risk"
        element={
          <Layout>
            <RiskMetrics />
          </Layout>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
    <Toaster position="bottom-right" theme="dark" richColors closeButton />
    </>
  );
};

export default App;
