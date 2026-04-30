import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DashboardProvider, useDashboard, useActiveRun } from "./useDashboard.tsx";
import type { Run } from "../types.ts";

const mockRun: Run = {
	id: "run-1",
	startedAt: "2026-04-30T12:00:00Z",
	events: [],
};

const mockRuns: Run[] = [
	mockRun,
	{
		id: "run-2",
		startedAt: "2026-04-30T13:00:00Z",
		events: [],
	},
];

function wrapper({ children }: { children: React.ReactNode }) {
	return <DashboardProvider>{children}</DashboardProvider>;
}

describe("useDashboard", () => {
	it("throws when used outside DashboardProvider", () => {
		// Suppress console.error for this expected throw
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => renderHook(() => useDashboard())).toThrow(
			"useDashboard must be used within a DashboardProvider",
		);
		spy.mockRestore();
	});

	it("returns state and dispatch inside provider", () => {
		const { result } = renderHook(() => useDashboard(), { wrapper });
		expect(result.current.state.runs).toEqual([]);
		expect(result.current.state.activeRunIndex).toBe(0);
		expect(typeof result.current.dispatch).toBe("function");
	});

	it("dispatches SET_RUNS and updates state", () => {
		const { result } = renderHook(() => useDashboard(), { wrapper });
		act(() => {
			result.current.dispatch({ type: "SET_RUNS", payload: mockRuns });
		});
		expect(result.current.state.runs).toHaveLength(2);
		expect(result.current.state.activeRunIndex).toBe(0);
	});

	it("dispatches SET_ACTIVE_RUN and updates index", () => {
		const { result } = renderHook(() => useDashboard(), { wrapper });
		act(() => {
			result.current.dispatch({ type: "SET_RUNS", payload: mockRuns });
		});
		act(() => {
			result.current.dispatch({ type: "SET_ACTIVE_RUN", payload: 1 });
		});
		expect(result.current.state.activeRunIndex).toBe(1);
	});

	it("dispatches ADD_RUN", () => {
		const { result } = renderHook(() => useDashboard(), { wrapper });
		act(() => {
			result.current.dispatch({ type: "ADD_RUN", payload: mockRun });
		});
		expect(result.current.state.runs).toHaveLength(1);
		expect(result.current.state.runs[0].id).toBe("run-1");
	});

	it("dispatches APPEND_EVENT", () => {
		const { result } = renderHook(() => useDashboard(), { wrapper });
		act(() => {
			result.current.dispatch({ type: "ADD_RUN", payload: mockRun });
		});
		act(() => {
			result.current.dispatch({
				type: "APPEND_EVENT",
				payload: {
					runId: "run-1",
					event: {
						id: "evt-1",
						timestamp: "2026-04-30T12:00:00Z",
						type: "test",
						severity: "info",
						payload: {},
					},
				},
			});
		});
		expect(result.current.state.runs[0].events).toHaveLength(1);
	});
});

describe("useActiveRun", () => {
	it("returns undefined when no runs exist", () => {
		const { result } = renderHook(() => useActiveRun(), { wrapper });
		expect(result.current).toBeUndefined();
	});

	it("returns the active run", () => {
		const { result } = renderHook(() => useActiveRun(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={mockRuns}>{children}</DashboardProvider>
			),
		});
		expect(result.current?.id).toBe("run-1");
	});

	it("follows activeRunIndex changes", () => {
		function useCombined() {
			const { state, dispatch } = useDashboard();
			const activeRun = useActiveRun();
			return { state, dispatch, activeRun };
		}

		const { result } = renderHook(() => useCombined(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={mockRuns}>{children}</DashboardProvider>
			),
		});

		expect(result.current.activeRun?.id).toBe("run-1");
		act(() => {
			result.current.dispatch({ type: "SET_ACTIVE_RUN", payload: 1 });
		});
		expect(result.current.activeRun?.id).toBe("run-2");
	});
});
