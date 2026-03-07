import { SocketProvider } from './contexts/SocketContext';
import { StatusBar } from './views/Dashboard/StatusBar';
import { ObserveView } from './views/Observe/ObserveView';

function App() {
  return (
    <SocketProvider>
      <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50">
        <div className="sticky top-0 z-10">
          <StatusBar />
        </div>
        <div className="flex flex-1 min-h-0 flex-col">
          <ObserveView />
        </div>
      </div>
    </SocketProvider>
  );
}

export default App;
