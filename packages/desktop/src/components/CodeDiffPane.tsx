import type { EventLog } from "../lib/types.js";

interface CodeDiffPaneProps {
	events: EventLog[];
}

/**
 * Right pane: file tree + Monaco diff + verification mesh.
 * M017.5 target. v0 stub renders file_created / file_modified events.
 */
export function CodeDiffPane({ events }: CodeDiffPaneProps) {
	const fileEvents = events.filter(
		(e) => e.type === "file_created" || e.type === "file_modified",
	);
	const meshEvents = events.filter((e) => e.type === "mesh_verdict");

	return (
		<aside className="pane pane-code">
			<h2 className="pane-title">Code + Diff</h2>
			{fileEvents.length === 0 ? (
				<div className="empty">Modified files appear here</div>
			) : (
				<ul className="file-list">
					{fileEvents.map((e) => (
						<li key={e.id} className="file-row mono">
							<span className={`file-status file-status-${e.type === "file_created" ? "new" : "mod"}`}>
								{e.type === "file_created" ? "+" : "~"}
							</span>
							<span className="file-path">
								{typeof e.payload?.path === "string" ? e.payload.path : "?"}
							</span>
						</li>
					))}
				</ul>
			)}
			{meshEvents.length > 0 && (
				<div className="mesh-panel">
					<h3>Verification</h3>
					<ul>
						{meshEvents.map((e) => (
							<li key={e.id} className="mono">
								{String(e.payload?.verdict ?? "—")}
							</li>
						))}
					</ul>
				</div>
			)}
		</aside>
	);
}
