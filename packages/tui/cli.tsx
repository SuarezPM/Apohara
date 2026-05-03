import React from "react";
import { render, Text } from "ink";
import { DashboardApp } from "./components/DashboardApp.tsx";

if (!process.stdin.isTTY) {
	render(<Text dimColor>Dashboard requires an interactive terminal (TTY).</Text>);
	process.exit(1);
}

render(<DashboardApp />);
