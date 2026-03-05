import { SocketProvider } from './contexts/SocketContext';
import { DashboardView } from './views/Dashboard/DashboardView';
import { PixelCanvasView } from './views/Pixel/PixelCanvasView';
import { SessionsView } from './views/Sessions/SessionsView';
import { MissionControlView } from './views/MissionControl/MissionControlView';
import { StatusBar } from './views/Dashboard/StatusBar';
import { useAgentStore } from './stores/agentStore';

function App() {
  const activeView = useAgentStore(state => state.activeView);

  return (
    <SocketProvider>
      <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50">
        <div className="sticky top-0 z-10">
          <StatusBar />
        </div>
        <div className="flex-1 flex flex-col">
          {/* hidden 처리로 언마운트 없이 뷰 전환 — fetch 재실행 방지 */}
          <div className={activeView === 'dashboard' ? 'flex flex-col flex-1' : 'hidden'}><DashboardView /></div>
          <div className={activeView === 'pixel' ? 'flex flex-col flex-1' : 'hidden'}><PixelCanvasView /></div>
          <div className={activeView === 'sessions' ? 'flex flex-col flex-1' : 'hidden'}><SessionsView /></div>
          {activeView === 'mission-control' ? (
            <div className="flex flex-col flex-1"><MissionControlView /></div>
          ) : null}
        </div>
      </div>
    </SocketProvider>
  );
}

export default App;
