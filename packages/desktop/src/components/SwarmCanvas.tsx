import type { EventLog } from "../lib/types.js";

interface SwarmCanvasProps {
	events: EventLog[];
}

/**
 * The center pane: DAG of decomposed tasks + agent lanes with live progress.
 * M017.4 target. This v0 stub renders a flat task list. Real @xyflow/react
 * graph + animated lanes land in M017.4 proper.
 */
export function SwarmCanvas({ events }: SwarmCanvasProps) {
	const tasks = events.filter(
		(e) => e.type === "task_scheduled" || e.type === "task_completed",
	);

	return (
		<section className="pane pane-canvas">
			<h2 className="pane-title">Swarm</h2>
			{tasks.length === 0 ? (
				<div className="empty">DAG appears here once an objective is decomposed</div>
			) : (
				<ul className="task-list">
					{tasks.map((t) => (
						<li key={t.id} className={`task task-${t.severity}`}>
							<span className="task-type mono">{t.type}</span>
							<span className="task-id mono">{t.taskId ?? "—"}</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
