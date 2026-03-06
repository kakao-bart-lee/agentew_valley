import { SocketProvider } from './contexts/SocketContext';
import { DashboardView } from './views/Dashboard/DashboardView';
import { StatusBar } from './views/Dashboard/StatusBar';
import { useAgentStore } from './stores/agentStore';
import { ObserveView } from './views/Observe/ObserveView';
import { WorkView } from './views/Work/WorkView';
import { ControlView } from './views/Control/ControlView';
import { AdminView } from './views/Admin/AdminView';

function App() {
  const activeView = useAgentStore((state) => state.activeView);

  return (
    <SocketProvider>
      <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50">
        <div className="sticky top-0 z-10">
          <StatusBar />
        </div>
        <div className="flex-1 flex flex-col">
          <div className={activeView === 'overview' ? 'flex flex-col flex-1' : 'hidden'}><DashboardView mode="overview" /></div>
          <div className={activeView === 'observe' ? 'flex flex-col flex-1' : 'hidden'}><ObserveView /></div>
          <div className={activeView === 'work' ? 'flex flex-col flex-1' : 'hidden'}><WorkView /></div>
          <div className={activeView === 'control' ? 'flex flex-col flex-1' : 'hidden'}><ControlView /></div>
          <div className={activeView === 'admin' ? 'flex flex-col flex-1' : 'hidden'}><AdminView /></div>
        </div>
      </div>
    </SocketProvider>
  );
}

export default App;
