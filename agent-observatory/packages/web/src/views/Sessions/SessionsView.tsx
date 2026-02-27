import { useState } from 'react';
import { SessionListView } from './SessionListView';
import { SessionReplayView } from './SessionReplayView';

export function SessionsView() {
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    if (selectedSessionId) {
        return (
            <SessionReplayView
                sessionId={selectedSessionId}
                onBack={() => setSelectedSessionId(null)}
            />
        );
    }

    return <SessionListView onSelectSession={setSelectedSessionId} />;
}
