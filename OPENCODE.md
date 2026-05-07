# OPENCODE.md — Schema compartido OpenCode + Antigravity

## Chain of Thought (CoT)

Antes de ejecutar cualquier tarea, razoná en estos 4 pasos:

1. **UNDERSTAND** — Qué pide exactamente el usuario. Reformulá en tus palabras.
2. **SCOPE** — Qué archivos/módulos se tocan. Usá GitNexus para blast radius.
3. **PLAN** — Secuencia atómica de pasos. Si son 3+ archivos, usá el workflow SDD.
4. **EXECUTE** — Un paso a la vez. Verificá cada paso antes del siguiente.

## División de Tareas por Herramienta

| Herramienta | Rol | Modelo |
|---|---|---|
| **OpenCode (terminal)** | Backend, análisis, debug, arquitectura, planificación, GSD workflows | deepseek-v4-pro |
| **Antigravity (GUI)** | Frontend, UI, edición visual, HTML/CSS, diseño, GSD workflows | kimi-k2.6 |

### Reglas

- Si la tarea es **backend-heavy** (APIs, DB, lógica, Rust/TS server) → OpenCode
- Si la tarea es **frontend/visual** (componentes, estilos, layouts, HTML) → Antigravity
- Si la tarea es **cross-cutting** (afecta 3+ módulos) → SDD workflow en AGENTS.md
- Si hay **conflicto potencial** → Git worktree separado (GSD lo maneja)

## Worktree Isolation

Cada herramienta trabaja en su propio worktree:

```
Apohara (main)
├── gsd/phase-{n}-backend    → OpenCode
└── gsd/phase-{n}-frontend   → Antigravity
```

No editar el mismo archivo desde ambas herramientas simultáneamente.

## Conocimiento Compartido

- **GitNexus**: blast radius, codebase navigation, execution flows
- **Serena**: operaciones semánticas LSP, rename seguro, find references
- **Engram**: memoria persistente (3 capas: project/action/detail)
- **Repomix**: contexto estructural completo en `.repomix/output.md`

## Lint de Conocimiento (Health Check)

Cada 5 sesiones o cuando el usuario lo pida, ejecutar vía Engram:

1. **Contradicciones**: buscar afirmaciones conflictivas en la memoria del proyecto
2. **Datos obsoletos**: entries sin acceso en 90+ días → flaggear para revisión
3. **Huérfanos**: conceptos sin referencias cruzadas → sugerir conexiones
4. **Cobertura**: módulos sin entries en Engram → sugerir documentar

Comando de referencia: `engram search --query "contradiction OR outdated"`

## Decisiones Arquitectónicas

Para decisiones críticas, usar GSD con sus agentes especializados:

- `gsd-planner` / `gsd-advisor` → deepseek-v4-pro (razonamiento profundo)
- `gsd-debugger` → deepseek-v4-pro (diagnóstico)
- `gsd-verifier` → kimi-k2.6 (validación de calidad)

El workflow SDD en AGENTS.md define el proceso completo de 6 fases.
