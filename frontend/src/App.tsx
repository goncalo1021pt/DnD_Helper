import { Navigate, Route, Routes } from "react-router-dom";
import { useCurrentUser } from "./hooks";
import LandingPage from "./components/LandingPage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./components/EmailFlowPages";
import AppShell from "./components/AppShell";
import CampaignsPage from "./components/CampaignsPage";
import ProfilePage from "./components/ProfilePage";
import ForgeWizard from "./components/ForgeWizard";
import HeroSheetPage from "./components/HeroSheetPage";
import ArchivesPage from "./components/ArchivesPage";
import CodexPage from "./components/CodexPage";
import MapPage from "./components/MapPage";
import DenPage from "./components/DenPage";
import BestiaryPage from "./components/BestiaryPage";
import ChroniclePage from "./components/ChroniclePage";
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
      {/* The landing is the front door for strangers; a signed-in visitor
          walks straight into the tavern. */}
      <Route
        index
        element={me ? <Navigate to="/questboard" replace /> : <LandingPage />}
      />

      {/* Email flows — reachable logged out (links arrive by email). */}
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />

      {/* The tavern proper lives under /questboard and needs a seat at the table. */}
      <Route
        path="questboard"
        element={me ? <AppShell user={me.user} /> : <Navigate to="/" replace />}
      >
        <Route index element={<CampaignsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* the heroes roster moved into the profile; deep hero routes stay */}
        <Route path="heroes" element={<Navigate to="/questboard/profile" replace />} />
        <Route path="heroes/forge" element={<ForgeWizard />} />
        <Route path="heroes/:heroId" element={<HeroSheetPage />} />
        <Route path="archives" element={<ArchivesPage />} />
        {/* old shelves point at the merged library */}
        <Route path="spellbook" element={<Navigate to="/questboard/archives" replace />} />
        <Route path="scribe" element={<Navigate to="/questboard/archives" replace />} />
        <Route path="campaigns/:id" element={<CampaignView />}>
          <Route index element={<CampaignDashboard />} />
          <Route path="board" element={<QuestBoard />} />
          <Route path="party" element={<PartyRoster />} />
          <Route path="codex" element={<CodexPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="map/:mapId" element={<MapPage />} />
          <Route path="den" element={<DenPage />} />
          <Route path="bestiary" element={<BestiaryPage />} />
          <Route path="chronicle" element={<ChroniclePage />} />
          <Route path="trees" element={<SkillTreesPage />} />
          <Route path="trees/:treeId" element={<TreeEditorPage />} />
          <Route path="characters/:charId/web" element={<CharacterWebPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
