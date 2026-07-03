import { Navigate, Route, Routes } from "react-router-dom";
import { useCurrentUser } from "./hooks";
import LandingPage from "./components/LandingPage";
import AppShell from "./components/AppShell";
import CampaignsPage from "./components/CampaignsPage";
import CampaignView from "./components/CampaignView";

export default function App() {
  const { data: me, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="bg-hearth font-accent flex min-h-screen items-center justify-center text-lg italic text-[#c89a5a]">
        Stoking the hearth…
      </div>
    );
  }

  return (
    <Routes>
      {/* The landing is always the front door, signed in or not. */}
      <Route index element={<LandingPage me={me ?? null} />} />

      {/* The tavern proper lives under /questboard and needs a seat at the table. */}
      <Route
        path="questboard"
        element={me ? <AppShell user={me.user} /> : <Navigate to="/" replace />}
      >
        <Route index element={<CampaignsPage />} />
        <Route path="campaigns/:id" element={<CampaignView />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
