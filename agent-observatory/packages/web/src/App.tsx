import { DashboardView } from './views/Dashboard/DashboardView';
import { PixelCanvasView } from './views/Pixel/PixelCanvasView';
import { SessionsView } from './views/Sessions/SessionsView';
import { StatusBar } from './views/Dashboard/StatusBar';
import { useAgentStore } from './stores/agentStore';
import { useSocket } from './hooks/useSocket';

function App() {
  useSocket(); // Initialize WebSocket connection globally
  const activeView = useAgentStore(state => state.activeView);

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50">
      <div className="sticky top-0 z-10">
        <StatusBar />
      </div>
      <div className="flex-1 flex flex-col">
        {activeView === 'dashboard' && <DashboardView />}
        {activeView === 'pixel' && <PixelCanvasView />}
        {activeView === 'sessions' && <SessionsView />}
      </div>
    </div>
  );
}

export default App;
