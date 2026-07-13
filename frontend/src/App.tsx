import { Navigate, Route, Routes } from "react-router-dom";
import { useCurrentUser } from "./hooks";
import LandingPage from "./components/LandingPage";
import AppShell from "./components/AppShell";
import CampaignsPage from "./components/CampaignsPage";
import MyHeroesPage from "./components/MyHeroesPage";
import ForgeWizard from "./components/ForgeWizard";
import HeroSheetPage from "./components/HeroSheetPage";
import ScribesDesk from "./components/ScribesDesk";
import CodexPage from "./components/CodexPage";
import CampaignView from "./components/CampaignView";
import CampaignDashboard from "./components/CampaignDashboard";
import QuestBoard from "./components/QuestBoard";
import PartyRoster from "./components/PartyRoster";
import SkillTreesPage from "./components/SkillTreesPage";
import TreeEditorPage from "./components/TreeEditorPage";
import CharacterWebPage from "./components/CharacterWebPage";

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
        <Route path="heroes" element={<MyHeroesPage />} />
        <Route path="heroes/forge" element={<ForgeWizard />} />
        <Route path="heroes/:heroId" element={<HeroSheetPage />} />
        <Route path="scribe" element={<ScribesDesk />} />
        <Route path="campaigns/:id" element={<CampaignView />}>
          <Route index element={<CampaignDashboard />} />
          <Route path="board" element={<QuestBoard />} />
          <Route path="party" element={<PartyRoster />} />
          <Route path="codex" element={<CodexPage />} />
          <Route path="trees" element={<SkillTreesPage />} />
          <Route path="trees/:treeId" element={<TreeEditorPage />} />
          <Route path="characters/:charId/web" element={<CharacterWebPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
