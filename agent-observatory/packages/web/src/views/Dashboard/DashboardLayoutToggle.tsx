import type { DashboardLayoutMode } from '../../utils/dashboardLayout';

interface DashboardLayoutToggleProps {
    value: DashboardLayoutMode;
    onChange: (mode: DashboardLayoutMode) => void;
}

const OPTIONS: Array<{ id: DashboardLayoutMode; label: string; description: string }> = [
    { id: 'focus', label: 'Focus', description: 'Agents first, activity on the side, metrics below.' },
    { id: 'classic', label: 'Classic', description: 'Current three-panel live console layout.' },
];

export function DashboardLayoutToggle({ value, onChange }: DashboardLayoutToggleProps) {
    return (
        <div className="flex items-center justify-end">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/70 p-1">
                <span className="px-2 text-xs uppercase tracking-[0.16em] text-slate-500">Layout</span>
                {OPTIONS.map((option) => (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => onChange(option.id)}
                        aria-pressed={value === option.id}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            value === option.id
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:bg-slate-700/80 hover:text-slate-100'
                        }`}
                        title={option.description}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
