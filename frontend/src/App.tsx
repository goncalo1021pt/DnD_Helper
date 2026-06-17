import { Navigate, Route, Routes } from "react-router-dom";
import { useCurrentUser } from "./hooks";
import LoginScreen from "./components/LoginScreen";
import AppShell from "./components/AppShell";
import CampaignsPage from "./components/CampaignsPage";
import CampaignView from "./components/CampaignView";

export default function App() {
  const { data: me, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-parchment/70">
        Loading…
      </div>
    );
  }

  if (!me) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppShell user={me.user} />}>
        <Route index element={<CampaignsPage />} />
        <Route path="campaigns/:id" element={<CampaignView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
