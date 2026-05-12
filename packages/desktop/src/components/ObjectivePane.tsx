import { useState } from "react";

interface ObjectivePaneProps {
	active: boolean;
	onRun: (sessionId: string) => void;
}

export function ObjectivePane({ active, onRun }: ObjectivePaneProps) {
	const [prompt, setPrompt] = useState("");
	const [enhanced, setEnhanced] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleEnhance() {
		setBusy(true);
		try {
			const r = await fetch("/api/enhance", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt }),
			});
			const data = (await r.json()) as { enhanced: string };
			setEnhanced(data.enhanced);
		} finally {
			setBusy(false);
		}
	}

	async function handleRun() {
		setBusy(true);
		try {
			const r = await fetch("/api/run", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: enhanced ?? prompt }),
			});
			const data = (await r.json()) as { sessionId: string };
			onRun(data.sessionId);
		} finally {
			setBusy(false);
		}
	}

	return (
		<aside className="pane pane-objective">
			<h2 className="pane-title">Objective</h2>
			<textarea
				className="objective-input"
				placeholder="Describe what to build…"
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
				disabled={active || busy}
				rows={8}
			/>
			<div className="objective-actions">
				<button
					type="button"
					onClick={handleEnhance}
					disabled={!prompt || active || busy}
				>
					Enhance ▾
				</button>
				<button
					type="button"
					className="primary"
					onClick={handleRun}
					disabled={!prompt || active || busy}
				>
					Run ▶
				</button>
			</div>
			{enhanced && (
				<div className="enhanced">
					<h3>Enhanced</h3>
					<pre className="mono">{enhanced}</pre>
				</div>
			)}
		</aside>
	);
}
